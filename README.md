# Katamari Amore web port

A browser port of the iOS game Katamari Amore (v1.3.2), in WebGL and plain JavaScript with no build step. Game data comes from the app's own files and the physics numbers are read from its binary. Work in progress, with six stages playable.

- Play: https://heyjonanderson.github.io/KatamariAmorePort/
- Repo: https://github.com/heyjonanderson/KatamariAmorePort
- Every guess, placeholder, and open question: [ASSUMPTIONS.md](ASSUMPTIONS.md)

## Run it locally

Run `python3 serve.py` (or `serve.bat` on Windows) and open the address it prints. A static server is needed because the game loads JSON and binary files.

| Input | Keyboard | Touch |
|---|---|---|
| Move | WASD or arrows | One drag stick on the left |
| Dash | Shift or Space | Dash button |
| U-turn | Q or E | Orange button |
| Pause | Esc or P | Pause button |
| Restart, mute | R, M | Pause menu |

## What is in here

- `menu.html`: title, mode and stage select, King briefing
- `game.html?stage=S001&mode=story`: the game. Modes are `story`, `timeattack`, `eternal`, and `exact`. `catch=f0` or `catch=goal` switch to the older catch size guesses
- `viewer.html`: model and stage viewer
- `sim.js`: rules and physics. `game.js`: rendering and HUD. `text.js` and `menu.js`: interface. `audio.js`: sound
- `tools/`: Python export scripts. `python3 tools/build_all.py APP_FOLDER` rebuilds `data/` from a decrypted app folder. `tools/kparam.json` is the physics table read from the binary
- `tests/`: Node tests. `node tests/bot2.js S001` plays a stage with a path-planning bot, `node tests/climb.js` checks the wall climb, and `node tests/game_smoke.js` checks the game loads
- `SPEC.md`: notes on the data formats

## Where it stands

**From the original code:** movement (drag, acceleration, brake, stick curve), the speed table, catch size and growth, crumble and converge, time limits, camera data rows, the physics parameter table, text in six languages, the ball model, stage data, and sounds.

**Still mine:** camera follow smoothing, which sound plays while objects act, menu and intro staging, and touch controls.

## Roadmap

Each item lists its entry in ASSUMPTIONS.md. Items marked RESOLVED there were checked against the app's source files or binary.

### Reported by testers (not fixed yet)

- **Tall objects glitch across the screen** (A84). Rolling up a tall object fills the view and hides the level.
- **Ball stretches into a tall oval** (A85). Seen at 9.5 cm in a tester screenshot.
- **Moving objects** (A35, A36, A86). Path followers now use the engine's own spline and facing rule. Check the bus and animals look right, and that the UFO in stage 5 tilts along its path.
- **Stage 1 trophy rotated 90 degrees** (A87). Placement rotation order was fixed from the loader (A97) but that does not touch yaw, so this is still open. It is the one that blocks the way to the next area.
- **Prince's face is upside down** (A81). The binary and the texture say it is upright, so I need to know where it shows. Screenshot please.
- **Controls should feel like the reference gameplay** (A83). Ask which part is off: stick feel, camera turning, or dash.
- **Moving objects knock the ball** (A100). New: a bus or animal running into the ball shoves it, drops your dash, and locks the controls for a third of a second. Also, crumble throws are now faster (1.63 instead of 0.98). Check that neither feels wrong.
- **Wall climbing** (A79, A98). New, never played. Roll into a wall or a tall object head-on and the ball lifts up it. Check the feel and that it does not catch on things it should not.

### Needs a human

- **Catch size and growth pace** (A78). Catch sizes come from the engine formula with each model's stored box. Growth in the John's Room reference video (6 cm at 30 s, 24 cm at 100 s, 49 cm at 180 s, 124 cm at the end) matches the shape of the data. My bot is slower than that player and cannot clear stages 2 and 4 to 6 in time, so someone needs to judge the pace.
- **Speed and brake feel** (A27, A71, A75). Drag, stick curve, braking, and acceleration use the real numbers. Check rolling, steering at speed, and stopping. Keyboard and touch push strength is my choice.
- **Crumble** (A65, A80). Dashing head-on into a wall knocks the newest objects off. Check that they pop up and not down.
- **Stages 2 to 6** (A49, A59). Only the bot has cleared them. Look for bad collision, stuck spots, wrong goal sizes, and animals walking at the wrong pace.
- **Ball growth curve** (A74). A tester says diameter is "really the square root of the real value". The code takes the cube root of volume. Needs a concrete example.
- **Sound mapping** (A99, A101, P23). Pickup, catch, crumble, crush, landing, dash, spin, brake, and U-turn sounds now follow the binary but have not been heard. A few ids are still unmapped (A101), and nothing plays for rolling.
- **Phone play** (P11, C8). The stick, buttons, pause menu, and bug report box have never run on a real phone.
- **Smaller checks:** prince U-turn (A66, A89), lumps (A64), lighting and texture settings (A67), stage 1 hallway pop-in (A51), the "Stop with this size" flow (A57).

### Ready to build

- **Stage packs 2 and 3** (A44). The app holds 21 stages and only S001 to S006 are exported.
- **Records, shop, and album screens** (A55). The data files ship with the app.
- **Rest of the physics table** (A71, A76). Wall and flat-ground angles, fly and landing times, display scale growth, and what a back push does.
- **Test `tools/build_all.py` on a clean folder** (C4).
- **I Love Katamari** as a separate project, later.

### Blocked on data that is only in the binary

- Camera follow code (P10)
- Catch sound routing (A53)
- Menu and intro staging (A38 to A41, A58)
- Unused stage fields

### Done

- Moving objects knock the ball and the crumble throw speed uses the right constant (A100)
- Wall climb from the engine's state machine and the KATA_CLIMB_PARAM numbers (A79, A98)
- Catch size solved: the engine reads each model's stored bounding box (A78)
- Speed table columns decoded; brake and acceleration had been swapped (A27)
- Crumble throw and thresholds from the source (A80)
- Each mode loads its own object layout from the stage files (A82)
- Prince U-turn length and arc from the binary, and his distance behind the ball from the speed table (A89)
- Real drag, stick curve, brake rule, and move-turn
- Stages 2 to 6 with targets, music, and stair handling
- Original ball model and textures, timer, item tag, and touch layout from the reference videos
- Path followers (bus, animals, cars, UFO) use the engine's B-spline and look-at rotation read from the binary (A35, A36, A96)
- The end of a run as the original does it: pause menu questions, Eternal can be finished, the King's goodbye before the result, the 1 minute line, and the end whistle, 30 second tick and result sounds (A93, A94)
- Time limits, Exact Size targets and tolerances, and the King's result rules, read from the original's data and code (A90 to A92)
- Exact Size mode with the King's lines, opening story, fall recovery, flip-book animation, and lumpy ball
- Six languages from the title screen (story text, stage names, object names; the pause menu and a few buttons have no strings in the app and stay English, A95), and size text as `4m02cm8mm`
- Pause menu with a bug report copy button, lighting, and texture settings
- Export tools that take arguments, with a `build_all.py` that chains them

## For testers

- Esc, P, or the Pause button opens the pause menu. "Bug report" copies the stage, mode, time, size, position, and browser. Paste it into a message and say what went wrong.
- "Catch size" in the pause menu switches between the engine formula (default) and the old guess (A48, A73, A78).
- Stages 2 to 6 are flagged "rough" on the stage select. Time limits, Exact Size targets and the King's result rules now come from the original's data (A90 to A92).
- Best times and sizes are saved in your browser only.
