// Camera row rule (A102): row i serves sizes above row i's own diameter up to row i+1's; row 0 up to row 1's; the last row beyond.
const fs = require('fs'), path = require('path'), K = require('../sim.js');
let bad = 0;
for (const st of ['S001', 'S002', 'S003', 'S004', 'S005', 'S006']) {
  const play = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', st, 'play.json')));
  const C = play.mis.camera; if (!C || !C.length) { console.log(st, 'no camera table'); bad++; continue; }
  const dias = C.map(r => r[0]);
  let prev = -1, switches = [];
  for (let d = 1; d < dias[dias.length - 1] * 1.5; d *= 1.01) {
    const i = K.cameraRow({ cam: C, diam: d });
    if (i < prev) { console.log(st, 'row went down at', d); bad++; }
    if (i !== prev) switches.push([i, +d.toFixed(1)]); prev = i;
  }
  const last = K.cameraRow({ cam: C, diam: dias[dias.length - 1] * 10 });
  if (last !== C.length - 1) { console.log(st, 'last row not reached'); bad++; }
  console.log(st, 'rows', C.length, 'sizes', dias.map(x => +x.toFixed(1)).join(' '), 'switch at', switches.map(s => s[1]).join(' '));
}
console.log(bad ? 'FAIL' : 'PASS'); process.exit(bad ? 1 : 0);
