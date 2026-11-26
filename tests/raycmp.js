// Ray stage 2 (A146): after each step of the port's own physics, what correction would the engine's ray lists still ask for?
// Small numbers mean the sphere push already agrees with the rays. Usage: node tests/raycmp.js [stage=S001] [frames=600] [x z yaw]
const K = require('../sim.js');
const st = process.argv[2] || 'S001', frames = +process.argv[3] || 600;
const p = require('../data/' + st + '/play.json');
const S = K.create(p, { noTarget: true });
if (process.argv[4]) { S.pos = [+process.argv[4], S.pos[1], +process.argv[5]]; S.yaw = +process.argv[6] || 0; }
let n = 0, big = 0, sumY = 0, maxY = 0, maxH = 0, gr = 0, wl = 0, worst = null;
for (let f = 0; f < frames; f++) {
  const old = S.pos.slice(); K.step(S, { turn: Math.sin(f / 90) * 0.5, fwd: 1 }); const R = K.radius(S);
  const c = K.rayContacts(S, R, old); n++;
  const ay = Math.abs(c.total[1]), ah = Math.hypot(c.total[0], c.total[2]); sumY += ay; if (ay > maxY) { maxY = ay; worst = { f, pos: S.pos.map(v => +v.toFixed(2)), c }; } if (ah > maxH) maxH = ah;
  if (c.ground.length) gr++; if (c.wall.length) wl++; if (ay > 0.05 * R || ah > 0.05 * R) big++;
}
console.log(`${st}: ${n} frames, ground lists ${gr}, wall lists ${wl}, mean |adjust y| ${(sumY / n).toFixed(4)} cm, max ${maxY.toFixed(3)} y, ${maxH.toFixed(3)} horizontal, frames over 5% of R: ${big}`);
if (worst) console.log('worst', worst.f, worst.pos.join(','), 'total', worst.c.total.map(v => v.toFixed(3)).join(','), 'ground', worst.c.ground.map(h => h.tag + ':' + h.adj.map(v => v.toFixed(2))).join(' | '));
