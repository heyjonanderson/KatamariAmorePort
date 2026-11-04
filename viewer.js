'use strict';
// Katamari Amore asset viewer. Loads exported stage data (see tools/export.py) and draws it with plain WebGL1.
const $ = id => document.getElementById(id);
const canvas = $('c');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
const qs = new URLSearchParams(location.search);
const S = { stage: qs.get('stage') || 'S001', mode: qs.get('mode') || 'stage', set: qs.get('set') || 'S', flipV: qs.get('flip') === '1', wire: false, coll: qs.get('coll') === '1',
            yaw: 0.6, pitch: 0.5, dist: 100, target: [0, 0, 0], group: null, ready: false, err: [], stats: {} };
window.__kv = S;   // test hook
window.addEventListener('error', e => S.err.push(String(e.message)));

// ---- minimal mat4 (column-major) ----
const M = {
  persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2), nf = 1 / (n - fa); return [t / a,0,0,0, 0,t,0,0, 0,0,(fa + n) * nf,-1, 0,0,2 * fa * n * nf,0]; },
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k]; o[c*4+r] = s; } return o; },
  look(e, t, u) { let z = [e[0]-t[0], e[1]-t[1], e[2]-t[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [u[1]*z[2]-u[2]*z[1], u[2]*z[0]-u[0]*z[2], u[0]*z[1]-u[1]*z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
    const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]), -(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]), -(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]), 1]; },
  rx(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
  ry(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
  rz(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; },
  pt(m, p) { return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]; },
  trs(t, s) { return [s,0,0,0, 0,s,0,0, 0,0,s,0, t[0],t[1],t[2],1]; },
};

