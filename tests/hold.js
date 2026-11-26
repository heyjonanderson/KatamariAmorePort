// sCheckHoldInWall port: squeezed between walls sheds a little, 15 held frames in a row shed more.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'S006', 'play.json'), 'utf8'));
const W = (x, z) => ({ n: [x, z], o: null });
function ball() {
  const S = K.create(play, { noTarget: true }), R = K.radius(S);
  S.objs.slice(0, 40).forEach((o, i) => { o.state = 'ball'; o.lpos = [(i % 5) * R * 0.1, 0, 0]; o.lrot = [1,0,0,0,1,0,0,0,1]; o.addVol = o.addVol || 1; o.crumbleVol = 1e12; S.attached.push(o); S.ibiList.push(o); });
  return S;
}
const run = (S, walls) => { const c = S.crumbled; K.holdInWall(S, walls, c); return S.crumbled - c; };
{ const S = ball(); run(S, [W(1, 0)]); ok(!S.holdIn && S.holdTime === 0, 'one wall is not held'); }
{ const S = ball(); run(S, [W(1, 0), W(0, 1)]); ok(!S.holdIn, 'two walls at 90 degrees are not held'); }
{ const S = ball(); run(S, [W(1, 0), W(-1, 0)]); ok(S.holdIn && S.holdTime === 1, 'two opposing walls hold'); }
{ const S = ball(); const a = 140 * Math.PI / 180; run(S, [W(1, 0), W(Math.cos(a), Math.sin(a))]); ok(!S.holdIn, '140 degrees is under the 150 limit'); }
{ const S = ball(); run(S, [W(1, 0), W(0, 1), W(-1, 0)]); ok(S.holdIn, 'three walls hold'); }
{ const S = ball(), V = S.volume, n0 = S.attached.length; for (let i = 0; i < 14; i++) run(S, [W(1, 0), W(0, 1), W(-1, 0)]); ok(S.holdTime === 14, 'time counts, ' + S.holdTime);
  const before = S.attached.length; run(S, [W(1, 0), W(0, 1), W(-1, 0)]); ok(S.holdTime === 1, 'time resets to 1 at 15, ' + S.holdTime); console.log('attached', n0, '->', before, '->', S.attached.length, 'volume', V.toFixed(1), '->', S.volume.toFixed(1)); }
{ const S = ball(); run(S, [W(1, 0)]); run(S, [W(-1, 0)]); run(S, [W(1, 0)]); ok(S.holdIn, 'flicker between opposing walls over three frames holds'); }
{ const S = ball(); run(S, [W(1, 0)]); run(S, [W(-1, 0)]); run(S, [W(-1, 0)]); ok(!S.holdIn, 'no flicker when the third frame matches the second'); }
{ const S = ball(); run(S, [W(1, 0), W(-1, 0)]); run(S, []); ok(!S.holdIn && S.holdTime === 0, 'free frame clears it'); }
{ const S = ball(); S.attached.forEach(o => { o.crumbleVol = 1e-9; }); const n0 = S.attached.length, c = run(S, [W(1, 0), W(-1, 0)]); ok(c >= 1 && S.attached.length < n0, 'a held frame sheds something, shed ' + c);
  for (let i = 0; i < 14; i++) run(S, [W(1, 0), W(-1, 0)]); ok(S.attached.length < n0 - 1, 'repeated holding keeps shedding, left ' + S.attached.length + ' of ' + n0); }
console.log(fail ? 'FAILED ' + fail : 'hold ok'); process.exit(fail ? 1 : 0);
