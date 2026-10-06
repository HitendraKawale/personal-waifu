import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import './style.css';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#status');
const buttons = document.querySelector('#controls');

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
  canvas.setAttribute('aria-label', '3D view of the pixiv sample avatar');
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
  let vrm;
  let observer;

  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync('/models/starter.vrm');
    vrm = gltf.userData.vrm;
    if (!vrm || vrm.meta.metaVersion !== '1') {
      throw new Error('The starter asset must be a VRM 1.0 model.');
    }
    scene.add(vrm.scene);
    vrm.update(0);
    const bounds = new THREE.Box3().setFromObject(vrm.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());

    function resize() {
      const width = viewer.clientWidth;
      const height = viewer.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const distance = 1.2 * Math.max(size.y, size.x / camera.aspect)
        / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z / 2;
      camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
      controls.target.copy(center);
      controls.minDistance = distance * 0.65;
      controls.maxDistance = distance * 1.8;
      controls.update();
      controls.saveState();
      camera.updateProjectionMatrix();
    }

    resize();
    observer = new ResizeObserver(resize);
    observer.observe(viewer);
    renderer.render(scene, camera);
    status.textContent = 'Character ready';
    controls.enabled = true;
    buttons.disabled = false;
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
      vrm.update(delta);
      renderer.render(scene, camera);
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      renderer.setAnimationLoop(null);
      buttons.disabled = true;
      controls.enabled = false;
      status.textContent = 'The 3D context was lost. Reload the page to try again.';
    });
  } catch (error) {
    observer?.disconnect();
    controls.dispose();
    buttons.disabled = true;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    canvas.remove();
    status.textContent = 'Could not load the character. Check the local server and reload the page.';
    console.error('Character loading failed:', error);
  }
}

startViewer().catch((error) => {
  buttons.disabled = true;
  status.textContent = 'Could not start the 3D viewer. Try reloading or using another browser.';
  console.error('Viewer initialization failed:', error);
});
