// Path-planning bot. Grid BFS over free cells (floor + walls + too-big objects blocked), replans as the ball grows.
// Usage: node tests/bot2.js [stage] [maxFrames] [cell cm]
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const stage = process.argv[2] || 'S001', maxF = +(process.argv[3] || 60000), CELLMIN = +(process.argv[4] || 4); let CELL = CELLMIN;
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', stage, 'play.json'), 'utf8'));
const S = K.create(play, process.env.CATCH ? { catchMode: process.env.CATCH } : {}); if (process.env.GOAL) S.goal = +process.env.GOAL; for (let i = 0; i < 120; i++) K.step(S, { L: 0, R: 0 });
const key = (i, j) => i * 100000 + j, ang = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
let why = '', plan = null, planFrame = -1e9, picks = 0, log = [];
function replan() {
  CELL = Math.max(CELLMIN, Math.round(K.radius(S) * 0.4));   // grid scales with the ball so big stages stay small enough to search
  const R = K.radius(S), stepUp = Math.max(0.5 * R, 1), climb = Math.max(K.CLIMB * R, 1), big = S.objs.filter(o => o.state === 'map' && o.catchMm > S.diam * 10);
  const freeAt = (x, z, fromY) => {
    const g = K.supportAt(S, x, z, fromY + stepUp + CELL * 1.05, fromY + climb); if (g === null) { why = 'nosupport'; return null; }
    { const up = K.groundAt(S.G, x, z, g + 2 * R * 0.95); if (up !== null && up > g + stepUp + CELL * 1.05) { why = 'ceiling'; return null; } }
    const sl = Math.max(Math.abs(K.supportAt(S, x + 1, z, g + 3, g + 3) - g) || 0, Math.abs(K.supportAt(S, x, z + 1, g + 3, g + 3) - g) || 0), off = R * Math.sqrt(1 + sl * sl);   // ball centre sits R off a sloped surface, not R above it
    const P = { hit: S.hit, erased: S.erased, pos: [x, g + off, z] }; if (K.hitWalls(P, R, true).length || Math.hypot(P.pos[0] - x, P.pos[2] - z) > 1e-6) { why = 'wall'; return null; }
    for (const o of big) { if (o.top <= g + climb) continue; if (Math.abs(o.pos[0] - x) > R + o.maxlen || Math.abs(o.pos[2] - z) > R + o.maxlen) continue; if (K.boxClosest(o, [x, g + R, z]).dist < R * 0.98) { why = 'obj:' + o.n; return null; } }
    return g;
  };
  globalThis.__freeAt = freeAt; globalThis.__why = () => why;
  const si = Math.round(S.pos[0] / CELL), sj = Math.round(S.pos[2] / CELL), dist = new Map(), par = new Map(), gy = new Map(), q = [[si, sj]];
  dist.set(key(si, sj), 0); gy.set(key(si, sj), S.pos[1] - R);
  for (let h = 0; h < q.length && dist.size < 250000; h++) { const [i, j] = q[h], d = dist.get(key(i, j)), y = gy.get(key(i, j));
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) { const ni = i + di, nj = j + dj, k = key(ni, nj); if (dist.has(k)) continue; const g = freeAt(ni * CELL, nj * CELL, y); if (g === null) continue;
      if (di && dj && (!gy.has(key(i + di, j)) && freeAt((i + di) * CELL, j * CELL, y) === null || !gy.has(key(i, j + dj)) && freeAt(i * CELL, (j + dj) * CELL, y) === null)) continue;
      dist.set(k, d + (di && dj ? 1.414 : 1)); par.set(k, [i, j]); gy.set(k, g); q.push([ni, nj]); } }
  // target: nearest (by path) catchable object that some reached cell can touch
  let best = null, bd = 1e18;
  for (const o of S.objs) { if (o.state !== 'map' || o.catchMm > S.diam * 10) continue;
    const ci = Math.round(o.pos[0] / CELL), cj = Math.round(o.pos[2] / CELL), rr = Math.ceil((R + o.maxlen) / CELL);
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) { const k = key(ci + a, cj + b), d0 = dist.get(k); if (d0 === undefined) continue; const d = o.n === S.target ? d0 * 0.001 : (process.env.GREEDY ? d0 : (d0 * CELL + 30) / Math.cbrt(Math.max(o.boxvol * o.addRatio, 1e-9))); if (d >= bd) continue; const g = gy.get(k), x = (ci + a) * CELL, z = (cj + b) * CELL;
      if (K.boxClosest(o, [x, g + R, z]).dist > R * 0.97) continue; bd = d; best = { o, cell: [ci + a, cj + b] }; } }
  if (process.env.DBG2 && !best) { const o = S.objs.find(o => o.n === 'BUTTON01_A' && o.state === 'map'); const ci = Math.round(o.pos[0] / CELL), cj = Math.round(o.pos[2] / CELL); let nearest = 1e9, cnt = 0; for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) { const k = key(ci + a, cj + b); if (dist.has(k)) { cnt++; nearest = Math.min(nearest, Math.hypot(a, b) * CELL); } } { const k = key(ci, cj); const g = gy.get(k); const bc = K.boxClosest(o, [ci * CELL, g + R, cj * CELL]); log.push(`g ${g} bc ${JSON.stringify(bc)} catch ${o.catchMm} diam ${S.diam}`); } log.push(`button ${o.pos.map(v=>v.toFixed(0))} cells near ${cnt} nearest ${nearest} R ${R.toFixed(1)} cells ${dist.size} ballcell ${si},${sj}`); }
  if (process.env.DBG3 && !best) { for (const [x, z] of [[40,174],[49,174],[64,174],[79,174],[89,174],[99,174],[110,174]]) { const k = key(Math.round(x/CELL), Math.round(z/CELL)); log.push(`cell ${x},${z} reached ${dist.has(k)} g ${gy.get(k)} sup ${K.supportAt(S, x, z, 500, 500)} free ${freeAt(x, z, 300)}`); } }
  let route = null; if (best) { route = []; let c = best.cell; while (c) { route.push(c); c = par.get(key(c[0], c[1])); } route.reverse(); }
  plan = { route, idx: 0, target: best && best.o, cells: dist.size }; planFrame = S.frame; globalThis.__dist = dist; globalThis.__gy = gy;
  if (process.env.DBG && S.frame - (replan.lastLog || -1e9) > 600) { replan.lastLog = S.frame; const tk = [[81,61],[-94,82],[89,174]].map(p => dist.has(key(Math.round(p[0]/CELL), Math.round(p[1]/CELL))) ? 'Y' : 'n').join(''); log.push(`f${S.frame} diam ${S.diam.toFixed(1)} cells ${dist.size} probes ${tk}`); }
}
let noTarget = 0, lastPos = S.pos.slice(), stuckT = 0;
for (let f = 0; f < maxF && !S.won && S.frame < maxF; f++) {
  if (S.frame - planFrame > (plan && plan.target && plan.target.n === S.target ? 12 : 90) || !plan || !plan.route || plan.target.state !== 'map') replan();
  let inp = { fwd: 0, turn: 0 };
  if (plan.route) {
    const r = plan.route; while (plan.idx < r.length - 1 && Math.hypot(r[plan.idx][0] * CELL - S.pos[0], r[plan.idx][1] * CELL - S.pos[2]) < Math.max(CELL * 1.5, K.radius(S) * 0.6)) plan.idx++;
    const w = r[Math.min(plan.idx + 2, r.length - 1)], want = Math.atan2(w[0] * CELL - S.pos[0], w[1] * CELL - S.pos[2]), e = ang(S.yaw, want);
    inp = { turn: Math.max(-1, Math.min(1, -e * 3)), fwd: Math.abs(e) < 1.0 ? 1 : 0 };
    noTarget = 0;
  } else { noTarget++; inp = { turn: 0.5, fwd: 0 }; if (noTarget > 600) { log.push('no reachable catchable target at frame ' + S.frame + ' diam ' + S.diam.toFixed(2)); break; } }
  if (process.env.TRACE && S.frame % 300 === 0) console.log(S.frame, 'pos', S.pos.map(v => v.toFixed(0)).join(','), 'diam', S.diam.toFixed(1), 'target', plan.target && plan.target.n + '@' + plan.target.pos.map(v => v.toFixed(0)), 'route', plan.route ? plan.route.length : 0);
  const before = S.picked; K.step(S, inp); if (S.picked > before || S.events.some(e => e.type === 'area')) { picks = S.picked; planFrame = -1e9; if (S.events.some(e => e.type === 'area')) log.push('area event at frame ' + S.frame + ' diam ' + S.diam.toFixed(1)); }
  if (S.frame % 150 === 0) { if (Math.hypot(S.pos[0] - lastPos[0], S.pos[2] - lastPos[2]) < 0.2 * K.radius(S)) stuckT++; else stuckT = 0; lastPos = S.pos.slice(); if (stuckT >= 4) { log.push('stuck at frame ' + S.frame + ' pos ' + S.pos.map(v => v.toFixed(1)) + ' diam ' + S.diam.toFixed(2) + ' target ' + (plan.target && plan.target.n)); plan = null; stuckT = 0; for (let i = 0; i < 40; i++) K.step(S, { fwd: -1, turn: 0.5 }); } }
}
console.log(`${stage}: frames ${S.frame} (${(S.frame / 30).toFixed(0)} s), picked ${S.picked}/${S.objs.length}, diam ${S.diam.toFixed(2)} cm, goal ${S.goal}, won ${S.won}`); { const t = S.objs.find(o => o.n === S.target); if (t) console.log('  target', t.n, 'state', t.state, 'path t', t.path && t.path.t.toFixed(3), 'ball', S.pos.map(v => v.toFixed(0)).join(',')); }
if (log.length) console.log('  ' + log.slice(0, 8).join('\n  '));
if (!S.won) { const R = K.radius(S), rem = S.objs.filter(o => o.state === 'map'), cat = rem.filter(o => o.catchMm <= S.diam * 10);
  console.log(`  remaining ${rem.length}, catchable now ${cat.length}, ball at ${S.pos.map(v => v.toFixed(0))}`);
  for (const o of cat.slice(0, 15)) console.log(`   ${o.n} catch ${o.catchMm}mm pos ${o.pos.map(v => v.toFixed(0))} lo.y ${o.lo[1].toFixed(1)} top ${o.top.toFixed(1)} maxlen ${o.maxlen.toFixed(1)} ground ${K.groundAt(S.G, o.pos[0], o.pos[2], 1000)}`);
  const sm = rem.filter(o => o.catchMm > S.diam * 10).sort((a, b) => a.catchMm - b.catchMm).slice(0, 6); console.log('  smallest uncatchable: ' + sm.map(o => o.n + ' ' + o.catchMm + 'mm@' + o.pos.map(v => v.toFixed(0))).join(' | ')); }

