// Placement rotation check (A136): objects tilted about x or z must rest on the map surface with their lowest box corner. Counts, over all stages,
// the tilted objects whose lowest oriented-box corner is within 2 cm of the surface under it. Usage: node tests/placerot.js
const fs = require('fs'), path = require('path'), K = require('../sim.js');
function groundAt(T, x, z, ymax) { let best = -1e9; for (let t = 0; t < T.length / 9; t++) { const o = t * 9; const ax = T[o], az = T[o+2], bx = T[o+3], bz = T[o+5], cx = T[o+6], cz = T[o+8]; const d = (bz-cz)*(ax-cx)+(cx-bx)*(az-cz); if (Math.abs(d) < 1e-9) continue; const l1 = ((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d, l2 = ((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d, l3 = 1-l1-l2; if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const h = l1*T[o+1]+l2*T[o+4]+l3*T[o+7]; if (h <= ymax && h > best) best = h; } return best; }
const mm = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j]; return r; };
const RX = a => [1,0,0, 0,Math.cos(a),-Math.sin(a), 0,Math.sin(a),Math.cos(a)], RY = a => [Math.cos(a),0,Math.sin(a), 0,1,0, -Math.sin(a),0,Math.cos(a)], RZ = a => [Math.cos(a),-Math.sin(a),0, Math.sin(a),Math.cos(a),0, 0,0,1], D = Math.PI / 180;
const oldRot = r => mm(RZ(-r[2] * D), mm(RY(-r[1] * D), RX(r[0] * D)));   // the A97 signs
let n = 0, ok = 0, okOld = 0;
for (const st of fs.readdirSync(path.join(__dirname, '..', 'data')).filter(s => /^S0\d\d$/.test(s))) {
  let p; try { p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', st, 'play.json'), 'utf8')); } catch (e) { continue; }
  const S = K.create(p, { noTarget: true }), seen = new Set();
  for (const o of S.objs) {
    const r = o.rawRot; if (!r || (Math.abs(r[0]) < 3 && Math.abs(r[2]) < 3)) continue;
    const key = o.n + o.pos.join(); if (seen.has(key)) continue; seen.add(key);
    const inf = p.info[o.n]; if (!inf || !inf.lo) continue;
    const fit = R => { let minY = 1e9, cx = 0, cz = 0; for (const x of [inf.lo[0], inf.hi[0]]) for (const y of [inf.lo[1], inf.hi[1]]) for (const z of [inf.lo[2], inf.hi[2]]) { const w = [R[0]*x+R[1]*y+R[2]*z, R[3]*x+R[4]*y+R[5]*z, R[6]*x+R[7]*y+R[8]*z]; if (w[1] < minY) { minY = w[1]; cx = w[0]; cz = w[2]; } }
      const g = groundAt(p.tris, o.pos[0] + cx, o.pos[2] + cz, o.pos[1] + minY + 30); return g < -1e8 ? null : Math.abs(o.pos[1] + minY - g) < 2; };
    const a = fit(o.rot), b = fit(oldRot(r)); if (a === null || b === null) continue; n++; if (a) ok++; if (b) okOld++;
  }
}
console.log('tilted objects on a surface:', n, 'resting within 2 cm: now', ok, ', with the A97 signs', okOld);
if (ok <= okOld) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
