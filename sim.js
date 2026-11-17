'use strict';
// Katamari Amore web port: simulation core. Pure logic, no DOM or GL, so it runs in the browser and in Node tests.
// Units: cm, one step = one game frame (the game's own tables are per frame). View space (z already mirrored from the data).
// Anything marked PLACEHOLDER is a stand-in for engine behavior not decoded yet. See ASSUMPTIONS.md.
(function (root) {
  const FPS = 30;                    // PLACEHOLDER (P1): fixed step rate, not read from the game
  // Two-stick control constants, read from KatamariData.cppi (gf32DefaultOujiParam) and OujiCtrl4.cppi
  const TILT = 0.2, TURNDELTA = 0.035, TURNDELTA2 = 0.055, TURNDELTA3 = 0.025, MOVEDELTA = 0.06, MOVEDELTA_B = 0.03;
  const DASH_DURATION = 240, DASH_FORBID = 240;   // frames, from the same table
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
  // placement euler (file degrees) -> view space. Decoded from the loader (A97): S = Sz(-rz) Sy(-ry) Sx(rx)
  const eulerView = (x, y, z) => mmul(rz(-z * D2R), mmul(ry(-y * D2R), rx(x * D2R)));
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
            if (steepOnly || Math.abs(H.ny[t]) >= FLAT_NY) continue;
            const o = t * 9, c = closestOnTri(T, o, S.pos[0], S.pos[1], S.pos[2]), dx = S.pos[0] - c[0], dy = S.pos[1] - c[1], dz = S.pos[2] - c[2], d2 = dx*dx + dy*dy + dz*dz;
            if (d2 >= R * R || d2 < 1e-10 || dy < -0.05) continue;                // ball must be on the upper side
            const d = Math.sqrt(d2), m = R - d; S.pos[0] += dx / d * m; S.pos[1] += dy / d * m; S.pos[2] += dz / d * m; if (dy > 0) S.rampLift = true; moved = true; continue;
          }
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
  function rayHit(S, ox, oy, oz, dx, dy, dz, maxT) {
    const H = S.camHit || S.hit; if (!H) return null; const T = H.tris; let best = null;
    for (let t = 0, n = T.length / 9; t < n; t++) {
      if (S.erased && H.kind && S.erased[H.kind[t]]) continue;
      const o = t * 9, e1x = T[o+3]-T[o], e1y = T[o+4]-T[o+1], e1z = T[o+5]-T[o+2], e2x = T[o+6]-T[o], e2y = T[o+7]-T[o+1], e2z = T[o+8]-T[o+2];
      const px = dy*e2z-dz*e2y, py = dz*e2x-dx*e2z, pz = dx*e2y-dy*e2x, det = e1x*px+e1y*py+e1z*pz; if (Math.abs(det) < 1e-9) continue;
      const inv = 1/det, tx = ox-T[o], ty = oy-T[o+1], tz = oz-T[o+2], u = (tx*px+ty*py+tz*pz)*inv; if (u < 0 || u > 1) continue;
      const qx = ty*e1z-tz*e1y, qy = tz*e1x-tx*e1z, qz = tx*e1y-ty*e1x, v = (dx*qx+dy*qy+dz*qz)*inv; if (v < 0 || u + v > 1) continue;
      const tt = (e2x*qx+e2y*qy+e2z*qz)*inv; if (tt > 1e-4 && tt <= maxT && (best === null || tt < best)) best = tt;
    }
    return best;
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
      vy: 0, flyT: 0, fallT: 0, speed: 0, v: [0, 0], dashT: 0, dashCool: 0, dash: false, yaw: mf[6],   // P7: mission data is already in engine space (y down), which matches view space in x and z, so no z flip. Engine ground normal starts as (0,-1,0)
      stoppers: play.mis.stoppers || [], erased: {}, layers: (() => { const lm = play.mis.layers_by_mode && play.mis.layers_by_mode[opts.set || 'S']; const l = lm && lm.length ? lm : play.mis.layers; return l && l.length ? l : null; })(), layer: 0, R: I3(), volume: sphereVol(startDiam / 200), diam: startDiam,
      lift: 0, liftApplied: 0, ctrlOff: 0, cw: { on: false, top: false, topT: 0, startY: 0, speed: 0, eff: 0, forbid: 0, norm: [0, 0] }, brake: false, crumbleCool: 0, crumbled: 0, flipT: 0, flipN: 14, flipYaw0: 0, ouji_jump: play.mis.ouji_jump, flipHeld: false, lumps: [], ibiList: [], recover: play.mis.recover || null, objs: [], attached: [], picked: 0, frame: 0, won: false, events: [], noWin: !!opts.noTarget, noReflect: !!opts.noReflect,
    };
    S.diam = diamFromVol(S.volume);
    S.pickMode = opts.pick || 'engine';   // 'sphere' brings back the old sphere-against-box pickup test for comparison (A29)
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
  function supportAt(S, x, z, yMapMax, yObjMax) {
    let g = groundAt(S.G, x, z, yMapMax); const dm = S.diam * 10;
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
  // Convenience for keyboards and bots: forward/turn (turn > 0 turns left, toward +yaw) -> two stick values
  function tank(fwd, turn) { const c = v => Math.max(-1, Math.min(1, v)); return { L: c(fwd - turn), R: c(fwd + turn) }; }

  // Two-stick input like the game's Ouji controller. L and R are -1..1 (up = forward). Returns {turn (rad, + = right), power, dir (1 fwd, -1 back, 0 none)}.
  function readSticks(L, R) {
    const pl = Math.abs(L), pr = Math.abs(R), t = TILT, rng = 1 - t;
    const fL = L >= t, fR = R >= t, bL = L <= -t, bR = R <= -t, idleL = pl < t, idleR = pr < t;
    const ex = p => Math.max(0, (p - t) / rng);
    if (fL && idleR) return { turn: TURNDELTA * ex(pl), power: 0, dir: 0 };            // sCheckTurnFL: pivot right
    if (fR && idleL) return { turn: -TURNDELTA * ex(pr), power: 0, dir: 0 };           // sCheckTurnFR: pivot left
    if (bL && idleR) return { turn: -TURNDELTA3 * ex(pl), power: 0, dir: 0 };          // sTurnSL
    if (bR && idleL) return { turn: TURNDELTA3 * ex(pr), power: 0, dir: 0 };           // sTurnSR
    if (fL && fR) return { turn: MOVEDELTA * 0.5 * (pl - pr), power: (ex(pl) + ex(pr)) / 2, dir: 1 };
    if (bL && bR) return { turn: -MOVEDELTA_B * 0.5 * (pl - pr), power: (ex(pl) + ex(pr)) / 2, dir: -1 };   // both back = reverse; the source has a real backward branch with MoveDeltaB (OujiCtrl4.cppi sTurn, A113), constants are gf32DefaultOujiParam
    if (fL && bR) return { turn: TURNDELTA2 * Math.min(1, ex((pl + pr) / 2) + 0.0), power: 0, dir: 0, moveTurn: true };    // sTurn90: spin right
    if (fR && bL) return { turn: -TURNDELTA2 * Math.min(1, ex((pl + pr) / 2)), power: 0, dir: 0, moveTurn: true };
    return { turn: 0, power: 0, dir: 0 };
  }

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
  function landingBounce(S, vmax, sup) {
    if (S.flyT < FLY_MIN) return;
    const T = [S.v[0], S.vy, S.v[1]], V = Math.hypot(T[0], T[1], T[2]); if (V < 1e-6) return;
    const x = S.pos[0], z = S.pos[2], hAt = (px, pz) => { const h = supportAt(S, px, pz, sup + 3, sup + 3); return h === null ? sup : h; };
    let nx = -(hAt(x + 1, z) - hAt(x - 1, z)) / 2, nz = -(hAt(x, z + 1) - hAt(x, z - 1)) / 2; const nl = Math.hypot(nx, 1, nz); nx /= nl; nz /= nl; const ny = 1 / nl;
    const d = [T[0] / V, T[1] / V, T[2] / V], inner = d[0] * nx + d[1] * ny + d[2] * nz; if (inner >= 0) return;
    const refp = (Math.acos(Math.max(-1, inner)) - Math.PI / 2) / (Math.PI / 2); if (refp <= 0) return;
    const r = [d[0] - 2 * inner * nx, d[1] - 2 * inner * ny, d[2] - 2 * inner * nz];
    S.reflV = [r[0] * 0.95 * V, r[2] * 0.95 * V]; S.reflVy = r[1] * REFL * V;
    S.dash = false; S.dashT = 0; S.dashLock = true;                                           // gYm_OujiDashCancel
    const spd = Math.max(0, Math.min(1, (S.fallT - FALL_MIN) / (FALL_MAX - FALL_MIN)));       // sGetSpeedRatio, airborne and hit the ground
    if (spd * refp > 0) crumbleHit(S, spd * refp, V, vmax);
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

  // KatamariMain.cppi sControl: max speed ratio by how far the stick is pushed. Below Sect1 it ramps up to HalfSpeedRatio, up to Sect2 it stays there,
  // above Sect2 the source formula (with its operator precedence, which the binary keeps) gives Half + (1 - Half * t): 1.4 at Sect2 falling to 1.0 at full tilt
  function tiltFactor(p) {
    if (p < KP.tilt1) return KP.halfSpeed * (p / KP.tilt1);
    if (p < KP.tilt2) return KP.halfSpeed;
    return KP.halfSpeed + (1 - KP.halfSpeed * ((p - KP.tilt2) / (1 - KP.tilt2)));
  }

  function step(S, input) {
    S.frame++; S.events.length = 0; moveMonos(S); flyMonos(S); animMonos(S); if (S.crumbleCool > 0) S.crumbleCool--;
    let inp = input.L !== undefined ? input : Object.assign(tank(input.fwd || 0, input.turn || 0), { dash: input.dash, flip: input.flip, P: input.fwd ? Math.abs(input.fwd) : undefined });
    const R = radius(S), stepUp = Math.max(0.5 * R, 1.0), climb = Math.max(CLIMB * R, 1.0), tp = tableParams(S);
    const cw = S.cw, cwWasOn = cw.on, stepW = cw.on ? 0.05 : stepUp, climbW = cw.on ? 0.05 : climb;   // while climbing the ball has to get fully above a ledge: no step-up allowance
     if (cw.forbid > 0) cw.forbid--;                    // sUpdateTime
    const cwOff = () => { if (cw.on) { if (cw.eff <= 0) { cw.forbid = CW.forbid; } else { cw.eff--; return; } } cw.on = false; cw.top = false; cw.startY = 0; cw.topT = 0; };   // gYm_KatamariDisableClimbWall
    // lumps lift the ball: the surface point that faces down decides how high the centre rides. Eased so it does not jitter (A64)
    S.lumps = lumpsOf(S, R); { const dn = mvec(mtr(S.R), [0, -1, 0]), want = S.lumps.length ? Math.min((lumpMult(S.lumps, dn) - 1) * R, LUMP_LIFT_MAX * R) : 0; S.lift += (want - S.lift) * 0.3; if (S.lift < 1e-4) S.lift = 0; }
    if (S.ctrlOff > 0) { S.ctrlOff--; inp = { L: 0, R: 0, dash: false, flip: false }; }   // OujiControlDisableTime: no prince input for a few frames after a crush (A100)
    S.pos[1] -= S.liftApplied; S.liftApplied = 0;   // the physics below runs on the round ball; the lift is added back at the end of the step
    const st = readSticks(inp.L, inp.R);
    // The two-stick average power drops when you steer (one stick lower), which with the 0.4 plateau of the speed curve made steering crawl. The original's one-stick path (Ctrl4 combined stick) has no such drop, so single-stick and keyboard input pass their own push strength (A75)
    if (inp.P !== undefined && st.dir !== 0) st.power = Math.max(0, Math.min(1, inp.P));
    // quick turn (OSTAT Jump180): the original has a U-turn button at the bottom centre of the screen. Pressing it makes the prince hop over the ball and face the other way.
    // Timing is guessed (A66)
    if (inp.flip && !S.flipHeld && S.flipT === 0) { S.flipN = flipFrames(S); S.flipT = S.flipN; S.flipYaw0 = S.yaw; S.events.push({ type: 'flip' }); }
    S.flipHeld = !!inp.flip;
    if (S.flipT > 0) { S.yaw += Math.PI / S.flipN; S.flipT--; } else S.yaw += st.turn;
    // OUJI_STAT_MOVETURN (OujiCtrl4 sTurn90 while the ball is moving): the velocity turns with the prince and drag drops to MoveTurnRegistRatio (A76)
    const moveTurn = !!st.moveTurn && S.flipT === 0 && Math.hypot(S.v[0], S.v[1]) > 1e-3;
    if (moveTurn) { const c = Math.cos(st.turn), n = Math.sin(st.turn), ox = S.v[0], oz = S.v[1]; S.v[0] = ox * c + oz * n; S.v[1] = oz * c - ox * n; }
    S.input = { L: inp.L, R: inp.R, turn: st.turn, power: st.power };
    // dash: up to DASH_DURATION frames, then DASH_FORBID frames of cooldown (PLACEHOLDER: the real dash is a swipe gesture, see P11)
    if (S.dashCool > 0) S.dashCool--;
    if (!inp.dash) S.dashLock = false;
    const wantDash = !!inp.dash && !S.dashLock && st.dir === 1 && S.dashCool === 0;
    if (wantDash) { S.dashT++; if (S.dashT > DASH_DURATION) { S.dashT = 0; S.dashCool = DASH_FORBID; } } else S.dashT = 0;
    S.dash = wantDash && S.dashCool === 0; if (S.crushCool > 0) S.crushCool--;
    // acceleration along the facing direction, capped at the table speed (sControl)
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    let acc = 0, ratio = 0, dir = S.flipT > 0 ? 0 : st.dir, power = st.power;
    if (S.dash) { power = 1; acc = tp.accD; ratio = tp.rD; }
    else if (dir === 1) { acc = tp.accF * power; ratio = tp.rF * tiltFactor(power); }
    else if (dir === -1) { acc = tp.accB * power; ratio = tp.rB * tiltFactor(power); }
    const fmax = tp.speed * ratio * (cw.on ? CW.maxSpd : 1);   // sControl: fmax *= MaxSpdRatio while climbing
    let vx = S.v[0], vz = S.v[1]; const oldMag = Math.hypot(vx, vz);
    if (S.reflV) { vx = S.reflV[0]; vz = S.reflV[1]; S.reflV = null; if (S.reflVy !== undefined) { S.vy = S.reflVy; S.reflVy = undefined; } }   // last frame's wall bounce replaces the new move (sControl copies vReflection into fvDelta, A103)
    else if (dir !== 0) {
      let ix = fx * dir, iz = fz * dir;
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
        vx += ix * acc; vz += iz * acc; const nm = Math.hypot(vx, vz);
        if (nm > fmax && nm > oldMag) { const keep = oldMag < fmax ? fmax : oldMag; vx = vx / nm * keep; vz = vz / nm * keep; }   // same overshoot rule as the engine
      }
    }
    { const dr = moveTurn ? DRAG * KP.moveTurnRegist : DRAG; vx *= 1 - dr; vz *= 1 - dr; }
    if (Math.hypot(vx, vz) < 1e-3) { vx = 0; vz = 0; }
    const vx0 = vx, vz0 = vz, vIn = Math.hypot(vx, vz), vmax = tp.speed; let hitPow = 0;   // incoming velocity, for crumble
    const bottom = S.pos[1] - R;
    const ok = (x, z) => supportAt(S, x, z, bottom + stepW, bottom + climbW) !== null;
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
    if (dx || dz) {
      const nx = S.pos[0] + dx, nz = S.pos[2] + dz;
      if (ok(nx, nz)) { S.pos[0] = nx; S.pos[2] = nz; mx = dx; mz = dz; }
      else if (ok(S.pos[0] + dx, S.pos[2])) { S.pos[0] += dx; mx = dx; vz *= 0.3; addBlock(0, dz); }
      else if (ok(S.pos[0], S.pos[2] + dz)) { S.pos[2] += dz; mz = dz; vx *= 0.3; addBlock(dx, 0); }
      else { vx *= 0.3; vz *= 0.3; addBlock(dx, 0); addBlock(0, dz); }
      moved = Math.hypot(mx, mz);
    }
    // solid objects: anything too big to pick up is a box (P8). Low ones are rolled over (P9)
    const diamMm = S.diam * 10;
    for (const o of S.objs) {
      if (o.state !== 'map' || o.catchMm <= diamMm) continue;
      if (o.top <= bottom + climbW) continue;
      if (Math.hypot(o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]) > R + o.maxlen) continue;
      const bc = boxClosest(o, S.pos); if (bc.dist >= R || bc.dist < 1e-6) continue;
      const nx = S.pos[0] - bc.p[0], nz = S.pos[2] - bc.p[2], hl = Math.hypot(nx, nz); if (hl < 1e-6) continue;
      if (o.path && o.ppos) {                                                     // sMovingMono: a moving object that runs into the ball knocks it along its move direction (A100)
        const mvx = o.pos[0] - o.ppos[0], mvz = o.pos[2] - o.ppos[2], ml = Math.hypot(mvx, mvz);
        if (ml > 1e-9) {
          const mnx = mvx / ml, mnz = mvz / ml, kx = S.pos[0] - o.pos[0], kz = S.pos[2] - o.pos[2], kl = Math.hypot(kx, kz) || 1;
          if (kx / kl * mnx + kz / kl * mnz > 0) {
            const sp = Math.min(ml * MP.crashSpd, tp.speed * tp.rD * MP.crashCap);
            vx = mnx * sp; vz = mnz * sp; S.dash = false; S.dashT = 0; S.ctrlOff = 10; S.events.push({ type: 'crush' });
          }
        }
      }
      const push = (R - bc.dist) / bc.dist, px = S.pos[0] + (S.pos[0] - bc.p[0]) * push, pz = S.pos[2] + (S.pos[2] - bc.p[2]) * push;
      if (ok(px, pz)) { S.pos[0] = px; S.pos[2] = pz; const ux = nx / hl, uz = nz / hl; addWall(ux, uz, o); const vn = vx * ux + vz * uz; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, ux, uz, vIn, vmax)); vx -= vn * ux; vz -= vn * uz; } }
    }
    // walls from the collision mesh
    for (const n of hitWalls(S, R, false, cw.on ? 0.05 : undefined)) { addWall(n[0], n[1], null); const vn = vx * n[0] + vz * n[1]; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, n[0], n[1], vIn, vmax)); vx -= vn * n[0]; vz -= vn * n[1]; } }
    if (hitPow > 0 && !cw.on && !cwWasOn) crumbleHit(S, hitPow, vIn, vmax);   // sMonoCrumble does nothing while climbing
    S.v[0] = vx; S.v[1] = vz; S.speed = Math.hypot(vx, vz); if (S.rampLift) S.vy = Math.max(S.vy, 0);
    // wall climb: sCheckClimbWall decides, sEnableClimbWall / DisableClimbWall change state, sClimbWall lifts the ball
    {
      let ok1 = false;
      if (walls.length === 1) {                                                        // more than one wall face at once: no climb
        const w = walls[0], free = !!(w.o && w.o.top <= bottom + CW.distRatio * S.diam && S.grounded);   // sCheckClimbMono: the object's top is within reach
        let can = cw.on || free;
        if (!can) can = S.grounded && cw.forbid === 0 && !S.rampLift;                  // not forbidden, not flying, not on a slope (HitEdge and DisableClimb are not modelled)
        if (can) {
          const hx = -w.n[0], hz = -w.n[1], camCos = fx * hx + fz * hz;                 // camera forward against the direction to the wall (camera = prince facing, A98)
          if (camCos >= CW.camCos && dir !== 0) {
            const n = cw.on ? cw.norm : w.n, ix = fx * dir, iz = fz * dir, mv = ix * n[0] + iz * n[1];   // input must point into the wall: inner(wall normal, -input) >= cos 36
            if (-mv >= CW.angleCos) ok1 = true;
          }
        }
        if (ok1 && !cw.on) { cw.speed = 0; cw.top = false; cw.norm = w.n.slice(); cw.startY = S.pos[1]; }
      }
      if (ok1) { if (!cw.top) cw.eff = 1; cw.forbid = 0; cw.on = true; }
      else cwOff();
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
            S.reflV = [(ux - 2 * inner * nx) * REFL * vIn, (uz - 2 * inner * nz) * REFL * vIn];
            S.dash = false; S.dashT = 0; S.dashLock = true;                                  // gYm_OujiDashCancel: the dash needs a new press
            if (Math.min(1, vIn / vmax) > 0.3 && refp > 0.3 && !(S.crushCool > 0)) { S.events.push({ type: 'crush', wall: true }); S.crushCool = 8; }   // my 8 frame gap so a ball ground against a wall does not stutter the sound   // reqCrush when speed ratio and angle power both pass 0.3
          }
        }
      }
    }
    // vertical. Flight bookkeeping is sStatFly: FlyTime counts frames in the air, FlyFallTime the frames moving down
    if (S.grounded || cw.on) { S.flyT = 0; S.fallT = 0; } else { S.flyT++; if (S.vy < 0) S.fallT++; }
    const g = cw.on ? 0 : gravity(S); S.vy = cw.on ? 0 : S.vy - g;
    let y = S.pos[1] + S.vy; const sup = supportAt(S, S.pos[0], S.pos[2], y - R + stepW + Math.max(0, -S.vy), y - R + climbW + Math.max(0, -S.vy));
    if (sup !== null && y - R <= sup) {
      if (S.vy < 0 && !S.grounded && !cw.on && !S.reflV && !S.noReflect) landingBounce(S, vmax, sup);   // landing from the air (sReflection, Fly branch, A107)
      y = sup + R; S.vy = 0;
    }
    S.pos[1] = y; S.grounded = !cw.on && sup !== null && Math.abs(y - R - sup) < 1e-3;
    // roll: the surface moves with the ball, axis = up x motion
    if (moved > 1e-6) {
      const axis = norm([mz, 0, -mx]);
      S.R = mmul(axisAngle(axis, -moved / R), S.R);
    }
    // fell through the map (KatamariRecover.cppi): when the ball is 'bottom' cm below the floor line it goes back to the recover point (the start), keeping what it has picked up (A56)
    const rc = S.recover; if (rc && S.pos[1] < -rc[0]) {
      S.pos = [rc[1], Math.max(-rc[2], 5) + S.diam, rc[3]]; S.vy = 0; S.v = [0, 0]; S.speed = 0; S.yaw = rc[4]; S.dash = false; S.dashT = 0; S.events.push({ type: 'recover' });
    }
    // pickup
    const cdm = S.diam * 10;
    for (const o of S.objs) {
      if (o.state !== 'map' || cdm < o.catchMm || (o.hitOff && o.hitOff > S.frame)) continue;
      const v = [o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]];
      if (Math.hypot(v[0], v[1], v[2]) > R + o.maxlen) continue;            // broad phase: ball radius + object bounding radius >= distance (gYm_MonoHitCheck)
      if (!engineHit(S, o, v, R)) continue;                                 // sCheckHitMono: the engine's pickup test (A29)
      const Rt = mtr(S.R), lp = mvec(Rt, v);                                // relative position kept as it was at pickup, no clamping (gYm_MonoHitSetInfo)
      o.state = 'ball'; o.lpos = lp; o.lrot = mmul(Rt, o.rot); S.attached.push(o); S.picked++; if (S.info[o.n].ibi) S.ibiList.push(o);
      const add = o.boxvol * o.addRatio * addRatio(S); o.addVol = add; o.crumbleVol = add; if (!o.rotHome) o.rotHome = o.rot; grow(S, add);
      S.events.push({ type: 'pickup', name: o.n, add }); if (S.target && o.n === S.target && !S.won) { S.won = true; S.events.push({ type: 'won' }); }
    }
    // object layers (MP_INF): layer 0 is live until the ball reaches its 'until' diameter, then the next area opens (P21: the whole mechanism is inferred)
    const LY = S.layers; if (LY && S.layer + 1 < LY.length && LY[S.layer].until > 0 && S.diam >= LY[S.layer].until) {
      const from = S.layer; S.layer++;
      for (const o of S.objs) if (o.state === 'hidden' && o.layer === S.layer) { o.state = 'map'; o.born = S.frame; }   // born: the renderer grows new objects in instead of popping them (A51)
      S.events.push({ type: 'layer', layer: S.layer });
    }
    // ERASE_STOPPER: [diameter cm, hit kind]. When the ball reaches the diameter, that kind of collision polygon stops blocking (A33)
    for (const st of S.stoppers) if (!S.erased[st[1]] && S.diam >= st[0]) { S.erased[st[1]] = true; S.events.push({ type: 'area', kind: st[1] }); }
    if (!S.won && !S.target && !S.noWin && S.diam >= S.goal) { S.won = true; S.events.push({ type: 'won' }); }
    converge(S, R, vmax);
    S.pos[1] += S.lift; S.liftApplied = S.lift;
  }

  const API = { buildGround, splineAt, moveMonos, animMonos, FPS, CLIMB, supportAt, create, step, boxClosest, rayHit, hitWalls, tank, readSticks, tableParams, lumpsOf, lumpMult, cameraRow, cameraParams, radius, maxSpeed, gravity, groundAt, diamFromVol, sphereVol, mmul, mvec, mtr, eulerView, interpRows, pairs, I3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KSim = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
