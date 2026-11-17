// Moving object knockback check: a box on a straight path runs into the resting ball. Usage: node tests/crush.js
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
const S = K.create(play, {}); for (let i = 0; i < 60; i++) K.step(S, {});
const R = K.radius(S), fl = S.pos[1] - R, p0 = S.pos.slice();
// closed square path far larger than the ball, one side passing 30 cm in front of the ball moving +x
const pts = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * Math.PI; pts.push([p0[0] + 60 + 60 * Math.cos(a), fl, p0[2] + 60 * Math.sin(a)]); }
const o = { n: 'BOX', state: 'map', catchMm: 1e7, pos: pts[0].slice(), ppos: pts[0].slice(), rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], lo: [-5, 0, -5], hi: [5, 20, 5], top: fl + 20, maxlen: 20, layer: 0, hitOff: 0, hi_: 0, path: { pts, t: 0, speed: 0.004 } };
S.objs.push(o);
let crush = 0, maxV = 0, ctrl = 0; const v0 = S.pos.slice();
for (let f = 0; f < 600; f++) { K.step(S, {}); for (const e of S.events) if (e.type === 'crush') crush++; maxV = Math.max(maxV, S.speed); ctrl = Math.max(ctrl, S.ctrlOff); }
console.log('crush events', crush, 'max ball speed', maxV.toFixed(2), 'ctrlOff max', ctrl, 'ball moved', Math.hypot(S.pos[0] - v0[0], S.pos[2] - v0[2]).toFixed(1), 'cm');
if (!crush || ctrl !== 10) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
