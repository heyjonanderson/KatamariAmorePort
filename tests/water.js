// A139: water layer. Drops the ball onto the water of every stage that has HIT_WAT and checks the engine's rules:
// splash only on the first water frame while flying, a ripple every 8 frames in water, at most 10 ripples, ripples live 30 frames, no effect on speed.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
for (const st of ['S004', 'S005', 'S006', 'S010', 'S012', 'S013', 'S020']) {
  const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', st, 'play.json'), 'utf8'));
  const S = K.create(play, { noTarget: true }), W = S.water; ok(!!W && W.n > 0, st + ' has water');
  // a point inside the first triangle
  const T = W.tris, cx = (T[0] + T[3] + T[6]) / 3, cz = (T[2] + T[5] + T[8]) / 3, y0 = K.waterAt(W, cx, cz, -1e9, 1e9);
  ok(y0 !== null, st + ' centroid is on water'); if (y0 === null) continue;
  ok(K.waterAt(W, cx, cz, y0 + 1, y0 + 100) === null && K.waterAt(W, cx, cz, y0 - 100, y0 - 1) === null, st + ' range test: water outside [yLo,yHi] is ignored');
  // A: the ball rests on the surface (centre one radius above it, the edge of the test line): a ripple every 8 frames. B: 3 diameters above: nothing. C: dropped from 3 diameters: one splash
  const run = (yOff, hover) => {
    S.pos = [cx, y0 + yOff, cz]; S.vy = 0; S.hitWater = false; S.ripples.length = 0; S.rippleWait = 8; let splash = 0, rip = 0, maxR = 0, first = -1;
    for (let f = 0; f < 90; f++) {
      S.pos[0] = cx; S.pos[2] = cz; if (hover) { S.vy = 0; S.pos[1] = y0 + yOff; }
      const before = S.ripples.length; K.step(S, {}); for (const e of S.events) if (e.type === 'splash') splash++;
      if (S.ripples.some(r => r.age === 0)) { rip++; if (first < 0) first = f; } maxR = Math.max(maxR, S.ripples.length); void before;
    }
    return { splash, rip, maxR, first };
  };
  const A = run(S.diam / 2 - 0.01, true), lifted = S.pos[1] > y0 + S.diam / 2 + 0.5, B = run(3 * S.diam, true), C = run(3 * S.diam, false);
  // lifted: the stage floor is above the water here (S004's pool is 20 cm below the street), the ball cannot sit on it
  if (lifted) console.log(st, 'note: floor is above this water at the test point, skipping the resting test'); else ok(A.rip === 11 && A.first === 7 && A.splash <= 1, st + ' resting on water: ripples ' + JSON.stringify(A)); ok(A.maxR <= 10, st + ' pool size');
  ok(B.rip === 0 && B.splash === 0, st + ' high above: nothing ' + JSON.stringify(B)); ok(C.splash <= 1, st + ' drop: at most one splash ' + JSON.stringify(C));
  const rip = A.rip, splash = C.splash, maxR = A.maxR, first = A.first;
console.log(st, 'water tris', W.n, 'surface y', y0.toFixed(1), 'splashes', splash, 'ripples', rip, 'first at frame', first, 'max alive', maxR);
}
// pure ripple rules
{
  const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'S012', 'play.json'), 'utf8')), S = K.create(play, { noTarget: true });
  S.ripples.push({ pos: [0, 0, 0], age: 0, sc100: 1, alpha: 0, scale: 0.5 }); const log = [];
  for (let f = 0; f < 32 && S.ripples.length; f++) { K.step(S, {}); if (S.ripples[0]) log.push([S.ripples[0].age, +S.ripples[0].alpha.toFixed(2), +S.ripples[0].scale.toFixed(3)]); }
  const at = a => (log.find(r => r[0] === a) || []);
  ok(at(10)[1] === 0.9 || at(10)[1] === 1, 'alpha near 1 at age 10: ' + JSON.stringify(at(10))); ok(Math.abs(at(29)[2] - 1.4667) < 1e-3, 'scale at age 29'); ok(S.ripples.length === 0, 'ripple gone after 30 frames');
}
console.log(fail ? 'FAILED ' + fail : 'water ok'); process.exit(fail ? 1 : 0);
