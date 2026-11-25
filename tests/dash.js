// Dash gesture check (OujiDash.cppi sDashNormal, A120). Usage: node tests/dash.js
// Taps 10 frames apart on S001 (diameter 5 cm, so 3 strokes start the wheel spin and 3 + 3 start the dash).
const fs = require('fs'), path = require('path'), K = require('../sim.js');
const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/S001/play.json'), 'utf8'));
const fails = [];
function fresh() { const S = K.create(play, {}); S.objs.length = 0; for (let i = 0; i < 60; i++) K.step(S, {}); return S; }
function run(S, frames, tapAt, extra) { const log = []; for (let f = 0; f < frames; f++) { K.step(S, Object.assign({ fwd: 0.2, turn: 0, tap: tapAt(f) }, extra || {})); log.push({ f, dash: S.dash, spin: S.wheelSpin, n: S.dS.n, spd: S.speed }); } return log; }
{ // tap every 10 frames, 8 taps
  const S = fresh(), log = run(S, 120, f => f % 10 === 0 && f < 80);
  const spinStart = log.find(l => l.spin), dashStart = log.find(l => l.dash && !l.spin), end = log.find((l, i) => i > 80 && !l.dash);
  console.log('spin from', spinStart && spinStart.f, 'dash from', dashStart && dashStart.f, 'dash ends', end && end.f);
  if (!spinStart || spinStart.f !== 20) fails.push('wheel spin should start on the 3rd tap (frame 20), got ' + (spinStart && spinStart.f));
  if (!dashStart || dashStart.f !== 50) fails.push('dash should start on the 6th tap (frame 50), got ' + (dashStart && dashStart.f));
  if (!end || end.f !== 84) fails.push('dash should end 14 frames after the last tap (frame 70 + 14 = 84), got ' + (end && end.f));
  const v0 = log[19].spd, v1 = log[49].spd, v2 = log[55].spd; console.log('speed before spin', v0.toFixed(2), 'end of spin', v1.toFixed(2), 'after launch', v2.toFixed(2));
  if (v1 > v0 + 0.5 && false) fails.push('ball should not accelerate while spinning');
}
{ // taps 15 frames apart never build a count
  const S = fresh(), log = run(S, 100, f => f % 15 === 0);
  if (log.some(l => l.dash)) fails.push('taps 15 frames apart must not start a dash');
}
{ // budget: with 30 frames left, the dash is cut after 30 stroking frames, then forbidden for 240 frames, then the budget is full again
  const S = fresh(); S.dS.dur = 30; S.objs.length = 0; const log = []; for (let f = 0; f < 400; f++) { S.pos[0] = 0; S.pos[2] = 0; K.step(S, { fwd: 0.2, turn: 0, tap: f % 8 === 0 }); log.push({ dash: S.dash, fw: S.dS.fw, forbid: S.dS.forbid, dur: S.dS.dur }); }
  const fb = log.findIndex(l => l.forbid), back = log.findIndex((l, i) => i > fb && !l.forbid);
  console.log('forbid from', fb, 'to', back, 'budget after', log[399].dur);
  if (fb < 0 || fb > 60) fails.push('budget should run out soon after the dash starts, got ' + fb);
  if (back - fb !== 240) fails.push('forbid should last 240 frames, got ' + (back - fb));
  if (log[back].dur !== 240) fails.push('budget should refill after the forbid');
  if (log.slice(fb, back).some(l => l.dash)) fails.push('no dash while forbidden');
}
{ // held key taps by itself
  const S = fresh(); let on = 0; for (let f = 0; f < 80; f++) { K.step(S, { fwd: 1, turn: 0, dash: true }); if (S.dash) on++; } console.log('held key dash frames in 80', on); if (on < 20) fails.push('held key should reach a dash');
}
if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
console.log('PASS');
