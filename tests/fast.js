// sCheckFast (A149): a frame move of at least the radius uses the five swept rays. A ball thrown down at several times its radius per frame must land on the floor, not tunnel
const K = require('../sim.js'), play = require('../data/S001/play.json');
let bad = 0;
for (const vy of [-3, -6, -12, -30]) {
  const S = K.create(play, { noTarget: true, ray: true }); for (let i = 0; i < 60; i++) K.step(S, { L: 0, R: 0 });
  const R = K.radius(S), floor = S.pos[1] - R; S.pos[1] += 40; S.vy = vy; let fast = 0, minY = 1e9;
  for (let f = 0; f < 900; f++) { K.step(S, { fwd: 0, turn: 0 }); minY = Math.min(minY, S.pos[1] - R); if (S.lastRay && S.lastRay.c.fast) fast++; }
  const ok = minY > floor - 0.5 && Math.abs(S.pos[1] - R - floor) < 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} vy ${vy} (R ${R.toFixed(1)}): fast frames ${fast}, lowest bottom ${(minY - floor).toFixed(2)} cm from the floor, rests ${(S.pos[1] - R - floor).toFixed(2)}`); if (!ok) bad++;
}
console.log(bad ? 'FAIL' : 'PASS'); process.exit(bad ? 1 : 0);
