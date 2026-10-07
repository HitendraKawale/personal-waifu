# Lesson 4: character interaction

Status: implemented, verified, and reviewed in Plannotator. The user separately authorized committing, merging, and pushing the reviewed work.

## Context and goal

Both bundled avatars can be viewed and switched, but cannot react to the user.
Add blinking, subtle idle motion, optional pointer-following gaze, and smile/surprise reactions.
Prove the reactions in the browser while keeping switching, failure recovery, and GPU cleanup checks passing.

Lesson 3's diff was approved but remains uncommitted on `lesson-3-character-switching`. Preserve those changes. Before implementation, snapshot the reviewed files outside the repo so lesson 4 can be reviewed as a separate static diff without requiring a commit or including lesson 3 again.

## Approach

Keep the existing render loop and three-vrm APIs. Add one small interaction module that owns a single avatar's transient motion and expression state. Main owns UI events, raycasting, camera-relative pointer targets, and the active-avatar lifecycle. Do not add an animation library, timers, another render loop, or dependencies.

```text
[Buttons / pointer] -> [Active avatar interactions] -> [vrm.update(delta)] -> [Existing renderer]
                                  ^
                                  |
                      [Motion preference / frame time]
```

## Findings and reuse

- `src/main.js` already owns one animation loop and the current `active` avatar. Apply interaction updates immediately before `active.vrm.update(delta)`.
- Switching already retains the old avatar until replacement succeeds. Attach interaction state to the same active-avatar object so a failed switch retains both pose and reactions.
- Both model files declare real bindings for `blink`, `happy`, and `surprised`. Seed-san's happy and surprised expressions are binary, so smooth expression blending would not behave consistently. Use full-strength expressions with a timed return to neutral instead.
- The starter uses bone-based look-at with left/right eye bones. Seed-san uses expression-based look-at and has no eye bones. Reuse `vrm.lookAt`, not direct eye-bone manipulation.
- Both models have a normalized spine. Use it for a small sway relative to the captured base pose; do not increment rotation each frame.
- `tests/viewer.smoke.mjs` assumes a still image in several camera/failure checks. Run those existing cases with reduced motion enabled, then add explicit motion-enabled interaction cases.
- `index.html` already has native buttons, fieldsets, and a live loading status. Reuse their conventions; keep reaction messages separate from model-loading errors.

## Behavior decisions

### Controls

Add an Interaction fieldset with Smile, Surprise, Reset character, Automatic motion, and Follow pointer controls. Use native buttons and checkboxes with visible labels and focus indicators. Keep Reset view separate: it controls the camera, not the face or body.

Smile and Surprise set the matching expression to weight 1 and clear the other. Repeating a reaction restarts its duration; reactions do not queue. A supported character click triggers exactly the same action as Smile.

With automatic motion enabled, a reaction lasts 1.5 seconds and then returns to neutral. With automatic motion off, a manually chosen expression remains until another reaction or Reset character. This provides a still, user-controlled mode for reduced motion.

Reset character clears the reaction and gaze, restores the captured spine pose, and restarts the blink/idle phase. It does not move the camera or silently toggle the user's preferences. If motion is enabled, idle behavior resumes from its neutral phase.

### Automatic motion

- Enabled initially unless `prefers-reduced-motion: reduce` is active.
- Blink once every 4 seconds, closing over 80 ms and opening over 120 ms. No random timing in this lesson; keep behavior teachable and tests reproducible.
- Spine sway: at most 0.75 degrees around local Z, one cycle every 5 seconds, applied relative to the original quaternion. Keep the original arm poses; do not add a standing-pose conversion or authored animation clips.
- Derive timing from the existing clamped frame delta. Hidden tabs do not advance interaction time, and resuming does not replay missed reactions.
- Turning automatic motion off immediately clears blink, restores the base spine pose, and stops reaction expiry. It does not clear a manually selected expression.
- If the OS preference changes to reduced motion, turn automatic motion and gaze off and reset the character. The user may explicitly enable either afterward. Removing the OS preference does not override the user's current choices.

### Gaze

Follow pointer is off by default, remains independent of automatic motion, and is supported only where three-vrm provides a usable look-at system.