// ---- shaders ----
function prog(vs, fs) {
  const p = gl.createProgram();
  for (const [ty, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const P = prog(`
  attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
  uniform mat4 uVP; uniform mat4 uModel; uniform float uFlipV;
  varying vec3 vN; varying vec2 vUv;
  void main() { vec4 w = uModel * vec4(aPos, 1.0); gl_Position = uVP * w; vN = mat3(uModel) * aNrm; vUv = vec2(aUv.x, mix(aUv.y, 1.0 - aUv.y, uFlipV)); }`,
`
  precision mediump float; varying vec3 vN; varying vec2 vUv; uniform sampler2D uTex; uniform float uUseTex; uniform vec3 uTint;
  void main() {
    vec4 c = uUseTex > 0.5 ? texture2D(uTex, vUv) : vec4(uTint, 1.0);
    if (c.a < 0.4) discard;
    vec3 n = normalize(vN); float l = 0.55 + 0.45 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
    gl_FragColor = vec4(c.rgb * l, 1.0);
  }`);
const L = { pos: gl.getAttribLocation(P, 'aPos'), nrm: gl.getAttribLocation(P, 'aNrm'), uv: gl.getAttribLocation(P, 'aUv'),
  vp: gl.getUniformLocation(P, 'uVP'), model: gl.getUniformLocation(P, 'uModel'), flip: gl.getUniformLocation(P, 'uFlipV'),
  tex: gl.getUniformLocation(P, 'uTex'), use: gl.getUniformLocation(P, 'uUseTex'), tint: gl.getUniformLocation(P, 'uTint') };

// ---- loading ----
const pow2 = n => (n & (n - 1)) === 0;
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + url)); i.src = url; }); }
async function loadGroup(stage, tag) {
  const base = `data/${stage}/`;
  const man = await (await fetch(`${base}${tag}.json?v=1`)).json();
  const blob = await (await fetch(`${base}${tag}.bin?v=1`)).arrayBuffer();
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const texs = {};
  await Promise.all(man.tex.map(async n => {
    const img = await loadImage(`${base}tex/${n}.png`);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const ok = pow2(img.width) && pow2(img.height);
    if (ok) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, ok ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = ok ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    texs[n] = t;
  }));
  // per-model bounds from actual vertices (the stored bbox is optional and not always tight)
  const f32 = new Float32Array(blob);
  for (const m of man.models) {
    let lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
    for (let i = 0; i < m.nv; i++) for (let k = 0; k < 3; k++) { const v = f32[m.voff / 4 + i * 8 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    m.lo = lo; m.hi = hi;
  }
  return { man, vbo, ibo, texs };
}

// Logic space (placements, collision) is z-mirrored relative to the visual map: view = (x, y, -z), angles: ry -> -ry, rx -> -rx, rz -> rz.
// Verified: every placed object rests on a visual surface only with this flip (see SPEC.md).
function placeMat(x, y, z, rx, ry, rz) { const R = M.mul(M.ry(-ry), M.mul(M.rx(-rx), M.rz(rz))); R[12] = x; R[13] = y; R[14] = -z; return R; }
let items = [], coll = null;
function layoutMap(g) { return g.man.models.map(m => ({ g, m, mat: M.trs([0,0,0], 1) })); }
function layoutGallery(g) {
  const n = g.man.models.length, cols = Math.ceil(Math.sqrt(n)), cell = 60;
  return g.man.models.map((m, i) => {
    const ext = Math.max(m.hi[0]-m.lo[0], m.hi[1]-m.lo[1], m.hi[2]-m.lo[2], 1e-3), s = (cell * 0.8) / ext;
    const cx = (m.lo[0]+m.hi[0]) / 2, cz = (m.lo[2]+m.hi[2]) / 2, gx = (i % cols) * cell, gz = Math.floor(i / cols) * cell;
    return { g, m, mat: M.mul(M.trs([gx, -m.lo[1] * s, gz], 1), M.mul(M.trs([0,0,0], s), M.trs([-cx, 0, -cz], 1))) };
  });
}
function layoutPlaced(og, sj, letter) {
  const byName = {}; for (const mo of sj.mono) byName[mo.name] = mo.model;
  const mods = {}; for (const m of og.man.models) mods[m.name] = m;
  const out = []; let skipped = 0;
  for (const [tn, recs] of Object.entries(sj.mloc)) {
    if (tn[3] !== letter) continue;
    for (const [nm, x, y, z, rx, ry, rz] of recs) { const m = mods[byName[nm]]; if (!m) { skipped++; continue; } out.push({ g: og, m, mat: placeMat(x, y, z, rx, ry, rz) }); }
  }
  S.skipped = skipped; return out;
}
function bounds(list) {
  let lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
  for (const it of list) for (let c = 0; c < 8; c++) {
    const p = M.pt(it.mat, [c & 1 ? it.m.hi[0] : it.m.lo[0], c & 2 ? it.m.hi[1] : it.m.lo[1], c & 4 ? it.m.hi[2] : it.m.lo[2]]);
    for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }
  return { lo, hi };
}
function frame(list) {
  const b = bounds(list); S.target = [0,1,2].map(k => (b.lo[k] + b.hi[k]) / 2);
  S.dist = Math.hypot(b.hi[0]-b.lo[0], b.hi[1]-b.lo[1], b.hi[2]-b.lo[2]) * 0.9 + 1; S.bounds = b;
}
function buildColl(sj) {
  if (!sj.hit) return null;
  const nv = sj.hit.v.length / 3, vb = new Float32Array(nv * 8);
  for (let i = 0; i < nv; i++) { vb[i*8] = sj.hit.v[i*3]; vb[i*8+1] = sj.hit.v[i*3+1]; vb[i*8+2] = -sj.hit.v[i*3+2]; vb[i*8+4] = 1; }
  const byKind = {};
  for (const p of sj.hit.polys) { const k = p[0], idx = p.slice(1), a = (byKind[k] = byKind[k] || []); for (let i = 0; i < idx.length; i++) a.push(idx[i], idx[(i + 1) % idx.length]); }
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, vb, gl.STATIC_DRAW);
  const kinds = Object.keys(byKind), all = []; const draws = [];
  for (const k of kinds) { draws.push({ k: +k, off: all.length * 2, n: byKind[k].length }); all.push(...byKind[k]); }
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(all), gl.STATIC_DRAW);
  return { vbo, ibo, draws };
}
const KIND_COL = { 0: [0.1, 0.9, 1.0], 2: [1.0, 0.6, 0.1], 3: [1.0, 0.2, 0.9], 4: [1.0, 0.1, 0.1] };
async function setScene(stage, mode) {
  S.ready = false; S.stage = stage; S.mode = mode;
  $('info').textContent = 'loading ' + stage + ' ' + mode + '...';
  try {
    const sj = await (await fetch(`data/${stage}/stage.json?v=2`)).json(); S.sj = sj;
    const letters = [...new Set(Object.keys(sj.mloc).map(k => k[3]))];
    const sel = $('set'); if (sel.dataset.stage !== stage) { sel.innerHTML = ''; for (const l of letters) { const o = document.createElement('option'); o.value = o.textContent = l; sel.appendChild(o); } sel.dataset.stage = stage; if (!letters.includes(S.set)) S.set = letters[0]; }
    sel.value = S.set; sel.style.display = mode === 'stage' ? '' : 'none';
    coll = buildColl(sj);
    if (mode === 'obj') { const og = await loadGroup(stage, 'obj'); items = layoutGallery(og); frame(items); }
    else {
      const mg = await loadGroup(stage, 'map'); items = layoutMap(mg); frame(items);
      if (mode === 'stage') { const og = await loadGroup(stage, 'obj'); items = items.concat(layoutPlaced(og, sj, S.set)); }
    }
    S.stats = { models: items.length, placed: items.length - (mode === 'stage' ? S.group_n || 0 : 0) };
    S.ready = true;
    for (const [id, m] of [['bMap','map'],['bObj','obj'],['bStage','stage']]) $(id).classList.toggle('on', mode === m);
  } catch (e) { S.err.push(String(e)); $('info').textContent = String(e); }
}

