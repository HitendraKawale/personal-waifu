import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Object3D } from 'three';
import { createInteractions } from '../src/interactions.js';

const url = process.argv[2];
assert(url, 'Usage: npm run test:smoke -- <running-app-url>');
const origin = new URL(url).origin;
const browser = await chromium.launch({ channel: 'chrome' });
const controls = ['Rotate left', 'Rotate right', 'Zoom in', 'Zoom out', 'Reset view'];
const newPage = (options = {}) => browser.newPage({ reducedMotion: 'reduce', ...options });

function within(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser operation exceeded 15 seconds')), 15000); }),
  ]).finally(() => clearTimeout(timer));
}

// Measure rendered pixels, not private camera state, to catch reversed zoom controls.
async function characterPixels(canvas) {
  return within(canvas.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => {
    const gl = element.getContext('webgl2');
    const pixels = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const contrast = Math.abs(pixels[i] - pixels[0])
        + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]);
      if (contrast > 60) count++;
    }
    resolve(count);
  }))));
}

// Frontal face crops for the two bundled assets, excluding their moving hair.
async function faceImage(page, id) {
  const canvas = page.locator('#viewer canvas');
  const image = await canvas.screenshot();
  const crop = await page.evaluate(async ({ image, id }) => {
    const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const face = document.createElement('canvas');
    face.width = Math.round(bitmap.height * 0.08);
    face.height = Math.round(bitmap.height * 0.075);
    face.getContext('2d').drawImage(bitmap,
      Math.round(bitmap.width / 2 - bitmap.height * (id === 'seed-san' ? 0.23 : 0.04)),
      Math.round(bitmap.height * 0.14), face.width, face.height,
      0, 0, face.width, face.height);
    bitmap.close();
    return face.toDataURL('image/png').split(',')[1];
  }, { image: image.toString('base64'), id });
  return Buffer.from(crop, 'base64');
}

async function imageDifference(page, first, second) {
  return page.evaluate(async (images) => {
    const canvas = document.createElement('canvas');
    const frames = [];
    for (const image of images) {
      const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      frames.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
      bitmap.close();
    }
    let difference = 0;
    for (let i = 0; i < frames[0].length; i++) {
      if (i % 4 !== 3) difference += Math.abs(frames[0][i] - frames[1][i]);
    }
    return difference / (canvas.width * canvas.height * 3);
  }, [first.toString('base64'), second.toString('base64')]);
}

function watchErrors(page, expectedModelFailure = null) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`));
  page.on('response', (response) => {
    if (expectedModelFailure && response.url() === `${origin}${expectedModelFailure}` && response.status() === 404) return;
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) errors.push(`External request: ${request.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (expectedModelFailure && ((message.text().startsWith('Character loading failed:') && message.text().includes(expectedModelFailure))
      || (message.location().url === `${origin}${expectedModelFailure}` && message.text().includes('404')))) return;
    errors.push(message.text());
  });
  return errors;
}

