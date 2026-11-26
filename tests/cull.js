// A123: buried objects. Objects whose far edge (distance + bounding radius) is inside the threshold leave the ball's list.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'S006', 'play.json'), 'utf8'));
for (const n of [50, 100, 160, 400]) {
  const S = K.create(play, { noTarget: true }), R = K.radius(S), objs = S.objs.slice(0, n); objs.forEach(o => { o.maxlen = R * 0.05; });
  objs.forEach((o, i) => { o.state = 'ball'; const f = (i + 0.5) / objs.length; o.lpos = [f * R, 0, 0]; o.lrot = [1,0,0,0,1,0,0,0,1]; S.attached.push(o); });
  K.cullStuck(S, R);
  const nn = objs.length, lo = R * 0.38, thr = lo + (nn > 90 ? (R - lo) * Math.min(1, (nn - 90) / 70) * 0.8 : 0);
  const want = objs.filter(o => o.lpos[0] + o.maxlen < thr).length;
  ok(S.buried === want && S.attached.length === objs.length - want, `n=${n}: buried ${S.buried} want ${want}`);
  console.log(`n=${n}: threshold ${(thr / R).toFixed(3)} R, buried ${S.buried}, still stuck ${S.attached.length}`);
  const b = S.buried; K.cullStuck(S, R); ok(S.buried === b, 'second pass changes nothing');
}
const S2 = K.create(play, { noTarget: true, noCull: true }); S2.attached.push({ lpos: [0, 0, 0], maxlen: 0.1, state: 'ball' }); K.cullStuck(S2, K.radius(S2)); ok(S2.buried === 0, 'noCull switch');
console.log(fail ? 'FAILED ' + fail : 'cull ok'); process.exit(fail ? 1 : 0);
