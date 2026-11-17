// The opening story (OP1, OP2, OP3), played from the original's own script tables.
// data/intro.json holds, per stage pack, the sprite list (sheet name + rectangle) and the script rows, dumped from the binary by tools/export_intro.ghidra.py.
// The player follows the script interpreter FUN_00056494 and the scene class FUN_00055ecc (decoded, see ASSUMPTIONS A107):
//   a row = [op, sprite, page, t0 ms, t1 ms, x, y, p0, p1, r, g, b, layer, f6]; each row runs once at t0 and, for timed ops, ends at t1.
//   5 show a sprite at x,y until t1.  6 show text page `page` (0 hides the text).  7 speech balloon centred on x,y, p0 x p1, tinted r,g,b, until t1 (FUN_0003e294: nine tiles of IMAGE/SYSBAL).  8 to 11 screen fade (black in, black out, white in, white out; f6/15 per frame).
//   12 and 13 sprite alpha ramp up/down by f6 per frame.  14 pop: ramp alpha by f6 and grow by 0.01 per frame around x,y.  16 zoom echo.  17 go to the ending scroll.
//   18 music, 19 stop music, 20 sound effect, 21 stop sound effects.  24 move from x,y to p0,p1 over t0..t1.  26 and 27 zoom in or out about p0,p1.  28 zoom with a pan.  29 keep showing until t1.
// Per-frame things (alpha ramps, the ending) run at 30 steps a second; the script clock is wall time in milliseconds.
(function (root) {
  const W = 480, H = 320, BAND = 66, SH = H - BAND, STEP = 1000 / 30;
  let DATA = null;
  const img = {};
  const loadImg = src => img[src] || (img[src] = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  // sound id -> file (the table at 0x89064, A94): 3 game_21, 4 and 5 oujih, 6 to 25 game_00 to game_19, 26 to 29 game_27 to game_30, 81 game_20, 82 and 83 res, 84 to 86 over
  const seName = id => id <= 2 ? 'KD_SE_common_0' + id : id === 3 ? 'KD_SE_game_21' : id <= 5 ? 'KD_SE_oujih_0' + (id - 4) : id <= 25 ? 'KD_SE_game_' + String(id - 6).padStart(2, '0') : id <= 29 ? 'KD_SE_game_' + (id + 1) : id === 81 ? 'KD_SE_game_20' : id <= 83 ? 'KD_SE_res_0' + (id - 82) : id === 84 ? 'KD_SE_over_00' : id === 85 ? 'KD_SE_over_00_2' : id === 86 ? 'KD_SE_over_01' : null;
  const bgmName = id => id <= 2 ? 'KD_BGM_0' + id : id === 3 ? 'BGM_ST00' : id <= 6 ? 'KD_BGM_0' + id : id <= 12 ? 'BGM_ST0' + (id - 6) : 'BGM_ST' + String(id - 5).padStart(2, '0');

  async function play(o) {
    if (!DATA) DATA = await (await fetch('data/intro.json?v=32')).json();
    const P = DATA[o.pack], cv = o.canvas, g = cv.getContext('2d'), texts = o.texts;
    const bal = await loadImg('ui/IMAGE/SYSBAL.png'), tint = document.createElement('canvas'); tint.width = W; tint.height = H;
    const sheets = {}; await Promise.all([...new Set(P.sprites.map(s => s[0]))].map(async n => { sheets[n] = await loadImg(`ui/OP${o.pack}/${n}.png`); }));
    // sprite objects (FUN_00055ba0 makes 67; they start hidden, alpha 1, layer 0)
    const S = []; for (let i = 0; i < 67; i++) { const d = P.sprites[i]; S.push({ d, hid: true, x: 0, y: 0, a: 1, layer: 0, flags: 0, rate: 0, w: d ? d[3] : 0, h: d ? d[4] : 0, px: 0, py: 0, rot: 0, ox: 0, oy: 0, bw: 0, bh: 0, zoom: 0, cx: 0, cy: 0, fr: 0, fa: 0 }); }
    // FUN_00055e78: the prince (sprite 9) cycles its 4 pictures, 1/16 of a step per frame, and the katamari (21) turns about its centre
    S[9].flags |= 2; S[9].x = 131; S[9].y = 91; S[21].px = 64; S[21].py = 64; S[21].x = 285; S[21].y = 160;
    const rows = P.rows.map(r => ({ r, s: 0 }));
    const fade = { mode: -1, t: 0, rate: 0 }; const rect = { a: 0, x: 0, y: 0, w: 0, h: 0, c: '#fff' };   // the balloon (one at a time)
    const echo = { on: false, s: 1, a: 1, n: 0, snap: null };
    let state = 4, page = -1, c8 = 0, c11 = 0, finishing = false, rotk = 0, done = false, t0 = performance.now(), acc = 0, last = t0, raf = 0;
    const show = s => { s.hid = false; }, hide = s => { s.hid = true; };
    const startFade = (mode, frames) => { fade.mode = mode; fade.t = 0; fade.rate = 1 / frames; };

    function script(now) {
      for (const R of rows) {
        const [op, si, pg, a0, a1, x, y, p0, p1, cr, cg, cb, layer, f6] = R.r, s = S[si];
        if (op === 5) { if (R.s === 1) { if (now >= a1) { hide(s); R.s = 2; } } else if (R.s === 0 && a0 <= now) { s.layer = layer; s.a = 1; s.x = x; s.y = y; show(s); R.s = 1; } }
        else if (op === 6) { if (R.s === 1) { if (now >= a1) { if (page === pg) page = -1; R.s = 2; } } else if (R.s === 0 && a0 <= now) { page = pg - 1; R.s = 1; } }
        else if (op === 7) { if (R.s === 1) { if (now >= a1) { rect.a = 0; R.s = 2; } } else if (R.s === 0 && a0 <= now) { rect.x = x; rect.y = y; rect.w = p0; rect.h = p1; rect.c = `rgb(${cr},${cg},${cb})`; rect.a = 1; R.s = 1; } }
        else if (op >= 8 && op <= 11) { if (R.s === 0 && a0 <= now) { startFade([2, 3, 0, 1][op - 8], 15 / f6); R.s = 1; } }
        else if (op === 12 || op === 13 || op === 14 || op === 15) {
          if (R.s === 0 && a0 <= now) {
            s.rate = f6; s.a = op === 13 ? 1 : 0; s.flags |= op === 14 ? 0x40 : op === 15 ? 0x20 : 0x10;
            if (op === 14) { s.ox = s.x; s.oy = s.y; s.bw = s.w; s.bh = s.h; s.zoom = 0; }
            show(s); R.s = 1;
          }
        }
        else if (op === 16) { if (R.s === 0 && a0 <= now) { echo.snap = snapshot(); echo.on = true; echo.s = 1; echo.a = 1; echo.n = 30; R.s = 1; } }
        else if (op === 17) { if (R.s === 0 && a0 <= now) { state = si; R.s = 1; } }
        else if (op === 18) { if (R.s === 0 && a0 <= now) { if (root.KSnd) KSnd.bgm(bgmName(si)); R.s = 1; } }
        else if (op === 19) { if (R.s === 0 && a0 <= now) { if (root.KSnd) KSnd.stopBgm(); R.s = 1; } }
        else if (op === 20) { if (R.s === 0 && a0 <= now) { const n = seName(si); if (n && root.KSnd) KSnd.se(n); R.s = 1; } }
        else if (op === 21) { if (R.s === 0 && a0 <= now) R.s = 1; }   // stop all sound effects: the effects are short, so nothing to do
        else if (op === 24 || op === 25) {
          if (R.s === 0 && a0 <= now) { if (op === 24) { s.layer = layer; s.a = 1; s.x = x; s.y = y; } s.ox = op === 24 ? x : s.x; s.oy = op === 24 ? y : s.y; show(s); R.s = 1; }
          else if (R.s === 1) { if (now >= a1) { hide(s); R.s = 2; } else { const u = (now - a0) / (a1 - a0); if (op === 24) { s.x = x + (p0 - x) * u; s.y = y + (p1 - y) * u; } else { s.x = s.ox + x * u; s.y = s.oy + y * u; } } }
        }
        else if (op === 26 || op === 27 || op === 28) {
          if (R.s === 0 && a0 <= now) { s.layer = layer; s.a = 1; if (op === 28) { s.x = 0; s.y = 0; } else { s.x = x; s.y = y; } s.cx = p0; s.cy = p1; s.bw = s.w; s.bh = s.h; show(s); R.s = 1; }
          else if (R.s === 1) {
            if (now >= a1) { hide(s); R.s = 2; }
            else {
              const u = (now - a0) / (a1 - a0), k = op === 26 ? 1 + u * f6 : op === 27 ? Math.max(1, 1.2 - u * f6) : 0.5 + u * f6;
              s.w = s.bw * k; s.h = s.bh * k; s.x = s.cx - s.bw * 0.5 * k; s.y = s.cy - s.bh * 0.5 * k;
              if (op === 28) { s.x += x * (k - 0.5); s.y += y * (k - 0.5); }
            }
          }
        }
        else if (op === 29) { if (R.s === 0 && a0 <= now) { show(s); R.s = 1; } if (R.s === 1 && now >= a1) { s.ox = s.x; s.oy = s.y; hide(s); R.s = 2; } }
      }
    }
    // FUN_000441bc, once per frame for every sprite that is showing
    function update(s) {
      if (s.hid) return;
      if (s.flags & 2) { s.fa += 0.0625; if (s.fa >= 1) { s.fa -= 1; s.fr = (s.fr + 1) % 4; } s.d = P.sprites[9 + s.fr]; s.w = s.d[3]; s.h = s.d[4]; }
      if (s.flags & 0x10) { s.a += s.rate; if (s.rate < 0) { if (s.a < 0) s.a = 0; } else if (s.a >= 1) s.a = 1; }
      if (s.flags & 0x20) { s.a += s.rate; if (s.rate < 0 ? s.a < 0 : s.a >= 1) { s.a = s.rate < 0 ? 0 : 1; s.rate = -s.rate; } }
      if (s.flags & 0x40) {
        s.a += s.rate; s.zoom += 0.01; s.w = s.bw * s.zoom; s.h = s.bh * s.zoom; s.x = s.ox - s.bw * 0.5 * s.zoom; s.y = s.oy - s.bh * 0.5 * s.zoom;
        if (s.rate >= 0) { if (s.a >= 1) { s.a = 1; s.rate = -s.rate; } } else if (s.a < 0) s.a = 0;
      }
    }
    // the ending (states 0x17 and 0x18 of FUN_00055ecc): the prince and the katamari over a scrolling background, two closing lines, then a fade out
    function ending() {
      if (state === 0x17) { show(S[9]); show(S[21]); show(S[42]); S[42].layer = 0; c8 = 0; page++; state = 0x18; }
      else if (state === 0x18) {
        if (++c8 === 160) page++;
        rotk += Math.PI / 16; S[21].rot = rotk;
        if (++c11 > 0x220) { c11 = 0x220; if (!finishing) { startFade(3, 15); finishing = true; } }
        S[42].x = -c11;
      }
    }
    function tick() {
      const now = performance.now() - t0;
      if (state === 4) script(now); else ending();
      for (const s of S) update(s);
      if (fade.mode >= 0) { fade.t = Math.min(1, fade.t + fade.rate); if ((fade.mode === 0 || fade.mode === 2) && fade.t >= 1) fade.mode = -1; }
      if (echo.on) { echo.s += 2 / 30; echo.a -= 1 / 30; if (--echo.n <= 0) echo.on = false; }
      if (finishing && fade.t >= 1 && fade.mode === 3 && !done) { done = true; setTimeout(() => o.done && o.done(), 0); }
    }
    // the balloon: corners (1,10) (12,10) (1,21) (21,21), 10 x 10, and the plain tile (13,22) stretched for the edges and the middle; white art tinted by the row's colour
    function drawBalloon(b) {
      const q = tint.getContext('2d'), l = Math.round(b.x - b.w / 2), tp = Math.round(b.y - b.h / 2), r = l + b.w, bt = tp + b.h, C = 10;
      q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, W, H);
      const tile = (sx, sy, sw, sh, dx, dy, dw, dh) => q.drawImage(bal, sx, sy, sw, sh, dx, dy, dw, dh);
      tile(1, 10, C, C, l - C, tp - C, C, C); tile(12, 10, C, C, r, tp - C, C, C); tile(1, 21, C, C, l - C, bt, C, C); tile(21, 21, C, C, r, bt, C, C);
      tile(13, 22, 6, 6, l, tp - C, b.w, C); tile(13, 22, 6, 6, l, bt, b.w, C); tile(13, 22, 6, 6, l - C, tp, C, b.h); tile(13, 22, 6, 6, r, tp, C, b.h); tile(13, 22, 6, 6, l, tp, b.w, b.h);
      q.globalCompositeOperation = 'source-in'; q.fillStyle = b.c; q.fillRect(0, 0, W, H);
      g.globalAlpha = b.a; g.drawImage(tint, 0, 0); g.globalAlpha = 1;
    }
    function drawSprite(s) {
      if (s.hid || !s.d || s.a <= 0) return; const im = sheets[s.d[0]]; if (!im) return;
      g.globalAlpha = Math.min(1, s.a);
      if (s.rot) { g.save(); g.translate(s.x, s.y); g.rotate(s.rot); g.drawImage(im, s.d[1], s.d[2], s.d[3], s.d[4], -s.px, -s.py, s.w, s.h); g.restore(); }
      else g.drawImage(im, s.d[1], s.d[2], s.d[3], s.d[4], s.x - s.px, s.y - s.py, s.w, s.h);
      g.globalAlpha = 1;
    }
    function draw() {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.save(); g.beginPath(); g.rect(0, 0, W, SH); g.clip();
      for (let L = 0; L < 10; L++) for (let i = 66; i >= 0; i--) if (S[i].layer === L) drawSprite(S[i]);
      if (rect.a > 0 && bal) drawBalloon(rect);
      drawSprite(S[41]); drawSprite(S[6]); drawSprite(S[7]);   // the speech-bubble pieces are drawn again after the box (FUN_00057180)
      g.restore();
      // the text band: black, with the current page centred in it
      g.fillStyle = '#000'; g.fillRect(0, SH, W, BAND);
      if (page >= 0 && texts[page] !== undefined) {
        const ls = texts[page].split('\n'), lh = 19; g.fillStyle = '#fff'; g.font = '16px "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        ls.forEach((t, i) => g.fillText(t, W / 2, SH + BAND / 2 + (i - (ls.length - 1) / 2) * lh));
      }
      if (echo.on && echo.snap) for (let i = 4; i >= 1; i--) { const k = Math.max(1, echo.s - i / 10); g.globalAlpha = Math.max(0, echo.a) * 0.25; g.drawImage(echo.snap, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); g.globalAlpha = 1; }
      if (fade.mode >= 0) { const a = fade.mode === 0 || fade.mode === 2 ? 1 - fade.t : fade.t; g.fillStyle = fade.mode === 0 || fade.mode === 1 ? '#fff' : '#000'; g.globalAlpha = a; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    }
    function snapshot() { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(cv, 0, 0); return c; }
    function loop(ts) {
      if (done && !raf) return;
      acc += ts - last; last = ts; if (acc > 500) acc = 500;
      while (acc >= STEP) { acc -= STEP; tick(); }
      draw(); raf = requestAnimationFrame(loop);
    }
    const skip = () => { if (!finishing) { finishing = true; startFade(3, 15); } };
    const key = e => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') { e.preventDefault(); skip(); } };
    cv.onclick = skip; document.addEventListener('keydown', key);
    raf = requestAnimationFrame(ts => { t0 = performance.now(); last = ts; loop(ts); });
    return { skip, stop() { done = true; cancelAnimationFrame(raf); raf = 0; cv.onclick = null; document.removeEventListener('keydown', key); }, seeker: { get state() { return state; }, get page() { return page; }, S, fade, rect, rows } };
  }
  root.KIntro = { play };
})(window);
