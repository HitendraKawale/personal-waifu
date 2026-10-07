# Lesson 3: character switching

Status: proposed, awaiting Plannotator approval. No implementation authorized yet.

## Context and goal

The viewer loads one hard-coded avatar and destroys the renderer when that load fails.
Add a native selector for two bundled VRM 1.0 characters, preserving the current character when replacement loading fails.
Prove switching, failure recovery, camera behavior, and resource cleanup in the existing browser smoke check.

Base: `69054a6` on `lesson-2-viewer`, already pushed and reviewed. `main` does not contain lesson 2. Start a new lesson branch from this commit; do not merge or rewrite branches as part of this lesson.

## Approach

Keep one renderer, scene, camera, OrbitControls instance, resize observer, and render loop. Replace only the active avatar. Reuse the installed dependencies; change neither package manifest nor lockfile.

```text
[Native selector] -> [Load and validate candidate] -> [Replace active avatar]
                              |                              |
                              v                              v
                    [Failure: retain current]       [Dispose previous avatar]
```

One replacement can load at a time. Disable the selector while loading and guard the handler against re-entry. Keep the current avatar rendered and its camera buttons enabled. This avoids concurrent downloads and stale-response races without request queues or cancellation infrastructure.

Keep this change in `src/main.js`, with local functions for loading and camera framing. A second module would currently split state owned by one viewer; reconsider extraction when uploads or another consumer need it.

## Findings and reuse

- `src/main.js`: reuse GLTFLoader with VRMLoaderPlugin, VRM 1.0 validation, frame-delta clamping, lights, OrbitControls, camera buttons, and ResizeObserver. Move setup outside the per-avatar loading path.
- The current `center` and `size` are closed over the first avatar. Make them active-avatar state so resizing and reset use the newly selected character's bounds.
- `index.html`: reuse the status live region, viewer container, and camera fieldset. Add a labeled native select outside the disabled camera fieldset.
- `src/style.css`: reuse button sizing, colors, and focus treatment for the select. Do not redesign the page.
- `tests/viewer.smoke.mjs`: extend existing rendered-pixel, camera, viewport, error, and local-request checks. Error allowances must identify the exact failed model URL.
- Installed `@pixiv/three-vrm@3.5.5` exports `VRMUtils.deepDispose`; use it to release replaced model geometry, materials, and textures. Removing a scene object alone does not release those resources.

## Second character and rights

Use Seed-san by VirtualCast, Inc., from the VRM Consortium sample repository.

- Pinned source: https://raw.githubusercontent.com/vrm-c/vrm-specification/94e82dd346fa6cf0337c4421728640e5252dd38e/samples/Seed-san/vrm/Seed-san.vrm
- Upstream description: https://github.com/vrm-c/vrm-specification/blob/94e82dd346fa6cf0337c4421728640e5252dd38e/samples/Seed-san/README.md
- VRM specification version: `1.0`; model version: `1`.
- Size: 10,917,800 bytes.
- SHA-256: `624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23`.
- Author and copyright: VirtualCast, Inc.
- License: https://vrm.dev/licenses/1.0/ plus embedded license settings.
- Inspected settings: redistribution allowed, avatar permission `everyone`, commercial usage `corporation`, modification `allowModificationRedistribution`, credit notation `required`. All four expression-usage permissions are true.

The full VRM Public License 1.0 was read during lesson 2. Its attribution conditions apply to Seed-san. Preserve the unmodified file and embedded metadata, and record author, copyright, source, license link, no-warranty notice, and the fact that the model was not modified in `public/models/README.md`. The page footer must visibly credit both model authors and link that document. Do not imply endorsement or apply a library's code license to either model.

Exploration fetched the pinned file into memory to inspect metadata and compute its hash. It has not been added to the project yet. Verify the same hash when downloading during implementation.

## Behavior contract

| State or action | Expected result |
| --- | --- |
| Initial load | Starter selected; selector and camera controls disabled until ready |
| Successful load | Heading, canvas accessible name, selector, and status identify the active character |
| Select the other character | Announce loading; disable selector; retain current model and usable camera controls |
| Replacement succeeds | Replace current model, frame new bounds, save new reset view, dispose previous model, re-enable selector |
| Replacement fetch, parse, or validation fails | Dispose any returned invalid candidate; retain current avatar and camera view; restore selector to current value; show retry guidance; re-enable selector |
| Initial model fails | Keep renderer alive; camera controls stay disabled; enable selector so the user can select the other character |
| Same character selected | Do not reload it |
| WebGL unavailable or context lost | Disable selector and camera controls; show existing fallback. A pending load must not re-enable a lost viewer; dispose its result instead |

Choose the initial starter on each page load. Do not persist selection yet. A successful switch resets framing deliberately; camera preservation across different character sizes is not part of this lesson.

Loading means loading and validating a candidate before removing the active model. Check VRM 1.0 metadata and finite, nonempty bounds before the swap. Keep the previous model undisposed until the new model's first render succeeds; if that synchronous first draw throws, remove/dispose the candidate and restore the previous model and camera state. Only then announce the new character as ready.

## Files to modify

