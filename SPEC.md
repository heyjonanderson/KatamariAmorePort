# Katamari Amore (iOS, v1.3.2) format notes

Source: `jp.co.bandainamcogames.NBGI0069-iOS4.3-(Clutch-2.0.4).ipa` (decrypted, cryptid 0). The other IPA is still FairPlay encrypted and not usable.
Binary `katamari2` is ARMv7/v7s, OpenGL ES 1.x (glVertexPointer, glDrawElements, glCompressedTexImage2D present). 23 `.cppi` game-logic source files ship in the bundle.
Tags: [confirmed] = parsed and cross-checked against all files, [inferred] = from names or partial evidence, [todo] = not looked at.

## .dat container [confirmed]
All integers big-endian. 199 files, 3,697 chunks, all parse with consistent offsets.
- u32 table size (= 1 + 13 * count), u8 count, then count entries of 13 bytes: u8 type, 8-char name (space padded), u32 offset.
- Chunk data starts at 4 + table size. Offsets are relative to that. A chunk runs to the next offset (last runs to EOF).
- Every chunk begins with u32 length of the rest of the chunk.
- Types: 1 = image (1,881), 2 = model (1,317), 4 = data table (499).

## Image chunk (type 1) [confirmed]
Payload: byte0 = 0, byte1 = flags, bytes2-3 = u16 palette count, bytes4-7 = u16 width, u16 height, then data.
- flags bit0: has alpha (palette entries are RGBA, else RGB; direct color is RGBA, else RGB)
- flags bit3 (0x08): 8-bit indices, else 4-bit indices
- flags bit4 (0x10): direct color, no palette (3 or 4 bytes per pixel)
- Palette count 0 with 8-bit means 256.
- 4-bit pixels: high nibble is the first pixel. Rows are plain row-major, no swizzle.
- Verified by exact byte counts on all 1,881 chunks and by neighbor-smoothness tests.

## Model chunk (type 2) [confirmed]
Floats are big-endian f32. Indices are big-endian u16. 1,317 of 1,317 parse with zero leftover bytes. All index values are in range, normals and UVs match the vertex count.
- u16 flags (0x10 = bounding box present, else 0)
- if flags & 0x10: 6 floats (min xyz, max xyz)
- u16 n, n * 3 floats: positions
- u16 n, n * 3 floats: normals
- u16 n, n * 4 bytes: colors (always 0 in this game)
- u16 n, n * 2 floats: UVs (not flipped; V=0 is the first stored row; tiling values above 1 are used)
- u16 submesh count, then per submesh: 3 bytes (always 000000), 8-char texture name, u16 triangle count, triangle count * 3 u16 indices
- Texture names resolve within the same stage (`S###MAPT` or `S###OBJT`), 0 unresolved across all 21 stages.
- Winding and handedness: [todo] (viewer draws two-sided).

