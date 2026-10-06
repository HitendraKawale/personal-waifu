# Personal Waifu: 3D viewer and learning roadmap

Status: proposed, awaiting Plannotator review. This plan authorizes lesson 2 only when approved. Later lessons need their own plans.

## Context and goal

The repository has only `README.md` and `.gitignore`; no app exists.
Build a local webpage showing one bundled anime avatar with usable camera controls.
Prove it in the browser with loading, failure, resize, and keyboard checks.

The user wants interchangeable characters, interaction, and physics, with custom characters later. Teach each change before implementing it, review each lesson's plan and resulting diff in Plannotator, and pause between lessons.

## Approach

Use plain JavaScript modules, Vite, Three.js, and `@pixiv/three-vrm`. A static viewer does not need React, a server API, a state library, or a physics engine. Use npm with a committed lockfile when publication is authorized.

VRM provides humanoid, expression, and spring-bone metadata. Choose VRM 1.0 for the initial supported format. This is not a promise to support arbitrary FBX, GLB, or rigged character files.

```text
[Bundled VRM] -> [VRM loader] -> [Three.js viewer] -> [Local webpage]
                                    ^
                                    |
                            [Camera controls]
```

Character appearance remains independent of model weights and recommendation behavior. Replacing an avatar must not require fine-tuning.

## Learning roadmap

| Lesson | Working result | What we learn and check |
| --- | --- | --- |
| 2. Viewer, this plan | One bundled avatar, orbit, zoom, reset, loading and error states | Scene, camera, renderer, assets, render loop; actual browser verification |
| 3. Switching | A selector with two independently licensed bundled avatars | Asset lifecycle; failed replacements preserve the current avatar; dispose old GPU resources; repeated switching does not accumulate models |
| 4. Interaction | Blink, idle motion, gaze toggle, and a click-triggered expression with an equivalent keyboard button | Humanoid bones, supported expressions, raycasting; missing capabilities disable controls rather than crash; reduced-motion preference |
| 5. Physics | Authored spring-bone motion, pause/reset, and bounded tuning controls | Frame delta, authored colliders, original parameter values, stable updates after tab suspension; unsupported avatars show an explanation |
| 6. Chat baseline | Anime recommendations plus a small set of avatar reactions | Keep recommendation output separate from animation commands; validate allowed reactions; protect credentials on a server |
| 7. Fine-tuning | A measured comparison with the baseline | Permitted training examples, held-out evaluation, recommendation accuracy, and off-topic behavior |
| Later. Local imports | A user-selected VRM file without uploading it to a server | File limits, parse errors, supported metadata, object URL cleanup, user-owned asset rights |

Spring bones approximate motion on authored bone chains. They are not full cloth simulation, soft-body physics, or automatic collision detection for every body surface. Camera orbit alone does not move the avatar and therefore does not demonstrate hair physics. Lesson 5 must exercise avatar movement with suitable authored hair/clothing chains and colliders.

## Lesson 2 design

### Interface

One responsive page: project title, character name, large neutral-background viewer, loading/status text, and native buttons for rotate left/right, zoom in/out, and reset view. Pointer drag and wheel/pinch use OrbitControls. Provide visible focus styles, meaningful button labels, and an `aria-live` status region outside the canvas.

Show the actual 3D model, not a placeholder image or fake chat interface. Do not add autonomous motion yet. Disable camera controls until loading succeeds. Constrain zoom and rotation so the avatar cannot be lost below the floor or clipped by an uncontrolled camera.

### Asset

Use pixiv's official `VRM1_Constraint_Twist_Sample.vrm` as the starter, not a claim that this is the final character design.

Pinned candidate source:
`https://raw.githubusercontent.com/pixiv/three-vrm/1b4fc0cc7ef39a49d62bb7a66dcfeca8f65316f7/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`

Exploration of the upstream development copy found:
- Size: 10,776,032 bytes.
- Author: pixiv Inc.; copyright: `(c) 2022 pixiv Inc.`.
- VRM metadata: redistribution allowed; modification and redistribution allowed; avatar permission `everyone`.
- License URL: `https://vrm.dev/licenses/1.0/`.
- Includes VRM, MToon, node constraint, and spring-bone extensions.

Before downloading into the public project, read the linked license and verify the pinned file's embedded metadata. Record source, revision, SHA-256, author, license URL, and usage restrictions in the model README. Do not treat the library's MIT license as the asset license. If the terms conflict with public redistribution or intended use, stop and revise the asset choice rather than silently substitute one.

### Files to modify

All paths are relative to `~/personal-waifu`.

| File | Today | After lesson 2 |
| --- | --- | --- |
| `package.json` | Absent | Private npm package; dev/build/preview/smoke scripts; only required dependencies |
| `package-lock.json` | Absent | Exact resolved dependency versions |
| `index.html` | Absent | Semantic page, viewer container, status, native controls |
| `src/main.js` | Absent | Scene setup, VRM loading, camera buttons, resize handling, render loop, failure handling |
| `src/style.css` | Absent | Responsive viewer and accessible controls |
| `public/models/starter.vrm` | Absent | One verified, locally served avatar |
| `public/models/README.md` | Absent | Asset provenance and licensing |
| `tests/viewer.smoke.mjs` | Absent | One repeatable browser smoke check, accepting the running app URL |
| `.gitignore` | Secret exclusions only | Also excludes `node_modules/` and `dist/` |
| `README.md` | Setup-only status | Local run/build/check instructions, controls, license link, completed lesson status |