| Path | Today | After |
| --- | --- | --- |
| `index.html` | Fixed title and starter credit | Native Character selector; stable heading target; credit for both authors |
| `src/main.js` | One-shot loading with global teardown on failure | Shared viewer lifecycle, guarded loading, replacement/rollback, correct bounds and disposal |
| `src/style.css` | Buttons only | Matching accessible select styles, no layout redesign |
| `public/models/seed-san.vrm` | Absent | Unmodified, verified second avatar |
| `public/models/README.md` | Starter provenance | Provenance, settings, attribution, and license notices for both assets |
| `tests/viewer.smoke.mjs` | Single-avatar checks | Both avatars, successful/failed swaps, retry, and repeated-switch resource checks |
| `README.md` | Lesson 2 status | Selection behavior, lesson 3 checks, and remaining limits |

## Decisions shown as diffs

Native control, outside the camera fieldset:

```diff
+<label for="character-select">Character</label>
+<select id="character-select" disabled>
+  <option value="starter">pixiv sample avatar</option>
+  <option value="seed-san">Seed-san</option>
+</select>
```

Only known local options map to asset paths. Reject an unknown ID rather than constructing a URL from arbitrary input:

```diff
+const characters = {
+  starter: { name: 'pixiv sample avatar', url: '/models/starter.vrm' },
+  'seed-san': { name: 'Seed-san', url: '/models/seed-san.vrm' },
+};
```

Separate avatar replacement from fatal viewer teardown:

```diff
-const gltf = await loader.loadAsync('/models/starter.vrm');
+const gltf = await loader.loadAsync(character.url);
```

Resource cleanup after a successful replacement:

```diff
+scene.remove(previous.scene);
+VRMUtils.deepDispose(previous.scene);
```

The above illustrates disposal, not the entire transaction. Preserve the previous model and camera state until the candidate passes validation and draws successfully. Failure to load a character must not call `renderer.dispose()` or `controls.dispose()`.

## Steps

- [x] Review this plan in Plannotator. Explain the difference between removing an object from a scene and freeing its GPU resources.
- [x] Confirm the clean lesson 2 baseline and branch from `lesson-2-viewer` as `lesson-3-character-switching`. Run the existing smoke suite before changes; reuse the running local server only if it still belongs to this project.
- [x] Download the pinned Seed-san file and verify its SHA-256 and embedded metadata. Extend the model documentation and visible credits before exposing the new option.
- [x] Extend the smoke check with a labeled selector and a successful starter-to-Seed-san-to-starter round trip. Verify the heading, selected value, rendered image change, controls, and reset behavior. Run it and record the expected failure against the current single-character viewer.
- [x] Add the selector and matching focus/disabled styles. Refactor the current one-shot loader into a guarded replacement operation using the existing renderer, controls, observer, and loop. Validate the requested ID, VRM version, and bounds. Retain the current avatar while loading and reset framing only on success.
- [x] Add failing tests for a delayed replacement, a 404, and a malformed replacement. Verify the current character, canvas, and camera state survive, the selector returns to the active option, and selecting the failed target again works once the request succeeds. Add initial-load recovery by choosing Seed-san after the starter fails. Implement these recovery paths without recreating the renderer.
- [x] Implement disposal for replaced and rejected candidate models. Add a test-only WebGL resource counter that wraps real create/delete calls for buffers, textures, and programs while still executing those calls. After warming both models, switch through at least three further round trips and compare live resource counts at the same active model. A removed disposal call must make the check fail. Do not add production globals or a test-only debug API.
- [x] Keep the existing WebGL failure coverage and add context-loss-during-loading coverage. Confirm an in-flight candidate is discarded and controls remain disabled. All event and load waits must have bounded timeouts.
- [x] Run `npm run build` and the complete smoke suite at `http://127.0.0.1:5173`, or the verified replacement URL if the existing server is unavailable. Run both avatar camera checks at 1280x900 and 390x844. Do not suppress unrelated console/network failures.
- [x] Inspect both avatars and the selector in Agent Browser. Exercise keyboard selection, orbit, zoom, reset, resize, and a failed replacement. Save before/after screenshots outside the public repo, and record the actual URL and evidence paths.
- [x] Update README status with measured results and limitations. Open the complete lesson 3 diff against the lesson 2 base in Plannotator, then stop for review. No commits or pushes without a separate request.

## Verification

Reuse `npm run test:smoke -- <actual-url>` and `npm run build`. Do not add a test framework or dependency.

Tests must demonstrate real visible outcomes rather than only count option elements. Check each avatar renders, a selection changes its image and name, failed loads leave the previous frame and camera intact, and subsequent attempts recover. Keep the existing missing-model, malformed-model, no-WebGL, keyboard, zoom-direction, reset, rotation, wheel, and local-only request checks.

For cleanup, count real WebGL resource handles with test-only instrumentation. Compare repeated visits to the same avatar after warmup; do not equate JavaScript heap size with GPU memory. Stable resource counts provide evidence against accumulation across this tested sequence, not a universal claim of zero memory leaks.

Preserve expected-error checks by model URL and failure type. The intentionally intercepted 404 is allowed only for that test; other failed requests, console errors, and uncaught exceptions remain failures.

## Not doing

No custom uploads, VRM 0 support, model cache, preloading, concurrent switching, localStorage, expressions, idle animation, physics controls, lighting redesign, chat, backend, dependencies, public hosting, branch merges, commits, or pushes.

Do not duplicate the starter or recolor it and call that a second independently sourced character. Do not hide licensing conditions behind the code license.
