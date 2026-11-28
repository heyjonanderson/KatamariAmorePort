// Pac-Man in the real game loop: pick-ups, scoring, power pellet, ghost bonus, hit and drop, clear. Run: QS="?stage=S007&mode=extra" SCRIPT=tests/pac_game.js node tests/game_smoke.js
const assert = require('assert');
module.exports = async ({ g, step, K }) => {
  const S = g.S, ex = () => g.ex(), O = S.objs, dtMs = 1000 / 30;
  step(3); assert(ex().PAC, 'pac state'); assert.strictEqual(g.err.length, 0, JSON.stringify(g.err));
  const put = (x, z) => { S.pos[0] = x; S.pos[2] = z; S.v = [0, 0]; S.vy = 0; S.speed = 0; S.pos[1] = S.diam / 2 + 2; };
  // 1. a pac-dot: 10 points, the dot leaves the map
  const dot = O.find(o => o.n === 'COCKIE'); put(dot.pos[0], dot.pos[2]); step(6);
  assert.strictEqual(ex().EX.score, 10, 'dot score ' + ex().EX.score); assert(dot.state === 'ball');
  // 2. ghosts are placed in the house and walk
  const g0 = ex().PAC.ghosts[0], p0 = O[0].pos.slice(); step(30); assert(O[0].pos[0] !== p0[0] || O[0].pos[2] !== p0[2], 'ghost moves');
  // 3. a power pellet: fright 20 s, ghosts blue, fruit appears, score + 100
  const pel = O[21]; put(pel.pos[0], pel.pos[2]); step(6);
  const P = ex().PAC; assert(P.fright > 0 && P.fright <= 600, 'fright ' + P.fright); assert(P.ghosts.every(q => q.st === 1)); assert.strictEqual(O[17].state, 'map', 'BERRY shown'); assert.strictEqual(O[0].state, 'xhid'); assert(O[4].state === 'map' || O[4].state === 'ball');
  assert.strictEqual(ex().EX.score, 110);
  // 4. frightened ghosts can be picked: 200, 400, 800 ... in the order they are taken (several can be in reach at once in the house); each comes back as eyes
  { const before = ex().EX.score, m = O[4]; assert.strictEqual(m.state, 'map'); put(m.pos[0], m.pos[2]); step(3);
    const dl = ex().EX.score - before, n = Math.round(Math.log2(dl / 200 + 1)); assert(n >= 1 && dl === 200 * (2 ** n - 1), 'a chain of 200, 400, 800 ... was paid, got ' + dl);   // a ghost eaten in the house can already be home again, so n comes from the score
    for (let i = 0; i < 4; i++) if (P.ghosts[i].st === 2) { assert.strictEqual(O[12 + i].state, 'map'); assert.strictEqual(O[4 + i].state, 'xhid'); } }
  put(-134, 100); S.pos[1] = 7;   // out of the way of the ghosts coming home
  // 5. the timer runs out: ghosts normal again, bonus back to 200
  step(620); assert.strictEqual(P.fright, 0); assert.strictEqual(P.bonus, 200); assert(P.ghosts.every(q => q.st !== 1));
  // 6. a normal ghost within 10 cm hurts: stun 3 s, no control, a pac-dot comes off
  P.ghosts.forEach(q => { q.st = 0; }); const stun0 = P.stun; assert.strictEqual(stun0, 0);
  for (const o of O) if (o.n === 'COCKIE' && o.state === 'map') { put(o.pos[0], o.pos[2]); step(2); if (S.attached.filter(a => a.n === 'COCKIE').length >= 10) break; }
  const have = S.attached.filter(a => a.n === 'COCKIE').length, sc = ex().EX.score; assert(have >= 10, 'dots ' + have);
  const gp = O[0].pos; put(gp[0], gp[2]); S.pos[1] = gp[1]; step(1); assert(P.stun > 80, 'stunned ' + P.stun);
  const left = S.attached.filter(a => a.n === 'COCKIE').length; assert(left < have, 'dots dropped ' + have + ' -> ' + left); assert(ex().EX.score < sc, 'score down');
  const thrown = O.filter(o => o.stopLand); assert(thrown.length >= 1); step(120); assert(thrown.every(o => o.state === 'map' && o.stopped), 'thrown dots lie still');
  const rem = O.filter(o => (o.n === 'COCKIE' || o.n === 'PCOCKIE') && o.state === 'map' && !o.stopped).length; console.log('remaining', rem, 'stopped', thrown.length);
  // 7. tunnel
  put(-150, 0); S.pos[1] = 6; step(1); assert(S.pos[0] > 100, 'wrapped to ' + S.pos[0]);
  // 8. clearing the maze ends the run with the score
  for (const o of O) if ((o.n === 'COCKIE' || o.n === 'PCOCKIE') && o.state === 'map') o.state = 'xhid'; step(2); assert(S.won, 'won');
  console.log('PASS pac_game score', ex().EX.score);
};
