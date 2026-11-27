'use strict';
// Katamari Amore web port: simulation core. Pure logic, no DOM or GL, so it runs in the browser and in Node tests.
// Units: cm, one step = one game frame (the game's own tables are per frame). View space (z already mirrored from the data).
// Anything marked PLACEHOLDER is a stand-in for engine behavior not decoded yet. See ASSUMPTIONS.md.
(function (root) {
  const FPS = 30;                    // PLACEHOLDER (P1): fixed step rate, not read from the game
  // Two-stick control constants, read from KatamariData.cppi (gf32DefaultOujiParam) and OujiCtrl4.cppi
  const TILT = 0.2, TURNDELTA = 0.035, TURNDELTA2 = 0.055, TURNDELTA3 = 0.025, MOVEDELTA = 0.06, MOVEDELTA_B = 0.03;
  // Dash gesture constants: gf32DefaultOujiParam in KatamariData.cppi (index 15 to 18) copied into the Ouji members at +0xf0/+0xf8/+0xf4/+0xfc (FUN_0002xxxx param copy, checked in the binary), A120.
  // dw = OUJI_DASH_DURATION_TIME = 1 (the literal in sDashNormal, FUN_00028150). repeat = frames between taps when a key is held (mine, A120b)
  const DASH = { stroke: 14, maxDur: 240, start: 3, forbid: 240, dw: 1, repeat: 5 };
  const wheelStrokes = d => d < 50 ? 3 : d < 100 ? 4 : d < 500 ? 5 : d < 1000 ? 6 : 7;   // sGetWheelSpinStroke (gsKataWheelSpin, A101)
  // KPARAM, read out of the binary (tools/kparam.json, ASSUMPTIONS A71). Only the ones the sim uses are here
  const KP = { registance: 0.0352, moveTurnRegist: 0.1234, getRatio: 0.1, crumbleRatio: 0.03, crumbleDepth: 5, crumbleAngle: 0.28, crumbleSpeedRatio: 0.98, convergeRatio: 0.015, halfSpeed: 0.4, tilt1: 0.29, tilt2: 0.99, brakeSpeedRatio: 0.45 };
  const WALL_NY = Math.cos(0.74 * Math.PI / 2), FLAT_NY = Math.cos(0.0453 * Math.PI / 2);   // KPARAM f32WallAngle and f32FlatAngle, times 90 degrees (A103): a face with normal.y (up) at or under WALL_NY is a wall, at or over FLAT_NY it is flat ground
  const BRAKE_COS = Math.cos(0.334 * Math.PI / 2);   // KPARAM f32BrakeAngle 0.334 * 90 degrees
  const DRAG = KP.registance;        // A71: drag per frame as a fraction of velocity (the engine subtracts v * Registance along the motion)
  // MonoHit.cppi gYm_MonoHitSetInfo: catch diameter (mm) from box volume * volume ratio / GetRatio, as a sphere
  const engineCatchMm = i => Math.floor(2000 * Math.cbrt(3 * i.boxvol * i.vol_ratio / KP.getRatio / (4 * Math.PI)));
  const CLIMB = 0.5;                 // PLACEHOLDER (P19, A98): too-big objects whose top is at most CLIMB * radius above the ball's bottom are rolled onto at once, like the step-up. Anything higher is climbed with the engine's wall climb
  // Wall climb (KatamariMain sClimbWall/sClimbWallTop, KatamariHit sCheckClimbWall/sEnableClimbWall/gYm_KatamariDisableClimbWall; constants from the KATA_CLIMB_PARAM struct in the binary, A79, A98)
  const CW = { angleCos: Math.cos(0.4 * Math.PI / 2), distRatio: 0.7, topTime: 10, maxSpd: 0.95, forbid: 10, accel: 0.1, speedPerDiam: 0.015, camCos: Math.cos(Math.PI / 3) };
  let GRID = 40;                                                  // set per stage in create: big stages (the ball starts at metres) need bigger cells

  // ---- small math ----
  const mmul = (a, b) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j]; return o; };
  const mvec = (a, v) => [a[0]*v[0]+a[1]*v[1]+a[2]*v[2], a[3]*v[0]+a[4]*v[1]+a[5]*v[2], a[6]*v[0]+a[7]*v[1]+a[8]*v[2]];
  const mtr = a => [a[0],a[3],a[6], a[1],a[4],a[7], a[2],a[5],a[8]];
  const I3 = () => [1,0,0, 0,1,0, 0,0,1];
  const rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0, 0,c,-s, 0,s,c]; };
  const ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,s, 0,1,0, -s,0,c]; };
  const rz = a => { const c = Math.cos(a), s = Math.sin(a); return [c,-s,0, s,c,0, 0,0,1]; };
  const D2R = Math.PI / 180;
  // placement euler (file degrees) -> view space: Sz(+rz) Sy(-ry) Sx(-rx). Order from the loader (A97); the signs come from resting tests, not the loader (A136): this combination
  // puts the lowest box corner of 56 more tilted objects on the surface than the A97 signs did, and loses 2 (tests/placerot.js)
  const eulerView = (x, y, z) => mmul(rz(z * D2R), mmul(ry(-y * D2R), rx(-x * D2R)));
  function axisAngle(ax, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = ax;
    return [t*x*x+c, t*x*y-s*z, t*x*z+s*y,  t*x*y+s*z, t*y*y+c, t*y*z-s*x,  t*x*z-s*y, t*y*z+s*x, t*z*z+c];
  }
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
  const sphereVol = rM => 4 / 3 * Math.PI * rM * rM * rM;                       // m^3
  const diamFromVol = v => 2 * 100 * Math.cbrt(3 * v / (4 * Math.PI)) + 0.02;  // cm, as in gYm_KatamariUpdateVolumeInfo (radius += 0.01)

  // piecewise-linear lookup. rows: [x, y...]; clamps at both ends
  function interpRows(rows, x, col) {
    if (x <= rows[0][0]) return rows[0][col];
    for (let i = 1; i < rows.length; i++) if (x < rows[i][0]) { const a = rows[i-1], b = rows[i], t = (x - a[0]) / (b[0] - a[0]); return a[col] + (b[col] - a[col]) * t; }
    return rows[rows.length - 1][col];
  }
  function pairs(flat) { const o = []; for (let i = 0; i + 1 < flat.length; i += 2) { if (flat[i] < 0) break; o.push([flat[i], flat[i+1]]); } return o; }

  // ---- ground (horizontal triangles of the map) ----
  function buildGround(tris) {
    const n = tris.length / 9, cells = new Map(), big = [];
    for (let t = 0; t < n; t++) {
      const o = t * 9; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < 3; k++) { const x = tris[o+k*3], z = tris[o+k*3+2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      if ((Math.floor(x1 / GRID) - Math.floor(x0 / GRID) + 1) * (Math.floor(z1 / GRID) - Math.floor(z0 / GRID) + 1) > 2500) { big.push(t); continue; }   // huge polygons (sea, sky) are tested every time instead of filling millions of cells (A46)
      for (let cx = Math.floor(x0 / GRID); cx <= Math.floor(x1 / GRID); cx++) for (let cz = Math.floor(z0 / GRID); cz <= Math.floor(z1 / GRID); cz++) {
        const key = cx * 100003 + cz; let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(t);
      }
    }
    return { tris, cells, big };
  }
  // highest surface under (x,z) that is not above yMax; null if none
  function groundAt(G, x, z, yMax) {
    let a = G.cells.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)); if (G.big.length) a = a ? a.concat(G.big) : G.big; if (!a) return null;
    let best = null; const T = G.tris;
    for (const t of a) {
      const o = t * 9, ax = T[o], ay = T[o+1], az = T[o+2], bx = T[o+3], by = T[o+4], bz = T[o+5], cx = T[o+6], cy = T[o+7], cz = T[o+8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const y = l0 * ay + l1 * by + l2 * cy; if (y <= yMax && (best === null || y > best)) best = y;
    }
    return best;
  }


  // ---- collision mesh (HIT_MAP): steep triangles are walls for the ball, all triangles block the camera ----
  function buildHit(flat, kinds) {
    const g = buildGround(flat), n = flat.length / 9, ny = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      const o = t * 9, ux = flat[o+3]-flat[o], uy = flat[o+4]-flat[o+1], uz = flat[o+5]-flat[o+2], vx = flat[o+6]-flat[o], vy = flat[o+7]-flat[o+1], vz = flat[o+8]-flat[o+2];
      const nx = uy*vz-uz*vy, nyy = uz*vx-ux*vz, nz = ux*vy-uy*vx, l = Math.hypot(nx, nyy, nz) || 1; ny[t] = nyy / l;
    }
    g.ny = ny; g.kind = kinds || null; return g;
  }
  // closest point on triangle t to p (Ericson, Real-Time Collision Detection)
  function closestOnTri(T, o, px, py, pz) {
    const ax = T[o], ay = T[o+1], az = T[o+2], bx = T[o+3], by = T[o+4], bz = T[o+5], cx = T[o+6], cy = T[o+7], cz = T[o+8];
    const abx = bx-ax, aby = by-ay, abz = bz-az, acx = cx-ax, acy = cy-ay, acz = cz-az, apx = px-ax, apy = py-ay, apz = pz-az;
    const d1 = abx*apx+aby*apy+abz*apz, d2 = acx*apx+acy*apy+acz*apz; if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
    const bpx = px-bx, bpy = py-by, bpz = pz-bz, d3 = abx*bpx+aby*bpy+abz*bpz, d4 = acx*bpx+acy*bpy+acz*bpz; if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
    const vc = d1*d4-d3*d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1/(d1-d3); return [ax+v*abx, ay+v*aby, az+v*abz]; }
    const cpx = px-cx, cpy = py-cy, cpz = pz-cz, d5 = abx*cpx+aby*cpy+abz*cpz, d6 = acx*cpx+acy*cpy+acz*cpz; if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
    const vb = d5*d2-d1*d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2/(d2-d6); return [ax+w*acx, ay+w*acy, az+w*acz]; }
    const va = d3*d6-d5*d4; if (va <= 0 && (d4-d3) >= 0 && (d5-d6) >= 0) { const w = (d4-d3)/((d4-d3)+(d5-d6)); return [bx+w*(cx-bx), by+w*(cy-by), bz+w*(cz-bz)]; }
    const dn = 1/(va+vb+vc), v = vb*dn, w = vc*dn; return [ax+abx*v+acx*w, ay+aby*v+acy*w, az+abz*v+acz*w];
  }
  // ---- buried objects (A123, INFERRED from FUN_000130cc and FUN_00013028): once an object's far edge (centre distance + bounding radius) is inside a threshold it is taken off the ball's list of stuck objects and never drawn, tested or shed again.
  // threshold = display radius (R * DispScaleRatio 0.38) while 90 or fewer objects are stuck; beyond that it eases toward R by min(1, (n - 90) / 70) * 0.8. The 90, 70 and 0.8 are literals in the binary; what n counts is my reading (stuck objects, buried ones included) ----
  function cullStuck(S, R) {
    if (S.noCull || !S.attached.length) return;
    const n = S.attached.length + S.buried, lo = R * 0.38; let thr = lo; if (n > 90) thr += (R - lo) * Math.min(1, (n - 90) / 70) * 0.8;
    for (let i = S.attached.length - 1; i >= 0; i--) {
      const o = S.attached[i]; if (Math.hypot(o.lpos[0], o.lpos[1], o.lpos[2]) + o.maxlen >= thr) continue;
      S.attached.splice(i, 1); o.state = 'buried'; S.buried++; const k = S.ibiList.indexOf(o); if (k >= 0) S.ibiList.splice(k, 1);
    }
  }
  // ---- water (A139): the map's HIT_WAT layer (8 stages). In the engine (Katamari::sWater, KatamariHit.cppi) it is only a trigger: a vertical test line from 10 diameters above the ball to one radius below its centre; where it
  // crosses a water polygon the ball is "in water", which makes a ripple every 8 frames (KATA_RIPPLE_WAIT, the reset value in FUN_0001f4dc) and, on the first contact while flying, the splash sound (id 28). There is no collision, drag or speed change ----
  const RIPPLE_WAIT = 8;
  function buildWater(flat) {
    const n = flat.length / 9, bb = new Float32Array(n * 4);
    for (let t = 0; t < n; t++) { const o = t * 9; bb[t*4] = Math.min(flat[o], flat[o+3], flat[o+6]); bb[t*4+1] = Math.max(flat[o], flat[o+3], flat[o+6]); bb[t*4+2] = Math.min(flat[o+2], flat[o+5], flat[o+8]); bb[t*4+3] = Math.max(flat[o+2], flat[o+5], flat[o+8]); }
    return { tris: Float32Array.from(flat), bb, n };
  }
  // highest water surface point on the test line through (x, z) between yLo and yHi, or null
  function waterAt(W, x, z, yLo, yHi) {
    const T = W.tris, B = W.bb; let best = null;
    for (let t = 0; t < W.n; t++) {
      if (x < B[t*4] || x > B[t*4+1] || z < B[t*4+2] || z > B[t*4+3]) continue;
      const o = t * 9, ax = T[o], ay = T[o+1], az = T[o+2], bx = T[o+3] - ax, by = T[o+4] - ay, bz = T[o+5] - az, cx = T[o+6] - ax, cy = T[o+7] - ay, cz = T[o+8] - az;
      const det = bx * cz - bz * cx; if (Math.abs(det) < 1e-9) continue;       // edge-on in the xz plane
      const px = x - ax, pz = z - az, u = (px * cz - pz * cx) / det, v = (bx * pz - bz * px) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const y = ay + u * by + v * cy; if (y >= yLo && y <= yHi && (best === null || y > best)) best = y;
    }
    return best;
  }
  // ripple effect (FUN_00034924): age in frames; alpha rises 0 to 1 over 10 frames and falls to 0 over the next 20; scale = scale100 * (0.5 + min(1, age / 30)); gone at 30 frames. The model is a flat 100 cm quad (GiFx02)
  function waterStep(S, R) {
    for (let i = S.ripples.length - 1; i >= 0; i--) {
      const r = S.ripples[i], t = r.age; r.alpha = t < 10 ? t / 10 : Math.max(0, 1 - (t - 10) / 20); r.age = t + 1; r.scale = r.sc100 * (0.5 + Math.min(1, r.age / 30));
      if (r.age / 30 >= 1) S.ripples.splice(i, 1);
    }
    const W = S.water; if (!W) return;
    const was = S.hitWater, yw = waterAt(W, S.pos[0], S.pos[2], S.pos[1] - R, S.pos[1] + 10 * S.diam); S.hitWater = yw !== null;
    if (yw === null) return;
    S.waterPos = [S.pos[0], yw, S.pos[2]];
    if (!was && !S.grounded) S.events.push({ type: 'splash' });               // sReaction: first frame in water while KSTAT(Fly)
    if (--S.rippleWait <= 0) { S.rippleWait = RIPPLE_WAIT; if (S.ripples.length < 10) S.ripples.push({ pos: S.waterPos.slice(), age: 0, sc100: S.diam / 100, alpha: 0, scale: S.diam / 200 }); }   // 10 ripples at most (the effect pool)
  }
  // push the ball out of steep collision triangles, horizontally. Returns the push directions used (unit xz) so velocity can be cut
  // Sloped faces (WALL_NY < |ny| < FLAT_NY, ramps) are pushed out of in 3D from above so the ball rides up them (P19). Sets S.rampLift when it lifted the ball.
  function hitWalls(S, R, steepOnly, riser) {
    const H = S.hit, out = []; S.rampLift = false; if (!H) return out;
    for (let it = 0; it < 3; it++) {
      let moved = false; const seen = new Set(), T = H.tris, x = S.pos[0], y = S.pos[1], z = S.pos[2];
      for (let cx = Math.floor((x - R) / GRID); cx <= Math.floor((x + R) / GRID); cx++) for (let cz = Math.floor((z - R) / GRID); cz <= Math.floor((z + R) / GRID); cz++) {
        let a = H.cells.get(cx * 100003 + cz); if (H.big.length) a = a ? a.concat(H.big) : H.big; if (!a) continue;
        for (const t of a) {
          if (seen.has(t)) continue; seen.add(t); if (S.erased && H.kind && S.erased[H.kind[t]]) continue;
          if (Math.abs(H.ny[t]) > WALL_NY) {
            if (H.ny[t] > 0) {                                                        // a face looking down (this z-mirrored data gives floors ny = -1 and ceilings +1; checked on the S001 floor and ceiling heights). The engine's test (gYm_KatamariMakeLandformNormal): dot(normal, up) <= cos(WallAngle * 90) is a wall, so ceilings and the undersides of slopes are walls, pushed out of in 3D (A143)
              if ((steepOnly && steepOnly !== 'ceil') || S.noCeil) continue;
              const o = t * 9, c = closestOnTri(T, o, S.pos[0], S.pos[1], S.pos[2]), dx = S.pos[0] - c[0], dy = S.pos[1] - c[1], dz = S.pos[2] - c[2], d2 = dx*dx + dy*dy + dz*dz;
              if (d2 >= R * R || d2 < 1e-10 || dy > 0.05) continue;                    // ball must be below the face
              const d = Math.sqrt(d2), m = R - d; S.pos[0] += dx / d * m; S.pos[1] += dy / d * m; S.pos[2] += dz / d * m; S.ceilHit = true; moved = true; continue;
            }
            if (steepOnly || Math.abs(H.ny[t]) >= FLAT_NY) continue;
            const o = t * 9, c = closestOnTri(T, o, S.pos[0], S.pos[1], S.pos[2]), dx = S.pos[0] - c[0], dy = S.pos[1] - c[1], dz = S.pos[2] - c[2], d2 = dx*dx + dy*dy + dz*dz;
            if (d2 >= R * R || d2 < 1e-10 || dy < -0.05) continue;                // ball must be on the upper side
            const d = Math.sqrt(d2), m = R - d; S.pos[0] += dx / d * m; S.pos[1] += dy / d * m; S.pos[2] += dz / d * m; if (dy > 0) S.rampLift = true; moved = true; continue;
          }
          if (steepOnly === 'ceil') continue;                                     // ceilings only (the bot planner asks this way)
          const o = t * 9, lo = Math.min(T[o+1], T[o+4], T[o+7]), hi = Math.max(T[o+1], T[o+4], T[o+7]); if (hi < y - R || lo > y + R) continue;
          if (hi <= y - R + (riser !== undefined ? riser : Math.max(0.5 * R, 1))) continue;               // low riser (a stair step): rolled over, the step top is the floor (A45)
          const c = closestOnTri(T, o, S.pos[0], S.pos[1], S.pos[2]), dx = S.pos[0] - c[0], dy = S.pos[1] - c[1], dz = S.pos[2] - c[2];
          if (dx*dx + dy*dy + dz*dz >= R * R) continue;
          if (dy > 0.5 * R) {
            if (steepOnly) continue;                                  // the contact point is well below the centre: an edge or a steep stair face under the ball, so it is ridden up, not a wall (A45)
            const d = Math.sqrt(dx*dx + dy*dy + dz*dz), m3 = R - d; if (m3 <= 0 || d < 1e-9) continue;
            S.pos[0] += dx / d * m3; S.pos[1] += dy / d * m3; S.pos[2] += dz / d * m3; S.rampLift = true; moved = true; continue;
          }
          const hl = Math.hypot(dx, dz); if (hl < 1e-6) continue;
          const m = Math.sqrt(Math.max(R * R - dy * dy, 0)) - hl; if (m <= 0) continue;
          S.pos[0] += dx / hl * m; S.pos[2] += dz / hl * m; out.push([dx / hl, dz / hl, t]); moved = true;
        }
      }
      if (!moved) break;
    }
    return out;
  }
  // nearest hit distance along a ray against all collision triangles (Moller-Trumbore, double sided); null if none within maxT
  function rayHit(S, ox, oy, oz, dx, dy, dz, maxT, oneSided) {
    const H = S.camHit || S.hit; if (!H) return null; const T = H.tris; let best = null;
    for (let t = 0, n = T.length / 9; t < n; t++) {
      if (S.erased && H.kind && S.erased[H.kind[t]]) continue;
      const o = t * 9, e1x = T[o+3]-T[o], e1y = T[o+4]-T[o+1], e1z = T[o+5]-T[o+2], e2x = T[o+6]-T[o], e2y = T[o+7]-T[o+1], e2z = T[o+8]-T[o+2];
      // the engine's segment test (FUN_0000f688) only counts a polygon when the segment starts on its front side and ends behind it; the plane comes from the vertex order (Newell, FUN_0000f0ec),
      // which in this z-mirrored data is the negative side of cross(e1, e2) (A134)
      if (oneSided && (e1y*e2z-e1z*e2y)*(ox-T[o]) + (e1z*e2x-e1x*e2z)*(oy-T[o+1]) + (e1x*e2y-e1y*e2x)*(oz-T[o+2]) > 0) continue;
      const px = dy*e2z-dz*e2y, py = dz*e2x-dx*e2z, pz = dx*e2y-dy*e2x, det = e1x*px+e1y*py+e1z*pz; if (Math.abs(det) < 1e-9) continue;
      const inv = 1/det, tx = ox-T[o], ty = oy-T[o+1], tz = oz-T[o+2], u = (tx*px+ty*py+tz*pz)*inv; if (u < 0 || u > 1) continue;
      const qx = ty*e1z-tz*e1y, qy = tz*e1x-tx*e1z, qz = tx*e1y-ty*e1x, v = (dx*qx+dy*qy+dz*qz)*inv; if (v < 0 || u + v > 1) continue;
      const tt = (e2x*qx+e2y*qy+e2z*qz)*inv; if (tt > 1e-4 && tt <= maxT && (best === null || tt < best)) best = tt;
    }
    return best;
  }

  // Ray stage 1 (A145): the engine's segment test against the collision polygons (gYm_MapHitCheck_Ground / HITSYS, A134).
  // A polygon counts only when the segment starts on its front side and ends behind it (or on it). Returns the nearest hit
  // { t: triangle, r: ratio along p0 to p1 in 0..1, n: front side unit normal (y up) } or null. Uses the same grid as hitWalls.
  function segHit(S, p0, p1) {
    const H = S.hit; if (!H) return null; const T = H.tris, dx = p1[0]-p0[0], dy = p1[1]-p0[1], dz = p1[2]-p0[2];
    const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]), z0 = Math.min(p0[2], p1[2]), z1 = Math.max(p0[2], p1[2]);
    const seen = new Set(); let best = null;
    const test = t => {
      if (seen.has(t)) return; seen.add(t); if (S.erased && H.kind && S.erased[H.kind[t]]) return;
      const o = t * 9, e1x = T[o+3]-T[o], e1y = T[o+4]-T[o+1], e1z = T[o+5]-T[o+2], e2x = T[o+6]-T[o], e2y = T[o+7]-T[o+1], e2z = T[o+8]-T[o+2];
      const cx = e1y*e2z-e1z*e2y, cy = e1z*e2x-e1x*e2z, cz = e1x*e2y-e1y*e2x, cl = Math.hypot(cx, cy, cz); if (cl < 1e-12) return;
      // front side is the negative side of cross(e1, e2) in this z-mirrored data
      const s0 = -(cx*(p0[0]-T[o]) + cy*(p0[1]-T[o+1]) + cz*(p0[2]-T[o+2])) / cl, s1 = -(cx*(p1[0]-T[o]) + cy*(p1[1]-T[o+1]) + cz*(p1[2]-T[o+2])) / cl;
      if (s0 < 0 || s1 > 0 || s0 === s1) return;
      const r = s0 / (s0 - s1); if (best && r >= best.r) return;
      const hx = p0[0]+dx*r-T[o], hy = p0[1]+dy*r-T[o+1], hz = p0[2]+dz*r-T[o+2];
      // inside test by barycentric coordinates in the polygon plane
      const d00 = e1x*e1x+e1y*e1y+e1z*e1z, d01 = e1x*e2x+e1y*e2y+e1z*e2z, d11 = e2x*e2x+e2y*e2y+e2z*e2z, d20 = hx*e1x+hy*e1y+hz*e1z, d21 = hx*e2x+hy*e2y+hz*e2z, den = d00*d11-d01*d01; if (Math.abs(den) < 1e-18) return;
      const v = (d11*d20-d01*d21)/den, w = (d00*d21-d01*d20)/den; if (v < -1e-6 || w < -1e-6 || v + w > 1 + 1e-6) return;
      best = { t, r, n: [-cx/cl, -cy/cl, -cz/cl] };
    };
    for (let cx = Math.floor(x0 / GRID); cx <= Math.floor(x1 / GRID); cx++) for (let cz = Math.floor(z0 / GRID); cz <= Math.floor(z1 / GRID); cz++) { const a = H.cells.get(cx * 100003 + cz); if (a) for (const t of a) test(t); }
    for (const t of H.big) test(t);
    return best;
  }

  // A solid object's hit data is its model's bounding box (MonoHit.cppi gYm_MonoHitInit: sHitData = model->boxHit; sCheckHitMap: "no detailed data yet, so a box"). The ball's segment is taken into the
  // object's own frame (transpose of its rotation, relative to its position) and tested against lo..hi. Like the map polygons the box is one sided (outward faces): a segment that starts inside
  // sees only back faces and hits nothing (A150). Returns {r, n} with r along the segment and n the world normal of the face it enters through
  function boxSeg(o, p0, p1) {
    const Rt = mtr(o.rot), a = mvec(Rt, [p0[0] - o.pos[0], p0[1] - o.pos[1], p0[2] - o.pos[2]]), b = mvec(Rt, [p1[0] - o.pos[0], p1[1] - o.pos[1], p1[2] - o.pos[2]]);
    let tmin = 0, tmax = 1, ax = -1, sg = 0;
    for (let k = 0; k < 3; k++) {
      const d = b[k] - a[k];
      if (Math.abs(d) < 1e-12) { if (a[k] < o.lo[k] || a[k] > o.hi[k]) return null; continue; }
      let t1 = (o.lo[k] - a[k]) / d, t2 = (o.hi[k] - a[k]) / d, sn = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sn = 1; }
      if (t1 > tmin) { tmin = t1; ax = k; sg = sn; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (ax < 0) return null;
    const nl = [0, 0, 0]; nl[ax] = sg; return { r: tmin, n: mvec(o.rot, nl) };
  }

  // Ray stage 2 (A146): the engine's ground and wall hit lists (Katamari::sGround, gYm_KatamariMakeLandformNormal, sRegistHitInfo, sGetHitInfo,
  // sGetAdjustGround, sGetAdjustWall, sAdjustPosi). Output only: nothing in step() calls it yet. Returns the lists and the position correction.
  // old = position at the start of the frame, S.pos = position now. The correction is subtracted from the position (as in sAdjustPosi).
  // Ray stage 4 (A148): the distort points of Katamari::sRoll, Mono::gYm_MonoIbitsu and sSetPosition. Index 0 is the free point (-ground normal x R on the ground, straight down in
  // the air), 1 to 18 the fixed points (table direction turned by the ball, length R: their f32Len is never above R), 19 to 24 the fluid points (lumps).
  // The fluid points are the farthest tip of each of the newest 12 attached objects that have ibitsu tips, the first 6 of those in that order (not the longest 6).
  const IB_FLUID0 = 19, IB_FLUID_N = 6, IB_DEPTH = 12, IB_MAXSCALE = 2.5;
  function distortPoints(S, R, pos, speed, climbing) {
    const pts = [], gn = S.grounded && S.gNorm ? S.gNorm : [0, 1, 0];
    const cwn = climbing && S.cw && S.cw.norm ? S.cw.norm : null;                       // while climbing point 0 aims into the wall by the climb length (sRoll: fvClimbWallNorm x -f32ClimbWallLen)
    pts.push({ i: 0, p: cwn ? [pos[0] - cwn[0] * (S.cw.len || R), pos[1], pos[2] - cwn[1] * (S.cw.len || R)] : [pos[0] - gn[0] * R, pos[1] - gn[1] * R, pos[2] - gn[2] * R], f32Len: R });
    if (IBI18) IBI18.forEach((q, i) => { const o = mvec(S.R, [q[0], -q[1], -q[2]]), l = Math.hypot(o[0], o[1], o[2]) || 1, n = [o[0] / l, o[1] / l, o[2] / l]; pts.push({ i: i + 1, n, p: [pos[0] + n[0] * R, pos[1] + n[1] * R, pos[2] + n[2] * R], f32Len: R }); });
    if (!climbing && !S.wheelSpin && S.ibiList && S.ibiList.length) {
      const tp = tableParams(S), vN = tp.speed * tp.rF, vD = tp.speed * tp.rD, sr = speed >= vD ? 0 : speed <= vN ? 1 : 1 - (speed - vN) / Math.max(vD - vN, 1e-6);
      let depth = IB_DEPTH, k = 0;
      for (let j = S.ibiList.length - 1; j >= 0 && depth > 0 && k < IB_FLUID_N; j--) {
        const o = S.ibiList[j]; if (o.state !== 'ball') continue; depth--;
        let far = 0, fn = null; for (const p of S.info[o.n].ibi) { const q = mvec(S.R, mvec(o.lrot, p).map((v, a) => v + o.lpos[a])), l = Math.hypot(q[0], q[1], q[2]); if (l > far) { far = l; fn = [q[0] / l, q[1] / l, q[2] / l]; } }
        if (!fn) continue;
        let len = R + (far - R) * sr, f32Len = far; if (len / R > IB_MAXSCALE) { f32Len = R * IB_MAXSCALE; len = f32Len; }   // sSetPosition: more than 2.5 R is cut to 2.5 R
        pts.push({ i: IB_FLUID0 + k, n: fn, p: [pos[0] + fn[0] * len, pos[1] + fn[1] * len, pos[2] + fn[2] * len], f32Len, o }); k++;
      }
    }
    const ib = S.ib; if (ib && ib.st && ib.no >= 0) {                                         // the planted point stays where it is (sSetPosition)
      let pt = pts.find(q => q.i === ib.no); if (!pt) pts.push(pt = { i: ib.no, f32Len: ib.len });
      pt.p = ib.posi.slice(); const d = [pt.p[0] - pos[0], pt.p[1] - pos[1], pt.p[2] - pos[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; pt.n = [d[0] / l, d[1] / l, d[2] / l];
    }
    return pts;
  }
  const IBI18 = (() => { try { return require('./tools/ibitsu_sph18.json').points; } catch (e) { return null; } })();
  function rayContacts(S, R, old, opt) {
    opt = opt || {}; const pos = S.pos, lists = [[], []], dist = opt.dist !== false;
    const mv = [pos[0]-old[0], pos[1]-old[1], pos[2]-old[2]], mlen = Math.hypot(mv[0], mv[1], mv[2]);
    const up = [0, 1, 0];
    const reg = (type, n, adj, r, tag, pt, vec, hp, mono) => {
      const L = lists[type], len = Math.hypot(adj[0], adj[1], adj[2]), di = typeof tag === 'number' ? tag : -1;    // di: the distort point index of the ray, -1 for the edge rays
      for (const h of L) { if (n[0]*h.n[0] + n[1]*h.n[1] + n[2]*h.n[2] >= 0.99998) { if (len > h.len) { h.n = n; h.adj = adj; h.len = len; h.r = r; h.tag = tag; h.pt = pt; h.di = di; h.vec = vec; h.hp = hp; h.mono = mono || null; } return; } }
      L.push({ n, adj, len, r, tag, pt, di, vec, hp, mono: mono || null });
    };
    // returns 0 for no hit, 2 for a hit that is dropped (gYm_KatamariMakeLandformNormal returns 2), 1 for a registered hit. off: the ray's offset from the centre (fast rays are shifted back to the centre as sGround does)
    let edgeHit = false;                                                        // KSTAT HitEdge: any edge ray hit something this frame (a dropped hit counts too); sCheckClimbWall refuses a climb then
    const cast = (p0, p1, tag, off) => {
      const h = segHit(S, p0, p1); if (!h) return 0;
      if (typeof tag === 'string' && tag !== 'fcenter') edgeHit = true;
      const d = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]], sl = Math.hypot(d[0], d[1], d[2]); if (sl < 1e-9) return 0;
      const n = h.n, wall = n[1] <= WALL_NY;                                   // up component at or below cos(WallAngle x 90): a wall (A143)
      if (!wall && (tag === 'top' || tag === 'lefttop' || tag === 'righttop')) return 2;   // ground seen by the upper edge rays does not count
      const inner = (n[0]*d[0] + n[1]*d[1] + n[2]*d[2]) / sl, k = inner * sl * (1 - h.r - 0.0005), o = off || [0, 0, 0];
      reg(wall ? 1 : 0, n, [n[0]*k, n[1]*k, n[2]*k], h.r, tag, h.t, d, [p0[0] + d[0]*h.r - o[0], p0[1] + d[1]*h.r - o[1], p0[2] + d[2]*h.r - o[2]]);
      return 1;
    };
    // edge rays (the walk case; the fast case is below): old position + offset to new position + 15% of the move + offset
    const left = (() => { const h = Math.hypot(mv[0], mv[2]); const dx = h > 1e-9 ? mv[0]/h : 0, dz = h > 1e-9 ? mv[2]/h : 1; return [-dz * R, 0, dx * R]; })();   // rotY(-90) of the flat move direction (left and right are both used, so the sign does not matter)
    const right = [-left[0], 0, -left[2]], upv = [0, R, 0];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l*R, v[1]/l*R, v[2]/l*R]; };
    const lu = norm([left[0]+upv[0], left[1]+upv[1], left[2]+upv[2]]), ru = norm([right[0]+upv[0], right[1]+upv[1], right[2]+upv[2]]);
    const tgt = [pos[0] + (mlen > 1e-9 ? mv[0]/mlen : 0) * R * 0.15, pos[1] + (mlen > 1e-9 ? mv[1]/mlen : 0) * R * 0.15, pos[2] + (mlen > 1e-9 ? mv[2]/mlen : 0) * R * 0.15];
    const fast = mlen >= R && opt.edges !== false; let fastHit = false;                 // sCheckFast: the frame's move is at least the radius
    if (fast) {
      // sGround, fast case: five rays (centre, top, left, right, bottom) from the old position minus R x move direction to the new position plus it, each shifted back to the centre.
      // The first one that hits and is not dropped ends the loop; the normal edge rays are skipped
      const rm = [mv[0]/mlen*R, mv[1]/mlen*R, mv[2]/mlen*R], a0 = [old[0]-rm[0], old[1]-rm[1], old[2]-rm[2]], b0 = [pos[0]+rm[0], pos[1]+rm[1], pos[2]+rm[2]];
      for (const [tag, off] of [['fcenter', [0, 0, 0]], ['top', upv], ['left', left], ['right', right], ['bottom', [0, -R, 0]]]) {
        const hit = cast([a0[0]+off[0], a0[1]+off[1], a0[2]+off[2]], [b0[0]+off[0], b0[1]+off[1], b0[2]+off[2]], tag, off);
        if (hit) fastHit = true; if (hit === 1) break;
      }
    } else if (mlen > 1e-6 && opt.edges !== false) for (const [tag, off] of [['top', upv], ['left', left], ['right', right], ['lefttop', lu], ['righttop', ru]]) cast([old[0]+off[0], old[1]+off[1], old[2]+off[2]], [tgt[0]+off[0], tgt[1]+off[1], tgt[2]+off[2]], tag);
    // distort rays: centre to each distort point (A148: fixed 1 to 18, fluid 19 to 24, the free point 0)
    const ptsAll = dist ? (opt.pts || distortPoints(S, R, pos, opt.speed !== undefined ? opt.speed : mlen, !!opt.climbing)) : null;
    if (dist) for (const q of ptsAll) cast([pos[0], pos[1], pos[2]], q.p, q.i);
    // solid objects (too big to pick up: Mono::gYm_MonoHitCheck "treated as background", then sCheckHitMap): the same kinds of ray against the box. Walk case: the five edge rays reach 0.5 R ahead
    // (the map's reach 0.15 R) and the loop ends at the first hit that is not dropped; fast case: the five swept rays from the old position to the new one plus R, same end; if a fast ray hit, the distort rays are skipped for that object
    const monos = new Set();
    if (S.ray && S.rayObjs && opt.objs !== false) {
      const dm = S.diam * 10;
      for (const o of S.objs) {
        if (o.state !== 'map' || o.catchMm <= dm) continue;
        if (Math.hypot(o.pos[0] - pos[0], o.pos[1] - pos[1], o.pos[2] - pos[2]) - mlen > R + o.maxlen) continue;   // m_dist = distance - k_dist; dist = R + f32Radius of the object
        const co = (p0, p1, tag, off) => {
          const h = boxSeg(o, p0, p1); if (!h) return 0;
          if (typeof tag === 'string' && tag !== 'fcenter') edgeHit = true;
          const d = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]], sl = Math.hypot(d[0], d[1], d[2]); if (sl < 1e-9) return 0;
          const n = h.n, wall = n[1] <= WALL_NY; monos.add(o);
          if (!wall && (tag === 'top' || tag === 'lefttop' || tag === 'righttop')) return 2;
          const inner = (n[0]*d[0] + n[1]*d[1] + n[2]*d[2]) / sl, k = inner * sl * (1 - h.r - 0.0005), of = off || [0, 0, 0];
          reg(wall ? 1 : 0, n, [n[0]*k, n[1]*k, n[2]*k], h.r, tag, -1, d, [p0[0] + d[0]*h.r - of[0], p0[1] + d[1]*h.r - of[1], p0[2] + d[2]*h.r - of[2]], o);
          return 1;
        };
        let ret = 0;
        if (fast) {
          const rm = [mv[0]/mlen*R, mv[1]/mlen*R, mv[2]/mlen*R], b0 = [pos[0]+rm[0], pos[1]+rm[1], pos[2]+rm[2]];
          for (const [tag, off] of [['fcenter', [0, 0, 0]], ['top', upv], ['left', left], ['right', right], ['bottom', [0, -R, 0]]]) {
            const hit = co([old[0]+off[0], old[1]+off[1], old[2]+off[2]], [b0[0]+off[0], b0[1]+off[1], b0[2]+off[2]], tag, off);
            if (hit) { ret = 1; fastHit = true; } if (hit === 1) break;
          }
        } else if (mlen > 1e-6 && opt.edges !== false) {
          const rm5 = [mv[0]/mlen*R*0.5, mv[1]/mlen*R*0.5, mv[2]/mlen*R*0.5];
          for (const [tag, off] of [['top', upv], ['left', left], ['right', right], ['lefttop', lu], ['righttop', ru]]) if (co([old[0]+off[0], old[1]+off[1], old[2]+off[2]], [pos[0]+rm5[0]+off[0], pos[1]+rm5[1]+off[1], pos[2]+rm5[2]+off[2]], tag, off) === 1) break;
        }
        if (!ret && dist) for (const q of ptsAll) co([pos[0], pos[1], pos[2]], q.p, q.i);
      }
    }
    // per axis: the largest positive plus the largest negative adjustment (sGetAdjustGround / sGetAdjustWall)
    const sum = L => { const a = [0, 0, 0], b = [0, 0, 0]; for (const h of L) for (let k = 0; k < 3; k++) { const v = h.adj[k]; if (v < 0) { if (b[k] > v) b[k] = v; } else if (v > 0) { if (a[k] < v) a[k] = v; } } const r = [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; return r.map(v => Math.abs(v) < 1e-4 ? 0 : v); };
    const adjG = sum(lists[0]), adjW = sum(lists[1]); let wn = [0, 0, 0]; for (const h of lists[1]) { wn[0] += h.n[0]; wn[1] += h.n[1]; wn[2] += h.n[2]; }
    // sAdjustPosi: the wall part only counts when the flat move runs along or into the wall (inner <= 0.01)
    let useWall = false; if (lists[1].length) { const mh = Math.hypot(mv[0], mv[2]), wh = Math.hypot(wn[0], wn[2]); if (mh < 1e-9 || wh < 1e-9) useWall = !!opt.stop || mh < 1e-9; else useWall = !!opt.stop || (mv[0]*wn[0] + mv[2]*wn[2]) / (mh * wh) <= 0.01; }
    const total = [adjG[0] + (useWall ? adjW[0] : 0), adjG[1] + (useWall ? adjW[1] : 0), adjG[2] + (useWall ? adjW[2] : 0)];
    return { ground: lists[0], wall: lists[1], adjG, adjW, useWall, total, pts: opt.pts || null, fast, fastHit, edge: edgeHit, monos: [...monos] };
  }

  // ---- state ----
  function create(play, opts) {
    opts = opts || {};
    const mf = play.mis.mission_floats;
    GRID = Math.max(40, (opts.startDiam || mf[8]) * 1.5);
    const startDiam = opts.startDiam || mf[8], tgtInfo = !opts.noTarget && play.mis.target && play.info[play.mis.target], cm = i => opts.catchMode === 'f0' ? i.catch_mm : (opts.catchMode === 'goal' && i.catch_goal_mm !== undefined) ? i.catch_goal_mm : engineCatchMm(i), goal = opts.goal || (tgtInfo ? cm(tgtInfo) / 10 : mf[9]);   // story clear = pick up the target mono (GameClear.cppi sCheck1P_N); goal is its catch size, used for the HUD gauge
    const S = {
      G: buildGround(play.tris), hit: play.hit && play.hit.length ? buildHit(play.hit, play.hit_kind) : null, camHit: play.camhit && play.camhit.length ? { tris: Float32Array.from(play.camhit), kind: null } : null, tab: play.mis.speed.filter(r => r.length >= 11), cam: play.mis.camera || [], speedRows: play.mis.speed.map(r => [r[0], r[1]]), gravRows: pairs(play.mis.gravity), addRows: pairs(play.mis.addvol),
      info: play.info, startDiam, goal, target: tgtInfo ? play.mis.target : null, targetLabel: tgtInfo ? (tgtInfo.label || play.mis.target).trim() : null,
      pos: [mf[0], Math.max(-mf[1], 5) + startDiam, mf[2]],        // PLACEHOLDER (P6): start y flipped from logic, then dropped to the floor
      vy: 0, dy: 0, climbLock: !!opts.climbLock, flyT: 0, fallT: 0, speed: 0, v: [0, 0], dashT: 0, dashCool: 0, dash: false, wheelSpin: false, wheelSpd: 0, dashRep: 0, dashHeld: false, dS: { n: 0, w: 0, dw: 0, dur: 240, fw: 0, forbid: false, on: false, spin: false, start: false }, yaw: mf[6],   // P7: mission data is already in engine space (y down), which matches view space in x and z, so no z flip. Engine ground normal starts as (0,-1,0)
      stoppers: play.mis.stoppers || [], erased: {}, layers: (() => { const lm = play.mis.layers_by_mode && play.mis.layers_by_mode[opts.set || 'S']; const l = lm && lm.length ? lm : play.mis.layers; return l && l.length ? l : null; })(), layer: 0, R: I3(), volume: sphereVol(startDiam / 200), diam: startDiam,
      noCeil: !!opts.noCeil, ceilHit: false, ib: { st: 0, no: -1, len: 0, posi: [0, 0, 0], vec: [0, 0, 0], fluidVec: [0, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, ray: opts.ray !== undefined ? !!opts.ray : !(typeof process !== 'undefined' && process.env && process.env.KRAY === '0'), rayObjs: opts.rayObjs !== undefined ? !!opts.rayObjs : !(typeof process !== 'undefined' && process.env && process.env.KOBJ === '0'), gNorm: [0, 1, 0], holdHist: [], holdTime: 0, holdIn: false, holdSeen: new WeakSet(), lift: 0, liftApplied: 0, ctrlOff: 0, cw: { on: false, top: false, topT: 0, startY: 0, speed: 0, eff: 0, forbid: 0, norm: [0, 0] }, brake: false, crumbleCool: 0, crumbled: 0, flipT: 0, flipN: 14, flipYaw0: 0, ouji_jump: play.mis.ouji_jump, flipHeld: false, lumps: [], ibiList: [], recover: play.mis.recover || null, objs: [], attached: [], picked: 0, frame: 0, won: false, events: [], buried: 0, noCull: !!opts.noCull, water: play.water && play.water.length ? buildWater(play.water) : null, hitWater: false, waterPos: null, rippleWait: RIPPLE_WAIT, ripples: [], noWin: !!opts.noTarget, noReflect: !!opts.noReflect,
    };
    S.diam = diamFromVol(S.volume);
    S.pickMode = opts.pick || 'engine'; S.noClimbKind = opts.noClimbKind === undefined ? 2 : opts.noClimbKind; S.noClimbKinds = new Set([S.noClimbKind].concat(opts.stopperClimb ? [] : (play.mis.stoppers || []).map(st => st[1])));   // the area walls named by ERASE_STOPPER cannot be climbed either: tester, stage 2 first slope (A126);   // 'sphere' brings back the old sphere-against-box pickup test for comparison (A29)
    const SET = opts.set || 'S';   // placement set for the mode: S story, T time attack, J exact size, E eternal (A82)
    for (const o of play.objs) {
      if ((o.set || 'S') !== SET) continue;
      const i = play.info[o.n]; if (!i) continue;
      const ext = [i.hi[0]-i.lo[0], i.hi[1]-i.lo[1], i.hi[2]-i.lo[2]];
      S.objs.push({ n: o.n, model: i.model, pos: o.p.slice(), rot: eulerView(o.r[0], o.r[1], o.r[2]), rawRot: o.r, catchMm: cm(i), boxvol: i.boxvol, addRatio: i.add_ratio,
        r: 0.5 * Math.hypot(ext[0], ext[1], ext[2]), halfXZ: 0.5 * Math.max(ext[0], ext[2]), top: o.p[1] + i.hi[1], lo: i.lo, hi: i.hi, maxlen: Math.max(Math.hypot(...i.lo), Math.hypot(...i.hi)), layer: o.layer || 0, state: (o.layer || 0) === 0 ? 'map' : 'hidden', path: (i.path && play.mis.splines && play.mis.splines[i.path.no]) ? { pts: play.mis.splines[i.path.no], speed: i.path.speed, t: 0 } : null });
    }
    for (const o of S.objs) if (o.path) { const sp = splineAt(o.path.pts, 0); o.pos = sp.pos; o.ppos = sp.pos.slice(); o.rot = pathRot(sp.tan, null); }   // tSpline starts at 0 (A96)
    return S;
  }
  // Moving monos (MonoMain.cppi): each frame getPos and getRotMat at tSpline, then tSpline += splineSpeed, minus 1 when it passes 1. Spline is a closed uniform
  // quadratic B-spline read from the binary (FUN_0002a254, FUN_0002a3e4, FUN_0002a178): u = t * n wrapped to [-0.5, n - 0.5), i = int(u + 0.5), position and tangent
  // are the sums of points i-1, i, i+1 weighted by the kernel F and its derivative at u - (i-1), u - i, u - (i+1). The curve does not pass through the points (A96)
  const bF = x => { const a = Math.abs(x); return a < 0.5 ? 0.75 - a * a : a < 1.5 ? (4 * a * a - 12 * a + 9) / 8 : 0; };
  const bD = x => { const a = Math.abs(x); let d = a < 0.5 ? -2 * a : a < 1.5 ? a - 1.5 : 0; return x < 0 ? -d : d; };
  function splineAt(pts, t) {
    const n = pts.length; let u = t * n; while (n - 0.5 <= u) u -= n; while (u < -0.5) u += n;
    const i = Math.trunc(u + 0.5), ip = i - 1 < 0 ? n - 1 : i - 1, inx = i + 1 >= n ? 0 : i + 1, ks = [ip, i, inx], xs = [u - (i - 1), u - i, u - (i + 1)], pos = [0, 0, 0], tan = [0, 0, 0];
    for (let q = 0; q < 3; q++) for (let k = 0; k < 3; k++) { pos[q] += pts[ks[k]][q] * bF(xs[k]); tan[q] += pts[ks[k]][q] * bD(xs[k]); }
    return { pos, tan };
  }
  // getRotMat: the model's z axis is minus the tangent (so a model faces away from its travel direction on the +z side), x = -(z cross up), y = (z cross up) cross z, up = (0, 1, 0). Columns here
  const pathRot = (tan, prev) => {
    const L = Math.hypot(tan[0], tan[1], tan[2]); if (L < 1e-9) return prev || ry(0);
    const z = [-tan[0] / L, -tan[1] / L, -tan[2] / L], c = [-z[2], 0, z[0]], cl = Math.hypot(c[0], c[2]); if (cl < 1e-6) return prev || ry(0);
    const v = [c[0] / cl, 0, c[2] / cl], x = [-v[0], 0, -v[2]], y = [v[1] * z[2] - v[2] * z[1], v[2] * z[0] - v[0] * z[2], v[0] * z[1] - v[1] * z[0]];
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  };
  // Flip-book monos (A59, FUN_00018514 = MonoCtrl::animation): each mono keeps its own phase, adds the ANIME speed once per update, and steps to the next model each time it passes 1.
  // While the mono is stuck to the ball (status 2, _NK_MONO_STAT_KATA) the speed counts three times (1 + 2). Runs for every mono that is not stopped, on the map or on the ball
  function animMonos(S) {
    for (const o of S.objs) { if (o.state !== 'map' && o.state !== 'fly' && o.state !== 'ball') continue; const an = S.info[o.n] && S.info[o.n].anim; if (!an) continue; o.aph = (o.aph || 0) + an.speed * (o.state === 'ball' ? 3 : 1); }
  }
  function moveMonos(S) {
    for (const o of S.objs) {
      if (!o.path || o.state !== 'map') continue;
      o.ppos = o.pos.slice();
      const sp = splineAt(o.path.pts, o.path.t);
      o.pos = sp.pos; o.top = o.pos[1] + o.hi[1]; o.rot = pathRot(sp.tan, o.rot);
      o.path.t += o.path.speed; if (o.path.t > 1) o.path.t -= 1;
    }
  }
  // closest point of an object's oriented bounding box to a world point c. Models are boxed in their own space; world = rot * local + pos
  function boxClosest(o, c) {
    const l = mvec(mtr(o.rot), [c[0] - o.pos[0], c[1] - o.pos[1], c[2] - o.pos[2]]);
    const q = [Math.min(Math.max(l[0], o.lo[0]), o.hi[0]), Math.min(Math.max(l[1], o.lo[1]), o.hi[1]), Math.min(Math.max(l[2], o.lo[2]), o.hi[2])];
    const w = mvec(o.rot, q);
    return { p: [w[0] + o.pos[0], w[1] + o.pos[1], w[2] + o.pos[2]], dist: Math.hypot(l[0] - q[0], l[1] - q[1], l[2] - q[2]) };
  }
  // The pickup test of MonoHit.cppi sCheckHitMono (A29). (1) If half the object's smallest box side plus the ball radius reaches the distance to the object's origin, it is a hit.
  // (2) Otherwise a segment of length f32IbitsuAveLen runs from the ball centre straight towards the object's origin, in the object's own frame, and a hit is when it touches the box
  // (NHit::hitLineBox, the segment against the box, which is centred on the middle of lo..hi). f32IbitsuAveLen is the mean lump length, which is at least the radius; I use the radius (lumps average out close to it)
  function engineHit(S, o, v, R) {
    if (S.pickMode === 'sphere') return boxClosest(o, S.pos).dist <= R;
    const dist = Math.hypot(v[0], v[1], v[2]);
    const minHalf = 0.5 * Math.max(0.1, Math.min(o.hi[0] - o.lo[0], o.hi[1] - o.lo[1], o.hi[2] - o.lo[2]));
    if (minHalf + R >= dist) return true;
    const Rt = mtr(o.rot), p0 = mvec(Rt, [-v[0], -v[1], -v[2]]), n = [p0[0] / dist, p0[1] / dist, p0[2] / dist];
    const p1 = [p0[0] - n[0] * R, p0[1] - n[1] * R, p0[2] - n[2] * R];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 3; k++) {
      const d = p1[k] - p0[k];
      if (Math.abs(d) < 1e-12) { if (p0[k] < o.lo[k] || p0[k] > o.hi[k]) return false; continue; }
      let ta = (o.lo[k] - p0[k]) / d, tb = (o.hi[k] - p0[k]) / d; if (ta > tb) { const x = ta; ta = tb; tb = x; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
    }
    return true;
  }
  // Support height under (x, z): map floor, or the top of a too-big object the ball can roll up onto (P19: climb limit CLIMB * radius).
  // yMapMax / yObjMax are the highest surface heights the ball may step onto from where it is.
  function supportAt(S, x, z, yMapMax, yObjMax, noMap) {
    let g = noMap ? null : groundAt(S.G, x, z, yMapMax); const dm = S.diam * 10;
    for (const o of S.objs) {
      if (o.state !== 'map' || o.catchMm <= dm || o.top > yObjMax || (g !== null && o.top <= g)) continue;
      if (Math.abs(x - o.pos[0]) > o.maxlen || Math.abs(z - o.pos[2]) > o.maxlen) continue;
      const l = mvec(mtr(o.rot), [x - o.pos[0], 0, z - o.pos[2]]);       // footprint test in the box's own frame (y ignored: boxes are treated as upright)
      const wy = mvec(mtr(o.rot), [0, 1, 0]);                             // so move along the local up axis until the point is in line with the footprint
      if (Math.abs(wy[1]) < 0.7) continue;
      const t = -l[1] / (wy[1] || 1); const px = l[0] + wy[0] * t, pz = l[2] + wy[2] * t;
      if (px >= o.lo[0] && px <= o.hi[0] && pz >= o.lo[2] && pz <= o.hi[2]) g = o.top;
    }
    return g;
  }
  // highest floor-like collision face at or below yMax at (x, z): the ground the ray mode actually stands on (the rendered map, S.G, can differ from it)
  function hitFloorAt(S, x, z, yMax) {
    let y = yMax;
    for (let k = 0; k < 12; k++) { const h = segHit(S, [x, y, z], [x, y - 1e5, z]); if (!h) return null; const hy = y - 1e5 * h.r; if (h.n[1] >= WALL_NY) return hy; y = hy - 0.01; }
    return null;
  }
  const radius = S => S.diam / 2;
  const maxSpeed = S => interpRows(S.speedRows, S.diam, 1);
  const gravity = S => interpRows(S.gravRows, S.diam, 1);
  const addRatio = S => S.addRows.length ? interpRows(S.addRows, S.diam, 1) : 1;      // A-VR: table is (diameter, ratio) pairs

  function grow(S, add) {
    const r0 = radius(S); S.volume += add; S.diam = diamFromVol(S.volume);
    if (S.diam > 99900) S.diam = 99900;            // KatamariMain.cppi: limiter at __M__(999) = 999 m (was wrongly 999 cm, A47)
    S.pos[1] += radius(S) - r0;                       // keep the bottom where it was
  }

  // KATAMARI table row at the current diameter, linearly interpolated like gYm_KatamariGetTableParam.
  // File column order (A27, from the struct offsets that gYm_KatamariGetTableParam reads in the binary): 0 diameter, 1 speed, 2 gravity, 3-6 brake effect F/B/S/dash,
  // 7-10 max speed ratio F/B/S/dash, 11-12 slope ratio up/down (unused: the shipped game sets IgnoreSlope), 13-16 acceleration F/B/S/dash, 17 prince offset Z, 18-20 alarm near/middle/far
  function tableParams(S) {
    const T = S.tab, d = Math.max(S.diam, T[1] ? T[1][0] : 0);
    let i = 2; while (i < T.length - 1 && d > T[i][0]) i++;
    const a = T[i - 1], b = T[i], t = Math.max(0, Math.min(1, (d - a[0]) / ((b[0] - a[0]) || 1)));
    const L = c => a[c] + (b[c] - a[c]) * t;
    return { speed: L(1), brakeF: L(3), brakeB: L(4), brakeS: L(5), brakeD: L(6), rF: L(7), rB: L(8), rS: L(9), rD: L(10), accF: L(13), accB: L(14), accS: L(15), accD: L(16), oujiZ: L(17) };
  }
  // Camera row at the current diameter (CAMERA_DATA): eye offset behind/up, look-at offset ahead/up, far clip. Offsets are logic space, y down.
  // Camera rows, from the engine (FUN_00029948, A102). The row is chosen by a step rule, not blended: row i serves diameters above row i's own size
  // up to row i+1's size (row 0 below row 1's), and the last row from then on. A row's numbers are logic space (y down, z behind negative).
  function cameraRow(S) {
    const C = S.cam; if (!C.length) return -1;
    let i = 0; while (i < C.length - 1 && !(S.diam <= C[i + 1][0])) i++;
    return i;
  }
  function cameraParams(S, idx) {
    const C = S.cam; if (!C.length) return { back: S.diam * 4.5, up: S.diam * 1.4, ahead: S.diam, lookUp: 0, far: 800 };
    const r = C[idx === undefined ? cameraRow(S) : idx];
    return { back: -r[3], up: -r[2], ahead: r[7], lookUp: -r[6], far: r[9] };
  }
  // gYm_OujiDashCancel: Dash, WheelSpin and the stroke count off. The stroke timer and the budget stay (a held key needs a fresh press, my dashLock)
  function dashCancel(S, keepLock) { const d = S.dS; d.on = false; d.spin = false; d.start = false; d.n = 0; S.dash = false; S.wheelSpin = false; if (!keepLock) S.dashLock = true; }
  // Convenience for keyboards and bots: forward/turn (turn > 0 turns left, toward +yaw) -> two stick values
  function tank(fwd, turn) { const c = v => Math.max(-1, Math.min(1, v)); return { L: c(fwd - turn), R: c(fwd + turn) }; }

  // Two-stick input like the game's Ouji controller (OujiCtrl4.cppi gYm_OujiCtrl4_GetMoveParam, A113). Each stick is a 2D vector l = [x, z] (x right, z forward, length 0..1, 0 = finger up).
  // Returns {turn (rad, + = right), power, dir (1 push forward or sideways, -1 back, 0 none), mdir (engine u8MoveDir 0 front, 1 back, 2 side, -1 none), phi (angle of the push relative to the prince, rad, + = right), msr (f32MaxSpeedRatio), moveTurn, spin}.
  // The combined stick and the angle between the two sticks are my reading of fvNrmStick[2] and f32StickAngle[2] (A121); how the game builds the stick vectors is not in the shipped sources.
  const SIDE_ANGLE = 0.3634740, TURNFAST_F = 0.8733223, TURNFAST_B = 2.2702518, FRONT_SPEED_ANGLE = 0.5, TURN_ANGLE2 = 0.75;   // gf32DefaultOujiParam
  function readCtrl(l, r) {
    const t = TILT, rng = 1 - t, none = { turn: 0, power: 0, dir: 0, mdir: -1, phi: 0, msr: 0, moveTurn: false };
    // a stick shorter than TurnTilt counts as finger up (A122: the engine's own dead zone is in the touch code, which is not shipped; this keeps the old behaviour for keyboard and bot input)
    let pl = Math.min(1, Math.hypot(l[0], l[1])), pr = Math.min(1, Math.hypot(r[0], r[1]));
    if (pl < t) { l = [0, 0]; pl = 0; } if (pr < t) { r = [0, 0]; pr = 0; }
    const lz = l[1], rz = r[1];
    if (pl === 0 && pr === 0) return none;
    const pivot = v => ({ turn: v, power: 0, dir: 0, mdir: -1, phi: 0, msr: 0, moveTurn: false });
    if (lz >= t && Math.abs(rz) <= t && pr === 0) return pivot(TURNDELTA * (lz - t) / rng);               // sCheckTurnFL + sTurnSingle: pivot right
    if (rz >= t && Math.abs(lz) <= t && pl === 0) return pivot(-TURNDELTA * (rz - t) / rng);              // sCheckTurnFR
    if (lz <= -t && Math.abs(rz) <= t && pr === 0) return pivot(-TURNDELTA3 * (Math.abs(lz) - t) / rng);   // sCheckTurnBL + sTurnSL
    if (rz <= -t && Math.abs(lz) <= t && pl === 0) return pivot(TURNDELTA3 * (Math.abs(rz) - t) / rng);   // sCheckTurnBR + sTurnSR
    if (pl <= 0 || pr <= 0) return none;                                                                    // one stick down but not a pivot: dropped
    const ll = Math.hypot(l[0], l[1]), rl = Math.hypot(r[0], r[1]), ln = [l[0] / ll, l[1] / ll], rn = [r[0] / rl, r[1] / rl];   // unit vectors (lengths above 1 are clamped to power 1)
    const ang = Math.acos(Math.max(-1, Math.min(1, ln[0] * rn[0] + ln[1] * rn[1])));                         // f32StickAngle[2]
    if (ang >= Math.PI / 2) {                                                                                // sTurn90: the sticks pull apart
      const lim = TURN_ANGLE2 * Math.PI; let ratio = 0, ok = false;
      if (ln[1] > 0) { if (rn[1] < 0) { ratio = ang >= lim ? 1 : (ang - Math.PI / 2) / (lim - Math.PI / 2); ok = true; } }
      else if (rn[1] > 0) { ratio = ang >= lim ? -1 : -(ang - Math.PI / 2) / (lim - Math.PI / 2); ok = true; }
      return { turn: ok ? TURNDELTA2 * ratio : 0, power: 0, dir: 0, mdir: -1, phi: 0, msr: 0, moveTurn: true, spin: ok };
    }
    const ex = p => p >= t ? (p - t) / rng : 0, power = (ex(pl) + ex(pr)) * 0.5;                              // sGetMovePower
    let sx = ln[0] * pl + rn[0] * pr, sz = ln[1] * pl + rn[1] * pr; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;       // fvNrmStick[2]
    const th = Math.acos(Math.max(-1, Math.min(1, sz))), range1 = Math.PI / 2 - SIDE_ANGLE, range2 = Math.PI / 2 + SIDE_ANGLE, left = sx < 0;
    let phi = th; if (th > range1 && th < range2) phi = Math.PI / 2; if (left) phi = -phi;                    // mInput->rotY(theta): the push is rotated by the stick angle, snapped to 90 degrees in the side zone
    // sTurn
    let ratio, back = false;
    if (th <= TURNFAST_F) ratio = th / TURNFAST_F;
    else if (th <= range1) ratio = (range1 - th) / (range1 - TURNFAST_F);
    else if (th <= range2) ratio = 0;
    else if (th <= TURNFAST_B) { back = true; ratio = -(th - range2) / (TURNFAST_B - range2); }
    else { back = true; ratio = -(Math.PI - th) / (Math.PI - TURNFAST_B); }
    if (left) ratio = -ratio;
    let ratio2 = pl - pr; if (th > Math.PI / 2) ratio2 = -ratio2;
    const md = back ? MOVEDELTA_B : MOVEDELTA, turn = md * ratio * 0.5 + md * ratio2 * 0.5;
    let msr, mdir;
    if (th <= range1) { let q = (range1 - th) / range1; q = q >= FRONT_SPEED_ANGLE ? 1 : q / FRONT_SPEED_ANGLE; msr = q; mdir = 0; }
    else if (th >= range2) { msr = (th - range2) / range1; mdir = 1; }
    else { msr = 0; mdir = 2; }
    return { turn, power, dir: mdir === 1 ? -1 : 1, mdir, phi, msr, moveTurn: false };
  }
  // One touch pad to two sticks (FUN_00025e30, controller type 2, A121). r = push to the right, f = push forward, each -1..1 (32 px from the pad centre is full).
  // Spin zones: a strong sideways push (0.5 to 1.25) with the other axis between -0.5 and 0.75 pulls the sticks apart. Otherwise below 0.05 forward only a sideways push spins (4 times r),
  // and forward of that both sticks get the same vector, gains 8 and 8 up to 0.1 forward, then 20 sideways and 12 forward. There is no reverse. Orientation (which way is forward) is my reading, see A121
  function padSticks(r, f) {
    r = Math.max(-1, Math.min(1, r)); f = Math.max(-1, Math.min(1, f));
    if (Math.abs(r) >= 0.5 && f >= -0.5 && f <= 0.75) { const q = Math.sign(r) * 10; return [[0, q], [0, -q]]; }
    if (f < 0.05) return [[0, 4 * r], [0, -4 * r]];
    const v = f < 0.1 ? [8 * r, 8 * f] : [20 * r, 12 * f];
    return [v, v];
  }
  // 1D sticks (up = forward), the form the keyboard mix and the bots use: a vertical vector per stick
  function readSticks(L, R) { return readCtrl([0, L], [0, R]); }

  // ---- lumps (A60, A64) ----
  // MonoIbitsu.cppi: the farthest IBITSU tip of each of the last N attached objects becomes a "fluid" distort point (up to 6). Katamari.sSetPosition-style code then puts the
  // surface at len = R + (tip - R) * spd_ratio, capped at 2.5 R: lumps are full size when the ball rolls at or below its normal top speed and melt away toward dash speed.
  // N (IbitsuCheckDepth) and the cone width (LUMP_SHARP) are guesses; the rest follows the source.
  // OUJI_JUMP in the stage data: [frames at the small end, small diameter, frames at the large end, large diameter] = [12, 10, 20, 80.1]. FUN_00025d8c: frames = trunc(f0 + (f2 - f0) * clamp((diam - d0) / (d1 - d0), 0, 1)) (A89)
  const flipFrames = S => { const j = (S.ouji_jump || [12, 10, 20, 80.1]); return Math.trunc(j[0] + (j[2] - j[0]) * Math.max(0, Math.min(1, (S.diam - j[1]) / (j[3] - j[1])))); };
  const LUMP_DEPTH = 12, LUMP_MAX = 6, LUMP_SHARP = 4, LUMP_CAP = 2.5, LUMP_LIFT_MAX = 0.25;   // the picture shows the full lump, the physics ball rises at most a quarter radius (A64)
  function lumpsOf(S, R) {
    const out = [], L = S.ibiList; if (!L || !L.length) return out;
    const tp = tableParams(S), vN = tp.speed * tp.rF, vD = tp.speed * tp.rD, v = S.speed;
    const sr = v >= vD ? 0 : v <= vN ? 1 : 1 - (v - vN) / Math.max(vD - vN, 1e-6);
    for (let i = L.length - 1, seen = 0; i >= 0 && seen < LUMP_DEPTH; i--, seen++) {
      const o = L[i]; let fl = 0, fq = null;
      for (const p of S.info[o.n].ibi) { const q = mvec(o.lrot, p); q[0] += o.lpos[0]; q[1] += o.lpos[1]; q[2] += o.lpos[2]; const l = Math.hypot(q[0], q[1], q[2]); if (l > fl) { fl = l; fq = q; } }
      if (!fq || fl <= R * 1.02) continue;
      const len = Math.min(R + (fl - R) * sr, R * LUMP_CAP);
      if (len > R * 1.005) out.push({ n: [fq[0] / fl, fq[1] / fl, fq[2] / fl], k: len / R - 1 });
    }
    out.sort((a, b) => b.k - a.k); out.length = Math.min(out.length, LUMP_MAX); return out;
  }
  function lumpMult(lumps, d) { let m = 0; for (const Lp of lumps) { const c = Lp.n[0] * d[0] + Lp.n[1] * d[1] + Lp.n[2] * d[2]; if (c > 0) m = Math.max(m, Lp.k * Math.pow(c, LUMP_SHARP)); } return 1 + m; }

  // input: {L, R, dash} (stick values -1..1), or {fwd, turn} which is converted with tank(). One call = one frame.

  // ---- crumble and converge (MonoCrumble.cppi, MonoConverge.cppi, KatamariHit sGetSpeedRatio / sGetReflectionRatio) (A65) ----
  // The KPARAM values are read from the binary (A71). Speeds are relative to f32ScaleMaxSpeed = the table speed (not the dash speed)
  // MONO_PARAM (gsMonoParam, 13 floats filled by the init at FUN_00018xxx, global 0x98a14): field 0 CrumbleSpdRatio 1.63 (throw speed; not the 0.98 of KPARAM), field 7 KataCrashSpdRatio 2.9 (A100)
  const MP = { crumbleSpd: 1.63, crashSpd: 2.9, crashCap: 1.3 };
  const REFL = 0.55;   // f32Reflection: StageInfo's min and max size ratio are both 0.55 (FUN_00023f18 sets 100, 200, 0.55, 0.55; read by FUN_0001cf74, A103)
  const CR = { angle: KP.crumbleAngle, spd: KP.crumbleSpeedRatio, vol: KP.crumbleRatio, depth: KP.crumbleDepth, cosA: Math.cos(75 * Math.PI / 180), sinA: Math.sin(75 * Math.PI / 180), cool: 15, hitOff: 10, conv: KP.convergeRatio, convMin: 0.5, flyMax: 240 };   // angle, spd, vol, depth, conv are exact (A71); the rest is staging
  // speed power x angle power of one hit: ground type of sGetSpeedRatio ((v/vmax - 0.25) / 0.25) times (acos(move . wall) - 90 deg) / 90 deg
  function impactPower(vx, vz, nx, nz, vIn, vmax) {
    if (vIn < 1e-6) return 0; const inner = (vx * nx + vz * nz) / vIn; if (inner >= 0) return 0;
    const ref = (Math.acos(Math.max(-1, inner)) - Math.PI / 2) / (Math.PI / 2), sp = Math.max(0, Math.min(1, (Math.min(1, vIn / vmax) - 0.25) / 0.25));
    return sp * ref;
  }
  // Landing bounce (KatamariHit sReflection, airborne branch, A107). The ball's total move this frame (ground move plus gravity) is mirrored off the ground normal and comes back next frame:
  // sideways x 0.95, up x f32Reflection (0.55), all times the speed. Not at all if the flight was under NonReflectFlyTime (5 frames), which also kills small bounces. A hard fall also shakes objects off (power from FlyFallTime)
  const FLY_MIN = 5, FALL_MIN = 9, FALL_MAX = 70;     // s32NonReflectFlyTime, s32FlyReflectMinTime, s32FlyReflectMaxTime (kparam.json)
  function landingBounce(S, vmax, sup, nrm) {
    if (S.flyT < FLY_MIN && !S.forceReflect) return;                           // ForceReflect (a fast-ray hit) skips the NonReflectFlyTime rule
    const T = [S.v[0], S.vy, S.v[1]], V = Math.hypot(T[0], T[1], T[2]); if (V < 1e-6) return;
    let nx, ny, nz;
    if (nrm) { nx = nrm[0]; ny = nrm[1]; nz = nrm[2]; }                         // ray mode: the ground normal comes from the hit list (A147)
    else { const x = S.pos[0], z = S.pos[2], hAt = (px, pz) => { const h = supportAt(S, px, pz, sup + 3, sup + 3); return h === null ? sup : h; };
      nx = -(hAt(x + 1, z) - hAt(x - 1, z)) / 2; nz = -(hAt(x, z + 1) - hAt(x, z - 1)) / 2; const nl = Math.hypot(nx, 1, nz); nx /= nl; nz /= nl; ny = 1 / nl; }
    const wallHit = !!(S.ray && S.hitWallN);                                    // KSTAT HitWall: the wall normal joins the ground normal (fvWall = normalize(vGroundNorm + fvWallNorm))
    if (wallHit) { nx += S.hitWallN[0]; ny += S.hitWallN[1]; nz += S.hitWallN[2]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; }
    const d = [T[0] / V, T[1] / V, T[2] / V], inner = d[0] * nx + d[1] * ny + d[2] * nz; if (inner >= 0) return;
    const refp = (Math.acos(Math.max(-1, inner)) - Math.PI / 2) / (Math.PI / 2); if (refp <= 0) return;
    const r = [d[0] - 2 * inner * nx, d[1] - 2 * inner * ny, d[2] - 2 * inner * nz];
    const half = S.forceReflect && wallHit ? 0.5 : 1;                            // sw_force_sub_spd: forced reflection with a wall hit halves f32Velocity first
    if (wallHit) { S.reflV = [r[0] * REFL * V * half, r[2] * REFL * V * half]; S.reflVy = r[1] * REFL * V * half; }   // a wall hit takes the wall branch: f32Reflection x f32Velocity on all three axes
    else { S.reflV = [r[0] * 0.95 * V, r[2] * 0.95 * V]; S.reflVy = r[1] * REFL * V; }
    dashCancel(S);                                           // gYm_OujiDashCancel
    // sGetSpeedRatio: a forced reflection uses the speed type (0 to 1 over a quarter of the top speed), otherwise the fall time
    const spd = S.forceReflect ? Math.max(0, Math.min(1, (Math.min(1, V / vmax) - 0.25) / 0.25)) : Math.max(0, Math.min(1, (S.fallT - FALL_MIN) / (FALL_MAX - FALL_MIN)));
    const crumbleOn = !(S.forceReflect && !wallHit) && !(S.fastHit && S.ib && S.ib.st);   // sw_crumble is off for ForceReflect without a wall hit; HitFast during a lump rock zeroes the power
    if (spd * refp > 0 && crumbleOn) crumbleHit(S, spd * refp, V, vmax);
    S.events.push({ type: 'bounce', v: S.reflVy, fall: T[1] });
  }
  function crumbleHit(S, total, vIn, vmax) {                 // gYm_MonoCrumble
    if (total <= CR.angle || S.crumbleCool > 0) return;
    const smin = vmax * CR.spd, cs = Math.max(0, Math.min(vIn, vmax) - smin) / (vmax - smin); if (cs <= 0) return;
    const power = (total - CR.angle) / (1 - CR.angle);
    crumbleVol(S, CR.vol * S.volume * power * cs, power);
  }
  function crumbleVol(S, vol, power) {                       // sCrumble: newest objects first, big ones soak up the hit and carry the rest over
    let depth = CR.depth, n = 0;
    for (let i = S.attached.length - 1; i >= 0 && depth > 0; i--) {
      const o = S.attached[i];
      if (o.crumbleVol > vol) o.crumbleVol -= vol;
      else { crumbleOne(S, i, power); n++; vol -= o.addVol; if (vol <= 0) break; }
      depth--;
    }
    if (n) { S.crumbleCool = CR.cool; S.crumbled += n; S.events.push({ type: 'crumble', n }); }
  }
  // sCheckHoldInWall (KatamariHit.cppi): the ball squeezed between walls sheds a little. 3 wall hits, or 2 walls more than 150 degrees apart, or opposing walls on three frames in a row
  // (first and second 138 degrees or more apart, first and third within 5 degrees) count as held; each held frame sheds 0.008 of the crumble volume and one lump object (35% of the crumble volume off its own),
  // and after 15 held frames in a row a 0.5 crumble if nothing else crumbled that frame. Not ported: the move nudge and the position adjust of sAdjustPosi (they need the engine's hit lists, A137), and mYm_MonoCheck_Crumble
  const HOLD = { hist: 3, ang2: 150 * Math.PI / 180, angFace: 138 * Math.PI / 180, angSame: 5 * Math.PI / 180, time: 15, tiny: 0.008, half: 0.5, lump: 0.35 };
  function holdInWall(S, walls, crumbledBefore) {
    const h = S.holdHist; let wn = [0, 0];
    for (const w of walls) { wn[0] += w.n[0]; wn[1] += w.n[1]; }
    const wl = Math.hypot(wn[0], wn[1]); if (wl > 1e-9) wn = [wn[0] / wl, wn[1] / wl]; else wn = [0, 0];
    h.unshift({ wc: walls.length, n: wn }); h.length = HOLD.hist;
    const acos = v => Math.acos(Math.max(-1, Math.min(1, v)));
    let count = false;
    if (walls.length > 1) {
      if (walls.length >= 3) { holdCrumble(S); count = true; }
      else {
        if (S.holdTime !== 0) count = true;
        if (walls.length === 2 && acos(walls[0].n[0] * walls[1].n[0] + walls[0].n[1] * walls[1].n[1]) > HOLD.ang2) { holdCrumble(S); count = true; }
      }
    }
    if (h[0] && h[1] && h[2] && h[0].wc && h[1].wc && h[2].wc) {
      if (acos(h[0].n[0] * h[1].n[0] + h[0].n[1] * h[1].n[1]) >= HOLD.angFace && acos(h[0].n[0] * h[2].n[0] + h[0].n[1] * h[2].n[1]) < HOLD.angSame) { count = true; holdCrumble(S); }
    }
    if (!count) { S.holdTime = 0; S.holdIn = false; return; }
    S.holdIn = true; S.holdTime++;
    if (S.holdTime >= HOLD.time) {
      if (S.crumbled === crumbledBefore) crumbleVol(S, HOLD.half * CR.vol * S.volume, HOLD.half);
      S.holdTime = 1;
    }
  }
  function holdCrumble(S) {                                  // sCrumbleHoldInWall
    crumbleVol(S, HOLD.tiny * CR.vol * S.volume, HOLD.tiny);
    for (let i = 0; i < S.ibiList.length; i++) {            // one lump object per call: gYm_MonoCrumbleForceMono(mc, 1.0, 0.35)
      const o = S.ibiList[i]; if (S.holdSeen.has(o)) continue; S.holdSeen.add(o);
      o.crumbleVol -= CR.vol * S.volume * HOLD.lump;
      if (o.crumbleVol <= 0) { const k = S.attached.indexOf(o); if (k >= 0) { crumbleOne(S, k, 1.0); S.crumbled++; S.events.push({ type: 'crumble', n: 1 }); } }
      break;
    }
  }
  function crumbleOne(S, i, power) {                         // sCrumbleOneMono: volume comes off, the object leaves the ball and is thrown away from the centre
    const o = S.attached[i]; S.attached.splice(i, 1);
    const k = S.ibiList.indexOf(o); if (k >= 0) S.ibiList.splice(k, 1);
    const wp = mvec(S.R, o.lpos), wr = mmul(S.R, o.lrot);
    o.pos = [S.pos[0] + wp[0], S.pos[1] + wp[1], S.pos[2] + wp[2]]; o.rot = wr; o.ppos = null;
    grow(S, -Math.min(o.addVol, S.volume * 0.5)); S.picked--;
    const h = Math.hypot(wp[0], wp[2]) || 1, tp = tableParams(S), spd = tp.speed * tp.rF * (0.6 + 0.4 * power) * MP.crumbleSpd;   // sGetCrumbleVector: _R_BASE 0.6 + _R_RANGE 0.4 * power, times the max forward speed and MONO_PARAM CrumbleSpdRatio 1.63 (A100, was the KPARAM 0.98)
    o.vel = [wp[0] / h * spd * CR.cosA, spd * CR.sinA, wp[2] / h * spd * CR.cosA];   // launch angle _A_BASE 75 degrees (sign of the source's rotX pair is my reading, A80)
    o.spin = { ax: o.vel[0] > o.vel[2] ? [0, 0, 1] : [1, 0, 0], w: 0.2 };   // gNk_StartMonoForceMove: spin 0.2 rad per frame about Z when vx > vz, else X
    o.state = 'fly'; o.flyT = 0; o.hitOff = S.frame + CR.hitOff; o.crumbleVol = 0; o.path = null;
  }
  function flyMonos(S) {                                     // thrown objects: ballistic until they reach the floor, then they lie there and can be caught again
    for (const o of S.objs) {
      if (o.state !== 'fly') continue;
      o.ppos = o.pos.slice(); o.vel[1] -= gravity(S); o.flyT++;
      for (let q = 0; q < 3; q++) o.pos[q] += o.vel[q];
      o.rot = mmul(axisAngle(o.spin.ax, o.spin.w), o.rot);
      const bottom = o.pos[1] + o.lo[1], sup = o.vel[1] <= 0 ? supportAt(S, o.pos[0], o.pos[2], bottom + Math.abs(o.vel[1]) + 1, bottom + Math.abs(o.vel[1]) + 1) : null;
      if (sup !== null && bottom <= sup) { o.pos[1] = sup - o.lo[1]; land(o); }
      else if (o.flyT > CR.flyMax || o.pos[1] < -5000) { o.state = 'gone'; }   // fell off the map
    }
  }
  function land(o) { o.state = 'map'; o.rot = o.rotHome; o.top = o.pos[1] + o.hi[1]; o.ppos = null; o.vel = null; }
  // MonoConverge: a lump dragging on the ground pulls the objects near it in toward the centre, harder the faster the ball goes
  function converge(S, R, vmax) {
    if (!S.lumps.length || S.lift < 1e-3) return;
    const ratio = 1 - (S.speed / vmax) * CR.conv; if (ratio >= 1) return;
    const dn = mvec(mtr(S.R), [0, -1, 0]);
    for (const L of S.lumps) {
      if (L.n[0] * dn[0] + L.n[1] * dn[1] + L.n[2] * dn[2] < 0.6) continue;           // this lump is the one on the ground
      for (const a of S.attached) {
        const m = Math.hypot(a.lpos[0], a.lpos[1], a.lpos[2]); if (m < CR.convMin * R) continue;
        if ((a.lpos[0] * L.n[0] + a.lpos[1] * L.n[1] + a.lpos[2] * L.n[2]) / m < 0.7) continue;      // near this lump
        a.lpos = [a.lpos[0] * ratio, a.lpos[1] * ratio, a.lpos[2] * ratio];
      }
    }
  }

  // gYm_MonoConverge (MonoConverge.cppi, A152), ray mode: every frame, each ground hit that names a distort point pulls the attached objects whose NearIbitsuNo is that point toward the
  // ball centre (mLocal translation x f32ConvergeRatio, 1 - velocity / max speed * IbitsuConvergeRatio). The near point is chosen at pickup (sGetNearIbitsuNo): the distort point (1 to 24)
  // whose direction is closest to the direction from the ball to the object. The fluid points also pull their own object in for each ground hit
  function nearIbitsu(S, o) {
    const w = mvec(S.R, o.lpos), l = Math.hypot(w[0], w[1], w[2]) || 1; let best = -1, bi = -1;
    for (const q of S.dpts || []) { if (q.i < 1 || !q.n) continue; const d = (q.n[0] * w[0] + q.n[1] * w[1] + q.n[2] * w[2]) / l; if (d > best) { best = d; bi = q.i; } }
    return bi;
  }
  function convergeRay(S, vmax, hits) {
    const ratio = 1 - Math.hypot(S.speed, S.dy) / Math.max(vmax, 1e-6) * CR.conv; if (ratio >= 1 || !hits.length) return;
    for (const h of hits) {
      if (typeof h.di !== 'number' || h.di < 1) continue;
      for (const a of S.attached) if (a.near === h.di) a.lpos = [a.lpos[0] * ratio, a.lpos[1] * ratio, a.lpos[2] * ratio];
    }
    const hn = hits.map(h => typeof h.di === 'number' ? h.di : -1);
    for (let j = 0; j < IB_FLUID_N; j++) if (hn[j] === IB_FLUID0 + j) for (let k = 0; k < hits.length; k++) { const pt = (S.dpts || []).find(q => q.i === IB_FLUID0 + j); if (pt && pt.o && pt.o.state === 'ball') pt.o.lpos = pt.o.lpos.map(v => v * ratio); }
  }
  // KatamariMain.cppi sControl: max speed ratio by how far the stick is pushed. Below Sect1 it ramps up to HalfSpeedRatio, up to Sect2 it stays there,
  // above Sect2 the source formula (with its operator precedence, which the binary keeps) gives Half + (1 - Half * t): 1.4 at Sect2 falling to 1.0 at full tilt
  function tiltFactor(p) {
    if (p < KP.tilt1) return KP.halfSpeed * (p / KP.tilt1);
    if (p < KP.tilt2) return KP.halfSpeed;
    return KP.halfSpeed + (1 - KP.halfSpeed * ((p - KP.tilt2) / (1 - KP.tilt2)));
  }

  function step(S, input) {
    S.frame++; S.events.length = 0; moveMonos(S); flyMonos(S); animMonos(S); if (S.crumbleCool > 0) S.crumbleCool--;
    let inp = input.L !== undefined ? input : Object.assign(tank(input.fwd || 0, input.turn || 0), { dash: input.dash, tap: input.tap, flip: input.flip, P: input.fwd ? Math.abs(input.fwd) : undefined });
    const R = radius(S), stepUp = Math.max(0.5 * R, 1.0), climb = Math.max(CLIMB * R, 1.0), tp = tableParams(S);
    const cw = S.cw, cwWasOn = cw.on, stepW = cw.on ? 0.05 : stepUp, climbW = cw.on ? 0.05 : climb;   // while climbing the ball has to get fully above a ledge: no step-up allowance
     if (cw.forbid > 0) cw.forbid--;                    // sUpdateTime
    const cwOff = () => { if (cw.on) { if (cw.eff <= 0) { cw.forbid = CW.forbid; } else { cw.eff--; return; } } cw.on = false; cw.top = false; cw.startY = 0; cw.topT = 0; };   // gYm_KatamariDisableClimbWall
    // lumps lift the ball: the surface point that faces down decides how high the centre rides. Eased so it does not jitter (A64)
    S.lumps = lumpsOf(S, R); { const dn = mvec(mtr(S.R), [0, -1, 0]), want = S.lumps.length && !S.ray ? Math.min((lumpMult(S.lumps, dn) - 1) * R, LUMP_LIFT_MAX * R) : 0; S.lift += (want - S.lift) * 0.3; if (S.lift < 1e-4) S.lift = 0; }
    if (S.ctrlOff > 0) { S.ctrlOff--; inp = { L: 0, R: 0, dash: false, flip: false }; }   // OujiControlDisableTime: no prince input for a few frames after a crush (A100)
    S.pos[1] -= S.liftApplied; S.liftApplied = 0;   // the physics below runs on the round ball; the lift is added back at the end of the step
    // single stick (inp.sx, inp.sz, x right, z forward): both sticks carry the same vector (A121). Otherwise two vertical sticks L and R
    const pad = inp.pad ? padSticks(inp.pad[0], inp.pad[1]) : null;
    const st = pad ? readCtrl(pad[0], pad[1]) : inp.sx !== undefined ? readCtrl([inp.sx, inp.sz], [inp.sx, inp.sz]) : readSticks(inp.L, inp.R);
    // The two-stick average power drops when you steer (one stick lower), which with the 0.4 plateau of the speed curve made steering crawl. The original's one-stick path (Ctrl4 combined stick) has no such drop, so single-stick and keyboard input pass their own push strength (A75)
    if (!pad && inp.sx === undefined && inp.P !== undefined && st.dir !== 0) st.power = Math.max(0, Math.min(1, inp.P));
    // quick turn (OSTAT Jump180): the original has a U-turn button at the bottom centre of the screen. Pressing it makes the prince hop over the ball and face the other way.
    // Timing is guessed (A66)
    if (inp.flip && !S.flipHeld && S.flipT === 0) { S.flipN = flipFrames(S); S.flipT = S.flipN; S.flipYaw0 = S.yaw; S.events.push({ type: 'flip' }); }
    S.flipHeld = !!inp.flip;
    if (S.flipT > 0) { S.yaw += Math.PI / S.flipN; S.flipT--; } else S.yaw += st.turn;
    // OUJI_STAT_MOVETURN (OujiCtrl4 sTurn90 while the ball is moving): the velocity turns with the prince and drag drops to MoveTurnRegistRatio (A76)
    const moveTurn = !!st.moveTurn && S.flipT === 0 && Math.hypot(S.v[0], S.v[1]) > 1e-3;
    if (moveTurn) { const c = Math.cos(st.turn), n = Math.sin(st.turn), ox = S.v[0], oz = S.v[1]; S.v[0] = ox * c + oz * n; S.v[1] = oz * c - ox * n; }
    S.input = { L: inp.L, R: inp.R, turn: st.turn, power: st.power };
    // dash: the real stroke gesture (OujiDash.cppi sDashNormal, A120). A tap is a stroke; taps no more than DASH.stroke frames apart keep the count going. At `start` strokes the wheel spin begins (no acceleration, speed builds by accD per frame),
    // at start + wheelStrokes(diameter) the dash begins and the ball is launched at the wheel spin speed. Dash ends when the strokes stop (OUJI_DASH_DURATION_TIME = 1), on a brake input, or after maxDur frames of stroking, then `forbid` frames of nothing.
    {
      const ds = S.dS;
      let tap = inp.tap;
      if (tap === undefined) {   // a held dash key or button taps by itself every DASH.repeat frames
        const h = !!inp.dash;
        if (!h) { S.dashLock = false; S.dashRep = 0; tap = false; }
        else if (S.dashLock) tap = false;
        else { tap = !S.dashHeld || ++S.dashRep >= DASH.repeat; if (tap) S.dashRep = 0; }
        S.dashHeld = h;
      } else S.dashLock = false;
      ds.start = false;
      if (ds.forbid) {
        dashCancel(S, true); ds.w = 0;
        if (--ds.fw <= 0) { ds.forbid = false; ds.fw = 0; ds.dur = DASH.maxDur; }
      } else if (!ds.spin && S.flyT >= FLY_MIN) dashCancel(S, true);   // KSTAT Fly: guess, A120c
      else {
        let ended = false;
        if (ds.n !== 0 && ds.on && --ds.dur <= 0) { ended = true; ds.forbid = true; ds.fw = DASH.forbid; ds.dur = DASH.maxDur; ds.w = 0; dashCancel(S, true); }
        if (!ended) {
          let trig = false;
          if (tap) { ds.dw = DASH.dw; ds.w = DASH.stroke; ds.n++; trig = true; }
          if (ds.w !== 0) {
            ds.w--;
            const c1 = DASH.start, c2 = c1 + wheelStrokes(S.diam);
            if (ds.n === c2 && trig) { ds.start = true; S.events.push({ type: 'dash' }); }
            if (ds.n === c1 && trig) S.events.push({ type: 'spin' });
            if (ds.n >= c2) { ds.spin = false; ds.on = true; } else if (ds.n >= c1) { ds.spin = true; ds.on = true; }
          } else {
            let stat = true;
            if (ds.on) { ds.dw--; if (ds.dw > 0) stat = false; }
            if (ds.spin) { ds.dw = 0; stat = true; }
            ds.n = 0;
            if (stat) { ds.spin = false; ds.on = false; }
          }
        }
      }
      S.dash = ds.on; S.wheelSpin = ds.spin;
      S.dashT = ds.forbid ? 0 : DASH.maxDur - ds.dur; S.dashCool = ds.forbid ? ds.fw : 0;   // for the HUD meter: budget spent, or forbid time left
      if (S.crushCool > 0) S.crushCool--;
      // sWheelSpin: speed builds while spinning (and on the start frame), capped at the dash top speed
      if (ds.spin || ds.start) S.wheelSpd = Math.min(S.wheelSpd + tp.accD, tp.speed * tp.rD); else S.wheelSpd = 0;
      if (ds.start) { const sp = S.wheelSpd; S.v[0] = Math.sin(S.yaw) * sp; S.v[1] = Math.cos(S.yaw) * sp; }   // sSetDashParam: velocity = wheel spin speed, along prince to ball
    }
    // acceleration along the facing direction, capped at the table speed (sControl)
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    let acc = 0, ratio = 0, dir = S.flipT > 0 ? 0 : S.dash ? 1 : st.dir, power = st.power;   // a dash pushes along the prince's facing whatever the sticks do (sControl: Dash gives fpow 1)
    if (S.dash) { power = 1; acc = S.wheelSpin ? 0 : tp.accD; ratio = tp.rD; }
    else if (dir !== 0 && st.mdir >= 0) {   // sControl: acceleration by move direction (front, back, side), max speed ratio blends toward the side ratio by f32MaxSpeedRatio
      acc = [tp.accF, tp.accB, tp.accS][st.mdir] * power;
      ratio = (st.mdir === 0 ? tp.rS + (tp.rF - tp.rS) * st.msr : tp.rS + (tp.rB - tp.rS) * st.msr) * tiltFactor(power);
    }
    const fmax = tp.speed * ratio * (cw.on ? CW.maxSpd : 1);   // sControl: fmax *= MaxSpdRatio while climbing
    let vx = S.v[0], vz = S.v[1]; const oldMag = Math.hypot(vx, vz);
    if (S.reflV) { vx = S.reflV[0]; vz = S.reflV[1]; S.reflV = null; S.dy = 0; if (S.reflVy !== undefined) { S.vy = S.reflVy; S.reflVy = undefined; } }   // last frame's wall bounce replaces the new move (sControl copies vReflection into fvDelta, A103)
    else if (dir !== 0) {
      const pa = S.yaw + (st.mdir >= 0 ? st.phi : 0); let ix = Math.sin(pa), iz = Math.cos(pa), iy = 0;   // the push is the prince's facing turned by the stick angle (mInput->rotY)
      if (S.ray && cw.on && cw.norm) { ix = -cw.norm[0]; iz = -cw.norm[1]; }          // sControl: while climbing the acceleration is straight into the wall (fvClimbWallNorm x -facc, y 0), whatever the stick angle (A151)
      else if (S.ray && S.grounded && S.gNorm && S.gNorm[1] < 0.9999 && S.gNorm[1] > 0.01) {   // sControl, HitGround: the input vector is taken into the ground plane and normalised, so on a slope the push has a vertical part (A151)
        const n = S.gNorm, d = ix * n[0] + iz * n[2]; let hx = ix - n[0] * d, hy = -n[1] * d, hz = iz - n[2] * d; const hl = Math.hypot(hx, hy, hz);
        if (hl > 1e-5) { ix = hx / hl; iy = hy / hl; iz = hz / hl; }
      }
      // sCheckBreakInput: the input has to point within BrakeAngle (30 degrees) of straight against the motion. A brake starts only above BrakeSpeedRatio (45%)
      // of the max speed for the direction the ball is travelling relative to the prince (front, back or side), and then holds until the input stops opposing
      let braking = false;
      if (oldMag > 1e-4 && (ix * -vx + iz * -vz) / oldMag >= BRAKE_COS) {
        const along = (fx * vx + fz * vz) / oldMag, grp = along > 0.7 ? (S.dash ? 'D' : 'F') : along < -0.7 ? 'B' : 'S', mspd = tp.speed * tp['r' + grp];
        braking = S.brake || oldMag >= KP.brakeSpeedRatio * mspd;
        if (braking && !S.brake) S.brakeEffect = tp['brake' + grp];   // chosen when the brake starts, by which way the ball travels (sCheckBreakInput)
      }
      if (braking && !S.brake && S.flipT === 0) S.events.push({ type: 'brake' });   // first brake frame, not during the U-turn hop (sCheckBreakInput, A101)
      S.brake = braking;
      if (braking) { const b = S.brakeEffect * power; vx -= vx / oldMag * b; vz -= vz / oldMag * b; }
      else {
        vx += ix * acc; vz += iz * acc; S.dy += iy * acc; const nm = Math.hypot(vx, S.dy, vz), om3 = Math.hypot(oldMag, S.dy - iy * acc);
        if (nm > fmax && nm > om3) { const keep = om3 < fmax || cw.on ? fmax : om3; vx = vx / nm * keep; vz = vz / nm * keep; S.dy = S.dy / nm * keep; }   // same overshoot rule as the engine; while climbing the cap is the climb max speed (sControl)
      }
    }
    if (!(S.ray && (cw.on || !S.grounded))) { const dr = moveTurn ? DRAG * KP.moveTurnRegist : DRAG; vx *= 1 - dr; vz *= 1 - dr; S.dy *= 1 - dr; }   // sRegistance: no drag in the air (Fly); sControl: none while climbing (A151)
    if (cw.on) { S.dy = 0; if (S.climbLock && S.ray && cw.norm) { const d = vx * cw.norm[0] + vz * cw.norm[1]; vx = cw.norm[0] * d; vz = cw.norm[1] * d; } }   // optional (off by default): the ball goes straight into the wall while it climbs, no sideways slide
    if (Math.hypot(vx, vz) < 1e-3) { vx = 0; vz = 0; }
    const vx0 = vx, vz0 = vz, vIn = Math.hypot(vx, vz), vmax = tp.speed; let hitPow = 0;   // incoming velocity, for crumble
    const bottom = S.pos[1] - R;
    const oldP = S.pos.slice();                                                        // position at the start of the frame (old position of the ray segments)
    const ok = S.ray ? () => true : (x, z) => supportAt(S, x, z, bottom + stepW, bottom + climbW) !== null;   // ray mode (A147): the move is free, the rays correct it
    let dx = vx, dz = vz, moved = 0, mx = 0, mz = 0;
    if (cw.on && cw.top) { dx = 0; dz = 0; }                                          // at the top the move is not added (sControl)
    // wall contacts this step, one entry per distinct normal (u16HitCount[1] counts wall faces; A98: flat walls made of many triangles count once)
    const walls = [], addWall = (nx, nz, o) => { for (const w of walls) if (w.n[0] * nx + w.n[1] * nz > 0.99) { if (o && !w.o) w.o = o; return; } walls.push({ n: [nx, nz], o: o || null }); };
    const topAt = (x, z) => supportAt(S, x, z, bottom + 6 * R, bottom + 6 * R);
    const wallAt = (x, z) => { const g = topAt(x, z); return g !== null && g > bottom; };   // higher ground ahead is a wall, no ground at all is an edge
    // outward normal (toward the ball) of the obstacle that stopped a move toward (px, pz): minus the horizontal gradient of the highest surface around that point, so a slanted wall gives a slanted normal.
    // Falls back to straight back along the move when the surface is flat there (A103)
    const blockN = (px, pz, mx, mz) => {
      const e = Math.max(R * 0.3, 0.5), h = (x, z) => { const g = topAt(x, z); return g === null ? bottom - 10 : g; };
      let gx = h(px + e, pz) - h(px - e, pz), gz = h(px, pz + e) - h(px, pz - e); const gl = Math.hypot(gx, gz);
      if (gl > 1e-6) { gx = -gx / gl; gz = -gz / gl; if (gx * mx + gz * mz < 0) return [gx, gz]; }
      const ml = Math.hypot(mx, mz) || 1; return [-mx / ml, -mz / ml];
    };
    const addBlock = (mx, mz) => { if (!(mx || mz) || !wallAt(S.pos[0] + mx, S.pos[2] + mz)) return; const n = blockN(S.pos[0] + mx, S.pos[2] + mz, mx, mz); addWall(n[0], n[1], null); };
    const ibReset = () => { const b = S.ib; b.st = 0; b.no = -1; b.len = R; b.vec = [0, 0, 0]; b.rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; };   // gYm_KataHitResetIbitsu
    if (S.ray && S.wheelSpin) ibReset();                                              // gYm_KatamariIbitsu: wheel spin resets the lumps
    const rocking = !!(S.ray && S.ib.st && !cw.on);                                  // FLUID state: the ball swings about the planted lump tip instead of moving freely (gYm_KatamariIbitsuMakeMatrix)
    if ((dx || dz) && !rocking) {
      const nx = S.pos[0] + dx, nz = S.pos[2] + dz;
      if (ok(nx, nz)) { S.pos[0] = nx; S.pos[2] = nz; mx = dx; mz = dz; }
      else if (ok(S.pos[0] + dx, S.pos[2])) { S.pos[0] += dx; mx = dx; vz *= 0.3; addBlock(0, dz); }
      else if (ok(S.pos[0], S.pos[2] + dz)) { S.pos[2] += dz; mz = dz; vx *= 0.3; addBlock(dx, 0); }
      else { vx *= 0.3; vz *= 0.3; addBlock(dx, 0); addBlock(0, dz); }
      moved = Math.hypot(mx, mz);
    }
    // solid objects: anything too big to pick up is a box (P8). Low ones are rolled over (P9). Ray mode (A150): the ray hits against the boxes replace this push, the knock stays
    const diamMm = S.diam * 10;
    const knock = o => {
      if (o.path && o.ppos) {                                                     // sMovingMono: a moving object that runs into the ball knocks it along its move direction (A100)
        const mvx = o.pos[0] - o.ppos[0], mvz = o.pos[2] - o.ppos[2], ml = Math.hypot(mvx, mvz);
        if (ml > 1e-9) {
          const mnx = mvx / ml, mnz = mvz / ml, kx = S.pos[0] - o.pos[0], kz = S.pos[2] - o.pos[2], kl = Math.hypot(kx, kz) || 1;
          if (kx / kl * mnx + kz / kl * mnz > 0) {
            const sp = Math.min(ml * MP.crashSpd, tp.speed * tp.rD * MP.crashCap);
            vx = mnx * sp; vz = mnz * sp; dashCancel(S, true); S.ctrlOff = 10; S.events.push({ type: 'crush' });
          }
        }
      }
    };   // sMovingMono (A100); in ray mode it runs for the objects whose box a ray hit
    for (const o of S.objs) {
      if (S.ray && S.rayObjs) break;
      if (o.state !== 'map' || o.catchMm <= diamMm) continue;
      if (o.top <= bottom + climbW) continue;
      if (Math.hypot(o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]) > R + o.maxlen) continue;
      const bc = boxClosest(o, S.pos); if (bc.dist >= R || bc.dist < 1e-6) continue;
      const nx = S.pos[0] - bc.p[0], nz = S.pos[2] - bc.p[2], hl = Math.hypot(nx, nz); if (hl < 1e-6) continue;
      knock(o);
      const push = (R - bc.dist) / bc.dist, px = S.pos[0] + (S.pos[0] - bc.p[0]) * push, pz = S.pos[2] + (S.pos[2] - bc.p[2]) * push;
      if (ok(px, pz)) { S.pos[0] = px; S.pos[2] = pz; const ux = nx / hl, uz = nz / hl; addWall(ux, uz, o); const vn = vx * ux + vz * uz; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, ux, uz, vIn, vmax)); vx -= vn * ux; vz -= vn * uz; } }
    }
    // walls from the collision mesh
    let noClimb = false;                                                              // HIT_ATTR_DISABLE_CLIMB: a hit polygon with this attribute turns the wall climb off for the frame (sAttribute, KatamariHit.cppi); the attribute value is taken to be kind 2 (P17b)
    let meshTop = -1e9;
    if (S.ray) {
      // ray mode (A147): the whole frame's move, then the engine's rays (sGround), then sAdjustPosi
      if (S.grounded || cw.on) { S.flyT = 0; S.fallT = 0; } else { S.flyT++; if (S.vy < 0) S.fallT++; }   // sStatFly bookkeeping on last frame's state
      if (rocking) {
        const b = S.ib, d = Math.hypot(b.vec[0], b.vec[1], b.vec[2]), mh = Math.hypot(vx, vz);
        let w = d <= 1e-4 ? 0 : mh / d; w = Math.max(-Math.PI, Math.min(Math.PI, w));
        if (w > 0 && mh > 1e-9) {
          const m = axisAngle([vz / mh, 0, -vx / mh], w); b.rot = mmul(m, b.rot); S.R = mmul(m, S.R);   // mDistortRot = m x mDistortRot, mRot = m x mRot
        }
        const v = mvec(b.rot, [-b.fluidVec[0], -b.fluidVec[1], -b.fluidVec[2]]); S.pos = [b.posi[0] + v[0], b.posi[1] + v[1], b.posi[2] + v[2]]; S.vy = 0; moved = 0;
      } else { const g = cw.on ? 0 : gravity(S); S.vy = cw.on ? 0 : S.vy - g; S.pos[1] += S.vy + (cw.on ? 0 : S.dy); }
      S.dpts = distortPoints(S, R, S.pos, vIn, cw.on);
      const c = rayContacts(S, R, oldP, { stop: false, pts: S.dpts });
      S.lastRay = { c, old: oldP };
      for (const o of c.monos) knock(o);                                              // a moving object whose box a ray hit knocks the ball along (sMovingMono)
      { const nh = c.ground.length + c.wall.length; if (nh > (S.maxHits || 0)) S.maxHits = nh; S.hitHist = S.hitHist || []; S.hitHist[nh] = (S.hitHist[nh] || 0) + 1; }   // diagnostic: hits per frame, for the _MAX_HITINFO question (A146)
      S.forceReflect = c.fastHit; S.fastHit = c.fastHit; S.edgeHit = c.edge; { let wx = 0, wy = 0, wz = 0; for (const h of c.wall) { wx += h.n[0]; wy += h.n[1]; wz += h.n[2]; } const wl = Math.hypot(wx, wy, wz); S.hitWallN = wl > 1e-9 ? [wx / wl, wy / wl, wz / wl] : null; }   // fvWallNorm of this frame (null: no wall hit, KSTAT HitWall off)
      if (c.fast) S.fastFrames = (S.fastFrames || 0) + 1;   // KSTAT ForceReflect / HitFast: a hit by the swept fast rays forces the reflection (no NonReflectFlyTime skip) and, with ground only, no crumble
      S.pos[0] -= c.total[0]; S.pos[1] -= c.total[1]; S.pos[2] -= c.total[2];
      let gx = 0, gy = 0, gz = 0; for (const h of c.ground) { gx += h.n[0]; gy += h.n[1]; gz += h.n[2]; }
      const gl = Math.hypot(gx, gy, gz), hitG = c.ground.length > 0 && !cw.on; if (gl > 1e-9) S.gNorm = [gx / gl, gy / gl, gz / gl];
      let boxG = false;
      const supO = S.rayObjs ? null : supportAt(S, S.pos[0], S.pos[2], 0, S.pos[1] - R + climbW + Math.max(0, -S.vy), true);                                                              // objects too big to pick up are part of the ray hits now (A150): their tops come back as ground hits
      if (supO !== null && S.pos[1] - R <= supO) { if (S.vy < 0 && !S.grounded && !hitG && !cw.on && !S.reflV && !S.noReflect) landingBounce(S, vmax, supO, [0, 1, 0]); S.pos[1] = supO + R; S.vy = 0; boxG = true; }
      if (hitG && S.vy < 0) { if (!S.grounded && !boxG && !cw.on && !S.reflV && !S.noReflect) landingBounce(S, vmax, 0, S.gNorm); S.vy = 0; }
      S.grounded = !cw.on && (hitG || boxG); S.rampLift = hitG && !c.ground.some(h => h.n[1] > 0.9999);
      // sGetHitInfo + sReaction + sCheckDistort (A148): the ground hit that touches first (smallest ratio) names the distort point that may start or continue a lump rock
      { const b = S.ib; let no = -1, mr = 2, hv = null, hp = null;
        for (const h of c.ground) if (h.r < mr) { mr = h.r; no = h.di; hv = h.vec; hp = h.hp; }
        if (b.st) { b.posi = [b.posi[0] - c.adjW[0], b.posi[1] - c.adjW[1], b.posi[2] - c.adjW[2]]; }   // fvDistortPosi -= fvAdjustWall
        let check = -1, dlen = R, cross = null, vec = null;
        if (no >= 0) {
          const pt = S.dpts.find(q => q.i === no);
          if (b.st) { if (no !== b.no) { check = no; dlen = pt ? pt.f32Len : R; vec = hv; cross = [hp[0] + hv[0] * 0.005, hp[1] + hv[1] * 0.005, hp[2] + hv[2] * 0.005]; } else check = b.no; }
          else { check = no; dlen = pt ? pt.f32Len : R; vec = hv; cross = hp; }
        } else if (hv) vec = hv;
        if (c.ground.length + c.wall.length === 0) ibReset();                          // no hit at all: back to the free ball
        else {
          let res = 0;
          if (check > 0) { if (check === b.no) res = 2; else if (dlen / R > 1) { res = 1; } }
          if (res === 0) ibReset();
          else if (res === 1) {
            const pt = S.dpts.find(q => q.i === check);
            if (check >= IB_FLUID0 && pt && pt.n) {                                     // sInitFluidIbitsu; the fixed points never get here (their f32Len is R)
              b.st = 2; b.no = check; b.len = dlen; b.fluidVec = [pt.n[0] * pt.f32Len, pt.n[1] * pt.f32Len, pt.n[2] * pt.f32Len];
              b.rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; b.vec = [vec[0] * 1.05, vec[1] * 1.05, vec[2] * 1.05];
              b.posi = [S.pos[0] + b.vec[0], S.pos[1] + b.vec[1], S.pos[2] + b.vec[2]]; S.events.push({ type: 'ibitsu', len: dlen / R });
            } else ibReset();
          } else if (res === 2 && c.total[1] >= 1) b.posi[1] -= c.total[1];            // moving platform
        }
      }
      for (const h of c.wall) {
        const hl = Math.hypot(h.n[0], h.n[2]); if (hl < 0.3) continue;                 // ceilings and undersides do not count as wall faces for the climb and hold rules (A143)
        const nx = h.n[0] / hl, nz = h.n[2] / hl;
        if (!h.mono && S.hit.kind && S.noClimbKinds.has(S.hit.kind[h.pt])) noClimb = true;
        if (h.mono) meshTop = Math.max(meshTop, h.mono.top); else { const T3 = S.hit.tris, o3 = h.pt * 9; meshTop = Math.max(meshTop, T3[o3 + 1], T3[o3 + 4], T3[o3 + 7]); }
        addWall(nx, nz, h.mono || null); const vn = vx * nx + vz * nz;
        if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, nx, nz, vIn, vmax)); vx -= vn * nx; vz -= vn * nz; }
      }
    } else for (const n of hitWalls(S, R, false, cw.on ? 0.05 : undefined)) { if (S.hit.kind && S.noClimbKinds.has(S.hit.kind[n[2]])) noClimb = true; { const T3 = S.hit.tris, o3 = n[2] * 9; meshTop = Math.max(meshTop, T3[o3 + 1], T3[o3 + 4], T3[o3 + 7]); } addWall(n[0], n[1], null); const vn = vx * n[0] + vz * n[1]; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, n[0], n[1], vIn, vmax)); vx -= vn * n[0]; vz -= vn * n[1]; } }
    const crumbled0 = S.crumbled;
    if (hitPow > 0 && !cw.on && !cwWasOn) crumbleHit(S, hitPow, vIn, vmax);   // sMonoCrumble does nothing while climbing
    const wasHold = S.holdIn; holdInWall(S, walls, crumbled0);
    if (S.ray && S.holdIn && S.lastRay) {                                              // sAdjustPosi, HoldInWall: the flat move is taken back (position = old position - correction) and on the first held frame the move becomes the wall normal x 0.05 x top speed (A142)
      const { c, old } = S.lastRay; S.pos[0] = old[0] - c.total[0]; S.pos[2] = old[2] - c.total[2];
      if (!wasHold) { let wx = 0, wy = 0, wz = 0; for (const h of c.wall) { wx += h.n[0]; wy += h.n[1]; wz += h.n[2]; } const wl = Math.hypot(wx, wy, wz) || 1; vx = wx / wl * tp.speed * 0.05; vz = wz / wl * tp.speed * 0.05; }
    }
    S.v[0] = vx; S.v[1] = vz; S.speed = Math.hypot(vx, vz); if (S.rampLift) S.vy = Math.max(S.vy, 0);
    // wall climb: sCheckClimbWall decides, sEnableClimbWall / DisableClimbWall change state, sClimbWall lifts the ball
    {
      let ok1 = false;
      if (walls.length === 1) {                                                        // more than one wall face at once: no climb
        const w = walls[0], free = !!(w.o && w.o.top <= bottom + CW.distRatio * S.diam && S.grounded);   // sCheckClimbMono: the object's top is within reach
        let can = cw.on || free;
        if (!can) can = S.grounded && cw.forbid === 0 && !S.rampLift;                  // not forbidden, not flying, not on a slope (HitEdge: below, ray mode only)
        if (S.ray && S.edgeHit && !free) can = false;                                   // sCheckClimbWall: KSTAT HitEdge (an edge ray hit something) refuses the climb unless the object is small enough to climb (sCheckClimbMono)
        if (noClimb && !free) can = false;                                              // DisableClimb: only a mono small enough to climb (sCheckClimbMono) still gets through
        if (can) {
          const hx = -w.n[0], hz = -w.n[1], camCos = fx * hx + fz * hz;                 // camera forward against the direction to the wall (camera = prince facing, A98)
          if (camCos >= CW.camCos && dir !== 0) {
            const n = cw.on ? cw.norm : w.n, pa2 = S.yaw + (st.mdir >= 0 ? st.phi : 0), ix = Math.sin(pa2), iz = Math.cos(pa2), mv = ix * n[0] + iz * n[1];   // input must point into the wall: inner(wall normal, -input) >= cos 36
            if (-mv >= CW.angleCos) ok1 = true;
          }
        }
        if (ok1 && !cw.on) { cw.speed = 0; cw.top = false; cw.norm = w.n.slice(); cw.len = S.ray && S.lastRay ? Math.max(R, ...S.lastRay.c.wall.map(h => Math.hypot(h.vec[0], h.vec[1], h.vec[2]))) : R; cw.startY = S.pos[1]; }
      }
      if (S.ray && !ok1 && cw.on && walls.length === 0 && S.lastRay && S.lastRay.c.ground.length > 0 && dir !== 0 && !S.edgeHit) {   // sReaction runs sReflection on any hit, and with ClimbWall on sCheckClimbWall needs no wall hit: the input still has to point into the climb wall (any ground hit, such as the top of a box the ball is rising past, keeps the climb going)
        const pa2 = S.yaw + (st.mdir >= 0 ? st.phi : 0), mv = Math.sin(pa2) * cw.norm[0] + Math.cos(pa2) * cw.norm[1];
        if (-mv >= CW.angleCos) ok1 = true;
      }
      if (!S.ray && !ok1 && cw.on && !cw.top && walls.length === 0 && dir !== 0 && S.pos[1] - R < cw.wallTop) ok1 = true;   // a sphere rising past a wall loses contact before its bottom clears the top (the engine tests several directions around the ball, so the contact lasts); keep climbing until the bottom is over the top (P19)
      if (ok1 && !cw.on && walls.length === 1) cw.wallTop = walls[0].o ? walls[0].o.top : meshTop;
      if (ok1) { if (!cw.top) cw.eff = 1; cw.forbid = 0; cw.on = true; }
      else cwOff();
      if (S.ray && cw.on && S.ib.st) ibReset();                                        // sReaction: climbing ends the lump state
      if (cw.on) {                                                                      // sClimbWall
        if (cw.top) { cw.topT++; if (cw.topT > CW.topTime) cwOff(); }
        else {
          const reach = CW.distRatio * S.diam; let now = Math.max(0, S.pos[1] - cw.startY);
          if (now < reach) {
            cw.speed = Math.min(cw.speed + CW.accel, S.diam * CW.speedPerDiam);
            let up = cw.speed; now += cw.speed;
            if (now > reach) { up -= now - reach; cw.top = true; cw.topT = 0; }
            S.pos[1] += up;
          } else { cw.top = true; cw.topT = 1; }
        }
      }
    }
    // wall bounce (sReflection, A103): hitting a wall head on or at a slant, with no climb starting, throws the ball back along the mirrored direction at 55% of its speed on the next frame
    if (!cw.on && !cwWasOn && walls.length && vIn > 1e-6 && !S.noReflect) {
      let sx = 0, sz = 0; for (const w of walls) { sx += w.n[0]; sz += w.n[1]; }
      const sl = Math.hypot(sx, sz);
      if (sl > 1e-6) {
        const nx = sx / sl, nz = sz / sl, ux = vx0 / vIn, uz = vz0 / vIn, inner = ux * nx + uz * nz;
        if (inner < 0) {
          const refp = (Math.acos(Math.max(-1, inner)) - Math.PI / 2) / (Math.PI / 2);
          if (refp > 0) {
            const hv = S.ray && S.forceReflect ? 0.5 : 1;                             // sw_force_sub_spd: a forced reflection with walls halves the speed first
            S.reflV = [(ux - 2 * inner * nx) * REFL * vIn * hv, (uz - 2 * inner * nz) * REFL * vIn * hv];
            dashCancel(S);                                  // gYm_OujiDashCancel: the dash needs new strokes
            if (Math.min(1, vIn / vmax) > 0.3 && refp > 0.3 && !(S.crushCool > 0)) { S.events.push({ type: 'crush', wall: true }); S.crushCool = 8; }   // my 8 frame gap so a ball ground against a wall does not stutter the sound   // reqCrush when speed ratio and angle power both pass 0.3
          }
        }
      }
    }
    // vertical. Flight bookkeeping is sStatFly: FlyTime counts frames in the air, FlyFallTime the frames moving down
    if (!S.ray) {
      if (S.grounded || cw.on) { S.flyT = 0; S.fallT = 0; } else { S.flyT++; if (S.vy < 0) S.fallT++; }
      const g = cw.on ? 0 : gravity(S); S.vy = cw.on ? 0 : S.vy - g;
      let y = S.pos[1] + S.vy; const sup = supportAt(S, S.pos[0], S.pos[2], y - R + stepW + Math.max(0, -S.vy), y - R + climbW + Math.max(0, -S.vy));
      if (sup !== null && y - R <= sup) {
        if (S.vy < 0 && !S.grounded && !cw.on && !S.reflV && !S.noReflect) landingBounce(S, vmax, sup);   // landing from the air (sReflection, Fly branch, A107)
        y = sup + R; S.vy = 0;
      }
      S.pos[1] = y; S.grounded = !cw.on && sup !== null && Math.abs(y - R - sup) < 1e-3;
    }
    // roll: the surface moves with the ball, axis = up x motion
    if (moved > 1e-6) {
      const axis = norm([mz, 0, -mx]);
      S.R = mmul(axisAngle(axis, moved / R), S.R);   // the contact point must move back relative to the ball's centre: tests/roll.js (A124). The sign was reversed before (tester: rolling backwards)
    }
    if (S.wheelSpin || (S.dS.start && S.wheelSpd > 0)) { const ax2 = norm([Math.cos(S.yaw), 0, -Math.sin(S.yaw)]); S.R = mmul(axisAngle(ax2, S.wheelSpd / R), S.R); }   // mWheelSpinRot: the ball spins in place about the camera X axis (w = spin speed / radius)
    // fell through the map (KatamariRecover.cppi): when the ball is 'bottom' cm below the floor line it goes back to the recover point (the start), keeping what it has picked up (A56)
    const rc = S.recover; if (rc && S.pos[1] < -rc[0]) {
      S.pos = [rc[1], Math.max(-rc[2], 5) + S.diam, rc[3]]; S.vy = 0; S.v = [0, 0]; S.speed = 0; S.yaw = rc[4]; dashCancel(S, true); S.events.push({ type: 'recover' });
    }
    waterStep(S, R);
    // pickup
    const cdm = S.diam * 10;
    for (const o of S.objs) {
      if (o.state !== 'map' || cdm < o.catchMm || (o.hitOff && o.hitOff > S.frame)) continue;
      const v = [o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]];
      if (Math.hypot(v[0], v[1], v[2]) > R + o.maxlen) continue;            // broad phase: ball radius + object bounding radius >= distance (gYm_MonoHitCheck)
      if (!engineHit(S, o, v, R)) continue;                                 // sCheckHitMono: the engine's pickup test (A29)
      const Rt = mtr(S.R), lp = mvec(Rt, v);                                // relative position kept as it was at pickup, no clamping (gYm_MonoHitSetInfo)
      o.state = 'ball'; o.lpos = lp; o.lrot = mmul(Rt, o.rot); o.near = nearIbitsu(S, o); S.attached.push(o); S.picked++; if (S.info[o.n].ibi) S.ibiList.push(o);
      const add = o.boxvol * o.addRatio * addRatio(S); o.addVol = add; o.crumbleVol = add; if (!o.rotHome) o.rotHome = o.rot; grow(S, add);
      S.events.push({ type: 'pickup', name: o.n, add }); if (S.target && o.n === S.target && !S.won) { S.won = true; S.events.push({ type: 'won' }); }
    }
    cullStuck(S, R);
    // object layers (MP_INF): layer 0 is live until the ball reaches its 'until' diameter, then the next area opens (P21: the whole mechanism is inferred)
    const LY = S.layers; if (LY && S.layer + 1 < LY.length && LY[S.layer].until > 0 && S.diam >= LY[S.layer].until) {
      const from = S.layer; S.layer++;
      for (const o of S.objs) if (o.state === 'hidden' && o.layer === S.layer) { o.state = 'map'; o.born = S.frame; }   // born: the renderer grows new objects in instead of popping them (A51)
      S.events.push({ type: 'layer', layer: S.layer });
    }
    // ERASE_STOPPER: [diameter cm, hit kind]. When the ball reaches the diameter, that kind of collision polygon stops blocking (A33)
    for (const st of S.stoppers) if (!S.erased[st[1]] && S.diam >= st[0]) { S.erased[st[1]] = true; S.events.push({ type: 'area', kind: st[1] }); }
    if (!S.won && !S.target && !S.noWin && S.diam >= S.goal) { S.won = true; S.events.push({ type: 'won' }); }
    if (S.ray) convergeRay(S, vmax, S.lastRay ? S.lastRay.c.ground : []); else converge(S, R, vmax);
    S.pos[1] += S.lift; S.liftApplied = S.lift;
  }

  const API = { holdInWall, HOLD, cullStuck, waterAt, buildWater, engineHit, buildGround, splineAt, moveMonos, animMonos, FPS, CLIMB, supportAt, create, step, boxClosest, rayHit, segHit, hitFloorAt, rayContacts, hitWalls, tank, readSticks, readCtrl, padSticks, tableParams, lumpsOf, lumpMult, cameraRow, cameraParams, radius, maxSpeed, gravity, groundAt, diamFromVol, sphereVol, mmul, mvec, mtr, eulerView, interpRows, pairs, I3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KSim = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
