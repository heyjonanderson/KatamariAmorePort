// Title -> mode select -> stage select -> the King's briefing -> game.html. Art and text are the original's; layout, timings and transitions are guesses (ASSUMPTIONS A38-A41).
'use strict';
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const PACKS = [null, ['S001', 'S002', 'S003', 'S004', 'S005', 'S006'], ['S008', 'S009', 'S010', 'S011', 'S012', 'S013'], ['S015', 'S016', 'S017', 'S018', 'S019', 'S020']];   // S007, S014 and S021 are the extra mini-game stages, not ported (A104)
let pack = Math.min(3, Math.max(1, parseInt(qs.get('pack'), 10) || 1)); const STAGES = () => PACKS[pack];
const PLAYABLE = 6;                                   // all six stages of every pack run (pack 1 stages 2 to 6 are bot-tested, packs 2 and 3 are not yet: flagged)
const MODES = [
  { id: 'story', name: 'Story', info: 0 },
  { id: 'timeattack', name: 'Time Attack', info: 1 },
  { id: 'eternal', name: 'Eternal', info: -1 },
  { id: 'exact', name: 'Exact Size', info: 2 },
];
// Mode button labels in each language. These are MY wording (the original draws them as pictures), see A77
const MODE_NAMES = { en: ['Story', 'Time Attack', 'Eternal', 'Exact Size'], fr: ['Histoire', 'Contre la montre', 'Éternel', 'Taille exacte'], de: ['Geschichte', 'Zeitangriff', 'Ewig', 'Exakte Größe'], it: ['Storia', 'Contro il tempo', 'Eterno', 'Misura esatta'], es: ['Historia', 'Contrarreloj', 'Eterno', 'Tamaño exacto'], ja: ['ストーリー', 'タイムアタック', 'エターナル', 'ジャストサイズ'] };
{ const n = MODE_NAMES[(window.KText && KText.lang) || 'en'] || MODE_NAMES.en; MODES.forEach((x, i) => { x.name = n[i]; }); }
let mode = qs.get('mode') || 'story', stageIdx = 0, plays = null, dlg = null;
const show = id => { for (const s of document.querySelectorAll('.scr')) s.classList.toggle('on', s.id === id); };
const KT = window.KText;

function logo() { show('sLogo'); const go = () => { clearTimeout(t); $('sLogo').onclick = null; title(); }; const t = setTimeout(go, 1600); $('sLogo').onclick = go; }
function title() { show('sTitle'); KSnd.bgm('KD_BGM_00'); $('sTitle').onclick = () => { KSnd.se('KD_SE_common_00'); packScreen(); }; }

// Pack picker: names are STAGEPACK_TYPE1, blurbs STAGEPACK_DETAIL. Layout is mine (A104)
function packScreen() {
  show('sPack'); $('sTitle').onclick = null; KT.setPack(1); $('pkHdr').textContent = KT.group('STAGEPACK_SELECT')[0];
  const ty = KT.group('STAGEPACK_TYPE1'), box = $('pkBtns'); box.innerHTML = '';
  for (let p = 1; p <= 3; p++) {
    const b = document.createElement('div'); b.className = 'btn ' + (p === pack ? 'y' : 'g'); b.style.left = '90px'; b.style.top = (34 + (p - 1) * 78) + 'px'; b.textContent = ty[p - 1];
    const sm = document.createElement('div'); sm.className = 'info'; sm.style.top = (34 + (p - 1) * 78 + 44) + 'px'; sm.style.fontSize = '11px'; sm.style.color = '#234'; sm.style.textShadow = '0 1px 2px #fff8'; sm.textContent = (KT.group('STAGEPACK_DETAIL')[p - 1] || '').replace('\n', ' '); box.appendChild(sm);
    b.onclick = () => { KSnd.se('KD_SE_common_00'); pack = p; stageScreen(); };   // the original asks pack, then stage, then mode: the mode screen's setup turns (pack, stage slot) into the global stage index first (FUN_00038ea4 state 9, A128)
    box.appendChild(b);
  }
}

function modeScreen() {
  show('sMode'); $('sTitle').onclick = null; KT.setPack(pack); $('mHdr').textContent = KT.group('SELECT_MODE')[0];
  const box = $('mBtns'); box.innerHTML = ''; $('mInfo').textContent = '';
  MODES.forEach((m, i) => {
    const b = document.createElement('div'); b.className = 'btn ' + (m.off ? 'g off' : (m.id === mode ? 'y' : 'g')); b.style.left = '170px'; b.style.top = (34 + i * 46) + 'px'; b.textContent = m.name;
    if (m.off) { const s = document.createElement('small'); s.textContent = 'soon'; b.appendChild(s); }
    const info = () => { $('mInfo').textContent = m.info >= 0 ? KT.group('SELECT_MODEINFO')[m.info] : KT.group('SELECT_TAIL')[0]; };
    b.onmouseenter = info;
    b.onclick = () => { info(); if (m.off) return; KSnd.se('KD_SE_common_00'); mode = m.id; brief(stageIdx); };
    box.appendChild(b);
  });
  $('mBack').onclick = stageScreen;
}

