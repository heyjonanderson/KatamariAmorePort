# Ibitsu and ray hit port: plan

Status: stage 0 done (reading and table extraction). Nothing in `sim.js` changed for this yet.
Rule from the owner (2026-11-25): original behaviour is the default. The port stays behind `?hit=ray` (off by default) until it beats the current sphere push in the tests.

## What the original does (from the shipped sources)

Per frame, in order (KatamariHit.cppi, KatamariIbitsu.cppi, MonoIbitsu.cppi):

1. `sGround`: casts line segments against the stage's collision polygons (HITSYS, one sided: a polygon only counts when the segment starts on its front side, A134).
   - one down ray from the centre, length 3R (for the prince, `fvHitPosiDR`)
   - normal case (not `Fast`): 5 segments from the old position to the new position plus 15% of the move, from the centre offsets up, left, right, left-up, right-up (`fvRadiusUp` and so on)
   - fast case (`Fast`, move of at least one radius per frame; `sCheckFast` is marked unused): 5 segments old to new across the whole move
   - one segment from the centre to every distort point (`sDistort[i]->fvPosi`), 18 fixed points plus up to 6 fluid ones
2. `gYm_KatamariMakeLandformNormal` sorts each hit (A103, A143): up component at or below cos(66.6 deg) is a wall, else ground. Each hit gets `fvAdjust = normal * dot(normal, ray direction) * rayLength * (1 - ratio - 0.0005)`. `sRegistHitInfo` keeps one hit per normal (same normal within 0.99998: the longer adjust wins), at most `_MAX_HITINFO` per list.
3. `sGetHitInfo`: sums normals, `sGetAdjustGround` and `sGetAdjustWall` take per axis the largest positive plus the largest negative adjust. The ground hit with the smallest hit ratio decides `s32IbitsuCheckNo`, the distort point that touches first.
4. `sCheckHoldInWall` (ported, A142), `sReaction`: `sAdjustPosi` applies the adjust, `sReflection` (ported, A103, A107, A108), `sCheckDistort`, then the ibitsu state: NONE, FIX (rocking on a fixed point) or FLUID (rocking on a lump).
5. `gYm_KatamariIbitsu` (every frame): `pushDistort`, `sRoll` (rotate the 18 fixed offsets by `mRot * scale(diameter / 100)`), `Mono::gYm_MonoIbitsu` (lump lengths), `sSetPosition` (length easing, slows lumps at speed), and `gYm_KatamariIbitsuMakeMatrix` (the ball's pose in FIX and FLUID state is rebuilt from the contact point `fvDistortPosi` and the rotated offset, so the ball rocks over the point).

## Data found

- `tools/ibitsu_sph18.json`: the 18 fixed distort directions (`_KATA_IBITYPE_SPH_18`, the type set in `KatamariMain.cppi:62`), length about 50, from the binary at 0x857b8 (A144).
- `tools/kparam.json`: `IbitsuCheckDepth` 12, `IbitsuAcc` (see the file). `IBITSU_FLUID_COUNT` is 6 (comment in MonoIbitsu.cppi).
- Per object lump tips (`md->factor->ibitsuVtx`, `ibitsuCnt`) are already exported as the IBITSU data (A64).

## What the port has now (A64, A111, A123, A140)

Lump lengths from the last 12 attached objects with tips (max 6), a lift of the ball centre eased from the lowest lump (`S.lift`), lump pickup rules, the buried-object cull. It does not rock the ball over a point, has no ray hits and no FIX or FLUID state.

## Stages

1. **Segment test (done, A145: `K.segHit`, tests/seg.js).** Add `rayPoly(S, p0, p1)`: segment against the hit polygons, one sided, giving the nearest hit with ratio and normal. A134 already decoded the engine's test (FUN_0000f688, Newell plane from the vertex order, negative side of cross(e1, e2) in this z-mirrored data). Unit tests on synthetic polygons and on S001's floor and the leaning book.
2. **(done, A146: `K.rayContacts`, tests/raycmp.js) `sGround` and `MakeLandformNormal`.** Build the hit lists, `sRegistHitInfo`, `sGetAdjustGround` and `sGetAdjustWall`, `sGetHitInfo`. Output only: compare the lists against what the sphere push finds on bot runs (same floor, same walls), no change to movement yet.
3. **`sAdjustPosi` and `sReaction` without ibitsu.** Move the ball by the adjust, keep `sReflection`. Behind `?hit=ray`. Includes the hold-in-wall move nudge (A142) because the wall count then comes from rays.
4. **Distort points and states.** `sRoll`, the 18 fixed points, the 6 fluid points from `MonoIbitsu`, `sCheckDistort`, FIX and FLUID states, `IbitsuMakeMatrix`, `sSetPosition`. Replaces the `S.lift` approximation (A64) when `?hit=ray` is on.
5. **Everything that hangs off it:** the ibitsu sound (`gYm_SeGameReq_Ibitsu`, when the lump length ratio passes `_IBITSU_RATE` = 0.30), attach depth, umbrellas, the downhill push of a lump (`sAddAcc`, `IbitsuAcc`).
6. **Flip the default** only when the bot sweep on all stages is at least as good and the owner agrees.

## Open points before stage 4

- `_MAX_DISTORT`, `_MAX_HITINFO`, `_MAX_DISTORT_SCALE` and `IBITSU_WORK_NUM` are macros in headers that were not shipped. They need the binary (array sizes and constants in `sRoll`, `sCheckDistort`, `gYm_SeGameReq_Ibitsu`).
  Measured instead of guessed: the port keeps one hit per normal, and in a 3000 frame run of S001 (early ball) it never has more than 3 hits in a frame (histogram printed by `tests/bot2.js` as "hits per frame"). The rays number at most 30 (5 edge + 25 distort), so a cap of 30 or more never bites. A cap below that would only matter for a lumpy late-game ball; not measured there yet.
- The radius vectors are set in `Katamari::sGetVector` (found, in A145).
- HITSYS internals beyond the segment test: the one hit per normal rule is in `sRegistHitInfo`, but which polygons the grid returns and in what order is HITSYS (binary only).
