// Loading feedback shared by the menu and the game. A task starts as a small spinner (after a 150 ms grace so instant work never flashes);
// anything still running after 2 s turns into a progress bar with a percentage and a label (A62).
(function (root) {
  const SPIN_AFTER = 150, BAR_AFTER = 2000;
  let el = null, tasks = new Set(), timer = null, barTimer = null;
  function build() {
    el = document.createElement('div'); el.id = 'kload';
    el.innerHTML = '<div class="kl-box"><div class="kl-spin"></div><div class="kl-bar"><i></i></div><div class="kl-txt"></div></div>';
    document.body.appendChild(el);
  }
  function paint() {
    if (!el) build();
    const list = [...tasks]; if (!list.length) { el.className = ''; return; }
    const t = list[list.length - 1], long = list.some(x => performance.now() - x.t0 >= BAR_AFTER);
    el.className = 'on' + (list.some(x => x.cover) ? ' cover' : '') + (long ? ' long' : '');
    const f = t.expect ? Math.min(1, t.done / t.expect) : -1, bar = el.querySelector('.kl-bar i');
    bar.style.width = f < 0 ? '35%' : Math.round(f * 100) + '%'; bar.parentNode.classList.toggle('ind', f < 0);
    el.querySelector('.kl-txt').textContent = (t.label || 'Loading') + (long && f >= 0 ? '  ' + Math.round(f * 100) + '%' : '');
  }
  function schedule() { clearTimeout(timer); clearTimeout(barTimer); timer = setTimeout(paint, SPIN_AFTER); barTimer = setTimeout(paint, BAR_AFTER + 20); }
  // begin('Loading stage', { expect: 12, cover: true }) -> { step(n), set(done, expect), label(s), end() }
  function begin(label, opts) {
    opts = opts || {}; const t = { label, expect: opts.expect || 0, done: 0, cover: !!opts.cover, t0: performance.now() };
    tasks.add(t); schedule(); if (opts.now) paint();
    return {
      step(n) { t.done += n === undefined ? 1 : n; if (performance.now() - t.t0 > SPIN_AFTER) paint(); },
      set(done, expect) { t.done = done; if (expect !== undefined) t.expect = expect; if (performance.now() - t.t0 > SPIN_AFTER) paint(); },
      expect(n) { t.expect = n; }, grow(n) { t.expect += n; }, label(s) { t.label = s; },
      end() { tasks.delete(t); if (!tasks.size) { clearTimeout(timer); clearTimeout(barTimer); } paint(); },
    };
  }
  // fetch with byte progress: onBytes(done, total). Falls back to a plain read when the body cannot be streamed.
  async function fetchBuf(url, onBytes) {
    const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !r.body.getReader || !onBytes) { const b = await r.arrayBuffer(); onBytes && onBytes(b.byteLength, b.byteLength); return b; }
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onBytes(got, total || got); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out.buffer;
  }
  root.KLoad = { begin, fetchBuf };
})(window);