Keep application code in one module for this lesson. Extract an avatar module when lesson 3 introduces replacement and cleanup, not before it has a caller.

### Decisions shown as diffs

Build scripts and dependency intent, with compatible exact versions resolved and locked during approved implementation:

```diff
+"private": true,
+"type": "module",
+"scripts": {
+  "dev": "vite",
+  "build": "vite build",
+  "preview": "vite preview",
+  "test:smoke": "node tests/viewer.smoke.mjs"
+}
```

Runtime dependencies: `three`, `@pixiv/three-vrm`. Development dependencies: `vite`, `playwright` for the one reusable browser check. Use the available browser installation if compatible; do not silently install a browser or system packages.

Loader mechanism, following the official example:

```diff
+const loader = new GLTFLoader();
+loader.register((parser) => new VRMLoaderPlugin(parser));
+const gltf = await loader.loadAsync('/models/starter.vrm');
+const vrm = gltf.userData.vrm;
+scene.add(vrm.scene);
```

Wrap initialization and loading in error handling. A successful HTTP response without a supported VRM must produce a visible error, not a ready state. Update the loaded avatar through `vrm.update(delta)` before rendering. Clamp delta after tab suspension; retain the model's authored scale and physics settings. Built-in spring evaluation may run, but new idle animation and physics tuning are outside this lesson.

```diff
 .gitignore
+node_modules/
+dist/
```

## Reuse and references

There is no application code to reuse. Preserve existing README workflow and secret ignore rules.

Reuse the libraries' GLTFLoader, VRMLoaderPlugin, OrbitControls, and VRM update machinery rather than write a parser, camera controller, or physics solver.

Documentation retrieved through Context7:
- Loading and expression example: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/expressions.html
- Model replacement and disposal example, for lesson 3: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/webgpu-dnd.html
- Spring-bone scaling caveats, for lesson 5: https://github.com/pixiv/three-vrm/blob/dev/guides/spring-bones-on-scaled-models.md

Confirm APIs against the dependency versions selected at implementation, rather than copying development-branch examples blindly.

Local exploration found Node `v26.10.0`, Agent Browser, and portless. Plannotator planning mode and the plan-submission tool are now available. The working tree contains only the untracked plan directory; application implementation has not started.

## Steps

- [x] Review this plan in Plannotator. Approval covers lesson 2 only; do not begin lesson 3 automatically.
- [x] Explain browser modules, the dev server, and scene/camera/renderer. Check the working tree and create an isolated implementation branch/workspace without overwriting existing work.
- [x] Verify the asset's full terms and pinned metadata. Capture provenance and SHA-256 in `public/models/README.md`.
- [x] Create the minimal package and HTML files. Check compatibility of selected dependency versions before installing. Add only the dependencies and ignore rules listed above. Inspect portless help and existing named apps, start this app in the background under an unused appropriate name, confirm the initial page loads, and record its actual URL and log path.
- [x] Write the smoke check first. It accepts the app URL as an argument, captures uncaught errors and failed requests, waits for the accessible ready status, and checks canvas dimensions and camera controls. Run it against the initial page and record the expected failure because the viewer is missing.
- [x] Implement model loading and the render loop. Show loading, ready, WebGL-unavailable, and load-failed states. Never mark the viewer ready before the model is added and a frame rendered.
- [x] Add OrbitControls and equivalent camera buttons, bounded zoom, reset, resize handling, and readable keyboard focus. Explain each addition before editing.
- [x] Complete the smoke check's negative case by intercepting the model request and returning a 404 in a fresh page. Assert a visible error and disabled controls. Assert no uncaught errors on either path; treat the deliberately failed model request as expected only in the negative case.
- [x] Run `npm run build`. Reuse the dev server started earlier and confirm the implemented page loads at its recorded URL.
- [x] Run the smoke check at desktop and mobile viewport sizes. Manually verify the actual avatar rendering, orbit, zoom, keyboard buttons, reset, and resize with Agent Browser. Save screenshots outside the public project unless explicitly requested otherwise.
- [x] Update the README with commands and the actual verified behavior. Show build/smoke output and evidence paths. Open the lesson's complete diff in Plannotator and stop for review.

## Verification and acceptance

The smoke command will be `npm run test:smoke -- <actual-local-url>`. It must exit nonzero on any unexpected page error, failed request, missing ready state, invalid canvas size, or missing/disabled camera control on the successful load path.

Manual checks are required because a passing canvas/status test does not prove a correctly rendered character:
- A recognizable avatar is visible, correctly oriented, lit, and framed.
- Dragging rotates the view; zoom remains bounded; reset restores the initial view.
- All camera actions have usable keyboard-operated buttons.
- Resizing does not stretch the avatar or overflow controls.
- Blocking the model request yields a readable error, not an infinite spinner.
- A missing WebGL context yields a readable fallback, not a blank page.
- Loading the page after dependencies and the asset are local makes no runtime request to a model CDN or AI provider.

No performance target is claimed without measurement. Record observations and any failures; do not equate a successful production build with a verified UI.

## Not doing in lesson 2

No uploads, second avatar, expression controls, custom idle animation, physics sliders, rigid-body engine, cloth simulation, chat, API keys, voice, model training, backend, public hosting, commits, or pushes.

Future imports will use the same VRM loading path but still require their own validation and safety work. Do not expose an upload button that does nothing.
