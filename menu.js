// Title -> mode select -> stage select -> the King's briefing -> game.html. Art and text are the original's; layout, timings and transitions are guesses (ASSUMPTIONS A38-A41).
'use strict';
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const STAGES = ['S001', 'S002', 'S003', 'S004', 'S005', 'S006'];
const EXACT_CM = { S001: 90, S002: 60, S003: 120, S004: 350, S005: 400, S006: 9000 };   // PLACEHOLDER (A57): the original's target sizes are not decoded. About 1.2x the story goal, so every stage can reach them
const PLAYABLE = 6;                                   // all six stages of the first pack run (2 to 6 are only bot-tested, flagged rough)
const MODES = [
  { id: 'story', name: 'Story', info: 0 },
  { id: 'timeattack', name: 'Time Attack', info: 1 },
  { id: 'eternal', name: 'Eternal', info: -1 },
  { id: 'exact', name: 'Exact Size', info: 2 },
];
// Mode button labels in each language. These are MY wording (the original draws them as pictures), see A77
const MODE_NAMES = { en: ['Story', 'Time Attack', 'Eternal', 'Exact Size'], fr: ['Histoire', 'Contre la montre', 'Éternel', 'Taille exacte'], de: ['Geschichte', 'Zeitangriff', 'Ewig', 'Exakte Größe'], it: ['Storia', 'Contro il tempo', 'Eterno', 'Misura esatta'], es: ['Historia', 'Contrarreloj', 'Eterno', 'Tamaño exacto'], ja: ['ストーリー', 'タイムアタック', 'エターナル', 'ジャストサイズ'] };
{ const n = MODE_NAMES[(window.KText && KText.lang) || 'en'] || MODE_NAMES.en; MODES.forEach((x, i) => { x.name = n[i]; }); }
let mode = qs.get('mode') || 'story', plays = null, dlg = null;
const show = id => { for (const s of document.querySelectorAll('.scr')) s.classList.toggle('on', s.id === id); };
const KT = window.KText;

function logo() { show('sLogo'); const go = () => { clearTimeout(t); $('sLogo').onclick = null; title(); }; const t = setTimeout(go, 1600); $('sLogo').onclick = go; }
function title() { show('sTitle'); KSnd.bgm('KD_BGM_00'); $('sTitle').onclick = () => { KSnd.se('KD_SE_common_00'); modeScreen(); }; }

function modeScreen() {
  show('sMode'); $('sTitle').onclick = null; $('mHdr').textContent = KT.group('SELECT_MODE')[0];
  const box = $('mBtns'); box.innerHTML = ''; $('mInfo').textContent = '';
  MODES.forEach((m, i) => {
    const b = document.createElement('div'); b.className = 'btn ' + (m.off ? 'g off' : (m.id === mode ? 'y' : 'g')); b.style.left = '170px'; b.style.top = (34 + i * 46) + 'px'; b.textContent = m.name;
    if (m.off) { const s = document.createElement('small'); s.textContent = 'soon'; b.appendChild(s); }
    const info = () => { $('mInfo').textContent = m.info >= 0 ? KT.group('SELECT_MODEINFO')[m.info] : KT.group('SELECT_TAIL')[0]; };
    b.onmouseenter = info;
    b.onclick = () => { info(); if (m.off) return; KSnd.se('KD_SE_common_00'); mode = m.id; stageScreen(); };
    box.appendChild(b);
  });
}

function stageScreen() {
  show('sStage'); $('stHdr').textContent = KT.group('PACK_STAGE1')[0]; $('stInfo').textContent = '';
  const names = KT.group('STAGE_NAME1'), box = $('stTiles'); box.innerHTML = '';
  STAGES.forEach((st, i) => {
    const col = i % 3, row = Math.floor(i / 3), x = 22 + col * 156, y = 44 + row * 118, ax = (i % 2) * 202, ay = [1, 135, 269][Math.floor(i / 2)];   // thumbnails sit 2 across, 3 down in ModSTAG1 (A39: assumed to be in stage order)
    const t = document.createElement('div'); t.className = 'tile' + (i >= PLAYABLE ? ' off' : ''); t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.backgroundPosition = `${-ax * 308 / 512 - 1}px ${-ay * 308 / 512 - 1}px`;
    const l = document.createElement('div'); l.className = 'tlab'; l.style.left = (x - 3) + 'px'; l.style.top = (y + 88) + 'px'; l.textContent = names[i] || st;
    box.appendChild(t); box.appendChild(l);
    { let r = {}; try { r = (JSON.parse(localStorage.getItem('kam_rec') || '{}'))[st] || {}; } catch (e) {}
      const txt = mode === 'story' ? (r.story ? 'best ' + KT.fmtTime(r.story) : '') : mode === 'exact' ? (r.exact !== undefined ? 'best: off by ' + r.exact + '%' : '') : (r[mode] ? 'best ' + (r[mode] >= 100 ? (r[mode] / 100).toFixed(2) + ' m' : r[mode].toFixed(1) + ' cm') : '');
      if (txt) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 62) + 'px'; f.style.color = '#8dff8d'; f.textContent = (mode === 'story' && r.cleared ? '\u2713 ' : '') + txt; box.appendChild(f); } }
    if (i >= PLAYABLE) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'not ported'; box.appendChild(f); }
    else if (i > 0) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'rough'; box.appendChild(f); }
    t.onclick = () => { if (i >= PLAYABLE) { $('stInfo').textContent = KT.group('COMING_SOON')[0].replace('\n', ' '); return; } KSnd.se('KD_SE_common_00'); brief(i); };
  });
  $('stBack').onclick = modeScreen; $('stDemo').onclick = () => demo(stageScreen);
}


