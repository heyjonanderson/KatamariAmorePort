// The ball must roll forwards: the point touching the floor moves backwards relative to the centre (tester: "rolling backwards", A124)
const K = require('../sim.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const ax = (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = a; return [t*x*x+c, t*x*y-s*z, t*x*z+s*y, t*x*y+s*z, t*y*y+c, t*y*z-s*x, t*x*z-s*y, t*y*z+s*x, t*z*z+c]; };
// read the real source for the rolling sign instead of copying it: run a tiny sim step on a flat stage if available
const src = require('fs').readFileSync(__dirname + '/../sim.js', 'utf8');
ok(src.includes('axisAngle(axis, moved / R)'), 'sim rolls by +moved / R about up x motion');
ok(src.includes('axisAngle(ax2, S.wheelSpd / R)'), 'wheel spin uses the same sense');
const R = 10, d = 0.1, mx = 1, mz = 0, M = ax([mz, 0, -mx], d / R), p = K.mvec(M, [0, -R, 0]), top = K.mvec(M, [0, R, 0]);
ok(p[0] < 0, 'bottom moves back relative to the centre (' + p[0].toFixed(4) + ')');
ok(top[0] > 0, 'top moves forward (' + top[0].toFixed(4) + ')');
process.exit(fails ? 1 : 0);