// ---- drawing ----
function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(0.55, 0.75, 0.95, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  if (!S.ready) return;
  const cp = Math.cos(S.pitch), eye = [S.target[0] + S.dist * cp * Math.sin(S.yaw), S.target[1] + S.dist * Math.sin(S.pitch), S.target[2] + S.dist * cp * Math.cos(S.yaw)];
  const vp = M.mul(M.persp(0.9, w / h, Math.max(S.dist / 200, 0.05), S.dist * 20), M.look(eye, S.target, [0,1,0]));
  gl.useProgram(P); gl.uniformMatrix4fv(L.vp, false, vp); gl.uniform1f(L.flip, S.flipV ? 1 : 0); gl.uniform1i(L.tex, 0);
  gl.enableVertexAttribArray(L.pos); gl.enableVertexAttribArray(L.nrm); gl.enableVertexAttribArray(L.uv);
  let tris = 0, cur = null;
  for (const it of items) {
    const g = it.g; if (g !== cur) { cur = g; gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo); }
    gl.uniformMatrix4fv(L.model, false, it.mat);
    gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, it.m.voff); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 32, it.m.voff + 12); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, it.m.voff + 24);
    for (const s of it.m.subs) {
      const t = g.texs[s.tex]; gl.uniform1f(L.use, t ? 1 : 0); gl.uniform3f(L.tint, 1, 0, 1);
      if (t) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); }
      gl.drawElements(S.wire ? gl.LINES : gl.TRIANGLES, s.n, gl.UNSIGNED_SHORT, s.off); tris += s.n / 3;
    }
  }
  if (S.coll && coll) {
    gl.disable(gl.DEPTH_TEST); gl.bindBuffer(gl.ARRAY_BUFFER, coll.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coll.ibo);
    gl.uniformMatrix4fv(L.model, false, M.trs([0,0,0], 1)); gl.uniform1f(L.use, 0);
    gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, 24);
    for (const d of coll.draws) { const c = KIND_COL[d.k] || [1,1,1]; gl.uniform3f(L.tint, c[0], c[1], c[2]); gl.drawElements(gl.LINES, d.n, gl.UNSIGNED_SHORT, d.off); }
  }
  S.stats.tris = tris; S.stats.items = items.length;
}
function tick() { draw(); $('info').textContent = S.ready ? `${S.stage} ${S.mode}${S.mode === 'stage' ? ' set ' + S.set : ''}  items ${S.stats.items}  tris ${S.stats.tris | 0}${S.skipped ? '  skipped ' + S.skipped : ''}` : $('info').textContent; requestAnimationFrame(tick); }

// ---- input: pointer events, 1 = orbit, 2 = pinch zoom + pan ----
const ptr = new Map(); let last = null;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
canvas.addEventListener('pointerup', e => { ptr.delete(e.pointerId); last = null; });
canvas.addEventListener('pointercancel', e => { ptr.delete(e.pointerId); last = null; });
canvas.addEventListener('pointermove', e => {
  if (!ptr.has(e.pointerId)) return;
  const prev = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptr.size === 1) {
    if (e.buttons & 2 || e.shiftKey) pan(e.clientX - prev[0], e.clientY - prev[1]);
    else { S.yaw -= (e.clientX - prev[0]) * 0.008; S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch + (e.clientY - prev[1]) * 0.008)); }
  } else if (ptr.size === 2) {
    const [a, b] = [...ptr.values()]; const d = Math.hypot(a[0]-b[0], a[1]-b[1]), c = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    if (last) { S.dist = Math.max(0.5, S.dist * last.d / d); pan(c[0] - last.c[0], c[1] - last.c[1]); }
    last = { d, c };
  }
});
function pan(dx, dy) {
  const k = S.dist * 0.0016, cy = Math.cos(S.yaw), sy = Math.sin(S.yaw);
  S.target[0] -= (cy * dx) * k; S.target[2] -= (-sy * dx) * k; S.target[1] += dy * k;
}
canvas.addEventListener('wheel', e => { e.preventDefault(); S.dist = Math.max(0.5, S.dist * Math.exp(e.deltaY * 0.001)); }, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---- UI ----
(async () => {
  const stages = await (await fetch('data/stages.json?v=2')).json();
  const sel = $('stage'); for (const s of stages) { const o = document.createElement('option'); o.value = o.textContent = s; sel.appendChild(o); }
  sel.value = S.stage;
  sel.onchange = () => setScene(sel.value, S.mode);
  $('set').onchange = e => { S.set = e.target.value; setScene(S.stage, S.mode); };
  $('bMap').onclick = () => setScene(S.stage, 'map'); $('bObj').onclick = () => setScene(S.stage, 'obj'); $('bStage').onclick = () => setScene(S.stage, 'stage');
  $('bFlip').onclick = () => { S.flipV = !S.flipV; $('bFlip').classList.toggle('on', S.flipV); };
  $('bWire').onclick = () => { S.wire = !S.wire; $('bWire').classList.toggle('on', S.wire); };
  $('bColl').onclick = () => { S.coll = !S.coll; $('bColl').classList.toggle('on', S.coll); };
  $('bReset').onclick = () => { S.yaw = 0.6; S.pitch = 0.5; frame(items.filter(i => i.g === items[0].g)); };
  $('bFlip').classList.toggle('on', S.flipV); $('bColl').classList.toggle('on', S.coll);
  await setScene(S.stage, S.mode);
  requestAnimationFrame(tick);
})();
