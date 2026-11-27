// Galaga port logic test: paths end where the formation is, stages run through, scoring matches the binary's tiers
const fs = require('fs'), assert = require('assert'), K = require('../galaga.js'), D = JSON.parse(fs.readFileSync(__dirname + '/../data/S021/galaga.json', 'utf8'));
const mk = () => { const log = { shown: {}, pos: {}, dropped: 0 }; return { log, ctx: { show: (i, on) => { log.shown[i] = on; }, place: (i, x, z, a) => { log.pos[i] = [x, z, a]; }, att: i => !!(log.att && log.att.has(i)), drop: f => { log.dropped++; } } }; };
// 1. every entry path of stage 1 ends close to a formation slot after the walk (state 2 then closes the gap)
{
  const { ctx, log } = mk(); const G = K.create(D, ctx, 7); let formed = 0, dived = 0, shots = 0, stage1Frames = 0;
  const ball = { x: 0, z: K.PLAYER_Z, diam: 20 };
  for (let f = 0; f < 30 * 60 && G.stage === 1; f++) { K.step(G, ball); stage1Frames++; for (const e of G.events.splice(0)) { if (e.t === 'dive') dived++; if (e.t === 'shot') shots++; } }
  formed = G.slots.filter(s => s.st === 3).length;
  console.log('stage 1 after 60 s: in formation', formed, 'of 40, dives started', dived, 'shots', shots);
  assert(formed >= 20, 'most enemies reach the formation');
  assert(dived >= 3, 'dive waves start');
  assert(shots > 0, 'diving enemies shoot');
  for (const s of G.slots) if (s.st === 3) { const f = K.FORM[s.row[5]]; assert(Math.abs(s.x - f[0]) < 1e-6 && Math.abs(s.z - f[1]) < 1e-6); }
}
// 2. nothing is ever picked up: every enemy uses its three dives and leaves, the stages run 1 -> 2 -> 3 -> clear
{
  const { ctx } = mk(); const G = K.create(D, ctx, 3); const ball = { x: 0, z: K.PLAYER_Z, diam: 10 }; const seen = new Set(); let f = 0;
  for (; f < 30 * 3600 && G.stage < 4; f++) { K.step(G, ball); seen.add(G.stage); }
  console.log('cleared after', (f / 30 / 60).toFixed(1), 'min, stages seen', [...seen].join());
  assert.strictEqual(G.stage, 4);
}
// 3. score tiers (FUN_0005328c): by 100 * attached count
assert.strictEqual(K.tier(0), 1000); assert.strictEqual(K.tier(23), 1000); assert.strictEqual(K.tier(24), 2000); assert.strictEqual(K.tier(60), 4000); assert.strictEqual(K.tier(90), 8000); assert.strictEqual(K.tier(120), 16000); assert.strictEqual(K.tier(144), 32000); assert.strictEqual(K.tier(168), 64000);
{ const { ctx } = mk(); const G = K.create(D, ctx, 1); G.bonus = 800; assert.strictEqual(K.score(G, [3, 1, 2]), 1000 + 400 + 100 + 160 + 800); }
// 4. group bonus: the last member of a dive group picked up pays t89e20[kind]
{ const { ctx } = mk(); const G = K.create(D, ctx, 1); G.groups[0] = { monos: [5, 6, 7], kind: 0, count: 3, remaining: 3 }; assert.strictEqual(K.groupRemove(G, 5), 0); assert.strictEqual(K.groupRemove(G, 6), 0); assert.strictEqual(K.groupRemove(G, 7), 800); assert.strictEqual(G.groups[0].count, 0); }
console.log('PASS');
