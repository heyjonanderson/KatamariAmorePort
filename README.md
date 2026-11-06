# Katamari Amore web port

A browser port of the iOS game Katamari Amore (v1.3.2). WebGL and plain JavaScript, no build step. The game data is pulled from the app's own files and the physics numbers are read from its binary. Work in progress, six stages playable.

Play: https://heyjonanderson.github.io/KatamariAmorePort/
Repo: https://github.com/heyjonanderson/KatamariAmorePort

## Run it locally

`python3 serve.py` (or `serve.bat` on Windows), then open the address it prints. Needs a static server because the game loads JSON and binary files.

Controls: WASD or arrows to move, Shift or Space to dash, Q or E to U-turn, R to restart, M to mute, Esc or P to pause. Touch uses one drag stick on the left and an orange U-turn button.

## What is in here

- `menu.html` title, mode and stage select, King briefing
- `game.html?stage=S001&mode=story` the game. Modes: `story`, `timeattack`, `eternal`, `exact`. `catch=f0` or `catch=goal` switch the catch size rule to the older guesses
- `viewer.html` model and stage viewer
- `sim.js` rules and physics, `game.js` rendering and HUD, `text.js` and `menu.js` interface, `audio.js` sound
- `tools/` Python export scripts. `python3 tools/build_all.py APP_FOLDER` rebuilds `data/` from a decrypted app folder. `tools/kparam.json` is the physics table read from the binary
- `tests/` bot and smoke tests (Node). `node tests/bot2.js S001` plays a stage with a path-planning bot, `node tests/game_smoke.js` checks the game loads
- `SPEC.md` notes on the data formats

## Assumptions

Everything that is a guess, a placeholder or a choice of mine is listed in [ASSUMPTIONS.md](ASSUMPTIONS.md), with how it was checked and how to clean it up. Items marked RESOLVED were checked against the app's source files or its binary. If something feels wrong when you play, look it up there first.

## Where it stands

From the original code: movement (drag, acceleration, brake, stick curve), speed table, catch size and growth, crumble and converge, time limits, camera data rows, the physics parameter table, text in six languages, the ball model, stage data, sounds.

Still mine: camera follow smoothing, the prince U-turn timing, which sound plays for what, the bus path curve, menu and intro staging, Exact Size targets, touch controls.

## Roadmap

### Needs a human

- Play the new catch size and growth (A78). Catch sizes now come from the engine formula with each model's stored box. Growth in the John's Room reference video (6 cm at 30 s, 24 cm at 100 s, 49 cm at 180 s, 124 cm at the end) has the same shape as the data allows. My bot is slower than that player and cannot clear stages 2 and 4 to 6 in time, so someone needs to judge the pace.
- Feel the speed and brake rules (A71, A75, A27). Drag, stick curve, braking and acceleration use the real numbers. Check rolling, steering at speed and stopping. Keyboard and touch push strength is my choice.
- Feel the crumble (A65, A80). Dashing head-on into a wall knocks the newest objects off. Thresholds and throw come from the source. Check that objects pop up, not down.
- Play stages 2 to 6 (A49, A59). Only the bot has cleared them. Look for bad collision, stuck spots, wrong goal sizes, and animals walking at the wrong pace.
- Ball growth curve (A74). A tester says diameter is "really the square root of the real value". The code takes the cube root of volume. Needs a concrete example.
- Listen to every sound mapping (P23, A53). None has been heard. Nothing plays for rolling, dashing or the prince.
- Try it on a phone (P11, C8). Stick, buttons, pause menu and bug report box have never run on a real phone.
- Prince U-turn, lumps, lighting and texture settings, the stage 1 hallway pop-in, Exact Size cutoffs (A66, A64, A67, A51, A57).

### Ready to build

- Wall climbing (A79), also asked for by a tester. Values are read from the binary, logic is in `KatamariHit.cppi`. The port has a step-up placeholder.
- Prince's face is upside down (A81), tester report.
- Stage layout per mode (A82). Tester says it differs between Story, Time Attack, Exact Size and Eternal. Check the stage files for per-mode variants first.
- Controls like the reference gameplay (A83), tester report. Need to ask which part feels off.
- Stage packs 2 and 3 (A44). The app holds 21 stages and only S001 to S006 are exported.
- Records, shop and album screens (A55). Data files ship with the app.
- Finish the language work (A77). Object names (`MONONAME.dat`), the pause menu and a few labels are still English.
- Rest of the physics table (A71, A76). Wall and flat-ground angles, fly and landing times, display scale growth, and what a back push does.
- Test `tools/build_all.py` on a clean folder (C4).
- Later, as a separate project: I Love Katamari.

### Blocked on data that is only in the binary

- Camera follow code (P10), prince U-turn timing (A66), catch sound routing (A53), bus path Spline (A35 to A37), Exact Size target sizes (A57), menu and intro staging (A38 to A41, A58), unused stage fields.

### Done

- Catch size solved: the engine reads each model's stored bounding box (A78)
- Speed table columns decoded: brake and acceleration had been swapped (A27)
- Crumble throw from the source (A80); real crumble and converge thresholds
- Real drag, stick curve, brake rule and move-turn
- Stages 2 to 6 with targets, music and stair handling
- Original ball model and textures, timer, item tag, touch layout from reference videos
- Exact Size mode with the King's lines, opening story, fall recovery, flip-book animation, lumpy ball
- Six languages from the title screen, size text as `4m02cm8mm`
- Pause menu with a bug report copy button, lighting and texture settings
- Export tools take arguments, with a `build_all.py` that chains them

## For testers

- Esc, P or the Pause button opens the pause menu. "Bug report" copies the stage, mode, time, size, position and browser. Paste it into a message and say what went wrong.
- "Catch size" in the pause menu switches between the engine formula (default) and the old guess (A48, A73, A78).
- Stages 2 to 6 are flagged "rough" on the stage select. Exact Size target sizes are placeholders.
- Best times and sizes are saved in your browser only.
