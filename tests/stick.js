// Single-stick steering check (sim readCtrl, OujiCtrl4.cppi, A113, A121). Usage: node tests/stick.js
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
const fails = [];
function run(inp, frames) { const S = K.create(play, {}); S.objs.length = 0; for (let i = 0; i < 60; i++) K.step(S, {}); const y0 = S.yaw, p0 = S.pos.slice(); for (let f = 0; f < frames; f++) K.step(S, inp); return { S, dyaw: S.yaw - y0, dp: [S.pos[0] - p0[0], S.pos[2] - p0[2]], y0 }; }
const fwd1 = run({ fwd: 1, turn: 0 }, 90), st1 = run({ L: 1, R: 1, sx: 0, sz: 1 }, 90);
console.log('tank fwd', fwd1.dp.map(v => v.toFixed(1)), 'stick fwd', st1.dp.map(v => v.toFixed(1)));
if (Math.hypot(fwd1.dp[0] - st1.dp[0], fwd1.dp[1] - st1.dp[1]) > 0.5 || Math.abs(st1.dyaw) > 1e-9) fails.push('stick straight ahead should match two sticks forward');
const side = run({ L: 1, R: 1, sx: 1, sz: 0 }, 90), fx = Math.sin(side.y0), fz = Math.cos(side.y0), along = side.dp[0] * fx + side.dp[1] * fz, across = side.dp[0] * fz - side.dp[1] * fx;
console.log('side push: along facing', along.toFixed(1), 'across', across.toFixed(1), 'dyaw', side.dyaw.toFixed(4));
if (Math.abs(side.dyaw) > 1e-9) fails.push('a sideways stick must not turn the prince');
if (Math.abs(across) < 3 * Math.abs(along) || Math.abs(across) < 20) fails.push('a sideways stick should push the ball across the facing');
const diag = run({ L: 1, R: 1, sx: Math.SQRT1_2, sz: Math.SQRT1_2 }, 30), want = 30 * 0.06 * 0.5 * ((Math.PI / 4) / 0.8733223);
console.log('45 degrees: turn in 30 frames', diag.dyaw.toFixed(3), 'expected', want.toFixed(3));
if (Math.abs(diag.dyaw - want) > 0.01) fails.push('45 degree turn rate off');
const left = run({ L: 1, R: 1, sx: -Math.SQRT1_2, sz: Math.SQRT1_2 }, 30); if (Math.abs(left.dyaw + diag.dyaw) > 1e-9) fails.push('left should mirror right');
const back = run({ L: -1, R: -1, sx: 0, sz: -1 }, 90), bb = back.dp[0] * Math.sin(back.y0) + back.dp[1] * Math.cos(back.y0); console.log('back along facing', bb.toFixed(1)); if (bb >= -5) fails.push('stick straight back should roll the ball backwards');
{ // engine one-pad mapping
  const fw = run({ L: 1, R: 1, pad: [0, 1] }, 90); if (Math.hypot(fw.dp[0] - fwd1.dp[0], fw.dp[1] - fwd1.dp[1]) > 0.5) fails.push('pad straight forward should match two sticks forward');
  const sp = run({ L: 0, R: 0, pad: [0.8, 0] }, 20), spL = run({ L: 0, R: 0, pad: [-0.8, 0] }, 20); console.log('pad spin right', sp.dyaw.toFixed(3), 'left', spL.dyaw.toFixed(3));
  if (Math.abs(sp.dyaw - 20 * 0.055) > 1e-6 || Math.abs(spL.dyaw + 20 * 0.055) > 1e-6) fails.push('pad side zone should spin at 0.055 a frame');
  const bk = run({ L: 0, R: 0, pad: [0, -1] }, 40); if (Math.hypot(bk.dp[0], bk.dp[1]) > 1 || Math.abs(bk.dyaw) > 1e-9) fails.push('pad has no reverse');
}
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log('PASS');
