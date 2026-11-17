// Wall bounce check (A103): a tall wall met at 60 degrees from its normal throws the ball back at 55% of its speed along the mirrored direction.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
const onBox = (S, fx, fz) => { const o = S.objs.find(q => q.n === 'BOX'); const rx = S.pos[0] - o.pos[0], rz = S.pos[2] - o.pos[2]; return rx * fx + rz * fz < 0 && rx * fx + rz * fz > -(K.radius(S) + 1); };   // within a radius in front of the box face
function run(noReflect) {
  const S = K.create(play, { noReflect }); for (let i = 0; i < 120; i++) K.step(S, {});
  const R = K.radius(S), fl = S.pos[1] - R, base = S.yaw, fx = Math.sin(base), fz = Math.cos(base);
  // wall face is the plane through the box's z = 0 side, facing back at the ball; the ball starts 25 cm in front of it, off to one side
  S.objs.push({ n: 'BOX', state: 'map', catchMm: 1e7, pos: [S.pos[0] + fx * 25, fl, S.pos[2] + fz * 25], rot: [fz, 0, fx, 0, 1, 0, -fx, 0, fz], lo: [-400, 0, 0], hi: [400, 40, 30], top: fl + 40, maxlen: 450, layer: 0, hitOff: 0 });
  S.yaw = base + Math.PI / 3; S.objs.push = S.objs.push;
  let hit = -1, vBefore = 0, vnAfter = 0, vtBefore = 0, vtAfter = 0, crush = 0;
  for (let f = 0; f < 80; f++) {
    const sp0 = Math.hypot(S.v[0], S.v[1]), v0 = S.v.slice(); K.step(S, { fwd: 1, turn: 0 });
    for (const e of S.events) if (e.type === 'crush') crush++;
    if (hit < 0 && S.reflV && S.pos[0] * 0 === 0 && onBox(S, fx, fz)) { hit = f; vBefore = sp0; const n = [-fx, -fz], t = [fz, -fx]; vtBefore = v0[0] * t[0] + v0[1] * t[1]; vnAfter = S.reflV[0] * n[0] + S.reflV[1] * n[1]; vtAfter = S.reflV[0] * t[0] + S.reflV[1] * t[1]; }
  }
  return { hit, vBefore, vnAfter, vtAfter, vtBefore, crush };
}
const on = run(false), off = run(true), fails = [];
console.log('bounce on ', on, '\nbounce off', off);
if (on.hit < 0) fails.push('no bounce on a wall hit');
else {
  if (!(on.vnAfter > 0)) fails.push('bounced velocity should point away from the wall');
  const sp = Math.hypot(on.vnAfter, on.vtAfter); if (sp > 0.56 * on.vBefore * 1.15 || sp < 0.5 * on.vBefore * 0.85) fails.push('bounce speed should be about 55% of ' + on.vBefore.toFixed(3) + ', got ' + sp.toFixed(3));
}
if (off.hit >= 0) fails.push('noReflect still bounced');
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log('PASS');
