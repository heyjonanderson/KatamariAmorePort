// Probe: put the ball somewhere with a given diameter, push it along a heading, print where it ends and what stopped it.
// usage: node tests/probe.js S002 x y z diam yaw frames
const K = require('../sim.js'), fs = require('fs'), path = require('path');
const [st, x, y, z, d, yaw, n] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], +process.argv[7], +(process.argv[8] || 120)];
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', st, 'play.json'), 'utf8')), S = K.create(play);
for (let i = 0; i < 30; i++) K.step(S, { L: 0, R: 0 });
S.volume = K.sphereVol(d / 200); S.diam = d; for (const k in S.stoppers) { } for (const s of S.stoppers) if (d >= s[0]) S.erased[s[1]] = true;
for (const o of S.objs) if (o.layer > 0) o.state = 'map';
S.pos = [x, y, z]; S.vy = 0; S.yaw = yaw;
for (let i = 0; i < n; i++) { K.step(S, { fwd: 1, turn: 0 }); if (i % 20 === 0) console.log(i, S.pos.map(v => v.toFixed(1)).join(','), 'v', S.v.map(v => v.toFixed(2)).join(','), 'vy', S.vy.toFixed(2), 'grounded', S.grounded); }
const R = K.radius(S), w = K.hitWalls({ hit: S.hit, erased: S.erased, pos: S.pos.slice() }, R, false); console.log('end', S.pos.map(v => v.toFixed(1)).join(','), 'R', R.toFixed(1), 'wall normals', JSON.stringify(w));
