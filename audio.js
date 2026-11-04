// Web Audio for the port. Files are the game's own CAF audio converted to WAV (see ASSUMPTIONS A34, P23).
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
    const p = fetch(BASE + name + '.m4a').then(r => r.ok ? r : fetch(BASE + name + '.wav')).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); })
      .then(a => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then(b => { buf.set(name, b); return b; }).catch(() => null);
    pending.set(name, p); return p;
  }
  function stopBgm() { for (const n of bgmNodes) { try { n.stop(); } catch (e) { } } bgmNodes = []; wantBgm = null; }
  // intro (A) once, then the loop (B), scheduled back to back so there is no gap
  async function bgm(stem) {
    wantBgm = stem; if (!started || !ensure()) return;
    let [a, b] = await Promise.all([load(stem + '_A'), load(stem + '_B')]); if (!b) { a = null; b = await load(stem); }   // a plain file loops by itself
    if (wantBgm !== stem || !b) return;
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
  function start() { if (started) return; if (!ensure()) return; started = true; if (ctx.state === 'suspended') ctx.resume(); if (wantBgm) bgm(wantBgm); }
  function setMuted(m) { muted = !!m; try { localStorage.setItem('kmute', muted ? '1' : '0'); } catch (e) { } if (master) master.gain.value = muted ? 0 : 1; }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) root.addEventListener(ev, start, { passive: true });
  root.KSnd = { bgm, stopBgm, se, start, setMuted, isMuted: () => muted, preload: names => { if (started && ensure()) names.forEach(load); } };
})(typeof window !== 'undefined' ? window : globalThis);
