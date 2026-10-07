# Personal Waifu

A website with a 3D anime character that helps you choose anime to watch.

## Current status

Lesson 4 adds expressions, blinking, subtle spine sway, character-click reactions, and optional pointer-following gaze to the pixiv sample and Seed-san. Both retain their authored arm poses. Failed replacements preserve the current avatar and reaction; successful replacements release the old model's GPU resources. There is no chat, physics control panel, custom character import, or trained model yet.

## Run locally

Use Node.js 22.12 or newer and npm. This lesson was checked with Node.js 26.10.0.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open http://127.0.0.1:5173. `--strictPort` stops the server if that port is occupied rather than silently choosing another. Leave other processes running; choose a different free port if needed.

The character and dependencies load from the local server, not a model CDN or AI provider. The sources and licenses for both bundled assets are in [public/models/README.md](public/models/README.md).

## Controls

- Choose an avatar from the Character selector. Only one model loads at a time; the current avatar's camera remains usable while a replacement loads.
- A successful switch resets the camera to frame the new avatar. If loading fails, selection returns to the current avatar; select the desired character again to retry.
- If the initial model fails, choose the other character. Reloading the page starts with the pixiv sample again.
- Drag on the character area to orbit the camera.
- Scroll or pinch over the character area to zoom.
- Use Rotate left/right, Zoom in/out, and Reset view for the same actions with a keyboard.
- Resizing the viewer reframes the character. Panning is disabled and zoom is bounded.

### Character interaction

- Smile and Surprise apply the avatar's full-strength expression. Seed-san uses binary presets, so these reactions do not fade.
- Click the character to Smile. Background clicks, movement beyond 6 CSS pixels, multi-touch, and cancelled gestures do not react. The Smile button is the keyboard equivalent.
- Automatic motion adds a blink every 4 seconds and a five-second spine sway within 0.75 degrees. Reactions expire after 1.5 seconds while motion is enabled. With motion off, an expression stays until another reaction or Reset character.
- Follow pointer is off by default. When enabled, mouse or pen movement inside the canvas directs the eyes through the model's look-at system. Leaving, pressing to drag, disabling gaze, resetting, or switching clears the target until a fresh pointer move.
- Reset character clears reactions and gaze, restores the base spine pose, and restarts motion phases. It preserves the camera and toggle preferences. Reset view only resets the camera.
- Reduced motion starts with automatic motion off. A live OS change to reduced motion disables motion and gaze and resets the character. You can explicitly enable either afterward. Successful switches preserve those preferences, not the old avatar's reaction.
- Unsupported controls are disabled with a visible explanation. Existing authored hair and accessory spring bones continue updating even with Automatic motion off.

## Check the viewer

```sh
npm run build
# Keep the dev server running in another terminal:
npm run test:smoke -- http://127.0.0.1:5173
```

The smoke check uses an existing Google Chrome installation through Playwright. It does not install a browser. It checks both avatars at desktop and mobile viewport sizes, rendered character pixels, keyboard camera controls, zoom direction, reset, rotation, wheel zoom, and local-only requests. It also checks round-trip switching, delayed replacements, missing/invalid models, recovery after an initial failure, and context loss during a pending load.

Interaction checks compare rendered faces for reactions, reset, gaze, and blinking. A controlled browser clock checks motion phases, reaction expiry, motion-off expression retention, and live reduced-motion changes. Gesture checks cover character hits, background misses, drags, multi-touch, and cancellation. Three valid, in-memory GLB variants remove optional metadata or bindings to check capability fallbacks without changing bundled assets. Replacement tests cover active reactions, neutral incoming avatars, retained preferences, and disabled interaction controls after failure or context loss.

The build and all 25 smoke cases passed. A repeated-switch check counts real WebGL buffer, texture, and program handles. After warmup and three further round trips, counts remained stable for each avatar: Seed-san had 126 buffers, 27 textures, and 18 programs; the starter had 78 buffers, 33 textures, and 8 programs. This tests accumulation over that sequence, not every possible memory leak.

Both avatars were inspected through Agent Browser in Chrome at 1280x900 and 390x844 on http://127.0.0.1:5173. Matched screenshots show neutral, smile, and surprise states. Desktop frame captures show blinking, idle motion, and gaze; orbit drags left the reaction neutral. Keyboard activation and live reduced-motion behavior were rechecked. No page, console, or network errors appeared. Seed-san's face is small at the mobile viewport, making expressions subtle.

Native keyboard selection remains a manual check: headless Chrome on this Mac received trusted key events but did not change selection, including on an isolated HTML select without app code. Automated multi-touch cancellation passed, but physical touchscreen and pinch gestures remain unverified.

Local evidence is temporary and not committed:

```text
/tmp/personal-waifu-lesson-4-smoke.log
/tmp/personal-waifu-lesson-4-build.log
/tmp/personal-waifu-lesson-4-expressions-contact-sheet.png
/tmp/personal-waifu-lesson-4-motion-contact-sheet.png
/tmp/personal-waifu-lesson-4-reduced-motion.png
/tmp/personal-waifu-lesson-4-browser-{console,errors,network}.log
/tmp/personal-waifu-lesson-4.patch
```

Full-page expression screenshots use `/tmp/personal-waifu-lesson-4-{starter,seed}-{desktop,mobile}-{neutral,smile,surprise}.png`. The review patch compares lesson 4 against a hashed snapshot of the approved, uncommitted lesson 3 files, not against HEAD.

The JavaScript bundle is 780.04 kB minified, producing Vite's existing size warning. The uncompressed avatar files are about 10.8 MB and 10.9 MB. Only the selected model is requested; switching back loads it again without an application-level model cache. Loading optimization is deferred; no performance target has been verified.

## Learning sequence

1. Set up the repository.
2. Build a local website with a licensed 3D character.
3. Add character switching with two bundled avatars.
4. Add expressions, gaze, and idle motion.
5. Add spring-bone physics controls for compatible models.
6. Connect a baseline anime recommendation chatbot.
7. Create permitted training examples, keep a separate evaluation set, and compare a fine-tuned model with the baseline.

Custom VRM imports come in a later lesson. The [3D viewer plan](plans/3d-viewer.md) records the roadmap. The [character-switching plan](plans/character-switching.md) and [character-interaction plan](plans/character-interactions.md) record lessons 3 and 4.

## How we work

Review each small plan in Plannotator before editing.
Explain each code change, run the relevant checks, then review the diff.
Pause before the next lesson. Commit and push only when requested.
