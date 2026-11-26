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
- `intro.js`, `data/intro.json`: the opening stories, played from the original's script tables (A107). `tools/export_intro.ghidra.py` dumps them from the binary.
- `tests/`: Node tests. `node tests/bot2.js S001` plays a stage with a path-planning bot, `node tests/climb.js` checks the wall climb, and `node tests/game_smoke.js` checks the game loads
- `SPEC.md`: notes on the data formats

## Where it stands

**From the original code:** movement (drag, acceleration, brake, stick curve), the speed table, catch size and growth, crumble and converge, time limits, camera rows, camera follow and its 32 frame moves, the physics parameter table, wall angles, the wall bounce and the landing bounce (A103, A108), the zoom echo, per-stage music and catch sounds (A50, A104), the three opening stories from the original script tables (A107), text in six languages, the ball model, stage data, and sounds.

**Still mine:** parts of the camera wall avoidance (A112), the angle rule for steering (A113), which sound plays while objects act, menu layout and transitions, the intro's text font, and touch controls.

## Design policy

The original game is the default. Where a tester asks for something the original did not do, it goes in as an optional toggle, off by default, so a run matches the original unless the player opts in. The pause menu has these toggles, saved in the browser:

- **Extra minute on timed runs.** Adds 60 s to Story and Time Attack limits. Runs with it on do not save best times, because they are not comparable with the original. Restart to apply.
- **Repeating object sounds off.** The original repeats a sound while an attached object keeps making it; this plays it once.
- **Wide view.** Keeps the original's 33 degree vertical view angle on wider windows (the original fixes the horizontal angle at 48 degrees, so wide screens see less height). `?view=wide` does the same.

Queued as toggles: a see-through cutout when something blocks the view, and a size to roll up shown for each item in the Collection.

Not toggles, because the original does them this way: Exact Size and Eternal have no timer and a stop button, Exact Size hides the size, and the menu goes pack, stage, mode (A128, A129).

## Roadmap

Each item lists its entries in ASSUMPTIONS.md. The same list is kept as a page that is updated with it; this is the copy in the repo. "Size" is S, M or L.

### Needs a human

Built and bot-tested, but only a person can say if it feels right. Ordered so you can run through them in one sitting.

