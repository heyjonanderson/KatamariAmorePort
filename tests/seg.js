// Ray stage 1 (A145): one sided segment test against the collision polygons.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'S001', 'play.json'), 'utf8'));
const S = K.create(play, { noTarget: true });
// synthetic: one floor triangle, front side up (cross(e1,e2).y < 0 in this data)
const mk = tris => ({ hit: { tris: Float32Array.from(tris), cells: new Map([[0, tris.length / 9 === 1 ? [0] : [0, 1]]]), big: [], kind: null }, erased: null });
{ const F = mk([0,0,0, 10,0,0, 0,0,10]); // cross = (e1 x e2) = (0,0,10)x... check sign by the test itself
  const down = K.segHit(F, [2,5,2], [2,-5,2]), up = K.segHit(F, [2,-5,2], [2,5,2]);
  ok(!!down !== !!up, 'exactly one side counts, down ' + !!down + ' up ' + !!up);
  const h = down || up; ok(h && Math.abs(h.r - 0.5) < 1e-9, 'ratio 0.5, ' + (h && h.r));
  ok(h && Math.abs(Math.abs(h.n[1]) - 1) < 1e-9, 'flat normal');
  ok(!K.segHit(F, [20,5,2], [20,-5,2]), 'outside the triangle misses');
  ok(!K.segHit(F, [2,5,2], [2,1,2]), 'segment that stops short misses'); }
// S001: the real floor is hit from above with a normal pointing up, from below not at all
{ let found = null; for (let x = 20; x < 200 && !found; x += 7) for (let z = 20; z < 200 && !found; z += 7) { const h = K.segHit(S, [x, 8, z], [x, -2, z]); if (h) found = [x, z, h]; }
  ok(found, 'floor found'); if (found) { const [x, z, h] = found;
    ok(h.n[1] > 0.99, 'floor normal up, ' + h.n.join(','));
    ok(Math.abs(h.r - 0.5) < 0.5, 'ratio inside the segment');
    const below = K.segHit(S, [x, -2, z], [x, 8, z]); ok(!below || below.t !== h.t, 'from below the floor does not count'); }
  // downward facing polygons (ny > 0.99 in the data) are hit from below at their centroid, and that same polygon is not hit from above
  const H = S.hit, T = H.tris; let n = 0, bad = 0;
  for (let t = 0; t < T.length / 9; t++) { if (H.ny[t] <= 0.99) continue; n++; const o = t * 9, cx = (T[o]+T[o+3]+T[o+6])/3, cy = (T[o+1]+T[o+4]+T[o+7])/3, cz = (T[o+2]+T[o+5]+T[o+8])/3;
    const lo = K.segHit(S, [cx, cy - 0.5, cz], [cx, cy + 0.5, cz]), hi = K.segHit(S, [cx, cy + 0.5, cz], [cx, cy - 0.5, cz]);
    if (!lo || (hi && hi.t === t)) bad++; }
  ok(n > 0 && bad <= n * 0.1, 'down facing polygons count from below only, ' + bad + ' of ' + n + ' wrong'); }
console.log(fail ? 'FAILED ' + fail : 'seg ok'); process.exit(fail ? 1 : 0);
