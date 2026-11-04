'use strict';
// Katamari Amore web port: simulation core. Pure logic, no DOM or GL, so it runs in the browser and in Node tests.
// Units: cm, one step = one game frame (the game's own tables are per frame). View space (z already mirrored from the data).
// Anything marked PLACEHOLDER is a stand-in for engine behavior not decoded yet. See ASSUMPTIONS.md.
(function (root) {
  const FPS = 30;                    // PLACEHOLDER (P1): fixed step rate, not read from the game
  // Two-stick control constants, read from KatamariData.cppi (gf32DefaultOujiParam) and OujiCtrl4.cppi
  const TILT = 0.2, TURNDELTA = 0.035, TURNDELTA2 = 0.055, TURNDELTA3 = 0.025, MOVEDELTA = 0.06, MOVEDELTA_B = 0.03;
  const DASH_DURATION = 240, DASH_FORBID = 240;   // frames, from the same table
  const DRAG = 0.03;                 // PLACEHOLDER (P3): per-frame velocity loss. KPARAM(f32Registance) is not in the bundle
  const CLIMB = 0.75;                // PLACEHOLDER (P19): the ball rolls up onto too-big objects whose top is at most CLIMB * radius above its bottom
  const MIN_POWER_SPEED = 0.4;       // PLACEHOLDER (P4): max speed at the lightest stick push, fraction. SpeedTiltSect/HalfSpeedRatio not in the bundle
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
  // placement euler in logic space -> view space (A14/A16: order and signs are GUESSES)
  const eulerView = (x, y, z) => mmul(ry(-y * D2R), mmul(rx(-x * D2R), rz(z * D2R)));
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
  // Sloped faces (0.7 <= |ny| < 0.97, ramps) are pushed out of in 3D from above so the ball rides up them (P19). Sets S.rampLift when it lifted the ball.
  function hitWalls(S, R, steepOnly) {
    const H = S.hit, out = []; S.rampLift = false; if (!H) return out;
    for (let it = 0; it < 3; it++) {
      let moved = false; const seen = new Set(), T = H.tris, x = S.pos[0], y = S.pos[1], z = S.pos[2];
      for (let cx = Math.floor((x - R) / GRID); cx <= Math.floor((x + R) / GRID); cx++) for (let cz = Math.floor((z - R) / GRID); cz <= Math.floor((z + R) / GRID); cz++) {
        let a = H.cells.get(cx * 100003 + cz); if (H.big.length) a = a ? a.concat(H.big) : H.big; if (!a) continue;
        for (const t of a) {
          if (seen.has(t)) continue; seen.add(t); if (S.erased && H.kind && S.erased[H.kind[t]]) continue;
          if (Math.abs(H.ny[t]) >= 0.7) {
            if (steepOnly || Math.abs(H.ny[t]) >= 0.97) continue;
            const o = t * 9, c = closestOnTri(T, o, S.pos[0], S.pos[1], S.pos[2]), dx = S.pos[0] - c[0], dy = S.pos[1] - c[1], dz = S.pos[2] - c[2], d2 = dx*dx + dy*dy + dz*dz;
            if (d2 >= R * R || d2 < 1e-10 || dy < -0.05) continue;                // ball must be on the upper side
            const d = Math.sqrt(d2), m = R - d; S.pos[0] += dx / d * m; S.pos[1] += dy / d * m; S.pos[2] += dz / d * m; if (dy > 0) S.rampLift = true; moved = true; continue;
          }
          const o = t * 9, lo = Math.min(T[o+1], T[o+4], T[o+7]), hi = Math.max(T[o+1], T[o+4], T[o+7]); if (hi < y - R || lo > y + R) continue;
          if (hi <= y - R + Math.max(0.5 * R, 1)) continue;               // low riser (a stair step): rolled over, the step top is the floor (A45)
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
    const startDiam = opts.startDiam || mf[8], tgtInfo = !opts.noTarget && play.mis.target && play.info[play.mis.target], cm = i => (opts.catchMode === 'goal' && i.catch_goal_mm !== undefined) ? i.catch_goal_mm : i.catch_mm, goal = opts.goal || (tgtInfo ? cm(tgtInfo) / 10 : mf[9]);   // story clear = pick up the target mono (GameClear.cppi sCheck1P_N); goal is its catch size, used for the HUD gauge
    const S = {
      G: buildGround(play.tris), hit: play.hit && play.hit.length ? buildHit(play.hit, play.hit_kind) : null, camHit: play.camhit && play.camhit.length ? { tris: Float32Array.from(play.camhit), kind: null } : null, tab: play.mis.speed.filter(r => r.length >= 11), cam: play.mis.camera || [], speedRows: play.mis.speed.map(r => [r[0], r[1]]), gravRows: pairs(play.mis.gravity), addRows: pairs(play.mis.addvol),
      info: play.info, startDiam, goal, target: tgtInfo ? play.mis.target : null, targetLabel: tgtInfo ? (tgtInfo.label || play.mis.target).trim() : null,
      pos: [mf[0], Math.max(-mf[1], 5) + startDiam, mf[2]],        // PLACEHOLDER (P6): start y flipped from logic, then dropped to the floor
      vy: 0, speed: 0, v: [0, 0], dashT: 0, dashCool: 0, dash: false, yaw: mf[6],   // P7: mission data is already in engine space (y down), which matches view space in x and z, so no z flip. Engine ground normal starts as (0,-1,0)
      stoppers: play.mis.stoppers || [], erased: {}, layers: (play.mis.layers && play.mis.layers.length) ? play.mis.layers : null, layer: 0, R: I3(), volume: sphereVol(startDiam / 200), diam: startDiam,
      lift: 0, liftApplied: 0, crumbleCool: 0, crumbled: 0, flipT: 0, flipLock: false, lumps: [], ibiList: [], recover: play.mis.recover || null, objs: [], attached: [], picked: 0, frame: 0, won: false, events: [], noWin: !!opts.noTarget,
    };
    S.diam = diamFromVol(S.volume);
    for (const o of play.objs) {
      const i = play.info[o.n]; if (!i) continue;
      const ext = [i.hi[0]-i.lo[0], i.hi[1]-i.lo[1], i.hi[2]-i.lo[2]];
      S.objs.push({ n: o.n, model: i.model, pos: o.p.slice(), rot: eulerView(o.r[0], o.r[1], o.r[2]), rawRot: o.r, catchMm: cm(i), boxvol: i.boxvol, addRatio: i.add_ratio,
        r: 0.5 * Math.hypot(ext[0], ext[1], ext[2]), halfXZ: 0.5 * Math.max(ext[0], ext[2]), top: o.p[1] + i.hi[1], lo: i.lo, hi: i.hi, maxlen: Math.max(Math.hypot(...i.lo), Math.hypot(...i.hi)), layer: o.layer || 0, state: (o.layer || 0) === 0 ? 'map' : 'hidden', path: (i.path && play.mis.splines && play.mis.splines[i.path.no]) ? { pts: play.mis.splines[i.path.no], speed: i.path.speed, t: 0 } : null });
    }
    for (const o of S.objs) if (o.path) {                                  // A37: start at the spline point nearest the placed position
      let bt = 0, bd = 1e18; for (let k = 0; k < 600; k++) { const p = splineAt(o.path.pts, k / 600).pos, d = Math.hypot(p[0] - o.pos[0], p[2] - o.pos[2]); if (d < bd) { bd = d; bt = k / 600; } }
      o.path.t = bt; const sp = splineAt(o.path.pts, bt); o.pos = sp.pos; o.ppos = sp.pos.slice(); o.rot = ry(Math.atan2(sp.tan[0], sp.tan[2]));
    }
    return S;
  }
  // moving monos (MonoMain.cppi): tSpline += splineSpeed per frame, wraps at 1. The Spline class is not in the sources, so this is a closed
  // Catmull-Rom through the waypoints with segment = t * count (A35). Local +z of the model points along the travel direction (A36)
  function splineAt(pts, t) {
    const n = pts.length, u = (t - Math.floor(t)) * n, i = Math.floor(u), f = u - i, P = k => pts[((i + k) % n + n) % n];
    const p0 = P(-1), p1 = P(0), p2 = P(1), p3 = P(2), f2 = f * f, f3 = f2 * f, pos = [], tan = [];
    for (let k = 0; k < 3; k++) {
      pos.push(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3));
      tan.push(0.5 * ((-p0[k] + p2[k]) + 2 * (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f + 3 * (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f2));
    }
    return { pos, tan };
  }
  function moveMonos(S) {
    for (const o of S.objs) {
      if (!o.path || o.state !== 'map') continue;
      o.ppos = o.pos.slice();
      o.path.t += o.path.speed; if (o.path.t >= 1) o.path.t -= 1;
      const sp = splineAt(o.path.pts, o.path.t);
      o.pos = sp.pos; o.top = o.pos[1] + o.hi[1];
      if (Math.hypot(sp.tan[0], sp.tan[2]) > 1e-6) o.rot = ry(Math.atan2(sp.tan[0], sp.tan[2]));
    }
  }
  // closest point of an object's oriented bounding box to a world point c. Models are boxed in their own space; world = rot * local + pos
  function boxClosest(o, c) {
    const l = mvec(mtr(o.rot), [c[0] - o.pos[0], c[1] - o.pos[1], c[2] - o.pos[2]]);
    const q = [Math.min(Math.max(l[0], o.lo[0]), o.hi[0]), Math.min(Math.max(l[1], o.lo[1]), o.hi[1]), Math.min(Math.max(l[2], o.lo[2]), o.hi[2])];
    const w = mvec(o.rot, q);
    return { p: [w[0] + o.pos[0], w[1] + o.pos[1], w[2] + o.pos[2]], dist: Math.hypot(l[0] - q[0], l[1] - q[1], l[2] - q[2]) };
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
  // File column order (inferred, ASSUMPTIONS A27): 0 diameter, 1 speed, 2 gravity, 3-6 accel F/B/S/dash, 7-10 speed ratio F/B/S/dash, 13-14 brake F/B
  function tableParams(S) {
    const T = S.tab, d = Math.max(S.diam, T[1] ? T[1][0] : 0);
    let i = 2; while (i < T.length - 1 && d > T[i][0]) i++;
    const a = T[i - 1], b = T[i], t = Math.max(0, Math.min(1, (d - a[0]) / ((b[0] - a[0]) || 1)));
    const L = c => a[c] + (b[c] - a[c]) * t;
    return { speed: L(1), accF: L(3), accB: L(4), accS: L(5), accD: L(6), rF: L(7), rB: L(8), rS: L(9), rD: L(10), brakeF: L(13), brakeB: L(14) };
  }
  // Camera row at the current diameter (CAMERA_DATA): eye offset behind/up, look-at offset ahead/up, far clip. Offsets are logic space, y down.
  function cameraParams(S) {
    const C = S.cam; if (!C.length) return { back: S.diam * 4.5, up: S.diam * 1.4, ahead: S.diam, lookUp: 0, far: 800 };
    const d = S.diam; let i = 1; while (i < C.length - 1 && d > C[i][0]) i++;
    const a = C[Math.min(i - 1, C.length - 1)], b = C[Math.min(i, C.length - 1)];
    const t = d <= C[0][0] ? 0 : Math.max(0, Math.min(1, (d - a[0]) / ((b[0] - a[0]) || 1))), L = c => a[c] + (b[c] - a[c]) * t;
    return { back: -L(3), up: -L(2), ahead: L(7), lookUp: -L(6), far: L(9) };
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
    if (bL && bR) return { turn: -MOVEDELTA_B * 0.5 * (pl - pr), power: (ex(pl) + ex(pr)) / 2, dir: -1 };   // PLACEHOLDER: both back = reverse
    if (fL && bR) return { turn: TURNDELTA2 * Math.min(1, ex((pl + pr) / 2) + 0.0), power: 0, dir: 0 };    // sTurn90: spin right
    if (fR && bL) return { turn: -TURNDELTA2 * Math.min(1, ex((pl + pr) / 2)), power: 0, dir: 0 };
    return { turn: 0, power: 0, dir: 0 };
  }

  // ---- lumps (A60, A64) ----
  // MonoIbitsu.cppi: the farthest IBITSU tip of each of the last N attached objects becomes a "fluid" distort point (up to 6). Katamari.sSetPosition-style code then puts the
  // surface at len = R + (tip - R) * spd_ratio, capped at 2.5 R: lumps are full size when the ball rolls at or below its normal top speed and melt away toward dash speed.
  // N (IbitsuCheckDepth) and the cone width (LUMP_SHARP) are guesses; the rest follows the source.
  const FLIP_FRAMES = 14, FLIP_MIN = 0.3;
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
  // The KPARAM values (CrumbleAngle, CrumbleSpeedRatio, CrumbleRatio, CrumbleDepth, CrumbleSpdRatio, IbitsuConvergeRatio) are not in the sources: GUESSED, kept mild
  const CR = { angle: 0.3, spd: 0.5, vol: 0.1, depth: 10, fly: 1.0, pop: 0.35, cool: 15, hitOff: 10, conv: 0.02, convMin: 0.5, flyMax: 240 };
  // speed power x angle power of one hit: ground type of sGetSpeedRatio ((v/vmax - 0.25) / 0.25) times (acos(move . wall) - 90 deg) / 90 deg
  function impactPower(vx, vz, nx, nz, vIn, vmax) {
    if (vIn < 1e-6) return 0; const inner = (vx * nx + vz * nz) / vIn; if (inner >= 0) return 0;
    const ref = (Math.acos(Math.max(-1, inner)) - Math.PI / 2) / (Math.PI / 2), sp = Math.max(0, Math.min(1, (Math.min(1, vIn / vmax) - 0.25) / 0.25));
    return sp * ref;
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
    const h = Math.hypot(wp[0], wp[2]) || 1, tp = tableParams(S), spd = tp.speed * tp.rF * (0.6 + 0.4 * power) * CR.fly;
    o.vel = [wp[0] / h * spd, spd * CR.pop, wp[2] / h * spd];
    o.spin = { ax: norm([wp[2], 0, -wp[0]]), w: 0.15 + 0.25 * power };
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
    const ratio = 1 - Math.min(1, S.speed / vmax) * CR.conv; if (ratio >= 1) return;
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

  function step(S, input) {
    S.frame++; S.events.length = 0; moveMonos(S); flyMonos(S); if (S.crumbleCool > 0) S.crumbleCool--;
    const inp = input.L !== undefined ? input : Object.assign(tank(input.fwd || 0, input.turn || 0), { dash: input.dash });
    const R = radius(S), stepUp = Math.max(0.5 * R, 1.0), climb = Math.max(CLIMB * R, 1.0), tp = tableParams(S);
    // lumps lift the ball: the surface point that faces down decides how high the centre rides. Eased so it does not jitter (A64)
    S.lumps = lumpsOf(S, R); { const dn = mvec(mtr(S.R), [0, -1, 0]), want = S.lumps.length ? Math.min((lumpMult(S.lumps, dn) - 1) * R, LUMP_LIFT_MAX * R) : 0; S.lift += (want - S.lift) * 0.3; if (S.lift < 1e-4) S.lift = 0; }
    S.pos[1] -= S.liftApplied; S.liftApplied = 0;   // the physics below runs on the round ball; the lift is added back at the end of the step
    const st = readSticks(inp.L, inp.R);
    // quick turn (OSTAT Jump180): pulling both sticks back while rolling makes the prince hop over the ball to the other side and face the other way.
    // The state exists in the sources but what sets it does not, so the trigger and timing are guessed (A66)
    { const sp = Math.sin(S.yaw), cp = Math.cos(S.yaw);
      if (S.flipT === 0 && !S.flipLock && st.dir === -1 && st.power >= 0.6 && S.v[0] * sp + S.v[1] * cp > FLIP_MIN * tp.speed) { S.flipT = FLIP_FRAMES; S.events.push({ type: 'flip' }); }
      if (st.dir !== -1 && S.flipT === 0) S.flipLock = false;
      if (S.flipT > 0) { S.yaw += Math.PI / FLIP_FRAMES; S.flipT--; if (S.flipT === 0) S.flipLock = true; } else S.yaw += st.turn; }
    S.input = { L: inp.L, R: inp.R, turn: st.turn, power: st.power };
    // dash: up to DASH_DURATION frames, then DASH_FORBID frames of cooldown (PLACEHOLDER: the real dash is a swipe gesture, see P11)
    if (S.dashCool > 0) S.dashCool--;
    const wantDash = !!inp.dash && st.dir === 1 && S.dashCool === 0;
    if (wantDash) { S.dashT++; if (S.dashT > DASH_DURATION) { S.dashT = 0; S.dashCool = DASH_FORBID; } } else S.dashT = 0;
    S.dash = wantDash && S.dashCool === 0;
    // acceleration along the facing direction, capped at the table speed (sControl)
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    let acc = 0, ratio = 0, dir = (S.flipT > 0 || (S.flipLock && st.dir === -1)) ? 0 : st.dir, power = st.power;
    if (S.dash) { power = 1; acc = tp.accD; ratio = tp.rD; }
    else if (dir === 1) { acc = tp.accF * power; ratio = tp.rF * (MIN_POWER_SPEED + (1 - MIN_POWER_SPEED) * power); }
    else if (dir === -1) { acc = tp.accB * power; ratio = tp.rB * (MIN_POWER_SPEED + (1 - MIN_POWER_SPEED) * power); }
    const fmax = tp.speed * ratio;
    let vx = S.v[0], vz = S.v[1]; const oldMag = Math.hypot(vx, vz);
    if (dir !== 0) {
      let ix = fx * dir, iz = fz * dir;
      // pushing against the motion brakes instead of accelerating (sCheckBreakInput, simplified)
      if (oldMag > 0.05 && (ix * vx + iz * vz) / oldMag < -0.3) { const b = (dir === 1 ? tp.brakeF : tp.brakeB) * power; vx -= vx / oldMag * Math.min(b, oldMag); vz -= vz / oldMag * Math.min(b, oldMag); }
      else {
        vx += ix * acc; vz += iz * acc; const nm = Math.hypot(vx, vz);
        if (nm > fmax && nm > oldMag) { const keep = oldMag < fmax ? fmax : oldMag; vx = vx / nm * keep; vz = vz / nm * keep; }   // same overshoot rule as the engine
      }
    }
    vx *= 1 - DRAG; vz *= 1 - DRAG;
    if (Math.hypot(vx, vz) < 1e-3) { vx = 0; vz = 0; }
    const vx0 = vx, vz0 = vz, vIn = Math.hypot(vx, vz), vmax = tp.speed * tp.rD; let hitPow = 0;   // incoming velocity, for crumble
    const bottom = S.pos[1] - R;
    const ok = (x, z) => supportAt(S, x, z, bottom + stepUp, bottom + climb) !== null;
    let dx = vx, dz = vz, moved = 0, mx = 0, mz = 0;
    if (dx || dz) {
      const nx = S.pos[0] + dx, nz = S.pos[2] + dz;
      if (ok(nx, nz)) { S.pos[0] = nx; S.pos[2] = nz; mx = dx; mz = dz; }
      else if (ok(S.pos[0] + dx, S.pos[2])) { S.pos[0] += dx; mx = dx; vz *= 0.3; }
      else if (ok(S.pos[0], S.pos[2] + dz)) { S.pos[2] += dz; mz = dz; vx *= 0.3; }
      else { vx *= 0.3; vz *= 0.3; }
      moved = Math.hypot(mx, mz);
    }
    // solid objects: anything too big to pick up is a box (P8). Low ones are rolled over (P9)
    const diamMm = S.diam * 10;
    for (const o of S.objs) {
      if (o.state !== 'map' || o.catchMm <= diamMm) continue;
      if (o.top <= bottom + climb) continue;
      if (Math.hypot(o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]) > R + o.maxlen) continue;
      const bc = boxClosest(o, S.pos); if (bc.dist >= R || bc.dist < 1e-6) continue;
      const nx = S.pos[0] - bc.p[0], nz = S.pos[2] - bc.p[2], hl = Math.hypot(nx, nz); if (hl < 1e-6) continue;
      const push = (R - bc.dist) / bc.dist, px = S.pos[0] + (S.pos[0] - bc.p[0]) * push, pz = S.pos[2] + (S.pos[2] - bc.p[2]) * push;
      if (ok(px, pz)) { S.pos[0] = px; S.pos[2] = pz; const ux = nx / hl, uz = nz / hl, vn = vx * ux + vz * uz; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, ux, uz, vIn, vmax)); vx -= vn * ux; vz -= vn * uz; } }
    }
    // walls from the collision mesh
    for (const n of hitWalls(S, R)) { const vn = vx * n[0] + vz * n[1]; if (vn < 0) { hitPow = Math.max(hitPow, impactPower(vx0, vz0, n[0], n[1], vIn, vmax)); vx -= vn * n[0]; vz -= vn * n[1]; } }
    if (hitPow > 0) crumbleHit(S, hitPow, vIn, vmax);
    S.v[0] = vx; S.v[1] = vz; S.speed = Math.hypot(vx, vz); if (S.rampLift) S.vy = Math.max(S.vy, 0);
    // vertical
    const g = gravity(S); S.vy -= g;
    let y = S.pos[1] + S.vy; const sup = supportAt(S, S.pos[0], S.pos[2], y - R + stepUp + Math.max(0, -S.vy), y - R + climb + Math.max(0, -S.vy));
    if (sup !== null && y - R <= sup) { y = sup + R; S.vy = 0; }
    S.pos[1] = y; S.grounded = sup !== null && Math.abs(y - R - sup) < 1e-3;
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
      if (boxClosest(o, S.pos).dist > R) continue;                         // ball surface touches the box (PLACEHOLDER P5: stands in for the engine's ray and box test)
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

  const API = { splineAt, moveMonos, FPS, CLIMB, supportAt, create, step, boxClosest, rayHit, hitWalls, tank, readSticks, tableParams, lumpsOf, lumpMult, cameraParams, radius, maxSpeed, gravity, groundAt, diamFromVol, sphereVol, mmul, mvec, mtr, eulerView, interpRows, pairs, I3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KSim = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