- **Rolling direction** (A124, A125) [S]. The ball now rolls forward. Roll and watch the ball and the stuck objects (A124).
- **Time Attack music and iPad sound** (A124, A125) [S]. Time Attack plays BGM_ST00 on every stage. Music and effects should start on the first tap on iPad Safari and Android Firefox, with no page zoom (A125).
- **Catch size and growth pace** (A78) [M]. Play stage 1 against the John’s Room video: it shows 6 cm at 30 s, 24 cm at 100 s, 49 cm at 180 s and 124 cm at the end. Say if the port grows faster or slower, and if objects stick when they should not or bounce off when they should stick. The bot is slower than a player, so it cannot judge this.
- **Rolling, steering, braking** (A71, A75) [M]. Drag, stick curve and brake rule are the engine’s numbers. Check steering at speed and stopping. Keyboard and touch push strength (A75) is my choice, so that is the part most likely to feel off.
- **Listen to all of the sound** (A109, P23, A53, A99, A101, A102, A104) [M]. Important: sound was silently broken from 2026-11-06 until today (a loader bug, A109), so nothing in the port has ever been heard, by me or by testers. It is fixed and checked by decoding in a browser. Now everything needs a first listen: pickup blips, catch loops, crumble, crush, landing, spin and dash, brake, U-turn, the 30-second warning, the end whistle, the camera step sound, stage music per stage, and the music and effects in the three opening stories. Report anything that sounds like the wrong effect. Nothing plays for rolling, and the new-area sound is still my guess.
- **Opening stories** (A107) [S]. New. All three now play from the original script tables: staging, timing, fades, balloons, music and the closing scroll are the original’s. Replay intro on the stage screen. Check the pace and the text size against a recording of the real game if you have one; tap or Enter skips.
- **Wall climb** (A79, A98) [M]. New. Roll head-on at a wall or tall object. The ball lifts up to 0.7 of its diameter, holds a third of a second at the top, then drops and cannot climb again for a third of a second. Check it does not grab walls it should slide along, or fail on edges that should work. Which contacts count as one wall is my choice.
- **Stage music** (A50) [M]. New. Every stage now plays its own track from the binary’s table (stage 1 was one track off before). Listen for the right piece per stage, a click at the loop seam, and the intro part leading into the loop.
- **Wall bounce** (A103) [M]. New. Roll at a wall at an angle and the ball should rebound at about half speed, mirrored, and the dash cancels. A hard hit plays the crush sound. Check it is not too bouncy or too sticky in corners. Bots clear stages slower with it (S001 317 s to 358 s) but S003 got faster (635 s to 416 s), so I do not know which way it should feel.
- **Camera** (A102) [S]. New. The camera now follows by the engine’s rows: it swings out in steps as the ball grows, over about a second, and heads where the prince looks with no easing. Check it against the reference videos, and say if it feels stiff or late.
- **Moving objects shove the ball** (A100) [S]. New. The bus and animals now knock the ball along their path and lock controls for 10 frames. Crumble throws are also 66% faster, after a wrong constant was fixed. Check neither feels off.
- **Crumble** (A65, A80) [S]. Dash head-on into a wall with a full ball. Objects should pop up and out, and be catchable again after a moment. The 75 degree launch direction is my reading of the code.
- **Prince U-turn** (A66, A89) [S]. Q or E, or the orange button on touch. Hop length and arc are from the binary and the sound is now game_13. Check it looks like the reference videos.
- **Play stages 2 to 6 and both new packs** (A49, A59, A104) [L]. Stages 2 to 6 only have bot runs. The 12 stages of Time Trip and Rolling Whopper have never been played by anyone and are flagged “untested”. Look for stuck spots, bad collision, goal sizes that feel wrong, models that look broken, walking animals at the wrong pace, and anything missing from the data (S015 and S017 have no draw distance section, so I used a guess).
- **Real time limits** (A90, A92) [M]. Story limits 5, 6, 4, 5, 6, 8 minutes, time attack 4, 4, 3, 4, 4, 5. Time attack limits match the two reference videos (stage 1 and 4). Story limits come from the same table and were not checked against a video. Check the 1 minute warning and the 30 second ticking.
- **Exact Size** (A57, A91) [S]. Targets, tolerances and verdict lines are from the stage files. Try to land on 1 m on stage 1. The “Stop with this size” button is mine, because the engine’s way to end an Exact Size run is not decoded.
- **Stage 1 hallway pop-in** (A51, A52) [S]. Objects now grow in when the ball reaches 19 cm and the draw distance is longer. Check it does not pop and that it matches the video.
- **Lumps in the physics** (A64) [S]. Long objects lift the ball slightly as they roll under it, capped at a quarter of the radius. Check it is not bumpy and does not snag on low things.
- **Lighting and texture settings** (A67) [S]. Pause menu has Lighting (Soft, Flat, Strong) and Textures (Smooth, Sharp, Pixel). Say which pair looks closest to the real game so I can make it the default.
- **Ball shape and core size** (A111) [S]. New. The ball no longer stretches into an oval (that was my guess, A60) and the core is drawn smaller than the object shell, 0.38 of the growth, like the original. Check 10, 30 and 100 cm: no oval, and no hollow look.
- **Records and Collection screens, achievement banners** (A114) [S]. New. Stage screen has Records and Collection buttons. Records shows your best per stage and mode on the clipboard; Collection lists what was stuck on the ball when you cleared a story stage. First catch of a pack’s achievement item (CARD, SKULL and so on) shows the original text banner, and the Pac-Man, Tekken or Galaga item the unlock text. Layout of the text is mine; say what looks off.
- **Camera against walls** (A112) [S]. New. Pressing the ball into a wall or corner now snaps the camera upward at once, up to nearly top-down, at the same distance, instead of sliding in and easing back. Check it looks like the reference videos.
- **Phone** (P11, C8) [S]. The floating stick, dash and U-turn buttons, pause menu and bug report box have never run on a real phone. Also check landscape, safe areas and that audio starts after the first tap.
- **Lighting and look against the real game** (A117, A8, B2) [S]. The default lighting is now the engine’s own constants (back faces culled, soft edges on cut-outs). The only inferred part is the sign of the sun direction. If tops of things look too dark or too bright next to the iOS game, say so and it is a one-character flip.

### Waiting on a tester