function stageScreen() {
  show('sStage'); KT.setPack(pack); $('stHdr').textContent = KT.group('PACK_STAGE')[0]; $('stInfo').textContent = '';
  const names = KT.group('STAGE_NAME'), box = $('stTiles'); box.innerHTML = '';
  STAGES().forEach((st, i) => {
    const col = i % 3, row = Math.floor(i / 3), x = 22 + col * 156, y = 44 + row * 118, ax = (i % 2) * 202, ay = [1, 135, 269][Math.floor(i / 2)];   // thumbnails sit 2 across, 3 down in ModSTAG1 (A39; packs 2 and 3 checked against the images, same layout)
    const t = document.createElement('div'); t.className = 'tile' + (i >= PLAYABLE ? ' off' : ''); t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.backgroundImage = `url(ui/MODE/ModSTAG${pack}.png)`; t.style.backgroundPosition = `${-ax * 308 / 512 - 1}px ${-ay * 308 / 512 - 1}px`;
    const l = document.createElement('div'); l.className = 'tlab'; l.style.left = (x - 3) + 'px'; l.style.top = (y + 88) + 'px'; l.textContent = names[i] || st;
    box.appendChild(t); box.appendChild(l);
    { let r = {}; try { r = (JSON.parse(localStorage.getItem('kam_rec') || '{}'))[st] || {}; } catch (e) {}
      const txt = true ? (r.story ? 'best ' + KT.fmtTime(r.story) : '') : mode === 'exact' ? (r.exactMm !== undefined ? 'best: off by ' + KT.fmtSize(r.exactMm / 10) : '') : (r[mode] ? 'best ' + (r[mode] >= 100 ? (r[mode] / 100).toFixed(2) + ' m' : r[mode].toFixed(1) + ' cm') : '');
      if (txt) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 62) + 'px'; f.style.color = '#8dff8d'; f.textContent = (r.cleared ? '\u2713 ' : '') + txt; box.appendChild(f); } }
    if (i >= PLAYABLE) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'not ported'; box.appendChild(f); }
    else if (pack > 1) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'untested'; box.appendChild(f); }
    else if (i > 0) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'rough'; box.appendChild(f); }
    t.onclick = () => { if (i >= PLAYABLE) { $('stInfo').textContent = KT.group('COMING_SOON')[0].replace('\n', ' '); return; } KSnd.se('KD_SE_common_00'); stageIdx = i; modeScreen(); };
  });
  $('stBack').onclick = packScreen; $('stPack').onclick = packScreen; $('stDemo').onclick = () => demo(stageScreen); $('stRec').onclick = () => recScreen('story'); $('stAlb').onclick = () => albScreen(0);
}


// Records: the clipboard art of SCORE.dat with the stage bests kept by game.js (kam_rec). Layout of the text on the clipboard is mine (A114)
function recScreen(m) {
  show('sRec'); KT.setPack(pack); const names = KT.group('STAGE_NAME'), sc = KT.group('SCORE_CONT'), order = ['story', 'timeattack', 'exact', 'eternal'], mi = Math.max(0, order.indexOf(m));
  let rec = {}; try { rec = JSON.parse(localStorage.getItem('kam_rec') || '{}'); } catch (e) {}
  $('rcHdr').textContent = sc[0]; $('rcMode').textContent = sc[1 + mi] + ' \u25B8'; $('rcMode').onclick = () => recScreen(order[(mi + 1) % 4]);
  const mmss = t => Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0'), fmt = (r) => m === 'story' ? (r.story ? (r.cleared ? '\u2713 ' : '') + mmss(r.story) : '-') : m === 'exact' ? (r.exactMm !== undefined ? '\u00b1' + KT.fmtSize(r.exactMm / 10) : '-') : (r[m] ? KT.fmtSize(r[m]) : '-');
  const box = $('rcRows'); box.innerHTML = '';
  STAGES().slice(0, PLAYABLE).forEach((st, i) => { const r = rec[st] || {}, d = document.createElement('div'); d.className = 'r'; const a = document.createElement('span'), b = document.createElement('b'); a.textContent = names[i] || st; b.textContent = fmt(r); d.appendChild(a); d.appendChild(b); box.appendChild(d); });
  $('rcBack').onclick = stageScreen;
  $('rcPack').textContent = 'Pack ' + pack + ' \u25B8'; $('rcPack').onclick = () => { pack = pack % 3 + 1; recScreen(m); };
}

