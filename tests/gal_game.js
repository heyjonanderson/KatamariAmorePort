// Galaga in the real game loop. Run: QS="?stage=S021&mode=extra" SCRIPT=tests/gal_game.js node tests/game_smoke.js
const assert = require('assert');
module.exports = async ({ g, ctx, step, K }) => {
  const KGal_tier = n => ctx.window.KGal.tier(n);
  const S = g.S, ex = () => g.ex(), O = S.objs; const keys = ctx.window.__keys;
  step(3); assert(ex().GAL, 'galaga state'); assert.strictEqual(g.err.length, 0, JSON.stringify(g.err)); assert.strictEqual(O.length, 149);
  { const bad = O.map((o, i) => [i, o.state]).filter(a => a[1] !== 'xhid' && a[1] !== 'ball'); assert(bad.length <= 2, 'visible at start ' + JSON.stringify(bad)); }
  // the ball stays on z = -60
  assert(Math.abs(S.pos[2] + 60) < 1e-6, 'z ' + S.pos[2]);
  // first enemies appear after their timer (stage 1 slot 0 starts at frame 0)
  step(5); const row0 = ex().GAL.slots[0]; assert(row0.st >= 1, 'slot 0 spawned'); assert.strictEqual(O[row0.mono].state, 'map');
  // run until some are in formation, then take one: score = tier 1000 + its value
  step(30 * 40); const form = ex().GAL.slots.filter(s => s.st === 3); assert(form.length > 10, 'formation ' + form.length);
  const bx = ex().GAL.beams.filter(b => b.on).map(b => b.x), sl = form.find(q => bx.every(x => Math.abs(O[q.mono].pos[0] - x) >= 12)), o = O[sl.mono];   // not under a running beam (it would take the pick-up off the ball) S.pos[0] = o.pos[0]; S.pos[1] = S.diam / 2 + 2; S.pos[2] = -60; // far from the enemies in z: it will not reach. Put the ball on top of it
  S.pos[2] = o.pos[2]; S.v = [0, 0]; step(3);
  const val = ({ GALAGA: 100, GOEI: 160, BOSSGALAGA: 400, TONBO: 100, GALBOSS: 320 })[o.n]; assert.strictEqual(o.state, 'ball', 'picked ' + o.n);
  { const VAL = { GALAGA: 100, GOEI: 160, BOSSGALAGA: 400, TONBO: 100, GALBOSS: 320 }, att = S.attached.filter(q => q.state === 'ball'); assert.strictEqual(ex().EX.score, KGal_tier(att.length) + att.reduce((a, q) => a + VAL[q.n], 0), 'score ' + ex().EX.score); }
  // a shot that reaches the ball throws one enemy off (at least one of the attached)
  const att0 = S.attached.length; ex().GAL.bullets[0].on = true; ex().GAL.bullets[0].x = S.pos[0]; ex().GAL.bullets[0].z = 60; ex().GAL.bullets[0].tx = S.pos[0]; ex().GAL.bullets[0].tz = 180;
  S.pos[2] = -60; step(2); assert(S.attached.length < att0 || att0 === 0, 'a shot throws something off');
  // tractor beam: a boss that dives on the beam path takes half of what is on the ball, and gives it back when it is picked up
  {
    const GA = ex().GAL, KG = ctx.window.KGal; step(30 * 20);
    const take = GA.slots.filter(q => q.st === 3 && q.row[6] !== 0 && !O[q.mono].noPick && O[q.mono].state === 'map').slice(0, 5);
    for (const q of take) { const oo = O[q.mono]; S.pos[0] = oo.pos[0]; S.pos[2] = oo.pos[2]; S.pos[1] = S.diam / 2 + 2; S.v = [0, 0]; step(2); }
    const n0 = S.attached.filter(o => o.state === 'ball').length; assert(n0 >= 3, 'picked enough ' + n0);
    const boss = GA.slots.find(q => q.row[6] === 0 && q.beam === 0 && q.st === 3 && O[q.mono].state === 'map'); assert(boss, 'boss in formation');
    S.pos[0] = 0; S.pos[2] = -60; S.pos[1] = S.diam / 2 + 2; S.v = [0, 0]; GA.timers.forEach(t => { t.on = false; });
    boss.lives = 3; KG.startDive(GA, boss, 3); let f = 0; for (; f < 400 && !GA.beams[0].on; f++) step(1); assert(GA.beams[0].on, 'beam on'); assert.strictEqual(O[124].state, 'map', 'beam model shown');
    S.pos[0] = GA.beams[0].x + 3; const n0b = S.attached.filter(o => o.state === 'ball').length, v0 = S.volume; step(3); assert(GA.beams[0].cap, 'captured');
    const n1 = S.attached.filter(o => o.state === 'ball').length; assert.strictEqual(n1, n0b - Math.ceil(n0b / 2), 'half taken: ' + n0b + ' -> ' + n1); assert(S.volume < v0, 'volume came off');
    assert(Math.abs(S.pos[0] - GA.beams[0].x) < 1e-6, 'held at the beam x'); for (f = 0; f < 200 && GA.beams[0].t < 100; f++) step(1); assert.strictEqual(O[139].state, 'map', 'captured ball shown behind the boss ' + O[139].state); assert(O[139].sc >= 0.2 && O[139].sc <= 0.5, 'its scale ' + O[139].sc);
    for (f = 0; f < 400 && GA.beams[0].on; f++) step(1); assert(!GA.beams[0].on, 'beam off'); assert.strictEqual(O[124].state, 'xhid');
    step(2); assert(GA.beams[0].list.length > 0, 'the boss carries them');
    // pick the boss up (wait for it to be back in formation first)
    for (f = 0; f < 900 && boss.st !== 3; f++) step(1); if (boss.st !== 3) console.log('boss', JSON.stringify({ st: boss.st, lives: boss.lives, dropped: boss.dropped, row5: boss.row[5], state: O[boss.mono].state, x: boss.x, z: boss.z, pi: boss.pi && { id: boss.pi.id, on: boss.pi.on } })); assert.strictEqual(boss.st, 3, 'boss back in formation');
    const bo = O[boss.mono]; S.pos[0] = bo.pos[0]; S.pos[2] = bo.pos[2]; S.pos[1] = S.diam / 2 + 2; S.v = [0, 0]; step(2);
    assert.strictEqual(GA.beams[0].list.length, 0, 'released'); assert(GA.pool.some(x => x > 0), 'virtual counts ' + GA.pool.join());
    assert(S.vvol > 0, 'virtual volume ' + S.vvol); assert.strictEqual(O[139].state, 'xhid');
    console.log('beam test ok: attached', n0b, '->', n1, 'pool', GA.pool.join(), 'vvol', S.vvol.toExponential(2));
  }
  console.log('PASS gal_game score', ex().EX.score);
};
