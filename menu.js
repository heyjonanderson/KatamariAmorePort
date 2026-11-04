// Title -> mode select -> stage select -> the King's briefing -> game.html. Art and text are the original's; layout, timings and transitions are guesses (ASSUMPTIONS A38-A41).
'use strict';
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const STAGES = ['S001', 'S002', 'S003', 'S004', 'S005', 'S006'];
const PLAYABLE = 6;                                   // all six stages of the first pack run (2 to 6 are only bot-tested, flagged rough)
const MODES = [
  { id: 'story', name: 'Story', info: 0 },
  { id: 'timeattack', name: 'Time Attack', info: 1 },
  { id: 'eternal', name: 'Eternal', info: -1 },
  { id: 'exact', name: 'Exact Size', info: 2, off: true },
];
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
      const txt = mode === 'story' ? (r.story ? 'best ' + KT.fmtTime(r.story) : '') : (r[mode] ? 'best ' + (r[mode] >= 100 ? (r[mode] / 100).toFixed(2) + ' m' : r[mode].toFixed(1) + ' cm') : '');
      if (txt) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 62) + 'px'; f.style.color = '#8dff8d'; f.textContent = (mode === 'story' && r.cleared ? '\u2713 ' : '') + txt; box.appendChild(f); } }
    if (i >= PLAYABLE) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'not ported'; box.appendChild(f); }
    else if (i > 0) { const f = document.createElement('div'); f.className = 'flag'; f.style.left = (x + 6) + 'px'; f.style.top = (y + 6) + 'px'; f.textContent = 'rough'; box.appendChild(f); }
    t.onclick = () => { if (i >= PLAYABLE) { $('stInfo').textContent = KT.group('COMING_SOON')[0].replace('\n', ' '); return; } KSnd.se('KD_SE_common_00'); brief(i); };
  });
  $('stBack').onclick = modeScreen;
}

// the King's lines for a stage and mode. [GOAL] is the stage's target (TARGET_ID), [TIME] the mode's time limit from the stage's MIS file
async function brief(i) {
  const st = STAGES[i]; plays = plays || {}; const p = plays[st] = plays[st] || await (await fetch(`data/${st}/play.json?v=1`)).json();
  const goal = KT.group('TARGET_ID')[i] || '', tl = p.mis.time_limit || [], v = { goal };
  let pages;
  if (mode === 'story') { v.time = KT.fmtTime(tl[0] || 360); pages = KT.pages([[KT.group('STORY_INFO')[i]], 'STORY_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(0, 4)], v); }
  else if (mode === 'timeattack') { v.time = KT.fmtTime(tl[1] || 300); const ti = KT.group('TIME_INFO'), tc = KT.group('TIME_INFO_COM'); pages = KT.pages([[ti[i * 2], ti[i * 2 + 1]], tc, [KT.group('START_GAME')[i]], KT.group('START_COM').slice(4, 6)], v); }
  else { const ei = KT.group('ETER_INFO'); pages = KT.pages([[ei[i * 2], ei[i * 2 + 1]], 'ETER_INFO_COM', [KT.group('START_GAME')[i]], KT.group('START_COM').slice(8, 10)], v); }
  show('sKing');
  const go = () => { if (dlg) dlg.stop(); location.href = `game.html?stage=${st}&mode=${mode}`; };
  dlg = KT.dialog($('kDlg'), pages, go); $('kSkip').onclick = go;
}

(async function () {
  KT.fit($('box')); await KT.load();
  if (qs.get('screen') === 'stage') stageScreen(); else if (qs.get('screen') === 'mode') modeScreen(); else logo();
})();
