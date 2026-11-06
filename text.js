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
  function dialog(el, list, done, onPage) {
    const t = el.querySelector('.t'), n = el.querySelector('.n'); let i = 0, c = 0, timer = null, fin = false;
    const SPEED = 38;
    function show() { onPage && onPage(i); c = 0; fin = false; n.style.visibility = 'hidden'; t.textContent = ''; clearInterval(timer); timer = setInterval(() => { c += SPEED / 60; const k = Math.floor(c); t.textContent = list[i].slice(0, k); if (k >= list[i].length) { clearInterval(timer); fin = true; n.style.visibility = 'visible'; } }, 1000 / 60); }
    function next() { if (!fin) { clearInterval(timer); t.textContent = list[i]; fin = true; n.style.visibility = 'visible'; return; } i++; if (i >= list.length) { clearInterval(timer); done && done(); return; } show(); }
    const key = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); next(); } };
    el.onclick = next; document.addEventListener('keydown', key);
    show();
    return { stop() { clearInterval(timer); document.removeEventListener('keydown', key); el.onclick = null; } };
  }
  // fit a 480x320 box (the art's native size) into the window
  function fit(box) { const f = () => { const s = Math.min(innerWidth / 480, innerHeight / 320); box.style.transform = `translate(${(innerWidth - 480 * s) / 2}px,${(innerHeight - 320 * s) / 2}px) scale(${s})`; }; addEventListener('resize', f); setInterval(f, 400); f(); }   // the interval covers panes that resize without telling the page
  // Languages: the app ships STRING.dat for six languages (exported by tools/export_strings.py). The choice is kept in localStorage (A77)
  const LANGS = [['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['es', 'Español'], ['ja', '日本語']];
  let lang = 'en'; try { const l = localStorage.getItem('kl_lang'); if (LANGS.some(x => x[0] === l)) lang = l; } catch (e) {}
  const nextLang = () => { const c = LANGS[(LANGS.findIndex(x => x[0] === lang) + 1) % LANGS.length][0]; try { localStorage.setItem('kl_lang', c); } catch (e) {} return c; };
  async function load() { T = await (await fetch('data/strings_' + lang + '.json?v=14')).json(); return root.KText; }
  const fmtSize = cm => { const t = Math.floor(cm * 10 + 1e-6), m = Math.floor(t / 1000), c = Math.floor((t % 1000) / 10), mm = t % 10; return m > 0 ? m + 'm' + String(c).padStart(2, '0') + 'cm' + mm + 'mm' : c > 0 ? c + 'cm' + mm + 'mm' : mm + 'mm'; };   // A72
  root.KText = { load, LANGS, nextLang, get lang() { return lang; }, group, clean, fill, pages, fmtTime, fmtSize, dialog, fit };
})(window);