// Collection: the album book of ALBUM.dat. Items stuck on the ball when a story stage was cleared; the achievement and Extra stage counts come from the pickup rules in MonoHit.cppi (A114)
function albScreen(si) {
  show('sAlb'); KSnd.bgm('KD_BGM_05'); KT.setPack(pack); const names = KT.group('STAGE_NAME'), al = KT.group('ALBUM');
  let col = { ach: {}, extra: [0, 0, 0], alb: {} }; try { col = Object.assign(col, JSON.parse(localStorage.getItem('kam_col') || '{}')); } catch (e) {}
  const st = STAGES()[si], items = Object.entries((col.alb || {})[st] || {}).sort((a, b) => a[0].localeCompare(b[0]));
  $('abHdr').textContent = al[1] || 'Collection';
  const box = $('abList'); box.innerHTML = '';
  if (!items.length) { const d = document.createElement('div'); d.textContent = '\u2013'; box.appendChild(d); }
  items.forEach(([k, n]) => { const d = document.createElement('div'), a = document.createElement('span'), b = document.createElement('span'); a.textContent = k; b.textContent = '\u00d7' + n; d.appendChild(a); d.appendChild(b); box.appendChild(d); });
  const nAch = Object.keys(col.ach || {}).length;
  $('abName').textContent = names[si] || st; $('abCount').textContent = items.length;
  $('abInfo').textContent = (al[0] || '').replace('\n', ' ') + '\n\n' + nAch + ' achievements  \u00b7  Extra item ' + (col.extra && col.extra[pack - 1] ? 'found' : 'not found');
  $('abStage').textContent = (names[si] || st) + ' \u25B8'; $('abStage').onclick = () => albScreen((si + 1) % PLAYABLE); $('abBack').onclick = () => { KSnd.bgm('KD_BGM_00'); stageScreen(); };
}

// Opening story: played from the original's script tables by intro.js (data/intro.json, A107). The strings are STORY_DEMO1 to 3 (16, 18 and 16 strings: the last two or so are the lines shown during the ending scroll)
let intro = null;
function demo(next) {
  show('sDemo'); KT.setPack(pack);
  const texts = KT.groupN('STORY_DEMO', [0, 16, 18, 16][pack]).map(s => KT.clean(s));
  const go = () => { if (intro) { intro.stop(); intro = null; } KSnd.bgm('KD_BGM_00'); try { localStorage.setItem(demoKey(), '1'); } catch (e) {} next(); };
  intro = null; KIntro.play({ pack, canvas: $('dCv'), texts, done: go }).then(p => { intro = p; });
  $('dSkip').onclick = () => { if (intro) intro.skip(); else go(); };
}
const demoKey = () => pack === 1 ? 'kam_demo' : 'kam_demo' + pack;   // each pack's story plays once before its first Story stage
const demoSeen = () => { try { return !!localStorage.getItem(demoKey()); } catch (e) { return true; } };

// the King's lines for a stage and mode. [GOAL] is the stage's target (TARGET_ID), [TIME] the mode's time limit from the stage's MIS file
async function brief(i) {
  if (mode === 'story' && i === 0 && !demoSeen() && !qs.get('nodemo')) { demo(() => brief(0)); return; }
  const st = STAGES()[i]; KT.setPack(pack); plays = plays || {};
  if (!plays[st]) { const t = KLoad.begin('Loading stage data', { expect: 1, now: true }); try { plays[st] = JSON.parse(new TextDecoder().decode(await KLoad.fetchBuf(`data/${st}/play.json?v=38`, (d, n) => t.set(d / n)))); } finally { t.end(); } }
  const p = plays[st];
  const goal = KT.group('TARGET_ID')[i] || '', tl = p.mis.time_limit_n || [], v = { goal };
  let pages;
  if (mode === 'story') { v.time = KT.fmtTime(tl[2] || 300); pages = KT.pages([[KT.group('STORY_INFO')[i]], 'STORY_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(0, 4)], v); }
  else if (mode === 'timeattack') { v.time = KT.fmtTime(tl[3] || 240); const ti = KT.group('TIME_INFO'), tc = KT.group('TIME_INFO_COM'); pages = KT.pages([[ti[i * 2], ti[i * 2 + 1]], tc, [KT.group('START_GAME')[i]], KT.group('START_COM').slice(4, 6)], v); }
  else if (mode === 'exact') { v.size = KT.fmtSize(p.mis.exact_mm / 10); pages = KT.pages([[KT.group('SIZE_INFO')[i]], 'SIZE_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(6, 8)], v); }
  else { const ei = KT.group('ETER_INFO'); pages = KT.pages([[ei[i * 2], ei[i * 2 + 1]], 'ETER_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(8, 10)], v); }
  show('sKing');
  const go = () => { if (dlg) dlg.stop(); location.href = `game.html?stage=${st}&mode=${mode}`; };
  dlg = KT.dialog($('kDlg'), pages, go); $('kSkip').onclick = go;
}

(async function () {
  KT.fit($('box')); await KT.load();
  $('tLang').textContent = KT.LANGS.find(x => x[0] === KT.lang)[1] + ' \u25B8'; $('tLang').onclick = e => { e.stopPropagation(); KT.nextLang(); location.reload(); };
  if (qs.get('screen')) KSnd.bgm('KD_BGM_00'); if (qs.get('screen') === 'pack') packScreen(); else if (qs.get('screen') === 'stage') stageScreen(); else if (qs.get('screen') === 'mode') modeScreen(); else if (qs.get('screen') === 'demo') demo(stageScreen); else logo();
})();