Reports I could not reproduce from the data. I will try to reproduce each one first, but a screenshot or a few words from the tester will settle them.

- **Name the six menu tracks** (Tester 2026-11-25) [S]. KD_BGM_01, 04 and 05 are now in the port, and soundtest.html plays every track. Tester: match the files to Overture I, Walking On A Star, Fugue #7777 and Lovely Angel by ear and say where each belongs. Binary says: title KD_BGM_00, result screen KD_BGM_04, collection KD_BGM_05, opening story KD_BGM_06.
- **Stage 1 trophy rotated 90 degrees** (A87) [S]. The placements are upright with yaw plus or minus 90, and I cannot see anything wrong in the data. Which trophy, and which way should it face? A screenshot would do.
- **Movement like We Love Katamari** (A83, A110) [M]. Tester suggests We Love Katamari’s movement and rolling code. None of it is in the files here; the port uses this app’s own drag, acceleration, brake and stick tables (A27, A71). Need to know which part feels different, with a stage and a situation.
- **Prince’s face upside down** (A81) [S]. The binary draws him with one plain matrix and the texture mapping checks out. Where does it happen: the hop, the start of the stage, the menu?
- **Controls like the reference gameplay** (A83) [M]. Which part: touch stick, two-stick feel, camera turning, or dash? Without that I can only compare to the videos.
- **Ball growth curve** (A74) [S]. A tester says diameter is “really the square root of the real value”. The code takes the cube root of volume like the engine. A concrete example (object, size before, size after) would show if something else is off.
- **Tall objects fill the screen** (A84, A112) [M]. Could not reproduce the view being blocked by attached objects: the camera sits far enough back that they never reach it. Best guess is the camera clipping into geometry while climbing, which the new wall avoidance (A112) changes. Need to know whether it still happens, and on which stage and object.

### I can do these now

The data or code is in the app and nothing is in the way. This is the work queue.

