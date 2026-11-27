// Sideways slide while climbing (A151). The engine accelerates the ball straight into the wall while it climbs (no stick angle, no drag), so a ball that enters a wall
// at an angle keeps only the sideways speed it came with. With `climbLock` (optional, off by default) the sideways part is removed. Usage: node tests/climbslide.js
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
function run(angle, lock) {
  const S = K.create(play, { climbLock: lock }); for (let i = 0; i < 120; i++) K.step(S, {});
  const R = K.radius(S), fl = S.pos[1] - R, fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), d = R + 10;
  S.objs.push({ n: 'BOX', state: 'map', catchMm: 1e7, pos: [S.pos[0] + fx * d, fl, S.pos[2] + fz * d], rot: [fz, 0, fx, 0, 1, 0, -fx, 0, fz], lo: [-60, 0, 0], hi: [60, 30, 30], top: fl + 30, maxlen: 100, layer: 0, hitOff: 0 });
  S.yaw += angle; let on0 = null, side = 0, f0 = 0;
  for (let f = 0; f < 90; f++) {
    K.step(S, { fwd: 1, turn: 0 });
    if (S.cw.on && on0 === null) { on0 = S.pos.slice(); f0 = f; }
    if (S.cw.on) side = Math.abs((S.pos[0] - on0[0]) * fz - (S.pos[2] - on0[2]) * fx);   // distance along the wall since the climb began
  }
  return { climbedFrom: f0, slideAlongWall: +side.toFixed(2), R: +R.toFixed(2) };
}
let bad = 0;
for (const a of [0, 0.3, 0.55]) { const o = run(a, false), l = run(a, true); console.log('angle', a, 'engine', o, 'locked', l); if (l.slideAlongWall > 0.05) { bad++; console.log('FAIL locked climb still slides'); } }
console.log(bad ? 'FAIL' : 'PASS'); process.exit(bad ? 1 : 0);
