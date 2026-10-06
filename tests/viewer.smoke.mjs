import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2];
assert(url, 'Usage: npm run test:smoke -- <running-app-url>');
const origin = new URL(url).origin;
const browser = await chromium.launch({ channel: 'chrome' });
const controls = ['Rotate left', 'Rotate right', 'Zoom in', 'Zoom out', 'Reset view'];

// Measure rendered pixels, not private camera state, to catch reversed zoom controls.
async function characterPixels(canvas) {
  return canvas.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => {
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
  })));
}

function watchErrors(page, expectedModelFailure = false) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`));
  page.on('response', (response) => {
    if (expectedModelFailure && response.url() === `${origin}/models/starter.vrm` && response.status() === 404) return;
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) errors.push(`External request: ${request.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (expectedModelFailure && (message.text().startsWith('Character loading failed:')
      || (message.location().url === `${origin}/models/starter.vrm` && message.text().includes('404')))) return;
    errors.push(message.text());
  });
  return errors;
}

try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = watchErrors(page);
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: 'Character ready' }).waitFor({ timeout: 15000 });
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
    await wheelHandled;
    assert(await characterPixels(canvas) > initialPixels * 1.05, 'Scrolling over the canvas must zoom');
    assert.deepEqual(errors, [], 'No unexpected page, console, or network failures');
    console.log(`PASS viewer ${viewport.width}x${viewport.height}: rendered avatar, keyboard, zoom direction, reset, rotate, wheel, local requests`);
    await page.close();
  }

  for (const failure of ['missing model', 'invalid model', 'no WebGL']) {
    const page = await browser.newPage();
    const errors = watchErrors(page, failure !== 'no WebGL');
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
    for (const name of controls) {
      assert(await page.getByRole('button', { name, exact: true }).isDisabled(), `${name} must remain disabled on failure`);
    }
    assert.deepEqual(errors, [], `No unexpected failures during ${failure}`);
    console.log(`PASS ${failure}: readable error, disabled controls, no uncaught errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
