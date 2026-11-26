// Ray mode (A147): the port driven from the engine's hit lists. Compares with the sphere push on the same inputs.
const K = require('../sim.js');
const st = process.argv[2] || 'S001', frames = +process.argv[3] || 600;
const p = require('../data/' + st + '/play.json');
const run = ray => { const S = K.create(p, { noTarget: true, ray }); const tr = []; let air = 0, maxY = -1e9, minY = 1e9;
  for (let f = 0; f < frames; f++) { K.step(S, { turn: Math.sin(f / 90) * 0.5, fwd: 1 }); if (!S.grounded) air++; if (f % 100 === 99) tr.push(S.pos.map(v => v.toFixed(1)).join(',')); maxY = Math.max(maxY, S.pos[1]); minY = Math.min(minY, S.pos[1]); }
  return { tr, air, picked: S.picked, diam: S.diam.toFixed(2), maxY: maxY.toFixed(1), minY: minY.toFixed(1) }; };
const a = run(false), b = run(true);
console.log(st, 'sphere', JSON.stringify(a)); console.log(st, 'ray   ', JSON.stringify(b));