try {
  {
    const spine = new Object3D();
    const base = spine.quaternion.clone();
    const controller = createInteractions({ humanoid: { getNormalizedBoneNode: (name) => name === 'spine' ? spine : null } });
    controller.update(1, { motionEnabled: true, gazeTarget: null });
    const first = spine.quaternion.clone();
    assert(first.angleTo(base) > 0.008 && first.angleTo(base) <= Math.PI / 240, 'Idle must rotate the real bone within 0.75 degrees');
    controller.update(5, { motionEnabled: true, gazeTarget: null });
    assert(first.angleTo(spine.quaternion) < 0.000001, 'Bone rotation must repeat without accumulating');
    controller.update(0, { motionEnabled: false, gazeTarget: null });
    assert(base.angleTo(spine.quaternion) < 0.000001, 'Disabling motion restores the bone');
    console.log('PASS idle bone: bounded rotation, periodic update, base-pose restoration');
  }

  for (const id of ['starter', 'seed-san']) {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor();
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.getByRole('status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    const smile = page.getByRole('button', { name: 'Smile', exact: true });
    assert(await smile.isVisible(), 'The character needs an accessible Smile button');
    assert(!(await page.getByLabel('Automatic motion', { exact: true }).isChecked()), 'Reduced motion starts still');
    const neutral = await faceImage(page, id);
    for (const name of ['Smile', 'Surprise']) {
      await page.getByRole('button', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
      assert(await imageDifference(page, neutral, await faceImage(page, id)) > 1, `${id} ${name} must visibly change the face`);
      await page.getByRole('button', { name: 'Reset character', exact: true }).click();
      assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.5, `${id} reset must restore the neutral face`);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS expressions ${id}: visible reactions, keyboard activation, neutral reset`);
    await page.close();
  }

  for (const id of ['starter', 'seed-san']) {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.goto(url);
    await page.locator('#status').filter({ hasText: 'Character ready' }).waitFor();
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.locator('#status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    const canvas = page.locator('#viewer canvas');
    const neutral = await faceImage(page, id);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2 - (id === 'seed-san' ? box.height * 0.19 : 0);
    const y = box.y + box.height * 0.45;
    await page.mouse.click(x, y);
    assert(await imageDifference(page, neutral, await faceImage(page, id)) > 1, 'A character hit must trigger Smile');
    await page.getByRole('button', { name: 'Reset character', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const currentBox = await canvas.boundingBox();
    const point = { x: currentBox.x + currentBox.width / 2 - (id === 'seed-san' ? currentBox.height * 0.19 : 0), y: currentBox.y + currentBox.height * 0.45 };
    await page.mouse.click(currentBox.x + 10, currentBox.y + 10);
    assert.equal(await page.locator('#reaction-status').textContent(), 'Character reset.', 'Background clicks do not react');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y, { steps: 4 });
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.locator('#reaction-status').textContent(), 'Character reset.', 'A drag returning to its start is not a click');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }, { x: point.x + 30, y: point.y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('#reaction-status').textContent(), 'Character reset.', 'Multi-touch does not react');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await cdp.detach();
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.5, 'Cancelled gestures keep the neutral face');
    assert.deepEqual(errors, []);
    console.log(`PASS gestures ${id}: character hit, background miss, drag rejection, multi-touch and cancellation`);
    await page.close();
  }

  for (const id of ['starter', 'seed-san']) {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
    await page.goto(url);
    await page.locator('#status').filter({ hasText: 'Character ready' }).waitFor();
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.locator('#status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    await page.clock.pauseAt(new Date('2025-01-01T01:00:00Z'));
    const gaze = page.getByLabel('Follow pointer', { exact: true });
    assert(!(await gaze.isChecked()), 'Gaze is opt-in');
    await page.getByRole('button', { name: 'Reset character', exact: true }).click();
    await page.clock.runFor(2000);
    const neutral = await faceImage(page, id);
    await gaze.check();
    const canvas = page.locator('#viewer canvas');
    await canvas.scrollIntoViewIfNeeded();
    let box = await canvas.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.clock.runFor(600);
    const looking = await faceImage(page, id);
    const gazeDifference = await imageDifference(page, neutral, looking);
    assert(gazeDifference > 0.1, `${id} gaze must change the rendered eyes: ${gazeDifference}`);
    await page.mouse.move(1, 1);
    await page.clock.runFor(64);
    assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.2, 'Pointer leave clears gaze');
    for (const action of ['drag', 'off', 'reset', 'switch']) {
      if (!(await gaze.isChecked())) await gaze.check();
      await canvas.scrollIntoViewIfNeeded();
      box = await canvas.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.clock.runFor(600);
      if (action === 'drag') await page.mouse.down();
      if (action === 'off') await gaze.press('Space');
      if (action === 'reset') await page.getByRole('button', { name: 'Reset character', exact: true }).press('Enter');
      if (action === 'switch') {
        for (const target of [id === 'starter' ? 'seed-san' : 'starter', id]) {
          await page.getByLabel('Character', { exact: true }).selectOption(target);
          const name = target === 'starter' ? 'pixiv sample avatar' : 'Seed-san';
          await page.locator('#status').filter({ hasText: `Character ready: ${name}` }).waitFor();
        }
      }
      await page.clock.runFor(2000);
      assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.2, `${action} clears gaze until a fresh pointer move`);
      if (action === 'drag') await page.mouse.up();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS gaze ${id}: rendered eye change ${gazeDifference.toFixed(2)}, leave, drag, off, reset, switching`);
    await page.close();
  }

  for (const id of ['starter', 'seed-san']) {
    const page = await newPage({ reducedMotion: 'no-preference' });
    const errors = watchErrors(page);
    await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
    await page.goto(url);
    await page.locator('#status').filter({ hasText: 'Character ready' }).waitFor();
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.locator('#status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    await page.clock.pauseAt(new Date('2025-01-01T01:00:00Z'));
    const motion = page.getByLabel('Automatic motion', { exact: true });
    const reset = page.getByRole('button', { name: 'Reset character', exact: true });
    assert(await motion.isChecked(), 'Motion defaults on without a reduced-motion preference');
    await motion.uncheck();
    await reset.click();
    // Settle the avatar's existing spring bones before taking the still baseline.
    await page.clock.runFor(2000);
    const canvas = page.locator('#viewer canvas');
    const neutral = await faceImage(page, id);
    const still = await canvas.screenshot();
    await motion.check();
    await reset.click();
    await page.clock.runFor(1000);
    const sway = await canvas.screenshot();
    assert(await imageDifference(page, still, sway) > 0.02, 'Idle motion must visibly change the pose');
    await page.clock.runFor(5000);
    assert(await imageDifference(page, sway, await canvas.screenshot()) < 0.5, 'Sway must repeat without accumulating rotation');
    await reset.click();
    await page.clock.runFor(3984);
    const beforeBlink = await faceImage(page, id);
    await page.clock.runFor(96);
    const closedEyes = await faceImage(page, id);
    assert(await imageDifference(page, beforeBlink, closedEyes) > 1, 'The scheduled blink must close the eyes');
    await page.clock.runFor(160);
    assert(await imageDifference(page, closedEyes, await faceImage(page, id)) > 1, 'The blink must reopen the eyes');
    await motion.uncheck();
    await page.clock.runFor(2000);
    const stoppedFace = await faceImage(page, id);
    const motionOffDifference = await imageDifference(page, neutral, stoppedFace);
    assert(motionOffDifference < 0.5, `Motion off restores the base pose and clears blinking: ${motionOffDifference}`);
    await page.getByRole('button', { name: 'Smile', exact: true }).click();
    await page.clock.runFor(5000);
    assert(await imageDifference(page, neutral, await faceImage(page, id)) > 1, 'Motion off holds a manually chosen expression');
    await motion.check();
    await reset.click();
    await page.getByRole('button', { name: 'Smile', exact: true }).click();
    await page.clock.runFor(1600);
    await motion.uncheck();
    await page.clock.runFor(2000);
    assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.5, 'Automatic reactions expire after 1.5 seconds');
    await motion.check();
    await page.getByLabel('Follow pointer', { exact: true }).check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('#automatic-motion').checked, null, { polling: 50, timeout: 5000 });
    await page.clock.runFor(32);
    assert(!(await motion.isChecked()), 'A live reduced-motion preference disables automatic motion');
    assert(!(await page.getByLabel('Follow pointer', { exact: true }).isChecked()), 'A live reduced-motion preference disables gaze');
    assert.deepEqual(errors, []);
    console.log(`PASS timing ${id}: periodic idle, blink, reaction expiry, motion-off hold, live reduced motion`);
    await page.close();
  }

  for (const fixture of ['removed', 'unbound-bone', 'unbound-expression']) {
    const id = fixture === 'unbound-expression' ? 'seed-san' : 'starter';
    const page = await newPage();
    const errors = watchErrors(page);
    await page.route(`**/models/${id}.vrm`, async (route) => {
      const response = await route.fetch();
      const source = await response.body();
      assert.equal(source.toString('ascii', 0, 4), 'glTF');
      assert.equal(source.readUInt32LE(4), 2);
      assert.equal(source.readUInt32LE(16), 0x4e4f534a);
      const oldLength = source.readUInt32LE(12);
      const json = JSON.parse(source.subarray(20, 20 + oldLength).toString());
      const vrm = json.extensions.VRMC_vrm;
      delete vrm.expressions.preset.happy;
      delete vrm.expressions.preset.blink;
      if (fixture === 'removed') delete vrm.lookAt;
      else {
        vrm.expressions.preset.happy = {};
        if (fixture === 'unbound-bone') {
          delete vrm.humanoid.humanBones.leftEye;
          delete vrm.humanoid.humanBones.rightEye;
        } else {
          for (const name of ['lookUp', 'lookDown', 'lookLeft', 'lookRight']) delete vrm.expressions.preset[name];
        }
      }
      const encoded = Buffer.from(JSON.stringify(json));
      const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
      encoded.copy(padded);
      const header = Buffer.from(source.subarray(0, 20));
      const tail = source.subarray(20 + oldLength);
      header.writeUInt32LE(20 + padded.length + tail.length, 8);
      header.writeUInt32LE(padded.length, 12);
      await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.concat([header, padded, tail]) });
    });
    await page.goto(url);
    await page.locator('#status').filter({ hasText: 'Character ready' }).waitFor();
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.locator('#status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    assert(await page.getByRole('button', { name: 'Smile', exact: true }).isDisabled(), 'A missing or unbound expression is unavailable');
    assert(await page.getByLabel('Follow pointer', { exact: true }).isDisabled(), 'A look-at object without usable bindings is unavailable');
    for (const name of ['Smile', 'Blinking', 'Follow pointer']) assert((await page.locator('#interaction-help').textContent()).includes(name));
    assert(await page.getByLabel('Automatic motion', { exact: true }).isEnabled(), 'A usable spine still permits idle motion');
    assert(await page.getByRole('button', { name: 'Surprise', exact: true }).isEnabled());
    const neutral = await faceImage(page, id);
    await page.getByRole('button', { name: 'Surprise', exact: true }).click();
    assert(await imageDifference(page, neutral, await faceImage(page, id)) > 1, 'Supported reactions still render');
    await page.getByRole('button', { name: 'Reset character', exact: true }).click();
    assert(await imageDifference(page, neutral, await faceImage(page, id)) < 0.5);
    assert.deepEqual(errors, []);
    console.log(`PASS capabilities ${fixture}: valid VRM, unsupported controls explained, supported reaction and reset work`);
    await page.close();
  }

  for (const [width, height, id] of [
    [1280, 900, 'starter'], [1280, 900, 'seed-san'],
    [390, 844, 'starter'], [390, 844, 'seed-san'],
  ]) {
    const viewport = { width, height };
    const page = await newPage({ viewport });
    const errors = watchErrors(page);
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor({ timeout: 15000 });
    if (id === 'seed-san') {
      await page.getByLabel('Character', { exact: true }).selectOption(id);
      await page.getByRole('status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    const canvas = page.locator('#viewer canvas');
    assert(await canvas.isVisible(), 'The renderer must create a visible canvas');
    const bounds = await canvas.boundingBox();
    assert(bounds.width > 200 && bounds.height > 200, 'The canvas must have usable dimensions');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    for (const name of controls) {
      const button = page.getByRole('button', { name, exact: true });
      assert(await button.isEnabled(), `${name} must be enabled after loading`);
      await button.focus();
      await page.keyboard.press('Enter');
    }
    const initialPixels = await characterPixels(canvas);
    assert(initialPixels > 100, 'The canvas must contain a rendered character, not just a background');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert(await characterPixels(canvas) > initialPixels * 1.1, 'Zoom in must enlarge the character');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    assert(await characterPixels(canvas) < initialPixels * 0.9, 'Zoom out must shrink the character');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    assert(Math.abs(await characterPixels(canvas) / initialPixels - 1) < 0.05, 'Reset must restore the framing');
    const front = await canvas.screenshot();
    await page.getByRole('button', { name: 'Rotate left', exact: true }).click();
    assert(!front.equals(await canvas.screenshot()), 'Rotate must change the rendered view');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await canvas.hover();
    const wheelHandled = canvas.evaluate((element) => new Promise((resolve) => {
      element.addEventListener('wheel', () => requestAnimationFrame(resolve), { once: true });
    }));
    await page.mouse.wheel(0, -100);
    await within(wheelHandled);
    assert(await characterPixels(canvas) > initialPixels * 1.05, 'Scrolling over the canvas must zoom');
    assert.deepEqual(errors, [], 'No unexpected page, console, or network failures');
    console.log(`PASS viewer ${id} ${viewport.width}x${viewport.height}: rendered avatar, keyboard, zoom direction, reset, rotate, wheel, local requests`);
    await page.close();
  }

  {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor();
    const selector = page.getByLabel('Character', { exact: true });
    assert(await selector.isVisible(), 'A labeled character selector must be visible');
    const canvas = page.locator('#viewer canvas');
    const starterImage = await canvas.screenshot();
    for (const [id, name] of [['seed-san', 'Seed-san'], ['starter', 'pixiv sample avatar']]) {
      await selector.selectOption(id);
      await page.getByRole('status').filter({ hasText: `Character ready: ${name}` }).waitFor();
      assert.equal(await selector.inputValue(), id);
      assert(await page.getByRole('heading', { name, exact: true }).isVisible());
      assert((await canvas.getAttribute('aria-label')).includes(name));
      assert(await characterPixels(canvas) > 100, `${name} must render`);
      for (const label of controls) assert(await page.getByRole('button', { name: label, exact: true }).isEnabled());
      if (id === 'seed-san') assert(!starterImage.equals(await canvas.screenshot()), 'Switching must change the rendered avatar');
      const pixels = await characterPixels(canvas);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Reset view', exact: true }).click();
      assert(Math.abs(await characterPixels(canvas) / pixels - 1) < 0.05, 'Reset must frame the active avatar');
    }
    assert.deepEqual(errors, []);
    console.log('PASS character round trip: selected value, name, rendered model, controls, reset');
    await page.close();
  }

  {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const live = {};
      for (const kind of ['Buffer', 'Texture', 'Program']) {
        live[kind] = new Set();
        const prototype = WebGL2RenderingContext.prototype;
        const create = prototype[`create${kind}`];
        const remove = prototype[`delete${kind}`];
        prototype[`create${kind}`] = function (...args) {
          const resource = create.apply(this, args);
          if (resource) live[kind].add(resource);
          return resource;
        };
        prototype[`delete${kind}`] = function (resource) {
          remove.call(this, resource);
          live[kind].delete(resource);
        };
      }
      window.gpuResourceCounts = () => Object.fromEntries(Object.entries(live).map(([kind, resources]) => [kind, resources.size]));
    });
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor();
    const baseline = {};
    for (let round = 0; round < 4; round++) {
      for (const [id, name] of [['seed-san', 'Seed-san'], ['starter', 'pixiv sample avatar']]) {
        await page.getByLabel('Character', { exact: true }).selectOption(id);
        await page.getByRole('status').filter({ hasText: `Character ready: ${name}` }).waitFor();
        assert(await characterPixels(page.locator('#viewer canvas')) > 100);
        const counts = await page.evaluate(() => window.gpuResourceCounts());
        if (round === 0) baseline[id] = counts;
        else assert.deepEqual(counts, baseline[id], `GPU resources must return to the ${id} baseline after round ${round}`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS repeated switching: stable GPU handles ${JSON.stringify(baseline)}`);
    await page.close();
  }

  for (const outcome of ['success', '404', 'malformed']) {
    const page = await newPage();
    const errors = watchErrors(page, outcome === 'success' ? null : '/models/seed-san.vrm');
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor();
    const canvas = page.locator('#viewer canvas');
    const originalCanvas = await canvas.elementHandle();
    const neutralFace = await faceImage(page, 'starter');
    await page.getByLabel('Follow pointer', { exact: true }).check();
    await page.getByRole('button', { name: 'Smile', exact: true }).click();
    const reactingFace = await faceImage(page, 'starter');
    assert(await imageDifference(page, neutralFace, reactingFace) > 1);
    const selector = page.getByLabel('Character', { exact: true });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/models/seed-san.vrm', async (route) => {
      await within(gate);
      if (outcome === 'success') await route.continue();
      else await route.fulfill({ status: outcome === '404' ? 404 : 200, contentType: 'application/json', body: '{}' });
    });
    const request = page.waitForRequest('**/models/seed-san.vrm');
    await selector.selectOption('seed-san');
    await request;
    assert(await selector.isDisabled(), 'Only one character may load at a time');
    assert(await page.getByRole('heading', { name: 'pixiv sample avatar', exact: true }).isVisible());
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const previousPixels = await characterPixels(canvas);
    assert(previousPixels > 100, 'The current avatar remains rendered during loading');
    release();
    if (outcome === 'success') {
      await page.getByRole('status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    } else {
      await page.getByRole('status').filter({ hasText: 'Could not load the character' }).waitFor();
      assert(await originalCanvas.evaluate((element) => element.isConnected), 'A failed replacement must keep the canvas');
      assert.equal(await selector.inputValue(), 'starter', 'Selection must return to the active character');
      assert(await selector.isEnabled(), 'Failure must allow another attempt');
      assert(Math.abs(await characterPixels(canvas) / previousPixels - 1) < 0.05, 'Failure must preserve the current avatar and camera');
      assert(await page.getByRole('heading', { name: 'pixiv sample avatar', exact: true }).isVisible());
      await page.getByRole('button', { name: 'Reset view', exact: true }).click();
      assert(await imageDifference(page, reactingFace, await faceImage(page, 'starter')) < 0.5, 'Failed replacement retains the active reaction');
      await page.unroute('**/models/seed-san.vrm');
      await selector.selectOption('seed-san');
      await page.getByRole('status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
    }
    assert(await originalCanvas.evaluate((element) => element.isConnected), 'Switching must reuse the renderer canvas');
    assert(await characterPixels(canvas) > 100);
    assert(await page.getByLabel('Follow pointer', { exact: true }).isChecked(), 'Switching preserves gaze preference');
    assert(!(await page.getByLabel('Automatic motion', { exact: true }).isChecked()), 'Switching preserves motion preference');
    const freshFace = await faceImage(page, 'seed-san');
    await page.getByRole('button', { name: 'Reset character', exact: true }).click();
    assert(await imageDifference(page, freshFace, await faceImage(page, 'seed-san')) < 0.5, 'A new avatar starts neutral during an active reaction');
    assert.deepEqual(errors, []);
    console.log(`PASS delayed replacement ${outcome}: reaction retained on failure, fresh neutral avatar, preferences preserved, camera usable`);
    await page.close();
  }

  {
    const page = await newPage();
    const errors = watchErrors(page);
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/models/seed-san.vrm', async (route) => {
      await within(gate);
      await route.continue();
    });
    const request = page.waitForRequest('**/models/seed-san.vrm');
    await page.getByLabel('Character', { exact: true }).selectOption('seed-san');
    await request;
    await page.locator('canvas').evaluate((canvas) => {
      const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('The test browser must support WEBGL_lose_context');
      extension.loseContext();
    });
    await page.getByRole('status').filter({ hasText: 'The 3D context was lost' }).waitFor();
    const response = page.waitForResponse('**/models/seed-san.vrm');
    release();
    assert.equal(await within((await response).finished()), null);
    await page.waitForLoadState('networkidle');
    assert((await page.locator('#status').textContent()).includes('The 3D context was lost'), 'A late model must not replace the context-loss message');
    assert(await page.getByLabel('Character', { exact: true }).isDisabled());
    assert(await page.getByRole('heading', { name: 'pixiv sample avatar', exact: true }).isVisible());
    for (const name of [...controls, 'Smile', 'Surprise', 'Reset character']) assert(await page.getByRole('button', { name, exact: true }).isDisabled());
    for (const name of ['Automatic motion', 'Follow pointer']) assert(await page.getByLabel(name, { exact: true }).isDisabled());
    assert.deepEqual(errors, []);
    console.log('PASS context lost during load: late candidate cannot replace the avatar or enable controls');
    await page.close();
  }

  for (const failure of ['missing model', 'invalid model', 'no WebGL']) {
    const page = await newPage();
    const errors = watchErrors(page, failure !== 'no WebGL' ? '/models/starter.vrm' : null);
    if (failure === 'no WebGL') {
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
      });
    } else {
      await page.route('**/models/starter.vrm', (route) => route.fulfill({
        status: failure === 'missing model' ? 404 : 200,
        contentType: 'application/json',
        body: '{}',
      }));
    }
    await page.goto(url);
    const message = failure === 'no WebGL' ? '3D is unavailable' : 'Could not load the character';
    await page.getByRole('status').filter({ hasText: message }).waitFor();
    for (const name of [...controls, 'Smile', 'Surprise', 'Reset character']) {
      assert(await page.getByRole('button', { name, exact: true }).isDisabled(), `${name} must remain disabled on failure`);
    }
    for (const name of ['Automatic motion', 'Follow pointer']) assert(await page.getByLabel(name, { exact: true }).isDisabled());
    const selector = page.getByLabel('Character', { exact: true });
    if (failure === 'no WebGL') {
      assert(await selector.isDisabled(), 'No WebGL means no character selection');
    } else {
      assert(await selector.isEnabled(), 'An initial load failure must allow a different character');
      await selector.selectOption('seed-san');
      await page.getByRole('status').filter({ hasText: 'Character ready: Seed-san' }).waitFor();
      assert(await characterPixels(page.locator('#viewer canvas')) > 100);
      for (const name of controls) assert(await page.getByRole('button', { name, exact: true }).isEnabled());
    }
    assert.deepEqual(errors, [], `No unexpected failures during ${failure}`);
    console.log(`PASS ${failure}: readable error, safe controls, ${failure === 'no WebGL' ? 'selection disabled' : 'recovery with Seed-san'}`);
    await page.close();
  }
} finally {
  await browser.close();
}
