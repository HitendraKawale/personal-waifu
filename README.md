# Personal Waifu

A website with a 3D anime character that helps you choose anime to watch.

## Current status

Lesson 2 implements a local 3D viewer with one bundled VRM 1.0 avatar, camera controls, and visible loading/error states. The starter is in its authored T-pose. There is no chat, character switching, custom animation, or trained model yet.

## Run locally

Use Node.js 22.12 or newer and npm. This lesson was checked with Node.js 26.10.0.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173. `--strictPort` stops the server if that port is occupied rather than silently choosing another. Leave other processes running; choose a different free port if needed.

The character and dependencies load from the local server, not a model CDN or AI provider. The source and license for the bundled asset are in [public/models/README.md](public/models/README.md).

## Controls

- Drag on the character area to orbit the camera.
- Scroll or pinch over the character area to zoom.
- Use Rotate left/right, Zoom in/out, and Reset view for the same actions with a keyboard.
- Resizing the viewer reframes the character. Panning is disabled and zoom is bounded.

## Check the viewer

```sh
npm run build
# Keep the dev server running in another terminal:
npm run test:smoke -- http://127.0.0.1:5173
```

The smoke check uses an existing Google Chrome installation through Playwright. It does not install a browser. It checks desktop and mobile viewport sizes, rendered character pixels, keyboard controls, zoom direction, reset, rotation, wheel zoom, and local-only requests. It also checks visible errors and disabled controls for missing/invalid assets and unavailable WebGL.

The build passed and all five smoke cases passed. The viewer was also inspected in Chrome at 1280x900 and 390x844, including drag orbit, keyboard operation, and resizing. Mobile viewport checks do not substitute for testing a physical touchscreen; pinch gestures have not been verified on a device.

The initial JavaScript bundle is about 765 kB minified, producing Vite's size warning. The uncompressed avatar file is about 10.8 MB. Loading optimization is deferred; no performance target has been verified.

## Learning sequence

1. Set up the repository.
2. Build a local website with a licensed 3D character.
3. Add character switching with two bundled avatars.
4. Add expressions, gaze, and idle motion.
5. Add spring-bone physics controls for compatible models.
6. Connect a baseline anime recommendation chatbot.
7. Create permitted training examples, keep a separate evaluation set, and compare a fine-tuned model with the baseline.

Custom VRM imports come in a later lesson. The [3D viewer plan](plans/3d-viewer.md) records the scope and roadmap.

## How we work

Review each small plan in Plannotator before editing.
Explain each code change, run the relevant checks, then review the diff.
Pause before the next lesson. Commit and push only when requested.