Track mouse/pen movement inside the canvas, not the entire page. Convert canvas-relative coordinates into a bounded target in camera space: X within ±0.5, Y within ±0.3, Z at -1 relative to the camera. Transform it to world space using the current camera matrix before passing it to the interaction module. Smooth target movement using frame delta and the model's authored look-at limits; do not override eye rotations or expression range maps.

Clear gaze when the pointer leaves, a drag begins, the option is disabled, the character changes, or Reset character is pressed. Resume only on a fresh eligible pointer move. Touch may tap to react or orbit the camera, but does not enable gaze tracking.

### Click versus drag

Use Three.js Raycaster against the active avatar's scene. A background click does nothing.

Record a primary pointer's starting location on pointerdown. Cancel the reaction candidate if movement exceeds 6 CSS pixels at any time, another pointer joins, or pointercancel fires. On a matching pointerup inside the canvas, raycast the current avatar only if the gesture is still a click. This prevents camera orbit and pinch gestures from triggering Smile. Do not cancel every OrbitControls start event, since it also fires for an ordinary pointer press.

The Smile button is the keyboard equivalent of character clicking. Do not make screen coordinates the only way to invoke a reaction.

### Capabilities and switching

Check expression existence and actual bindings, not merely preset names. Disable unsupported reaction buttons and explain why in visible text. Automatic motion is available when blink or the chosen spine bone is usable. Follow pointer is disabled without usable look-at support. Reset remains usable when an avatar is active.

Preserve the user's motion/gaze preferences across successful switches, but start the new avatar with neutral expression, fresh timing, and no pointer target. The old avatar remains interactive while a replacement loads. A failed load leaves its current interaction state intact. First-load failure and WebGL loss disable all interaction controls, including late-arriving loads.

## Files to modify

Paths are relative to `~/personal-waifu`.

| File | Today | After |
| --- | --- | --- |
| `src/interactions.js` | Absent | Per-avatar expression, blink, idle, and gaze state; no DOM events or independent timers |
| `src/main.js` | Viewer and switching lifecycle | Creates active interaction state, calls its frame update, wires UI and raycast gestures, applies reduced-motion preferences |
| `index.html` | Character selector and camera controls | Separate interaction fieldset, accessible toggle labels, capability explanation |
| `src/style.css` | Button/select styling | Checkbox focus/spacing and interaction layout using existing colors and sizes |
| `tests/viewer.smoke.mjs` | Still-avatar viewer/switching checks | Existing checks under reduced motion plus interaction, gesture, preference, and capability checks |
| `README.md` | Lesson 3 behavior and limitations | Interaction controls, defaults, verified results, and remaining limits |

Do not modify either VRM asset, its license settings, the package manifest, or the lockfile.

## Decisions shown as diffs

Interaction module boundary:

```js
createInteractions(vrm)
// Returns:
// capabilities: { happy, surprised, blink, idle, gaze }
// react(name): accepts only 'happy' or 'surprised'; unsupported names do nothing
// reset(): restores base pose and neutral expression/gaze
// update(delta, { motionEnabled, gazeTarget }): advances state; target is a world-space Vector3 or null
```

Main owns raycasting and transforms pointer coordinates. The interaction module owns its look-at target object and smooths toward the supplied point. No controller registry, event bus, or model-specific subclass.

```diff
-active?.vrm.update(delta);
+if (active) {
+  active.interactions.update(delta, { motionEnabled, gazeTarget });
+  active.vrm.update(delta);
+}
```

Guard the built-in expression API through the controller's capability check:

```diff
+vrm.expressionManager.setValue('happy', name === 'happy' ? 1 : 0);
+vrm.expressionManager.setValue('surprised', name === 'surprised' ? 1 : 0);
```

Restore the captured pose before applying the current frame's small rotation. Never use an accumulating increment such as `spine.rotation.z += sway`.

```diff
+<fieldset id="interactions" disabled>
+  <legend>Interaction</legend>
+  <button type="button" data-reaction="happy">Smile</button>
+  <button type="button" data-reaction="surprised">Surprise</button>
+  <button type="button" id="reset-character">Reset character</button>
+  <label><input type="checkbox" id="automatic-motion"> Automatic motion</label>
+  <label><input type="checkbox" id="follow-pointer"> Follow pointer</label>
+</fieldset>
```

