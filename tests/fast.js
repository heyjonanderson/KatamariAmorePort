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
// forced reflection with a wall (sw_force_sub_spd): a ball hitting a wall at several radii per frame comes back at half of the usual f32Reflection x speed
{
  const mk = () => { const S = K.create(play, { noTarget: true, ray: true }); for (let i = 0; i < 60; i++) K.step(S, { L: 0, R: 0 }); return S; };
  const S0 = mk(); let best = null;
  for (let a = 0; a < 16; a++) { const ang = a * Math.PI / 8, d = [Math.sin(ang), 0, Math.cos(ang)], h = K.segHit(S0, S0.pos.slice(), [S0.pos[0] + d[0] * 200, S0.pos[1], S0.pos[2] + d[2] * 200]); if (h && Math.abs(h.n[1]) < 0.2 && (!best || h.r < best.r)) best = { r: h.r, d, ang }; }
  const sp = 6, S = mk(); S.v = [best.d[0] * sp, best.d[2] * sp]; S.yaw = best.ang; let seen = null;
  for (let f = 0; f < 30 && !seen; f++) { K.step(S, { fwd: 0, turn: 0 }); if (S.reflV && S.lastRay.c.fast) seen = Math.hypot(...S.reflV); }
  const ok = seen !== null && seen < 0.4 * sp && seen > 0.1 * sp; console.log(`${ok ? 'ok  ' : 'FAIL'} wall at speed ${sp}: reflected speed ${seen === null ? 'none' : seen.toFixed(2)} (full f32Reflection would be about ${(0.55 * sp).toFixed(2)}, halved ${(0.275 * sp).toFixed(2)})`); if (!ok) bad++;
}
console.log(bad ? 'FAIL' : 'PASS'); process.exit(bad ? 1 : 0);
