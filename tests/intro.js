// Test of the opening stories (A107). Part 1 checks data/intro.json against the interpreter's rules; part 2 (needs the playwright module) plays all three packs
// in a browser with a fake clock, checks that every script row runs to its end, that the story finishes by itself and that a tap skips it.
// Usage: node tests/intro.js
const fs = require('fs'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const D = JSON.parse(fs.readFileSync(path.join(root, 'data/intro.json'))); const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const OPS = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 29]);
const SPR = new Set([5, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29]);
for (const p of ['1', '2', '3']) {
  const P = D[p]; const names = new Set(P.sprites.map(s => s[0]));
  for (const n of names) check(fs.existsSync(path.join(root, `ui/OP${p}/${n}.png`)), `pack ${p}: sheet ${n} missing`);
  let lastPage = 0, last = 0;
  P.rows.forEach((r, i) => {
    const [op, sp, pg, t0, t1] = r; check(OPS.has(op), `pack ${p} row ${i}: unknown op ${op}`);
    if (SPR.has(op)) check(sp >= 0 && sp < P.sprites.length, `pack ${p} row ${i}: sprite ${sp} out of range`);
    if ([5, 6, 7, 24, 26, 27, 28, 29].includes(op)) check(t1 > t0, `pack ${p} row ${i}: ends before it starts`);
    if (op === 6) lastPage = Math.max(lastPage, pg); if (op !== 17) last = Math.max(last, t0, t1);
  });
  check(P.texts >= lastPage + 2, `pack ${p}: ${P.texts} strings but the script uses ${lastPage} pages and the ending needs 2 more`);
  const end = P.rows.find(r => r[0] === 17); check(end && end[3] >= last - 1, `pack ${p}: the ending starts at ${end && end[3]} but rows run to ${last}`);
  console.log(`pack ${p}: ${P.rows.length} rows, ${P.sprites.length} sprites, ${lastPage} pages, ending at ${(end[3] / 1000).toFixed(1)} s`);
}
(async () => {
  let pw = null; try { pw = require('playwright'); } catch (e) { console.log('playwright not installed: skipping the browser part'); }
  if (pw) {
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.m4a': 'audio/mp4' };
    const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(b); } }); }).listen(0);
    const port = srv.address().port; const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const [pack, skip] of [['1', false], ['2', false], ['3', false], ['2', true]]) {
      const pg = await b.newPage({ viewport: { width: 480, height: 320 } }); const errs = [];
      pg.on('pageerror', e => errs.push(e.message)); await pg.clock.install();
      await pg.goto(`http://localhost:${port}/menu.html?pack=${pack}&screen=demo`); await pg.clock.runFor(2000);
      let rowsOk = false; const scr = () => pg.evaluate(() => document.querySelector('.scr.on').id);
      if (skip) { await pg.clock.runFor(20000); await pg.click('#dCv'); }
      let n = 0; while ((await scr()) === 'sDemo' && n < 160) { await pg.clock.runFor(1000); n++; if (!skip && !rowsOk) { const r = await pg.evaluate(() => intro && intro.seeker.state === 24 ? intro.seeker.rows.map(x => [x.r[0], x.s]) : null); if (r) { rowsOk = true; const TIMED = [5, 6, 7, 24, 25, 26, 27, 28, 29]; check(r.every(([op, s]) => TIMED.includes(op) ? s === 2 : s === 1), `pack ${pack}: some script rows did not run to their end`); } } }
      if (!skip) check(rowsOk, `pack ${pack}: never reached the ending`);
      check((await scr()) === 'sStage', `pack ${pack}${skip ? ' skipped' : ''}: still in the intro after ${n} s`);
      check(errs.length === 0, `pack ${pack}: page errors ${errs.join(';')}`);
      if (!skip) check(n > D[pack].rows.find(r => r[0] === 17)[3] / 1000 + 15, `pack ${pack}: ended too early (${n} s)`);
      console.log(`pack ${pack}${skip ? ' (tap at 20 s)' : ''}: left the intro after ${n} s of fake time`);
      await pg.close();
    }
    await b.close(); srv.close();
  }
  console.log(fails.length ? 'FAIL:\n  ' + fails.join('\n  ') : 'PASS'); process.exit(fails.length ? 1 : 0);
})();