- **Ramps and slopes up and down (High School, City Square, Big City, Kid's Room pedestal, Western Europe)** (Tester 2026-11-25) [M]. Isolated ramps climb in the sim and the climb code matches the engine (A131). Needs positions: which ramp, which size. Four reports so far with no spot named.
- **Stage 2 fish statue ramp and crate start** (Tester 2026-11-25) [S]. Placement rotation signs were wrong (A136), which can turn the tilted fish vases the wrong way; check the ramp again. Still to do: the 40 cm climb question at the first incline and the crate start in Time Attack.
- **Katamari slides while climbing** (Tester 2026-11-25) [M]. Lock the ball's x and z while it climbs a wall or object (tester). Check the continuation rule in A79 and the engine's climb state.
- **Katamari slides all over the place** (Tester 2026-11-25) [M]. Tester says it slides on turns. Compare grip and drag with the engine (A71) at several sizes; may be the same cause as the slopes.
- **Speed in big stages and the fall speed when huge** (Tester 2026-11-25) [M]. Checked against the table, the engine source and gravity rules with no defect found (A131). Needs a tester video with the stage and spot, and the size, where it feels slow. Possible lead: the engine clamps the lookup size to KataLimitSize.
- **Draw distance** (Tester 2026-11-25) [S]. Still short in the John's Room hallway and Roman Coliseum. A52 has the engine's far plane; check which pair is applied, and the object fade and cull distances.
- **Optional improvements: see-through cutouts and size to roll up** (Owner 2026-11-25) [M]. The original stays the default and improvements are optional pause-menu toggles. Built: extra minute, quiet repeating sounds, wide view. Still to build: a see-through cutout when an object or wall blocks the view, and a size to roll up shown for each item in the Collection.
- **Camera: top down in Secret Lab and Space Colony, too close in City Square and Shopping Mall** (Tester 2026-11-25) [M]. The camera collision ray was two-sided; the engine's test is one-sided and now ported (A134). The too-close view may be the 16:9 vertical angle (A135): wide view is now a pause-menu option. Needs tester check on Secret Lab, Space Colony, City Square and Shopping Mall.
- **Rolled up objects stick out too far** (Tester 2026-11-25) [S]. Umbrellas in City Square and others sit well outside the ball. Check the attach depth rule and the core size (A111).
- **Time Attack scores 2 mm low** (Tester 2026-11-25) [S]. Western Europe and Big City give 705 m 36 cm 0 mm here and 2 mm more in the original. Float32 accumulation was ruled out and the size and pickup formulas match the engine (A133); what is left is a constant 0.2 cm in diameter, about one 11 m object or a different start size. Needs a tester video of a full Time Attack clear or the original's object count per stage.
- **Hit system: the engine's ray based ground and walls, and ibitsu** (A137, A143, A144, A145, A146) [L]. Plan in docs/IBITSU_PLAN.md. Done: the fixed distort table from the binary (A144), the one sided segment test (A145), the ground and wall lists with the position correction (A146, output only; on flat ground and ramps it agrees with the sphere push to under 0.4 cm, it disagrees on low steps). Next: drive the movement from the lists behind ?hit=ray (off by default), then the distort points and the FIX and FLUID rocking states, then flip the default only if it matches or beats the sphere push.
- **The King's head in the in-game dialogs** (Tester 2026-11-25) [M]. The achievement and 1 minute left dialogs. The head on the briefing and result screens is done (A141). Game::facereq is set in MonoHit.cppi, but the code that reads it is not in the shipped sources and still has to be decoded (A93, A114, A141).
- **Safari and Firefox on Android checks** (Tester 2026-11-25) [S]. Audio unlock and zoom guard are in (A125). Firefox on Android flashes when dash is pressed over and over; cause not known.
- **Stage 2 (South American Ruins) wall climb check** (A79, A98, A110, A115) [S]. Tester says it cannot be finished. The bot stall was its own planner (A115); with wall climb in the planner it clears the stage in 649 s. Still unplayed by a person: roll at the 20 cm step near x = -530 and say if the climb feels doable.
- **Check the camera wall avoidance assumptions** (A112) [S]. The swing rule is from the binary: one ray, 10 + 75 degrees by how close the hit is, capped at 85 degrees, no easing. Still unconfirmed: where the ray starts, the swing axis, and what the blocked flag at +0x230 drives. Compare with a reference video of a camera against a wall.
- **Extra-stage result lines** (A104, A114) [S]. The EXTRA_RES lines (the King judging a mini-game score) belong to the Pac-Man, Tekken and Galaga stages, which are not ported. The achievement and unlock banners are built (A114).

### Bot runs

The path-planning bot clears a stage in code, with no person. Slow, and it plays worse than a human, so a loss here is a hint and not a verdict. Run with node tests/bot2.js S008.

- **Clear the 12 new stages with the bot** (A104, A115) [M]. Cleared so far: S009 (305 s), S015 (337 s, after the ledge link). S008 got to 195 cm (goal 186) but never caught its target TIMEHOP, which moves along a path and was at 98% of it with the ball 5 m up. S010, S012 and S013 had no result and still need a re-run with the new planner.
- **Bot clears for stages 4 to 6, and S002 inside the time limit** (A49, A59, A115) [M]. S002 is now cleared by the bot (649 s, over its 6 minute limit, A115): the stall at 46 cm was the planner not knowing wall climb. S004 to S006 still need a re-run with the new planner. The bot is slower than a person, so a late finish is a hint and not a verdict.
- **Bot baselines after the bounces** (A103, A108) [S]. With the wall and landing bounce: S001 309 s, S003 482 s, S009 305 s, S011 508 s, all won (before the landing bounce: S001 358 s, S003 416 s). S008, S010, S012 and S013 produced no result in the re-run and still need a look. The old bot test also had to be fixed to allow the ball to shrink when a hit sheds objects. Re-run all of them after any physics change.

### Blocked or still being decoded

Not in the shipped source files. Some can be pulled out of the compiled binary, which is how the physics table, the hop, the time limits, wall climb and the sound ids were found.

- **Confirm the one-pad direction and make it the touch default** (A121) [S]. The engine’s one-pad mapping is ported (?ctl=pad). The one open point is which pad direction is forward in the original; the port assumes up. Check against a recording or the tester on a touch device, then switch touch over from the tank mix.
- **Decode the original album and score layout** (A55, A114) [M]. The Records and Collection screens use the real art but my own text layout. What the album shows per item (pictures, which items count), the score screen rows and the Shop (an in-app purchase page, left out on purpose) are not decoded.
- **Lump sound** (A101) [S]. The lump sound (id 17) has no trigger in the port (no engine distortion rate). The splash is played since the water work (A139). Ids 14, 26, 27 and 29 are never played by the original, so nothing is missing for them.
- **Path start point** (A37) [S]. Path followers start at the beginning of their curve. The initial position value is assumed zero.
- **End banners and a few dialog triggers** (A93, A94) [S]. The 1 minute banner hold time (45 and 60 are passed in), the res_01 trigger and the variant selector for the result lines are not decoded. END_COM is now shown after the goodbye.
- **Unused stage fields** (A91) [S]. The int at +0x44, three floats in the mission record and the story selector for the TIME_LIMIT variants are read but not interpreted.
- **Menu layout and transitions** (A38 to A41) [M]. Button positions, timings and thumbnail order are mine. The art and text are the original’s. The layout code is in the binary. (The intro is now the original’s.)
- **Pac-Man, Tekken and Galaga mini-games** (A93) [L]. The Time Attack mini-games are in the app but their source files are not shipped. They would have to be rebuilt from the binary. A tester asked for the 3 extra stages. Not planned yet.

### Future ideas

Not part of this port. Parked here so they do not get lost.

- **I Love Katamari port** [L]. A second project, after this one. Same approach: pull the assets and tables, read the code, bot-test.

### Done

- Ibitsu and ray hit port, stages 0 to 2 (A144 to A146): the 18 point distort table is read from the binary and confirmed by the game's pointer array, the one sided segment test (K.segHit) and the engine's ground and wall lists with the position correction (K.rayContacts) exist and are tested, but are not used by the movement yet.
- Hit handling from the engine's own rays (A144 to A148, docs/IBITSU_PLAN.md): the ground and walls come from line segments against the collision polygons (the ball centre to 18 fixed points, a down point and up to 6 lump points, plus up, left, right and diagonal segments along the move), classified, deduplicated and applied as in sGround, sGetHitInfo and sAdjustPosi. A lump on the ball (an attached object with ibitsu tips) that touches the ground is planted and the ball swings over it, as in gYm_KatamariIbitsuMakeMatrix, with the lump sound. `?hit=ray` turns it on while it is being checked (the old sphere push stays the default until the bot sweep is done); the sphere push took its ground from the visible map, the rays take it from the collision data, so they differ where those differ (S006 and S012 water).
- Ceilings and the undersides of slopes are walls (A143), from the engine's one test in gYm_KatamariMakeLandformNormal: the ball can no longer be squeezed through the thin leaning book of stage 1. ?ceil=off turns it off. This fixed the stage 1 bot stall (A137).
- Squeezed between walls (A142): 3 walls, two nearly opposed walls, or flicker between opposing walls sheds a little and a lump object, and half a handful after 15 frames, from sCheckHoldInWall.
- King screen blink (A141): the second King head picture (KinSKNG2) flickers over the King on the briefing and result screens, 16 frames off and 16 on, from FUN_00052b6c. Which half starts hidden is mine.
- Size gear in the corner (A140): both gears scale from the corner with progress (30% at the start, 100% at the goal) and pulse 5% in opposite phase every 24 frames, from FUN_00031568. The full size and which gear takes the plus sign are mine.
- Buried stuck objects (A123): objects whose far edge is inside a threshold between 0.38 R and 0.88 R (growing after 90 stuck) leave the ball: not drawn, not lumped, not shed. From FUN_000130cc. The field meanings are my reading; ?cull=off turns it off.
- Water (A139): the HIT_WAT layer of eight stages is exported and used the way the engine does. It has no collision or drag; it makes a ripple every 8 frames (the original GiFx02 ring, 30 frame life), the splash sound on the first contact while flying, and the HUD prince gets a snorkel head. The original has no 3D swim animation. Still to check by eye: ripple look and draw order (mine), the two leaning snorkel heads (mine).
- Owner decisions 2026-11-25: original behaviour stays the default with improvements as optional pause-menu toggles (extra minute on timed runs, quiet repeating sounds and wide view are built; cutouts and size to roll up are queued); Exact Size and Eternal HUD built; menu order follows the original (pack, stage, mode); water goes right after slopes and speed.
- Tester items built (2026-11-25): placement rotation signs fixed from resting tests, which turns pizzas, the lying trophy and tilted props (A136); camera ray one-sided like the engine (A134); Exact Size and Eternal HUD (A129); collection in all modes (A127); menu order pack, stage, mode (A128); mirrored viewer (A130); KD_BGM_01, 04 and 05 added with collection and result music and a sound test page (A132); area walls cannot be climbed (A126); 2 mm gap investigated (A133); `?view=wide` option (A135).
- Tester notes 2026-11-25 read (Discord log and the issues doc). Done from them: the ball rolled backwards (fixed, A124), Time Attack now plays the stage 0 track on every stage as the binary does, the unused new-area sound and toast are gone, iPad and Android audio unlock and page zoom guards (A125). 19 more items are queued under I can do now.
- Camera wall ray start confirmed to be the ball position (A112). Menu layout looked at: it is code (tweened objects with start and end positions per screen), not data, so an exact port is a per-screen decode of the menu range; the size of that job is now written in A38.
- Sound id triggers closed out: every call of the original sound player was listed. Ids 14, 26, 27 and 29 are never played (unused leftovers), id 20 is the camera pull back (already ported). The port's invented new-area sound and toast are removed because the original has neither.
- Unused stage fields (A91) traced to their readers in the binary: +0x44 has none, +0x48 / +0x4c (5 and 1000) scale the result screen picture, +0x54 is the fall height already used. The search turned up one real mechanic that is not ported (A123: stuck objects are hidden once deep in a growing ball when a kind has more than 90 stuck).
- END_COM ("Royal Rainbow!") now follows the goodbye on a win, as the original appends it to the same dialog (FUN_00033620 then FUN_0004014c); the banner object mechanics (1/30 per frame fades, dialog text engine, queued) are written down in A93.
- Real dash gesture ported from OujiDash.cppi: taps are strokes (14 frames apart at most), the 3rd starts a wheel spin, the 3 + wheelStrokes(size)th launches the dash at the spin speed, strokes stopping end it, a 240 frame stroking budget then 240 frames forbidden. All constants read (gf32DefaultOujiParam, OUJI_DASH_DURATION_TIME = 1 from the binary); steering ported whole from OujiCtrl4.cppi as readCtrl (pivots, spin by stick angle, angle-based turn, side and back zones with their speed ratios, push direction by stick angle); A120 resolved, A113 and A76 updated (A120b to d, A121, A122)
- Open guesses narrowed: the collision polygon kinds surveyed over all 18 stages (kind 2 is the full-height boundary wall, taken to be the no-climb attribute, which the sim now honours; kind 1 is a flat catch-all floor; P17b), the mirrored picture derived from the engine’s y-down space instead of only from mirrored text (P20), stairs and climbing checked against the shipped source (HitEdge is a fast-ball ceiling or side hit, not a stair rule; P19, A45). The test bot now intercepts flying objects such as TIMEHOP instead of chasing them, and its reach rule matches the engine pickup test
- Pickup test copied from the engine’s sCheckHitMono: a short ray from the ball centre toward the object’s origin against its box, with the half-size shortcut (A29); clip range from the first GRAPHICS pair and no fog anywhere (A52); placement sets and growth sizes per game mode from MP_INF (A119); the real dash gesture read from the source (A120)
- Sweep 3 of the guesses: the engine’s GL state read from the binary (culls back faces, alpha test not-equal-zero with blending, light ambient 0.5 and diffuse 1.0 from (42, -349, -29)) and used as the default lighting (A117); a nibble-order bug that garbled the ball, prince, shadow and some UI textures found and fixed by re-exporting 38 images (A118); A3, A4, A17 verified; only the map’s own models are loaded, S004 re-run: won in 506 s (A22)
- Ball core drawn at the engine’s display size and never stretched (A111); camera wall avoidance rule read from the binary (A112); back push and the turn constants checked against the source (A113)
- Zoom-out sizes checked against a tester’s list for all six areas: every size is a row in the stage’s camera table, so nothing to change (A110)
- Opening stories of all three packs played from the original script tables: sprites, timing, fades, speech balloons, music and the closing scroll, with a tap to skip (A107)
- Landing bounce from the engine (5 frame minimum flight, 0.55 up, 0.95 sideways, crumble from long falls) and the camera zoom echo with its real constants; the shrink flag turned out to be dead code (A108)
- Found and fixed a loader bug that kept all sound silent since 2026-11-06 (A109)
- All 18 playable stages load: Time Trip and Rolling Whopper data exported, pack picker, pack-aware King text and result lines, per-stage music and catch sounds from the binary (A50, A104, A105)
- Wall angle (66.6 degrees, not 0.7) and the wall bounce ported from the engine (A103)
- Camera follow decoded and ported: rows, 32-frame moves, instant heading, step sound (A102)
- MONO_PARAM traced end to end: three live fields, all used; the other ten are never read by the game (A100)
- Wall climb ported from the engine’s state machine and parameter struct (A79, A98)
- Moving objects knock the ball; the crumble throw speed corrected from 0.98 to the MONO_PARAM 1.63 (A100)
- Sounds from the engine ids: pickup, catch loops, crumble, crush, landing, spin, dash, brake, U-turn, end whistle, 30-second tick (A53, A99, A101, A94)
- Path followers use the engine’s B-spline and look-at facing; tilted props use the loader’s rotation order (A35, A36, A96, A97)
- Time limits, Exact Size targets, result rules, end dialogs, pause confirmations and Eternal finish from the files and binary (A90 to A94)
- Object names, pause menu and labels in six languages, with a picker on the title screen (A77, A95)
- Catch size from each model’s stored box, speed table decoded (brake and acceleration were swapped), real drag, stick curve, brake rule and 30 Hz step (A27, A71, A78)
- Crumble and converge from the source: 75 degree launch, table speed, 0.2 rad spin, thrown objects can be caught again (A65, A80)
- Prince U-turn hop from the binary (12 to 20 frames by size), resting distance from the speed table, camera field of view and facing (A66, A89)
- Each mode loads its own object layout; stages 2 to 6 loaded and cleared by the bot (A44, A82)
- Fall recovery to the start point, lumpy ball from the original shape points, lumps lift the ball, move-turn momentum (A56, A64, A76)
- Menus and UI: pause menu with bug report copy, lighting and texture settings, best times on tiles, opening story, flip-book walk cycles, Exact Size with the King’s lines
- Spinner under 2 seconds on stage load and restart, dash speed lines, leaning prince, ball dust, original timer and item tag, size text like 4m02cm8mm
- Hallway pop-in fix: objects grow in and the draw distance is longer (A51, A52)
- Audio cut from 33 MB to 9 MB (AAC), title music 8 MB to 0.6 MB
- Records and Collection screens from the original art, achievement and Extra item banners from the pickup rules in MonoHit.cppi (A114); build_all.py re-run on a clean folder with identical output (C4)
- Ghidra set up on the app binary, with the physics table in tools/kparam.json; export tools take arguments and chain through build_all.py

## For testers

- Esc, P, or the Pause button opens the pause menu. "Bug report" copies the stage, mode, time, size, position, and browser. Paste it into a message and say what went wrong.
- "Catch size" in the pause menu switches between the engine formula (default) and the old guess (A48, A73, A78).
- Stage select now starts with a pack picker. Stages 2 to 6 of the first pack are flagged "rough", the other packs "untested". Time limits, Exact Size targets and the King's result rules now come from the original's data (A90 to A92).
- Best times and sizes are saved in your browser only.
- Pause menu has the optional improvements (see Design policy). Everything else follows the original.
- Exact Size and Eternal show no timer. Exact Size also hides the size. Both have a stop button under the gauge, and the pause menu has the original's stop options.
- Menu order is pack, stage, then mode, as in the original (A128).
- Music: open `soundtest.html` and play the tracks. Please tell me which file is Overture I, Walking On A Star, Fugue #7777 and Lovely Angel, and which screen each belongs to. Currently the title and menus play KD_BGM_00, the collection KD_BGM_05, the result screen KD_BGM_04, the opening story KD_BGM_06.
- Please check against the original: pizzas and the trophy row (rotation fix, A136), Secret Lab and Space Colony camera (A134), and whether `?view=wide` fixes the too-close view in City Square and Shopping Mall.
- Water is in (A139) on six playable stages: North African Streets (S004), the S005 and S006 stages, S010, Discovery Age Port Town (S012), S013 and Big City (S020). Roll or drop onto water: ripples appear under the ball, there is a splash sound if you were in the air, and the prince in the corner gets a snorkel. There is no slowdown or sinking, as in the original. Please check how the ripple looks against your memory of the original (size, softness, timing).
