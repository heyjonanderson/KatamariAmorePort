// Wall climb check: a flat box ahead of the ball on stage 1. Usage: node tests/climb.js
// Low box (2 cm): the ball goes on top. 3.5 cm box (0.7 of the 5 cm diameter): lifted onto the top. 5 cm box: lifted to the reach, held 10 frames, drops, locked out 10 frames.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
function run(H) {
  const S = K.create(play, {}); for (let i = 0; i < 120; i++) K.step(S, {});
  const R = K.radius(S), fl = S.pos[1] - R, fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), d = R + 10;
  S.objs.push({ n: 'BOX', state: 'map', catchMm: 1e7, pos: [S.pos[0] + fx * d, fl, S.pos[2] + fz * d], rot: [fz, 0, fx, 0, 1, 0, -fx, 0, fz], lo: [-30, 0, 0], hi: [30, H, 30], top: fl + H, maxlen: 60, layer: 0, hitOff: 0 });
  let maxRise = 0, climbed = 0, topFrames = 0, onTop = false, lastForbid = 0;
  for (let f = 0; f < 120; f++) { K.step(S, { fwd: 1, turn: 0 }); const c = S.cw; if (c.on) climbed++; if (c.on && c.top) topFrames++; lastForbid = Math.max(lastForbid, c.forbid); if (c.on) maxRise = Math.max(maxRise, S.pos[1] - R - fl); /* the rise while the climb itself runs */ if (S.grounded && Math.abs(S.pos[1] - R - fl - H) < 0.05) onTop = true; }
  return { climbed, topFrames, maxRise, onTop, lastForbid };
}
const lo = run(2), mid = run(3.5), hi = run(5), fails = [];
console.log('2 cm', lo, '\n3.5 cm', mid, '\n5 cm', hi);
if (!lo.onTop) fails.push('2 cm box not climbed');
if (!mid.onTop) fails.push('3.5 cm box not reached');
// in the sphere push (?hit=sphere) a 5 cm box stays out of reach. In ray mode (A150) the engine's own rays decide after the lockout: the ball's 18 sample points can slip over the corner, so it may end on top
const RAY = K.create(play, {}).ray;
if (!RAY && hi.onTop) fails.push('5 cm box should be out of reach');
if (hi.topFrames < 10 || hi.topFrames > 12) fails.push('top hold should be about 10 frames, got ' + hi.topFrames);
if (Math.abs(hi.maxRise - 3.5) > (RAY ? 0.4 : 0.1)) fails.push('rise should stop at 0.7 of the diameter (3.5), got ' + hi.maxRise.toFixed(2));
if (hi.lastForbid !== 10) fails.push('lockout should be 10 frames, got ' + hi.lastForbid);
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log('PASS');
