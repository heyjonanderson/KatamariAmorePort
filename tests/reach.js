// Flood fill over a grid: where can a ball of the start size go, given floor and collision walls? Reports how much of the object volume is reachable.
const fs = require('fs'), K = require('../sim.js');
const stage = process.argv[2] || 'S001', STEP = +(process.argv[3] || 4);
const play = JSON.parse(fs.readFileSync(`${__dirname}/../data/${stage}/play.json`)); const S = K.create(play);
for (let i = 0; i < 120; i++) K.step(S, { L: 0, R: 0 });
const R = K.radius(S), stepUp = Math.max(0.5 * R, 1);
const key = (i, j) => i * 100000 + j;
const free = (x, z, fromY) => { const g = K.groundAt(S.G, x, z, fromY + stepUp); if (g === null) return null; const P = { hit: S.hit, pos: [x, g + R, z] }; const out = K.hitWalls(P, R); if (out.length || Math.hypot(P.pos[0] - x, P.pos[2] - z) > 1e-6) return null; return g; };
const si = Math.round(S.pos[0] / STEP), sj = Math.round(S.pos[2] / STEP), seen = new Map(), q = [[si, sj, S.pos[1] - R]]; seen.set(key(si, sj), S.pos[1] - R);
while (q.length) { const [i, j, y] = q.pop(); for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const ni = i + di, nj = j + dj, k = key(ni, nj); if (seen.has(k)) continue; const g = free(ni * STEP, nj * STEP, y); if (g === null) continue; seen.set(k, g); q.push([ni, nj, g]); } }
let reach = 0, tot = 0, volR = 0, volT = 0, small = 0;
for (const o of S.objs) {
  const add = o.boxvol * o.addRatio * 1.2; tot++; volT += add;
  // reachable if some reached cell is within R + object bounding radius horizontally and the vertical gap is within reach
  let ok = false; const ci = Math.round(o.pos[0] / STEP), cj = Math.round(o.pos[2] / STEP), rr = Math.ceil((R + o.maxlen) / STEP) + 1;
  for (let a = -rr; a <= rr && !ok; a++) for (let b = -rr; b <= rr && !ok; b++) { const g = seen.get(key(ci + a, cj + b)); if (g === undefined) continue; if (Math.hypot((ci + a) * STEP - o.pos[0], (cj + b) * STEP - o.pos[2]) > R + o.maxlen) continue; if (o.pos[1] - o.maxlen <= g + 2 * R + 1 && o.pos[1] + o.maxlen >= g) ok = true; }
  if (ok) { reach++; volR += add; }
}
const need = K.sphereVol(S.goal / 200) - K.sphereVol(S.startDiam / 200);
console.log(`${stage} ball ${S.diam.toFixed(1)} cm. free cells ${seen.size} (${STEP} cm grid). objects reachable at start size: ${reach}/${tot}. add volume reachable ${(volR / need * 100).toFixed(0)}% of need (all objects ${(volT / need * 100).toFixed(0)}%)`);