Capability explanations belong in an adjacent text element, not a tooltip-only message. Do not announce every blink or frame in a live region.

## Steps

- [x] Review this plan in Plannotator. Explain expression weights, normalized bones, and the difference between camera movement and character movement.
- [x] Preserve the reviewed lesson 3 working tree. Snapshot the five existing files listed above outside the repo, with file hashes, to compare lesson 4 independently. Record that `src/interactions.js` is new. Do not commit, stash, reset, or discard lesson 3.
- [x] Run the existing full smoke suite as a baseline. Read the pinned library APIs for expression bindings, normalized bones, and look-at reset/update before using them.
- [x] Extend the browser checks for both avatars with reduced-motion mode and the new controls. Assert a rendered face change for Smile and Surprise, and restoration with Reset character. Run against the current viewer and capture the expected failure before implementing the controls and interaction module.
- [x] Implement manual reactions and Reset character through the module. Integrate controller state into successful replacement and rollback without changing resource ownership. A rejected candidate must not reset the active avatar's reactions.
- [x] Add deterministic browser-clock tests for blink timing, bounded non-accumulating sway, reaction expiry, motion-off stillness, and live reduced-motion changes. Then add blink/idle updates to the existing loop. Keep existing camera and GPU resource tests passing under reduced motion.
- [x] Add a click-hit test and negative tests for background clicks, camera drags, and multi-pointer cancellation. Implement pointer tracking and raycasting only after the tests fail. Reuse the Smile action rather than a second reaction path.
- [x] Add gaze tests for both bundled models, using their different gaze systems. Implement camera-relative target conversion and the built-in look-at API. Test pointer leave, drag start, gaze-off, reset, and successful switching clear the target.
- [x] Add a missing-capability case by intercepting a real model response in the test and removing optional expression/look-at metadata. Rebuild the GLB JSON chunk and lengths correctly in memory; do not modify bundled files. Assert unsupported controls are disabled with an explanation and supported controls continue to work.
- [x] Run the complete smoke suite and production build. Test switching during an active reaction, failed replacement retaining the current reaction, context loss, and repeated switching without resource accumulation. Keep all asynchronous waits bounded.
- [x] Inspect both avatars on desktop and mobile in Agent Browser. Capture matched neutral/smile/surprise images, confirm blink/idle/gaze visibly affect the model, and verify dragging never triggers a smile. Recheck keyboard activation and reduced-motion behavior; report automation or device limitations rather than claiming unverified support.
- [x] Update README with actual results and evidence paths. Generate a lesson-4-only static diff against the saved lesson 3 snapshot, include the new module, and review it in Plannotator. Stop before the next lesson or any commit/push.

## Verification

Run `npm run test:smoke -- <actual-local-url>` and `npm run build`. Reuse `http://127.0.0.1:5173` only after confirming the server still belongs to this project.

Use browser screenshots or rendered pixels for visible expression changes, not only button state or status text. Keep the camera fixed and automatic motion off for those comparisons. Advance the browser's test clock explicitly for timing checks rather than sleeping or disabling assertions when motion is enabled.

Capability fixtures must retain the rest of a valid VRM. Removing optional happy/blink/look-at metadata should disable only those features; it must not force every control off by causing the entire model load to fail.

Review existing pixel and screenshot tests for motion sensitivity rather than weakening their zoom, rollback, or cleanup assertions. Retain exact expected-error allowances for intercepted failures.

No performance or physical-device claim without measurements. Native keyboard selection and touch pinch remain known unverified items from lesson 3 unless separately exercised successfully.

## Sources

Inspected the embedded metadata and expression bindings of both bundled VRM files, not just their preset names.

Context7 references, to be checked against installed `@pixiv/three-vrm@3.5.5`:
- Expressions: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/expressions.html
- Built-in gaze target: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-core/examples/lookAt.html
- Normalized bones and update ordering: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/bones.html

## Not doing

No physics sliders, ragdolls, full cloth simulation, arm-pose conversion, animation downloads, voice, lip sync, chat, uploads, new avatars, persistence, randomized behavior, dependencies, public hosting, commits, or pushes. Existing authored spring bones continue to be updated by three-vrm; this lesson does not add a new physics solver.
