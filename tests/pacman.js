// Pac-Man rules (pacman.js, ported from the binary): ghosts keep walking, eyes always get home, bonus chain, timers
const fs = require('fs'), assert = require('assert'), K = require('../pacman.js');
const maze = JSON.parse(fs.readFileSync(__dirname + '/../data/S007/maze.json'));
assert.strictEqual(maze.edges.length, 89); assert.strictEqual(maze.nodes.length, 68);
// 1. every ghost keeps walking for 20 minutes without ever leaving the graph, and leaves the house
const P = K.create(maze, 12345); let exited = false;
for (let f = 0; f < 30 * 1200; f++) for (const g of P.ghosts) { K.stepGhost(P, g); assert(g.prog >= 0 && g.prog < 1 && g.edge >= 0 && g.edge < 89); if (g.edge < 80 && g.edge !== 0x57) exited = true; }
assert(exited, 'ghosts leave the house');
// 2. eyes started on every edge in both directions reach the house, and in a sensible time
let worst = 0;
for (let e = 0; e < 89; e++) for (const d of [0, 1]) {
  const Q = K.create(maze, 1), g = Q.ghosts[0]; g.st = 2; g.edge = e; g.dir = d; g.prog = 0.5; let f = 0, home = null;
  for (; f < 30 * 120 && !home; f++) home = K.stepGhost(Q, g);
  assert.strictEqual(home, 'home', 'eyes from edge ' + e + ' dir ' + d + ' never got home'); worst = Math.max(worst, f);
  assert.strictEqual(g.st, 0); assert.strictEqual(g.edge, 0x57);
}
console.log('eyes: worst way home', (worst / 30).toFixed(1), 's');
// 3. bonus chain 200, 400, ... 6400 and stays; power up turns all blue and the timer ends it
const Q = K.create(maze, 3); const got = []; for (let i = 0; i < 8; i++) got.push(K.eat(Q)); assert.deepStrictEqual(got, [200, 400, 800, 1600, 3200, 6400, 6400, 6400]);
K.powerUp(Q); assert(Q.ghosts.every(g => g.st === 1)); let n = 0, r; while (!(r = K.tick(Q))) n++; assert.strictEqual(r, 'end'); assert.strictEqual(n, 599); assert.strictEqual(Q.bonus, 200); assert(Q.ghosts.every(g => g.st === 0));
// 4. touch: only state 0, within 10 cm in 3D, turns the ghost round
const T2 = K.create(maze, 4), g0 = T2.ghosts[0]; g0.prog = 0.25; assert(!K.touch(T2, 0, [0, 30, 0], [0, 6.4, 0])); assert(K.touch(T2, 0, [0, 12, 0], [0, 6.4, 0])); assert.strictEqual(g0.dir, 0); assert.strictEqual(g0.prog, 0.75);
g0.st = 1; assert(!K.touch(T2, 0, [0, 6.4, 0], [0, 6.4, 0]));
// 5. visibility
const V = K.create(maze, 5); let sh = K.shown(V); assert(sh.slice(0, 4).every(Boolean) && !sh.slice(4).some(Boolean));
K.powerUp(V); sh = K.shown(V); assert(!sh.slice(0, 4).some(Boolean) && sh.slice(4, 8).every(Boolean) && !sh.slice(8).some(Boolean)); V.fright = 5 * 30; sh = K.shown(V); assert(sh.slice(8, 12).every(Boolean) && !sh.slice(4, 8).some(Boolean));
assert.strictEqual(K.dropCount(0), 0); assert.strictEqual(K.dropCount(9), 1); assert.strictEqual(K.dropCount(50), 10);
console.log('pacman ok');
