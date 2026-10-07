import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createInteractions } from './interactions.js';
import './style.css';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#status');
const buttons = document.querySelector('#controls');
const selector = document.querySelector('#character-select');
const heading = document.querySelector('#character-name');
const interactionControls = document.querySelector('#interactions');
const motionToggle = document.querySelector('#automatic-motion');
const gazeToggle = document.querySelector('#follow-pointer');
const reactionStatus = document.querySelector('#reaction-status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
motionToggle.checked = !reducedMotion.matches;
const characters = {
  starter: { name: 'pixiv sample avatar', url: '/models/starter.vrm' },
  'seed-san': { name: 'Seed-san', url: '/models/seed-san.vrm' },
};

async function startViewer() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true });
  if (!context) {
    status.textContent = '3D is unavailable. Enable WebGL in your browser or try another browser.';
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D character view');
  canvas.setAttribute('aria-describedby', 'camera-help');
  viewer.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#edf0f2');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8994aa, 2));
  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(2, 3, 4);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI / 4;
  controls.maxPolarAngle = Math.PI / 2;
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  let active;
  let loading = false;
  let contextLost = false;

  function updateInteractionControls() {
    interactionControls.disabled = !active || contextLost;
    if (!active) return;
    const capabilities = active.interactions.capabilities;
    for (const button of interactionControls.querySelectorAll('[data-reaction]')) {
      button.disabled = !capabilities[button.dataset.reaction];
    }
    motionToggle.disabled = !(capabilities.blink || capabilities.idle);
    gazeToggle.disabled = !capabilities.gaze;
    const unavailable = [];
    if (!capabilities.happy) unavailable.push('Smile');
    if (!capabilities.surprised) unavailable.push('Surprise');
    if (!capabilities.blink) unavailable.push('Blinking');
    if (!capabilities.idle) unavailable.push('Idle motion');
    if (!capabilities.gaze) unavailable.push('Follow pointer');
    document.querySelector('#interaction-help').textContent = unavailable.length
      ? `Unavailable for this character: ${unavailable.join(', ')}.`
      : 'Click the character to smile. Drag to rotate the camera.';
  }

  function react(name) {
    if (!active || contextLost || !active.interactions.capabilities[name]) return;
    active.interactions.react(name);
    reactionStatus.textContent = name === 'happy' ? 'Smile requested.' : 'Surprise requested.';
  }
  for (const button of interactionControls.querySelectorAll('[data-reaction]')) {
    button.addEventListener('click', () => react(button.dataset.reaction));
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const gazePointer = new THREE.Vector2();
  const gazeWorld = new THREE.Vector3();
  let pointerInside = false;
  const pressedPointers = new Set();
  let press;
  canvas.addEventListener('pointerdown', (event) => {
    pointerInside = false;
    pressedPointers.add(event.pointerId);
    press = event.isPrimary && event.button === 0 && pressedPointers.size === 1
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, avatar: active }
      : null;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press = null;
    if (!['mouse', 'pen'].includes(event.pointerType) || pressedPointers.size || !gazeToggle.checked || gazeToggle.disabled) return;
    const box = canvas.getBoundingClientRect();
    gazePointer.set(
      THREE.MathUtils.clamp((event.clientX - box.left) / box.width * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(1 - (event.clientY - box.top) / box.height * 2, -1, 1),
    );
    pointerInside = true;
  });
  canvas.addEventListener('pointerup', (event) => {
    const click = press;
    press = null;
    pressedPointers.delete(event.pointerId);
    if (!active || contextLost || click?.id !== event.pointerId || click.avatar !== active) return;
    const box = canvas.getBoundingClientRect();
    pointer.set((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2);
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return;
    camera.updateMatrixWorld();
    active.vrm.scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(active.vrm.scene, true).length) react('happy');
  });
  canvas.addEventListener('pointercancel', (event) => {
    pressedPointers.delete(event.pointerId);
    press = null;
    pointerInside = false;
  });
  canvas.addEventListener('pointerleave', () => { pointerInside = false; });
  gazeToggle.addEventListener('change', () => { pointerInside = false; });
  document.querySelector('#reset-character').addEventListener('click', () => {
    pointerInside = false;
    active?.interactions.reset();
    reactionStatus.textContent = 'Character reset.';
  });

  reducedMotion.addEventListener('change', (event) => {
    if (!event.matches) return;
    motionToggle.checked = false;
    gazeToggle.checked = false;
    pointerInside = false;
    active?.interactions.reset();
    reactionStatus.textContent = 'Motion disabled by your reduced-motion preference.';
  });

  function frameCharacter() {
    if (!active) return;
    const { center, size } = active;
    const distance = 1.2 * Math.max(size.y, size.x / camera.aspect)
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z / 2;
    camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    controls.target.copy(center);
    controls.minDistance = distance * 0.65;
    controls.maxDistance = distance * 1.8;
    controls.update();
    controls.saveState();
  }

  function resize() {
    const width = viewer.clientWidth;
    const height = viewer.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCharacter();
  }

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(viewer);
  document.querySelector('#rotate-left').onclick = () => controls.rotateLeft(Math.PI / 8);
  document.querySelector('#rotate-right').onclick = () => controls.rotateLeft(-Math.PI / 8);
  document.querySelector('#zoom-in').onclick = () => controls.dollyIn(1 / 1.15);
  document.querySelector('#zoom-out').onclick = () => controls.dollyOut(1 / 1.15);
  document.querySelector('#reset-view').onclick = () => controls.reset();

  let previousTime = performance.now();
  renderer.setAnimationLoop((time) => {
    const delta = Math.min(Math.max((time - previousTime) / 1000, 0), 0.05);
    previousTime = time;
    if (document.hidden) return;
    if (active) {
      const followsPointer = pointerInside && gazeToggle.checked && !gazeToggle.disabled;
      if (followsPointer) {
        camera.updateMatrixWorld();
        gazeWorld.set(gazePointer.x * 0.5, gazePointer.y * 0.3, -1).applyMatrix4(camera.matrixWorld);
      }
      active.interactions.update(delta, {
        motionEnabled: motionToggle.checked && !motionToggle.disabled,
        gazeTarget: followsPointer ? gazeWorld : null,
      });
      active.vrm.update(delta);
    }
    renderer.render(scene, camera);
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    pointerInside = false;
    press = null;
    pressedPointers.clear();
    updateInteractionControls();
    observer.disconnect();
    renderer.setAnimationLoop(null);
    buttons.disabled = true;
    selector.disabled = true;
    controls.enabled = false;
    status.textContent = 'The 3D context was lost. Reload the page to try again.';
  });

  async function loadCharacter(id) {
    if (contextLost || loading || id === active?.id) return;
    if (!Object.hasOwn(characters, id)) {
      selector.value = active?.id ?? 'starter';
      return;
    }
    const character = characters[id];
    loading = true;
    selector.disabled = true;
    status.textContent = `Loading ${character.name}…`;
    let rollback;
    let candidateScene;
    try {
      const gltf = await loader.loadAsync(character.url);
      candidateScene = gltf.scene;
      if (contextLost) {
        VRMUtils.deepDispose(candidateScene);
        return;
      }
      const vrm = gltf.userData.vrm;
      if (!vrm || vrm.meta.metaVersion !== '1') {
        throw new Error('The character must be a VRM 1.0 model.');
      }
      vrm.update(0);
      const bounds = new THREE.Box3().setFromObject(vrm.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      if (bounds.isEmpty() || ![...center, ...size].every(Number.isFinite) || size.lengthSq() === 0) {
        throw new Error('The character has invalid bounds.');
      }
      const previous = active;
      const view = {
        position: camera.position.clone(), target: controls.target.clone(),
        resetPosition: controls.position0.clone(), resetTarget: controls.target0.clone(),
        minDistance: controls.minDistance, maxDistance: controls.maxDistance,
      };
      rollback = () => {
        scene.remove(vrm.scene);
        active = previous;
        if (previous) scene.add(previous.vrm.scene);
        camera.position.copy(view.position);
        controls.target.copy(view.target);
        controls.position0.copy(view.resetPosition);
        controls.target0.copy(view.resetTarget);
        controls.minDistance = view.minDistance;
        controls.maxDistance = view.maxDistance;
        controls.update();
      };
      if (previous) scene.remove(previous.vrm.scene);
      active = { id, vrm, center, size, interactions: createInteractions(vrm) };
      scene.add(vrm.scene);
      frameCharacter();
      renderer.render(scene, camera);
      if (previous) VRMUtils.deepDispose(previous.vrm.scene);
      heading.textContent = character.name;
      canvas.setAttribute('aria-label', `3D view of ${character.name}`);
      selector.value = id;
      status.textContent = `Character ready: ${character.name}`;
      controls.enabled = true;
      buttons.disabled = false;
      selector.disabled = false;
      updateInteractionControls();
      pointerInside = false;
      reactionStatus.textContent = '';
    } catch (error) {
      rollback?.();
      if (candidateScene) VRMUtils.deepDispose(candidateScene);
      if (contextLost) return;
      selector.value = active?.id ?? 'starter';
      selector.disabled = false;
      controls.enabled = Boolean(active);
      buttons.disabled = !active;
      updateInteractionControls();
      status.textContent = active
        ? `Could not load the character. Still showing ${characters[active.id].name}. Select ${character.name} again to retry.`
        : 'Could not load the character. Choose another character or reload to retry.';
      console.error('Character loading failed:', character.url, error);
    } finally {
      loading = false;
    }
  }

  selector.addEventListener('change', () => loadCharacter(selector.value));
  await loadCharacter('starter');
}

startViewer().catch((error) => {
  interactionControls.disabled = true;
  buttons.disabled = true;
  selector.disabled = true;
  status.textContent = 'Could not start the 3D viewer. Try reloading or using another browser.';
  console.error('Viewer initialization failed:', error);
});
