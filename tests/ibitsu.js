// Ray stage 4 (A148): a lump on the ball makes it rock over the planted tip (FLUID state), and never goes through the floor.
const K = require('../sim.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const play = require('../data/S001/play.json');
function ball(lumpLen, ang) {
  const S = K.create(play, { noTarget: true, ray: true }); S.diam = 10; S.pos = [-60, 8, 100]; S.yaw = 0; S.v = [0, 0];
  const R = K.radius(S), name = Object.keys(play.info).find(k => play.info[k].ibi && play.info[k].ibi.length);
  const o = S.objs.find(q => q.n === name); o.state = 'ball'; o.lrot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // one lump: the object's farthest tip sits lumpLen x R from the centre, in the direction ang (0 = straight down, towards +z by ang)
  const dir = [0, -Math.cos(ang), Math.sin(ang)], tip = S.info[o.n].ibi.reduce((a, p) => Math.hypot(...p) > Math.hypot(...a) ? p : a);
  const tl = Math.hypot(...tip); o.lpos = dir.map(v => v * lumpLen * R); o.lrot = (() => { const a = tip.map(v => v / tl), c = [dir[0] * 0 + 0, 0, 0]; return [1, 0, 0, 0, 1, 0, 0, 0, 1]; })();
  o.lpos = [dir[0] * lumpLen * R - tip[0], dir[1] * lumpLen * R - tip[1], dir[2] * lumpLen * R - tip[2]];
  S.attached.push(o); S.ibiList.push(o); return { S, R, o };
}
{ // a long lump pointing straight down: it lands on the tip, the ball sits higher than the plain radius
  const { S, R } = ball(1.6, 0); let st = 0, maxY = -1e9, minY = 1e9, start = -1;
  for (let f = 0; f < 120; f++) { K.step(S, {}); if (S.ib.st && start < 0) start = f; st = Math.max(st, S.ib.st); maxY = Math.max(maxY, S.pos[1]); minY = Math.min(minY, S.pos[1]); }
  ok(st === 2, 'the lump starts the FLUID state, ' + st);
  ok(minY > 3.1 + R * 0.9, 'never through the floor, min y ' + minY.toFixed(2) + ' floor 3.1 R ' + R);
  console.log('down lump: started frame', start, 'y', minY.toFixed(2), maxY.toFixed(2), 'state', S.ib.st, 'pos', S.pos.map(v => v.toFixed(1)).join(','));
}
{ // driving forward with the lump on the ground: the ball rocks (height changes) and the lump lets go
  const { S, R } = ball(1.6, 0.3); const ys = []; let was = 0, ended = false;
  for (let f = 0; f < 200; f++) { K.step(S, { turn: 0, fwd: 1 }); ys.push(S.pos[1]); if (S.ib.st) was = f; else if (was && !ended) ended = f; }
  const rng = Math.max(...ys) - Math.min(...ys);
  ok(was > 0, 'rocking happens'); ok(ended, 'it ends again'); console.log('forward lump: rocking until', was, 'ended', ended, 'y range', rng.toFixed(2), 'R', R.toFixed(2));
  ok(Math.min(...ys) > 3.1 + R * 0.9, 'min y ' + Math.min(...ys).toFixed(2));
}
console.log(fail ? 'FAILED ' + fail : 'ibitsu ok'); process.exit(fail ? 1 : 0);