## Stage files [confirmed names, inferred roles]
- `S###MAPM`: map models (world-space coordinates already) + `MAP_LOC` table listing them [confirmed]
- `S###MAPT`: map textures. `S###OBJM` / `S###OBJT`: pickup object models / textures [confirmed]
- `S###MLST`: `MONOLIST` (see below) plus `MI*` animation tables for the clock, phone and deck [confirmed for MONOLIST]
- `S###MLOC`: object placement tables (see below) [confirmed]
- `S###IBI`: `HIT_MAP` collision mesh [confirmed format], `HIT_CAM` (camera collision, same shape of data probably) [todo], `IBITSU` (a name list) [todo]
- `S###MIS`: mission/stage resource list [todo]
- `GAMEDATA`/`GAMEDT2x`: prince (`GiOuji*`), katamari textures, effects, silhouettes. Flag-0 models here (no bbox) [confirmed format, roles inferred]
- `*_2x.dat` are retina versions of the UI sheets.
- Audio is plain `.caf`, 170 files (BGM_ST##_A/B, KD2_SE_mono_##).

## MONOLIST (S###MLST) [confirmed]
Big-endian. u32 count, then per record: u32 id (1..count), 16-char object name, 1 pad byte, 8-char model name (`Msa####`, an OBJM chunk), 3 f32, u8 category, Shift-JIS description (ends at the next record's id, whose first byte is 0).
- The 3 floats: first one rises steadily across the list (33 for a pin, 38 button ... 727 pillow). Probably the katamari size needed to pick it up. [inferred] Other two (1.0, 2.0 typical) unknown.
- 3 of 55 records in S001 point at `MIa*` models (WDECK, KETAI, CLOCK) that have no OBJM chunk. They are the animated objects.
- All 21 stages parse to the exact byte.

## Placement tables (S###MLOC, chunks MP_xxx) [confirmed]
Per chunk: u16 name count, count * 16-char names (all exist in MONOLIST), u16 placement count, then 26-byte records: u16 name index + 6 little-endian f32 (x, y, z, rx, ry, rz). Rotations are degrees [inferred].
- Floats here are little-endian. Everything else in the .dat files is big-endian.
- MP_S/T/J/E/F are the five modes, `00` and `01` are two areas of the same stage (S001: 152 + 142 placements for S). All 21 stages parse exactly.
- 139 of 1,353 S001 placements have nonzero rx or rz, so objects can be tilted. Euler order not verified (viewer uses Ry * Rx * Rz).
- y is the object's origin height, objects are centered vertically (model y min is negative).

## HIT_MAP (S###IBI) [confirmed format]
Big-endian. u16 vertex count, count * 3 f32, u16 polygon count, then per polygon: u8 kind, u16 n (3 or 4), n u16 indices. S001: 379 vertices, 373 polygons, kinds {0: 187, 2: 169, 3: 16, 4: 1}. What each kind means is [todo] (likely floor, wall, and special surfaces).

## Coordinate spaces [confirmed]
Placements and collision share one space. The visual map and object models live in the same space as each other, which is z-mirrored from it.
- Convert logic to view: (x, y, z) -> (x, y, -z), ry -> -ry, rx -> -rx, rz -> rz.
- Check: with the flip, all 290 placed S001 objects (set S) have a visual surface under them, median gap 0.1 cm, 94% within 3 cm. Without it, 63 have nothing underneath and only 68% are within 3 cm.
- Units are centimeters (button 2.0 wide, room 750 wide, walls 410 tall). Objects place at scale 1.
- Whether object models themselves are mirrored in the engine is [todo] (only matters for text and asymmetric props).

## Game logic [todo]
Source is in `*.cppi` inside the app folder: `KatamariMain`, `KatamariHit`, `MonoHit`, `OujiCtrl4`, `OujiDash`, `MonoCrumble`, ... Japanese comments, partly stubbed.
Next: read pickup rule, katamari growth, rolling physics, prince control, camera. Write constants into this file as they are confirmed.

## MIS chunk (S###MIS) and game rules found so far

Directory: u16 count, then 21-byte entries (16-char name, u8 type, u32 absolute offset into the chunk). Sections seen: STAGE_RESOURCE, MONO_RESOURCE, RELEASE_HEADER, GRAPHICS, TIME_LIMIT*, VOLUME_RATIO, VOLUME_LIMIT, MISSION_DATA, CAMERA_DATA, GRAVITY, OUJI_SCALE, OUJI_JUMP, SPEED_TABLE.

- VOLUME_RATIO, GRAVITY: u16 float count, then (diameter, value) pairs, terminated by -1. Gravity example: 5 cm to 0.11, 10 to 0.185, 30 to 0.343, 100 to 0.8.
- SPEED_TABLE: u16 float count (317), 2 header floats [1000.0, 0.8], then records of 21 floats (KATA_TABLE). Col 0 diameter, col 1 speed in cm per frame. Record 0 is all zeros.
- MISSION_DATA floats from byte 7 (see ASSUMPTIONS A26).

Engine formulas (from `MonoHit.cppi`, `KatamariMain.cppi`; field meanings partly inferred, see A28):
- ball radius from volume: r = cbrt(3V / 4pi), plus 0.01
- pickup: ball diameter (mm) >= object catch diameter, and ball radius + object radius >= distance
- object volume = bbox volume (m) with 0.1 cm minimum side; added volume = bbox volume * MONOLIST f2 * VOLUME_RATIO(diameter)
- placements: ints byte-reversed, y and z negated, rotations in degrees (DEG2RAD)

Still unread: `sControl` (input), `sRegistance`, `sGravity`, camera, `OujiCtrl4`, `KatamariHit`.

## Controls, camera and HUD (found in `OujiCtrl4.cppi`, `KatamariMain.cppi`, the MIS data)

- Two sticks, left and right. One stick alone pivots (0.035 rad per frame forward, 0.025 back). Both forward drives, steering by the difference. One forward and one back spins (0.055). Dead zone 0.2.
- Speed: each frame velocity += input direction * acceleration (table cols 3 to 6: forward, back, side, dash), capped at table speed (col 1) * ratio (cols 7 to 10), then drag. Pushing against the motion brakes.
- Table row at the current diameter is interpolated between neighboring rows (`gYm_KatamariGetTableParam`).
- Dash: 240 frames, then 240 forbidden.
- `CAMERA_DATA`: rows of [diameter, eye xyz, 1.0, look-at xyz, 1.0, far]. `GRAPHICS`: near, far. `OUJI_SCALE`: 0.1.
- Prince: models `GiOujiM0..2` in `GAMEDATA.dat`, texture `GiOuji_T`.
- HUD art: `GAMEDATA.dat` (`GiSIZEF/B` gauge, `GiNUM_W/O` digits, `GiTIMER`), `IMAGE.dat` (`SYSPAD`, `SYSPADC`). Number sheet cells: big 44x56, digits 0-4 row 0 and 5-9 row 1; small 32x40 rows 2-3 with c and m.