if (process.env.FRONT) { const fr = []; const dd = globalThis.__dist, R0 = K.radius(S); const stepUp = Math.max(0.5 * R0, 1), climb = Math.max(K.CLIMB * R0, 1); for (const k of dd.keys()) { const jj = ((k % 100000) + 150000) % 100000 - 50000; const i = (k - jj) / 100000; for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const k2 = key(i + di, jj + dj); if (dd.has(k2)) continue; const gx = (i + di) * CELL, gz = (jj + dj) * CELL; const sup = K.supportAt(S, gx, gz, 1e5, 1e5); const sup2 = K.supportAt(S, i * CELL, jj * CELL, 1e5, 1e5); const sup2b = globalThis.__gy.get(key(i, jj)); why = ''; const r = globalThis.__freeAt(gx, gz, sup2b); fr.push([gx, gz, sup, sup2, r === null ? globalThis.__why() : 'free?']); } } require('fs').writeFileSync(process.env.FRONT, JSON.stringify(fr)); }
if (process.env.MAP) { const cells = []; for (const k of (globalThis.__dist || new Map()).keys()) { const j = ((k % 100000) + 150000) % 100000 - 50000 + (((k % 100000) + 150000) % 100000 >= 50000 ? 0 : 0); const jj = ((k % 100000) + 100000 + 50000) % 100000 - 50000; cells.push([(k - jj) / 100000, jj]); }
  const cat = S.objs.filter(o => o.state === 'map' && o.catchMm <= S.diam * 10).map(o => [o.n, o.pos[0], o.pos[1], o.pos[2]]);
  require('fs').writeFileSync(process.env.MAP, JSON.stringify({ cell: CELL, cells, cat, ball: S.pos, diam: S.diam })); }