// Opening story (STORY_DEMO1): six pages, each a small staged picture from the OP1 sprites. The original's layout, camera moves and timing are not decoded; this is my staging (A58)
const OP = n => `url(ui/OP1/${n}.png)`;
const DEMO1 = [   // layers per page: [kind, image, left, top, w, h, delay]
  [['bg', 'DemROOM1', 512, 256], ['ch', 'DemChar2']],
  [['bg', 'DemROOM1', 512, 256], ['ch', 'DemChar1']],
  [['bg', 'DemROOM1', 512, 256], ['ch', 'DemChar3']],
  [['bg', 'DemROOM2', 512, 256]],
  [['bg', 'DemROOM2', 512, 256], ['it', 'DemITM01', 20, 30, 80, 80, 0.2], ['it', 'DemITM07', 380, 40, 80, 80, 0.5], ['it', 'DemITM10', 60, 150, 64, 64, 0.8], ['it', 'DemITMWD', 360, 160, 90, 90, 1.1], ['it', 'DemITM09', 210, 6, 80, 80, 1.4], ['it', 'DemITM04', 120, 100, 64, 64, 1.7], ['it', 'DemITM06', 300, 110, 64, 64, 2.0]],
  [['bg', 'DemROOM2', 512, 256], ['ch', 'DemChar6'], ['it', 'DemPARTS', 30, 20, 96, 96, 0.5]],
];
function demoScene(i) {
  const box = $('dScene'); box.innerHTML = '';
  for (const L of DEMO1[Math.min(i, DEMO1.length - 1)]) {
    const d = document.createElement('div'); d.className = 'l ' + L[0]; d.style.backgroundImage = OP(L[1]);
    if (L[0] === 'bg') d.style.backgroundSize = L[2] + 'px ' + L[3] + 'px';
    if (L[0] === 'it') { d.style.left = L[2] + 'px'; d.style.top = L[3] + 'px'; d.style.width = L[4] + 'px'; d.style.height = L[5] + 'px'; d.style.backgroundSize = 'contain'; d.style.animationDelay = L[6] + 's, ' + (L[6] + 0.5) + 's'; }
    box.appendChild(d);
  }
}
function demo(next) {
  show('sDemo');
  const pages = KT.group('STORY_DEMO1').map(s => KT.clean(s));
  const go = () => { if (dlg) dlg.stop(); try { localStorage.setItem('kam_demo', '1'); } catch (e) {} next(); };
  dlg = KT.dialog($('dDlg'), pages, go, demoScene); $('dSkip').onclick = go;
}
const demoSeen = () => { try { return !!localStorage.getItem('kam_demo'); } catch (e) { return true; } };

// the King's lines for a stage and mode. [GOAL] is the stage's target (TARGET_ID), [TIME] the mode's time limit from the stage's MIS file
async function brief(i) {
  if (mode === 'story' && i === 0 && !demoSeen() && !qs.get('nodemo')) { demo(() => brief(0)); return; }
  const st = STAGES[i]; plays = plays || {};
  if (!plays[st]) { const t = KLoad.begin('Loading stage data', { expect: 1, now: true }); try { plays[st] = JSON.parse(new TextDecoder().decode(await KLoad.fetchBuf(`data/${st}/play.json?v=13`, (d, n) => t.set(d / n)))); } finally { t.end(); } }
  const p = plays[st];
  const goal = KT.group('TARGET_ID')[i] || '', tl = p.mis.time_limit || [], v = { goal };
  let pages;
  if (mode === 'story') { v.time = KT.fmtTime(tl[0] || 360); pages = KT.pages([[KT.group('STORY_INFO')[i]], 'STORY_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(0, 4)], v); }
  else if (mode === 'timeattack') { v.time = KT.fmtTime(tl[1] || 300); const ti = KT.group('TIME_INFO'), tc = KT.group('TIME_INFO_COM'); pages = KT.pages([[ti[i * 2], ti[i * 2 + 1]], tc, [KT.group('START_GAME')[i]], KT.group('START_COM').slice(4, 6)], v); }
  else if (mode === 'exact') { v.size = KT.fmtSize(EXACT_CM[st]); pages = KT.pages([[KT.group('SIZE_INFO')[i]], 'SIZE_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(6, 8)], v); }
  else { const ei = KT.group('ETER_INFO'); pages = KT.pages([[ei[i * 2], ei[i * 2 + 1]], 'ETER_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(8, 10)], v); }
  show('sKing');
  const go = () => { if (dlg) dlg.stop(); location.href = `game.html?stage=${st}&mode=${mode}`; };
  dlg = KT.dialog($('kDlg'), pages, go); $('kSkip').onclick = go;
}

(async function () {
  KT.fit($('box')); await KT.load();
  $('tLang').textContent = KT.LANGS.find(x => x[0] === KT.lang)[1] + ' \u25B8'; $('tLang').onclick = e => { e.stopPropagation(); KT.nextLang(); location.reload(); };
  if (qs.get('screen') === 'stage') stageScreen(); else if (qs.get('screen') === 'mode') modeScreen(); else if (qs.get('screen') === 'demo') demo(stageScreen); else logo();
})();
