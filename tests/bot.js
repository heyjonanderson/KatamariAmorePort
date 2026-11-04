// Headless bot test of the simulation on real stage data. Usage: node tests/bot.js [stage] [maxFrames]
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const stage = process.argv[2] || 'S001', maxF = +(process.argv[3] || 30000);
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', stage, 'play.json'), 'utf8'));
const S = K.create(play); const fails = []; const check = (c, m) => { if (!c) fails.push(m); };
const log = []; const t0 = { diam: S.diam, pos: S.pos.slice() };
// 1) settle with no input: should land on a floor and stay put
for (let i = 0; i < 120; i++) K.step(S, { fwd: 0, turn: 0 });
const sup = K.groundAt(S.G, S.pos[0], S.pos[2], S.pos[1]);
check(sup !== null, 'no ground under start position'); check(Math.abs(S.pos[1] - K.radius(S) - sup) < 0.05, 'start did not settle on the floor: y=' + S.pos[1] + ' floor=' + sup);
log.push(`start diam ${t0.diam.toFixed(2)} cm, goal ${S.goal} cm, settled y ${S.pos[1].toFixed(2)} (floor ${sup && sup.toFixed(2)}), objects ${S.objs.length}`);
// 2) greedy bot: steer to the nearest catchable object, else to nearest object that is next to become catchable
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
let lastD = S.diam, maxSeenSpeed = 0, nan = false, offmap = 0, stuck = 0, lastPos = S.pos.slice(), lastPick = 0, esc = null, escDir = 1, wander = { t: 0, dir: 0 }, picks = [], mono = true, wonAt = null;
for (let f = 0; f < maxF && !S.won; f++) {
  let best = null, bd = 1e18;
  for (const o of S.objs) { if (o.state !== 'map') continue; const catchable = S.diam * 10 >= o.catchMm; const reach = Math.abs(o.pos[1] - S.pos[1]) <= K.radius(S) + o.r * 0.6 + 1; const d = Math.hypot(o.pos[0] - S.pos[0], o.pos[2] - S.pos[2]); let los = true; if (catchable && reach && d > 1) { const dx = o.pos[0] - S.pos[0], dz = o.pos[2] - S.pos[2], t = K.rayHit(S, S.pos[0], S.pos[1], S.pos[2], dx / d, 0, dz / d, d); los = t === null; }
    const score = d + (catchable && reach && los ? 0 : 1e5 + (catchable ? 0 : o.catchMm * 10) + (reach ? 0 : 5e4)); if (score < bd) { bd = score; best = o; } }
  let inp = { fwd: 0, turn: 0 };
  if (!(best && bd < 5e4)) { if (wander.t <= 0) { wander = { t: 90, dir: Math.random() * 2 - 1 }; } wander.t--; inp = { turn: wander.dir, fwd: 1 }; }
  if (best && bd < 5e4) { const want = Math.atan2(best.pos[0] - S.pos[0], best.pos[2] - S.pos[2]); const e = angDiff(S.yaw, want); inp = { turn: Math.max(-1, Math.min(1, -e * 3)), fwd: Math.abs(e) < 1.2 ? 1 : 0 }; }
  // blocked head-on by something too big: back off, then detour to one side. Alternate the side each time.
  if (!esc && stuck >= 60) { esc = { t: 0, dir: escDir, y0: S.yaw }; escDir = -escDir; stuck = 0; }
  if (esc) { esc.t++; const turned = Math.abs(angDiff(esc.y0, S.yaw)); inp = turned < 1.4 && esc.t < 90 ? { turn: esc.dir, fwd: esc.t < 20 ? -1 : 0 } : { turn: 0, fwd: 1 }; if (esc.t > 90 + 90) esc = null; }
  K.step(S, inp);
  for (const e of S.events) if (e.type === 'pickup') { picks.push([S.frame, e.name, +S.diam.toFixed(2)]); lastPick = S.frame; }
  if (S.events.some(e => e.type === 'won')) wonAt = S.frame;
  if (!isFinite(S.pos[0] + S.pos[1] + S.pos[2] + S.diam + S.speed)) { nan = true; break; }
  if (S.diam < lastD - 1e-9) mono = false; lastD = S.diam;
  maxSeenSpeed = Math.max(maxSeenSpeed, Math.abs(S.speed));
  const g = K.groundAt(S.G, S.pos[0], S.pos[2], S.pos[1]); if (g === null) offmap++;
  if (f % 30 === 0) { stuck = Math.hypot(S.pos[0] - lastPos[0], S.pos[2] - lastPos[2]) < 0.3 * K.radius(S) && inp.fwd > 0 ? stuck + 30 : 0; lastPos = S.pos.slice(); }
}
check(!nan, 'NaN in state'); check(mono, 'diameter shrank'); check(offmap === 0, 'ball was off the map for ' + offmap + ' frames');
check(maxSeenSpeed <= K.maxSpeed({ diam: 1e4, speedRows: S.speedRows }) + 1e-6, 'speed exceeded table max');
check(S.picked > 0, 'picked nothing');
log.push(`frames ${S.frame} (${(S.frame / K.FPS).toFixed(0)} s at ${K.FPS} fps), picked ${S.picked}/${S.objs.length}, final diam ${S.diam.toFixed(2)} cm, won ${S.won}${wonAt ? ' at frame ' + wonAt : ''}`);
log.push('first pickups [frame,name,diam]: ' + JSON.stringify(picks.slice(0, 6)));
log.push(`max speed seen ${maxSeenSpeed.toFixed(3)} cm/frame, speed table max ${K.maxSpeed({ diam: 1e4, speedRows: S.speedRows }).toFixed(3)}, off-map frames ${offmap}`);
globalThis.__S = S; console.log(stage + "\n  " + log.join('\n  '));
if (fails.length) { console.log('FAIL:\n  ' + fails.join('\n  ')); process.exit(1); } else console.log('PASS');
