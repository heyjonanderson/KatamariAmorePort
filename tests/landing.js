// Landing bounce check (A107): a ball that lands after 5 or more frames in the air goes back up at 55% of its fall speed; a short drop does not bounce.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
function drop(h, vx) {
  const S = K.create(play, {}); for (let i = 0; i < 120; i++) K.step(S, {});
  const R = K.radius(S), fl = S.pos[1] - R; S.pos[1] = fl + R + h; S.vy = 0; S.grounded = false; S.flyT = 0; S.fallT = 0; S.v = [vx, 0];
  let fallV = 0, bounceV = 0, ev = 0, peak = 0, landedAt = -1;
  for (let f = 0; f < 200; f++) {
    K.step(S, {});
    const b = S.events.find(e => e.type === 'bounce'); if (b) { if (!ev) { fallV = b.fall; bounceV = b.v; } ev++; if (landedAt < 0) landedAt = f; }
    if (landedAt >= 0) peak = Math.max(peak, S.pos[1] - R - fl);
  }
  return { ev, fallV, bounceV, peak, flyAtEnd: S.flyT };
}
const fails = [], hi = drop(150, 0), lo = drop(0.6, 0), side = drop(150, 0.5);
console.log('150 cm drop', hi, '\n0.6 cm drop', lo, '\n150 cm drop moving', side);
if (hi.ev < 1) fails.push('no bounce after a 150 cm drop');
else if (Math.abs(hi.bounceV / Math.abs(hi.fallV) - 0.55) > 0.12) fails.push('bounce speed should be 55% of the fall speed, got ' + (hi.bounceV / Math.abs(hi.fallV)).toFixed(2));
if (lo.ev !== 0) fails.push('a 0.6 cm drop should not bounce');
if (hi.ev > 8) fails.push('bounces should die out quickly (NonReflectFlyTime 5 frames), got ' + hi.ev);
if (side.ev < 1) fails.push('no bounce when moving sideways');
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log('PASS');
