// Web Audio for the port. Files are the game's own CAF audio converted to AAC (.m4a, see ASSUMPTIONS A34, A68, P23).
// The context can only start after a tap or key press, so everything waits for the first gesture.
(function (root) {
  const BASE = 'audio/';
  let ctx = null, master = null, bgmGain = null, seGain = null, muted = false, started = false, bgmNodes = [], wantBgm = null;
  const buf = new Map(), pending = new Map();
  try { muted = localStorage.getItem('kmute') === '1'; } catch (e) { }
  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    bgmGain = ctx.createGain(); bgmGain.gain.value = 0.55; bgmGain.connect(master); seGain = ctx.createGain(); seGain.gain.value = 0.9; seGain.connect(master);
    return ctx;
  }
  function load(name) {
    if (buf.has(name)) return Promise.resolve(buf.get(name)); if (pending.has(name)) return pending.get(name);
    const p = fetch(BASE + name + '.m4a').then(r => r.ok ? r : fetch(BASE + name + '.wav')).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); })   // everything is AAC now (A68); the .wav is only a fallback
      .then(a => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then(b => { buf.set(name, b); return b; }).catch(() => null);
    pending.set(name, p); return p;
  }
  function stopBgm() { for (const n of bgmNodes) { try { n.stop(); } catch (e) { } } bgmNodes = []; wantBgm = null; }
  // intro (A) once, then the loop (B), scheduled back to back so there is no gap
  async function bgm(stem) {
    wantBgm = stem; if (!ensure()) return;   // the context can be made and can decode before the first tap (it stays suspended), so the music is ready the moment the tap unlocks it
    let [a, b] = await Promise.all([load(stem + '_A'), load(stem + '_B')]); if (!b) { a = null; b = await load(stem); }   // a plain file loops by itself
    if (!started || wantBgm !== stem || !b) return;
    for (const n of bgmNodes) { try { n.stop(); } catch (e) { } } bgmNodes = [];
    const t0 = ctx.currentTime + 0.05; let t = t0;
    if (a) { const s = ctx.createBufferSource(); s.buffer = a; s.connect(bgmGain); s.start(t); bgmNodes.push(s); t += a.duration; }
    const l = ctx.createBufferSource(); l.buffer = b; l.loop = true; l.connect(bgmGain); l.start(t); bgmNodes.push(l);
  }
  let lastSe = {};
  async function se(name, vol) {
    if (!started || !ensure()) return; const now = ctx.currentTime; if (lastSe[name] && now - lastSe[name] < 0.06) return; lastSe[name] = now;
    const b = await load(name); if (!b) return; const s = ctx.createBufferSource(); s.buffer = b;
    if (vol !== undefined && vol !== 1) { const g = ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(seGain); } else s.connect(seGain); s.start();
  }
  // iOS Safari only unlocks audio from 'touchend' or 'click' (not touchstart or pointerdown) and can re-suspend or 'interrupt' the context, so every gesture tries to resume it until it reports running,
  // and a silent buffer is played in the same gesture. Only then are the pending music and effects started (A125, tester: music and sounds started late on iPad Safari and Firefox on Android)
  function start() {
    if (!ensure()) return;
    if (ctx.state !== 'running') { try { const r = ctx.resume(); if (r && r.then) r.then(settle, () => { }); } catch (e) { } try { const b = ctx.createBuffer(1, 1, 22050), n = ctx.createBufferSource(); n.buffer = b; n.connect(ctx.destination); n.start(0); } catch (e) { } }
    settle();
  }
  function settle() { if (started || !ctx || ctx.state !== 'running') return; started = true; hidePrompt(); if (wantBgm) bgm(wantBgm); }
  // iOS Safari only unlocks audio from a touchend or click, and a finger held on the stick never ends. If nothing has unlocked it after a moment, a small button asks for one tap (tester 2026-11-27: Safari music and effects start late)
  let prompt = null, promptTimer = null;
  function hidePrompt() { if (promptTimer) { clearTimeout(promptTimer); promptTimer = null; } if (prompt) { prompt.remove(); prompt = null; } }
  function showPrompt() {
    promptTimer = null; if (started || muted || prompt || !root.document || !root.document.body) return;
    prompt = root.document.createElement('button'); prompt.textContent = 'Tap for sound';
    prompt.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99;padding:8px 14px;border-radius:16px;border:0;background:rgba(0,0,0,.65);color:#fff;font:600 14px system-ui,sans-serif';
    prompt.addEventListener('click', start); root.document.body.appendChild(prompt);
  }
  if (root.document && root.addEventListener) root.addEventListener('load', () => { promptTimer = setTimeout(showPrompt, 1500); });
  function setMuted(m) { muted = !!m; try { localStorage.setItem('kmute', muted ? '1' : '0'); } catch (e) { } if (master) master.gain.value = muted ? 0 : 1; }
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click', 'mousedown']) root.addEventListener(ev, start, { passive: true });
  if (root.document) root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden && ctx && ctx.state !== 'running') { started = false; start(); } });
  root.KSnd = { bgm, stopBgm, se, start, setMuted, isMuted: () => muted, preload: names => { if (ensure()) names.forEach(load); } };
})(typeof window !== 'undefined' ? window : globalThis);
