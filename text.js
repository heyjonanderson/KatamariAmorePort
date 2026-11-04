// Strings and the King's dialogue box, shared by menu.html and game.html.
// Strings come from English.lproj/STRING.dat (data/strings_en.json, exported by tools/export_strings.py). Typing speed is a guess (ASSUMPTIONS A40).
(function (root) {
  let T = null;
  const group = name => { const i = T.names.findIndex(n => n[0] === name); if (i < 0) return []; const st = T.names[i][1], nx = i + 1 < T.names.length ? T.names[i + 1][1] : T.strings.length; return T.strings.slice(st, nx).map(s => s.replace(/\0/g, '')); };
  // markers in the original text: '&' = wait for a tap, '$' = end of the block, 'F1' = a big-number line, '#word#' = highlighted word
  const clean = s => s.replace(/\n?&\n?\$?/g, '').replace(/\n?\$/g, '').replace(/\nF1\n?/g, '\n').replace(/^F1\n?/, '').replace(/#/g, '').replace(/　/g, ' ').trim();
  const fmtTime = sec => { const m = Math.floor(sec / 60), s = Math.round(sec % 60), a = group('TIME_MIN')[0], b = group('TIME_AND')[0], c = group('TIME_SEC')[0]; return (m ? m + a : '') + (m && s ? b : '') + (s || !m ? s + c : ''); };
  function fill(s, v) { v = v || {}; return s.replace(/\[GOAL\]/g, v.goal || '').replace(/\[TIME\]/g, v.time || '').replace(/\[SIZE\]/g, v.size || '').replace(/\[SCORE\]/g, v.score || ''); }
  const pages = (names, v) => [].concat(...names.map(n => Array.isArray(n) ? n : group(n))).map(s => fill(clean(s), v));
  // Dialog: types text out, tap / Enter / Space finishes the page, then advances. el = the box element, with .t (text) and .n (arrow)
  function dialog(el, list, done) {
    const t = el.querySelector('.t'), n = el.querySelector('.n'); let i = 0, c = 0, timer = null, fin = false;
    const SPEED = 38;
    function show() { c = 0; fin = false; n.style.visibility = 'hidden'; t.textContent = ''; clearInterval(timer); timer = setInterval(() => { c += SPEED / 60; const k = Math.floor(c); t.textContent = list[i].slice(0, k); if (k >= list[i].length) { clearInterval(timer); fin = true; n.style.visibility = 'visible'; } }, 1000 / 60); }
    function next() { if (!fin) { clearInterval(timer); t.textContent = list[i]; fin = true; n.style.visibility = 'visible'; return; } i++; if (i >= list.length) { clearInterval(timer); done && done(); return; } show(); }
    const key = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); next(); } };
    el.onclick = next; document.addEventListener('keydown', key);
    show();
    return { stop() { clearInterval(timer); document.removeEventListener('keydown', key); el.onclick = null; } };
  }
  // fit a 480x320 box (the art's native size) into the window
  function fit(box) { const f = () => { const s = Math.min(innerWidth / 480, innerHeight / 320); box.style.transform = `translate(${(innerWidth - 480 * s) / 2}px,${(innerHeight - 320 * s) / 2}px) scale(${s})`; }; addEventListener('resize', f); setInterval(f, 400); f(); }   // the interval covers panes that resize without telling the page
  async function load() { T = await (await fetch('data/strings_en.json?v=1')).json(); return root.KText; }
  root.KText = { load, group, clean, fill, pages, fmtTime, dialog, fit };
})(window);
