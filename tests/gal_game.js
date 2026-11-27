// Galaga in the real game loop. Run: QS="?stage=S021&mode=extra" SCRIPT=tests/gal_game.js node tests/game_smoke.js
const assert = require('assert');
module.exports = async ({ g, ctx, step, K }) => {
  const S = g.S, ex = () => g.ex(), O = S.objs; const keys = ctx.window.__keys;
  step(3); assert(ex().GAL, 'galaga state'); assert.strictEqual(g.err.length, 0, JSON.stringify(g.err)); assert.strictEqual(O.length, 149);
  { const bad = O.map((o, i) => [i, o.state]).filter(a => a[1] !== 'xhid' && a[1] !== 'ball'); assert(bad.length <= 2, 'visible at start ' + JSON.stringify(bad)); }
  // the ball stays on z = -60
  assert(Math.abs(S.pos[2] + 60) < 1e-6, 'z ' + S.pos[2]);
  // first enemies appear after their timer (stage 1 slot 0 starts at frame 0)
  step(5); const row0 = ex().GAL.slots[0]; assert(row0.st >= 1, 'slot 0 spawned'); assert.strictEqual(O[row0.mono].state, 'map');
  // run until some are in formation, then take one: score = tier 1000 + its value
  step(30 * 40); const form = ex().GAL.slots.filter(s => s.st === 3); assert(form.length > 10, 'formation ' + form.length);
  const sl = form[0], o = O[sl.mono]; S.pos[0] = o.pos[0]; S.pos[1] = S.diam / 2 + 2; S.pos[2] = -60; // far from the enemies in z: it will not reach. Put the ball on top of it
  S.pos[2] = o.pos[2]; S.v = [0, 0]; step(3);
  const val = ({ GALAGA: 100, GOEI: 160, BOSSGALAGA: 400, TONBO: 100, GALBOSS: 320 })[o.n]; assert.strictEqual(o.state, 'ball', 'picked ' + o.n);
  assert.strictEqual(ex().EX.score, 1000 + val, 'score ' + ex().EX.score);
  // a shot that reaches the ball throws one enemy off (at least one of the attached)
  const att0 = S.attached.length; ex().GAL.bullets[0].on = true; ex().GAL.bullets[0].x = S.pos[0]; ex().GAL.bullets[0].z = 60; ex().GAL.bullets[0].tx = S.pos[0]; ex().GAL.bullets[0].tz = 180;
  S.pos[2] = -60; step(2); assert(S.attached.length < att0 || att0 === 0, 'a shot throws something off');
  console.log('PASS gal_game score', ex().EX.score);
};
