var KSnd = window.KSnd || { bgm() {}, stopBgm() {}, se() {}, start() {}, setMuted() {}, isMuted: () => false };   // audio.js is optional (tests run without it)
'use strict';
// Katamari Amore web port: playable stage. Rendering only; all rules are in sim.js (see ASSUMPTIONS.md, P entries).
const $ = id => document.getElementById(id);
const canvas = $('c');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
const qs = new URLSearchParams(location.search);
const STAGE = qs.get('stage') || 'S001', MODE = qs.get('mode') || 'story';   // story: catch the target; timeattack: biggest in the time limit; eternal: no limit
if (!qs.has('stage') && location.replace) location.replace('menu.html');
const G = { err: [], ready: false, S: null, frames: 0 };
window.__kg = G;   // test hook
window.addEventListener('error', e => G.err.push(String(e.message)));

// ---- mat4, column-major ----
const M = {
  persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2), nf = 1 / (n - fa); return [-t / a,0,0,0,   /* x negated: the game's visual data is left-handed, this flips the picture to match (P20) */ 0,t,0,0, 0,0,(fa + n) * nf,-1, 0,0,2 * fa * n * nf,0]; },
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k]; o[c*4+r] = s; } return o; },
  look(e, t, u) { let z = [e[0]-t[0], e[1]-t[1], e[2]-t[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [u[1]*z[2]-u[2]*z[1], u[2]*z[0]-u[0]*z[2], u[0]*z[1]-u[1]*z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
    const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]), -(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]), -(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]), 1]; },
  // 3x3 row-major rotation (sim) + translation + uniform scale -> column-major 4x4
  fromR3(R, t, s) { return [R[0]*s,R[3]*s,R[6]*s,0, R[1]*s,R[4]*s,R[7]*s,0, R[2]*s,R[5]*s,R[8]*s,0, t[0],t[1],t[2],1]; },
  I: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
};

// ---- shader (same look as the viewer) ----
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
  uniform mat4 uVP; uniform mat4 uModel; varying vec3 vN; varying vec2 vUv;
  void main() { gl_Position = uVP * (uModel * vec4(aPos, 1.0)); vN = mat3(uModel) * aNrm; vUv = aUv; }`,
`
  precision mediump float; varying vec3 vN; varying vec2 vUv; uniform sampler2D uTex; uniform float uUseTex; uniform vec3 uTint;
  void main() {
    vec4 c = uUseTex > 0.5 ? texture2D(uTex, vUv) : vec4(uTint, 1.0);
    if (c.a < 0.4) discard;
    vec3 n = normalize(vN); float l = 0.55 + 0.45 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
    gl_FragColor = vec4(c.rgb * l, 1.0);
  }`);
const L = { pos: gl.getAttribLocation(P, 'aPos'), nrm: gl.getAttribLocation(P, 'aNrm'), uv: gl.getAttribLocation(P, 'aUv'),
  vp: gl.getUniformLocation(P, 'uVP'), model: gl.getUniformLocation(P, 'uModel'),
  tex: gl.getUniformLocation(P, 'uTex'), use: gl.getUniformLocation(P, 'uUseTex'), tint: gl.getUniformLocation(P, 'uTint') };

// ---- loading (same data layout as the viewer) ----
const pow2 = n => (n & (n - 1)) === 0;
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + url)); i.src = url; }); }
function makeTex(img) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const ok = pow2(img.width) && pow2(img.height);
  if (ok) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, ok ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = ok ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}
async function loadGroup(stage, tag) {
  const base = `data/${stage}/`;
  const man = await (await fetch(`${base}${tag}.json?v=1`)).json();
  const blob = await (await fetch(`${base}${tag}.bin?v=1`)).arrayBuffer();
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const texs = {};
  await Promise.all(man.tex.map(async n => { texs[n] = makeTex(await loadImage(`${base}tex/${n}.png`)); }));
  const mods = {}; for (const m of man.models) mods[m.name] = m;
  return { man, vbo, ibo, texs, mods };
}

// ---- the ball: generated UV sphere, procedural texture (PLACEHOLDER B9) ----
function makeBall() {
  const nu = 32, nv = 16, v = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const th = j / nv * Math.PI, ph = i / nu * Math.PI * 2, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    v.push(x, y, z, x, y, z, i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#2f8ea3'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 14; k++) { g.fillStyle = k % 2 ? '#4fb0c2' : '#216f82'; g.fillRect(Math.random() * 128, Math.random() * 128, 18 + Math.random() * 30, 8 + Math.random() * 18); }
  g.fillStyle = '#9fe0ea'; for (let k = 0; k < 4; k++) g.fillRect(k * 32, 0, 5, 128);
  return { vbo, ibo, n: idx.length, tex: makeTex(c) };
}

// ---- state ----
let play = null, og = null, mg = null, ou = null, ball = null, S = null;
const cam = { yaw: 0, ready: false, k: 0.2, back: 20, up: 8, ahead: 8, lookUp: 0 };
const keys = {};
const pads = { L: null, R: null };           // touch sticks: {id, ox, oy, v}
let touchDash = false;
let last_dt = 0.016, acc = 0, last = 0, prevPos = [0,0,0], prevYaw = 0, lost = false, ouji = { pat: 0, t: 0 };
const UI = {};                                // HUD images


// CATCH_SE = [2, 0, n, 0, every]: n picks one of three sounds, every = repeat interval in frames. The file for each n is a guess from clip lengths (A53)
const CATCH_SE_MAP = [20, 21, 14]; let activeCatch = null, paused = false;
function restart() {
  S = KSim.create(play, Object.assign(MODE === 'story' ? {} : { noTarget: true }, qs.get('catch') ? { catchMode: qs.get('catch') } : {})); G.S = S; resShown = false; activeCatch = null; if (dlgRes) { dlgRes.stop(); dlgRes = null; } $('res').style.display = 'none';
  for (let i = 0; i < 60; i++) KSim.step(S, { fwd: 0, turn: 0 });   // settle on the floor, same as the bot test
  S.frame = 0; S.events.length = 0;
  prevPos = S.pos.slice(); prevYaw = S.yaw; cam.yaw = S.yaw; cam.ready = false; lost = false; toast = null; KSnd.bgm('BGM_ST0' + (parseInt(STAGE.slice(1), 10) - 1)); ouji = { pat: 0, t: 0 };
  { const tl = play.mis.time_limit || []; S.timeLimit = MODE === 'eternal' ? Infinity : (tl[MODE === 'timeattack' ? 1 : 0] || 360); }   // TIME_LIMIT entries: 0 story, 1 time attack (guess, A42)
  $('msg').style.display = 'none'; acc = 0;
}

// ---- input ----
// Keyboard (easy mode): forward/back and left/right are mixed into two stick values. Touch: drag on the left half = left stick, right half = right stick.
function readInput() {
  const dash = !!(keys.ShiftLeft || keys.ShiftRight || keys.Space || touchDash);
  if (pads.L || pads.R) return { L: pads.L ? pads.L.v : 0, R: pads.R ? pads.R.v : 0, dash };
  const fwd = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  const left = (keys.ArrowLeft || keys.KeyA ? 1 : 0) - (keys.ArrowRight || keys.KeyD ? 1 : 0);
  const t = KSim.tank(fwd, left * (fwd ? 0.5 : 1));     // while driving, steer gently; standing still, spin
  return { L: t.L, R: t.R, dash };
}
window.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyR') restart(); if (e.code === 'Escape' || e.code === 'KeyP') setPause(!paused); if (e.code === 'KeyM') { KSnd.setMuted(!KSnd.isMuted()); syncSnd(); } if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });
const bSnd = document.getElementById('bSnd'); const syncSnd = () => { bSnd.textContent = KSnd.isMuted() ? 'Sound off' : 'Sound on'; }; bSnd.onclick = () => { KSnd.setMuted(!KSnd.isMuted()); syncSnd(); }; syncSnd();
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const PAD_R = 70;
canvas.addEventListener('pointerdown', e => {
  const side = e.clientX < window.innerWidth / 2 ? 'L' : 'R'; if (pads[side]) return;
  pads[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, v: 0 }; canvas.setPointerCapture(e.pointerId); G.touched = true;
});
canvas.addEventListener('pointermove', e => { for (const k of ['L', 'R']) { const p = pads[k]; if (p && p.id === e.pointerId) { p.x = e.clientX; p.y = e.clientY; p.v = Math.max(-1, Math.min(1, -(e.clientY - p.oy) / PAD_R)); } } });
const endPad = e => { for (const k of ['L', 'R']) if (pads[k] && pads[k].id === e.pointerId) pads[k] = null; };
canvas.addEventListener('pointerup', endPad); canvas.addEventListener('pointercancel', endPad);
$('bRestart').onclick = restart; $('bAgain').onclick = restart;
$('bDash').addEventListener('pointerdown', e => { touchDash = true; e.stopPropagation(); }); $('bDash').addEventListener('pointerup', () => { touchDash = false; }); $('bDash').addEventListener('pointercancel', () => { touchDash = false; });

// ---- drawing ----
function bindGroup(g) { gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo); }
function drawModel(g, m, mat) {
  gl.uniformMatrix4fv(L.model, false, mat);
  gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, m.voff); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 32, m.voff + 12); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, m.voff + 24);
  for (const s of m.subs) {
    const t = g.texs[s.tex]; gl.uniform1f(L.use, t ? 1 : 0); gl.uniform3f(L.tint, 1, 0, 1);
    if (t) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); }
    gl.drawElements(gl.TRIANGLES, s.n, gl.UNSIGNED_SHORT, s.off); G.tris += s.n / 3;
  }
}
function objMat(R3, t) { return M.fromR3(R3, t, 1); }
function draw(alpha) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(0.55, 0.75, 0.95, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  if (!G.ready || !S) return;
  G.tris = 0;
  const R = KSim.radius(S);
  const pos = [0,1,2].map(k => prevPos[k] + (S.pos[k] - prevPos[k]) * alpha);
  // camera from the stage's CAMERA_DATA table, eased toward the ball's heading
  const cp = KSim.cameraParams(S);
  if (!cam.ready) { cam.yaw = S.yaw; cam.back = cp.back; cam.up = cp.up; cam.ahead = cp.ahead; cam.lookUp = cp.lookUp; cam.ready = true; }
  const dyaw = Math.atan2(Math.sin(S.yaw - cam.yaw), Math.cos(S.yaw - cam.yaw)); cam.yaw += dyaw * cam.k;
  const kk = 1 - Math.exp(-last_dt * 3); cam.back += (cp.back - cam.back) * kk; cam.up += (cp.up - cam.up) * kk; cam.ahead += (cp.ahead - cam.ahead) * kk; cam.lookUp += (cp.lookUp - cam.lookUp) * kk;
  const cfx = Math.sin(cam.yaw), cfz = Math.cos(cam.yaw);
  const eyeFull = [pos[0] - cfx * cam.back, pos[1] + cam.up, pos[2] - cfz * cam.back];
  // keep the camera inside the room. Ray from the ball toward the wanted eye spot; if something is in the way, swing the camera up and over
  // (up to ~70 degrees) before shrinking its distance. Goes up and in at once, eases back down and out.
  const d0 = [eyeFull[0] - pos[0], eyeFull[1] - pos[1], eyeFull[2] - pos[2]], len0 = Math.hypot(d0[0], d0[1], d0[2]) || 1, hz = Math.hypot(d0[0], d0[2]) || 1, e0 = Math.atan2(d0[1], hz), margin = Math.max(0.4, R * 0.08);
  const eyeAt = (e, L) => [pos[0] + d0[0] / hz * Math.cos(e) * L, pos[1] + Math.sin(e) * L, pos[2] + d0[2] / hz * Math.cos(e) * L];
  const clearFor = (e, L) => { const t = KSim.rayHit(S, pos[0], pos[1], pos[2], d0[0] / hz * Math.cos(e), Math.sin(e), d0[2] / hz * Math.cos(e), L + margin); return t === null ? L : Math.max(0.3, t - margin); };
  const Lmin = len0 * 0.35; let bestE = e0, bestL = 0; for (let k = 0; k <= 7; k++) { const e = e0 + k * 0.15, L = clearFor(e, len0); if (L > bestL + 1e-6) { bestL = L; bestE = e; } if (L >= Lmin) { bestL = L; bestE = e; break; } }
  if (cam.e === undefined || bestE > cam.e) cam.e = bestE; else cam.e += (bestE - cam.e) * (1 - Math.exp(-last_dt * 3));
  if (cam.L === undefined || bestL < cam.L) cam.L = bestL; else cam.L += (bestL - cam.L) * (1 - Math.exp(-last_dt * 3));
  cam.L = Math.min(cam.L, clearFor(cam.e, cam.L));                       // safety: smoothed values must not poke through
  const eye = eyeAt(cam.e, cam.L);
  const tgt = [pos[0] + cfx * cam.ahead, pos[1] + cam.lookUp, pos[2] + cfz * cam.ahead];
  const far = Math.max(cp.far, play.mis.far || 800, play.mis.far2 || 0, cam.back * 3);   // GRAPHICS holds two near/far pairs (0.1/800 and 1/10000 in stage 1); the longer one stops the far end of a hallway from clipping (A52)
  const vp = M.mul(M.persp(0.9, w / h, Math.max(R * 0.03, 0.05), far), M.look(eye, tgt, [0,1,0]));
  gl.useProgram(P); gl.uniformMatrix4fv(L.vp, false, vp); gl.uniform1i(L.tex, 0);
  gl.enableVertexAttribArray(L.pos); gl.enableVertexAttribArray(L.nrm); gl.enableVertexAttribArray(L.uv);
  // map
  bindGroup(mg); for (const m of mg.man.models) drawModel(mg, m, M.I());
  // loose objects
  bindGroup(og);
  for (const o of S.objs) { if (o.state !== 'map') continue; const m = og.mods[o.model]; if (!m) continue;
    let sc = 1; if (o.born !== undefined) { const d = Math.hypot(o.pos[0] - pos[0], o.pos[2] - pos[2]); const k = (S.frame + alpha - o.born - Math.min(d / 40, 24)) / 10; if (k <= 0) continue; if (k < 1) { const c = 1.70158, x = k - 1; sc = 1 + (c + 1) * x * x * x + c * x * x; } }   // grow in over ~0.35 s, nearer ones first
    drawModel(og, m, M.fromR3(o.rot, o.ppos ? [0,1,2].map(q => o.ppos[q] + (o.pos[q] - o.ppos[q]) * alpha) : o.pos, sc)); }
  // attached objects: world = T(ball) * R * [lrot | lpos]
  for (const o of S.attached) {
    const m = og.mods[o.model]; if (!m) continue;
    const wr = KSim.mmul(S.R, o.lrot), wp = KSim.mvec(S.R, o.lpos);
    drawModel(og, m, objMat(wr, [pos[0] + wp[0], pos[1] + wp[1], pos[2] + wp[2]]));
  }
  // prince, behind the ball (PLACEHOLDER P15: placement, scale, walk cycle order and which way the model faces are guesses)
  if (ou && S.diam < 100 && (cam.L === undefined || cam.L > R * 3.5)) {   // hidden if the clipped camera is right on top of it
    const m = ou.mods['GiOujiM' + [0, 1, 0, 2][ouji.pat % 4]], fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    let off = R + 1.6; { const t = KSim.rayHit(S, pos[0], pos[1] - R * 0.5, pos[2], -fx, 0, -fz, off + 1.5); if (t !== null) off = Math.max(R * 0.6, t - 1.5); }   // do not stand inside a wall behind the ball
    const c = Math.cos(S.yaw), sn = Math.sin(S.yaw), Ry = [-c,0,sn, 0,1,0, -sn,0,-c];     // local -z -> forward (the model faces -z)
    const ppos = [pos[0] - fx * off, pos[1] - R, pos[2] - fz * off];
    bindGroup(ou); if (m) drawModel(ou, m, M.fromR3(Ry, ppos, 1));
  }
  // ball
  gl.bindBuffer(gl.ARRAY_BUFFER, ball.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ball.ibo);
  gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, 24);
  gl.uniformMatrix4fv(L.model, false, M.fromR3(S.R, pos, R)); gl.uniform1f(L.use, 1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ball.tex);
  gl.drawElements(gl.TRIANGLES, ball.n, gl.UNSIGNED_SHORT, 0);
}

// ---- HUD: original art (GAMEDATA / IMAGE .dat), layout is mine (PLACEHOLDER P16) ----
const hudc = $('hud'), hx = hudc.getContext('2d');
const IMGS = { SIZEB: 'ui/GAMEDT2x/GiSIZEB.png', SIZEF: 'ui/GAMEDT2x/GiSIZEF.png', NUMW: 'ui/GAMEDT2x/GiNUM_W.png', NUMO: 'ui/GAMEDT2x/GiNUM_O.png', TIMER: 'ui/GAMEDT2x/GiTIMER.png', PAD: 'ui/IMAGE/SYSPAD.png', PADC: 'ui/IMAGE/SYSPADC.png' };
async function loadUI() { await Promise.all(Object.entries(IMGS).map(async ([k, u]) => { try { UI[k] = await loadImage(u); } catch (e) { G.err.push(String(e)); } })); }
// glyph cells of the number sheets. big: 44x56, digits 0-4 on row 0, 5-9 on row 1. small: 32x40 on rows 2-3, row 3 also has c (cell 5) and m (cell 6)
function glyph(ch) {
  if (ch >= '0' && ch <= '9') { const d = +ch; return { x: (d % 5) * 44, y: d < 5 ? 0 : 56, w: 44, h: 56 }; }
  if (ch === 'c') return { x: 160, y: 152, w: 32, h: 40 }; if (ch === 'm') return { x: 192, y: 152, w: 32, h: 40 }; return null;
}
function drawNum(str, x, y, hgt, sheet) {   // draws with the big digits, c/m scaled to match; returns width
  const img = UI[sheet]; if (!img) return 0; let cx = x;
  for (const ch of str) {
    if (ch === '.') { hx.fillStyle = sheet === 'NUMO' ? '#ff7a2a' : '#fff'; const d = hgt * 0.12; hx.fillRect(cx + d * 0.3, y + hgt - d * 1.4, d, d); cx += d * 1.6; continue; }
    const g = glyph(ch); if (!g) continue; const sc = hgt / 56, dw = (ch === 'c' || ch === 'm') ? g.w * sc * 0.9 : g.w * sc * 0.62, dh = (ch === 'c' || ch === 'm') ? g.h * sc * 0.9 : hgt;
    const gx = (ch === 'c' || ch === 'm') ? g.x : g.x + 4, gw = (ch === 'c' || ch === 'm') ? g.w : g.w - 8;
    hx.drawImage(img, gx, g.y, gw, g.h, cx, (ch === 'c' || ch === 'm') ? y + hgt - dh : y, dw, dh); cx += dw + hgt * 0.03;
  }
  return cx - x;
}
function fmtDiam(cm) { return cm < 100 ? Math.floor(cm) + 'cm' : (cm / 100).toFixed(1) + 'm'; }
function drawHud() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = hudc.clientWidth, H = hudc.clientHeight;
  if (hudc.width !== Math.floor(W * dpr)) { hudc.width = Math.floor(W * dpr); hudc.height = Math.floor(H * dpr); }
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, W, H);
  if (!G.ready || !S) return;
  const gs = Math.max(120, Math.min(190, Math.min(W, H) * 0.3));
  // size gauge: green gear, rainbow fills outward from the corner as the ball grows toward the goal
  const prog = Math.max(0, Math.min(1, (S.diam - S.startDiam) / (S.goal - S.startDiam)));
  if (UI.SIZEB) hx.drawImage(UI.SIZEB, 0, 0, gs, gs);
  if (UI.SIZEF) { hx.save(); hx.beginPath(); hx.moveTo(0, 0); hx.arc(0, 0, gs * (0.12 + 0.9 * prog), 0, Math.PI / 2); hx.closePath(); hx.clip(); hx.drawImage(UI.SIZEF, 0, 0, gs, gs); hx.restore(); }
  // size number
  const nh = gs * 0.26; hx.save(); hx.shadowColor = '#000a'; hx.shadowBlur = 4; drawNum(fmtDiam(S.diam), 10, gs * 0.64, nh, 'NUMW'); hx.restore();
  // goal marker text
  hx.fillStyle = '#fff'; hx.font = '12px system-ui, sans-serif'; hx.shadowColor = '#000'; hx.shadowBlur = 3; hx.fillText((S.targetLabel ? 'catch: ' + S.targetLabel + ' (' + fmtDiam(S.goal) + ')' : 'goal ' + fmtDiam(S.goal)) + '   ' + S.picked + ' picked', 10, gs * 0.64 + nh + 18); hx.shadowBlur = 0;
  // timer: pie of remaining time, number inside
  const inf = !isFinite(S.timeLimit), left = inf ? S.frame / KSim.FPS : Math.max(0, S.timeLimit - S.frame / KSim.FPS), ts = Math.max(64, Math.min(96, Math.min(W, H) * 0.16)), tx = W - ts - 12, ty = 12;
  if (UI.TIMER) hx.drawImage(UI.TIMER, tx, ty, ts, ts);
  hx.beginPath(); hx.moveTo(tx + ts / 2, ty + ts / 2); hx.arc(tx + ts / 2, ty + ts / 2, ts * 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (inf ? 0.999 : left / S.timeLimit)); hx.closePath(); hx.fillStyle = !inf && left < 30 ? '#ff5a5a' : '#ffb0b8'; hx.fill();
  hx.beginPath(); hx.arc(tx + ts / 2, ty + ts / 2, ts * 0.22, 0, Math.PI * 2); hx.fillStyle = '#5a5a5a'; hx.fill();
  const mm = Math.floor(left / 60), ss = Math.floor(left % 60); const tstr = mm + ':' + String(ss).padStart(2, '0');
  hx.fillStyle = '#fff'; hx.font = `bold ${Math.round(ts * 0.22)}px system-ui, sans-serif`; hx.textAlign = 'center'; hx.shadowColor = '#000'; hx.shadowBlur = 3; hx.fillText(tstr, tx + ts / 2, ty + ts + 16); hx.textAlign = 'left'; hx.shadowBlur = 0;
  // dash meter (placeholder look)
  if (S.dashCool > 0 || S.dashT > 0) { const f = S.dashCool > 0 ? 1 - S.dashCool / 240 : 1 - S.dashT / 240; hx.fillStyle = '#0006'; hx.fillRect(tx, ty + ts + 24, ts, 6); hx.fillStyle = S.dashCool > 0 ? '#888' : '#ffd24a'; hx.fillRect(tx, ty + ts + 24, ts * f, 6); }
  // touch sticks
  for (const k of ['L', 'R']) { const p = pads[k]; if (!p) continue; const ps = 128;
    if (UI.PAD) hx.drawImage(UI.PAD, p.ox - ps / 2, p.oy - ps / 2, ps, ps);
    const dy = Math.max(-PAD_R, Math.min(PAD_R, p.y - p.oy)) * 0.6; if (UI.PADC) hx.drawImage(UI.PADC, p.ox - 32, p.oy + dy - 32, 64, 64); }
}
let toast = null, resShown = false, dlgRes = null;

// End of a run: the King comments in his own words (STRING.dat). Which line set is used for which result is a guess (A43)
function showResult() {
  resShown = true; const KT = window.KText; if (!KT) return; saveRecord();
  const elapsed = S.frame / KSim.FPS, left = S.timeLimit - elapsed, v = { goal: S.targetLabel || '', time: KT.fmtTime(elapsed), size: fmtDiam(S.diam) };
  let names;
  if (MODE === 'story') {
    if (S.won) { const f = left / S.timeLimit, k = f >= 0.5 ? 'STORY_RES03' : f >= 0.2 ? 'STORY_RES01' : 'STORY_RES02'; names = [k]; }
    else names = ['STORY_FAIL'];
  } else { const f = S.diam / Math.max(S.goal, 1); names = [f >= 1 ? 'TIME_RES03' : f >= 0.5 ? 'TIME_RES01' : 'TIME_RES02']; }
  const pages = KT.pages(names, v); if (names[0] === 'STORY_RES01') pages.push(v.time);
  $('res').style.display = 'block'; $('rRetry').style.display = $('rMenu').style.display = 'none';
  const done = () => { $('rRetry').style.display = $('rMenu').style.display = 'block'; };
  if (dlgRes) dlgRes.stop(); dlgRes = KT.dialog($('rDlg'), pages, done);
}
$('rRetry').onclick = () => restart(); $('rMenu').onclick = () => { location.href = 'menu.html?screen=stage&mode=' + MODE; };
if (window.KText) KText.fit($('rbox'));
function hud() {
  drawHud();
  if (!S) return;
  if (toast) { const cv = $('hud'), x = cv.getContext('2d'), a = Math.min(1, toast.t / 30); x.save(); x.globalAlpha = a; x.font = `bold ${Math.round(cv.height * 0.035)}px sans-serif`; x.textAlign = 'center'; x.shadowColor = '#000c'; x.shadowBlur = 6; x.fillStyle = '#fff'; x.fillText(toast.text, cv.width / 2, cv.height * 0.2); x.restore(); toast.t--; if (toast.t <= 0) toast = null; }
  if ((S.won || lost) && !resShown) showResult();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!G.ready) return;
  const dt = Math.min((now - last) / 1000, 0.25); last = now; last_dt = dt;
  cam.k = 1 - Math.exp(-dt * 8);
  if (paused) { acc = 0; return; }
  acc += dt; const stepDt = 1 / KSim.FPS;
  const inp = readInput();
  let n = 0;
  while (acc >= stepDt && n < 5) {
    prevPos = S.pos.slice(); prevYaw = S.yaw;
    const over = S.won || lost;
    KSim.step(S, over ? { L: 0, R: 0 } : inp);
    for (const ev of S.events) {                                             // sound cues (guesses: ASSUMPTIONS P23)
      if (ev.type === 'pickup') { const i = S.info[ev.name], c = i && i.cat; if (c !== undefined) KSnd.se('KD2_SE_mono_' + String(c).padStart(2, '0')); }
      if (ev.type === 'pickup') { const i = S.info[ev.name], cs = i && i.catch_se; if (cs) activeCatch = { se: CATCH_SE_MAP[cs[2]] !== undefined ? CATCH_SE_MAP[cs[2]] : 20, every: cs[4] || 300, next: S.frame }; }   // A53
      else if (ev.type === 'area') KSnd.se('KD_SE_game_28');
      else if (ev.type === 'won') { KSnd.stopBgm(); KSnd.se('KD_SE_res_00'); }
    }
    if (activeCatch && !over && S.frame >= activeCatch.next) { KSnd.se('KD_SE_game_' + String(activeCatch.se).padStart(2, '0')); activeCatch.next = S.frame + activeCatch.every; }   // the original repeats the object's own sound every N frames while it sits on the ball (MonoMain catchSE)
    if (S.events.some(e => e.type === 'area')) toast = { t: 4 * KSim.FPS, text: 'New area unlocked' };   // PLACEHOLDER (P21): the original's cue is unknown
    if (!over && S.frame / KSim.FPS >= S.timeLimit) { lost = true; KSnd.stopBgm(); KSnd.se('KD_SE_over_00'); }
    // prince walk cycle: advances while there is stick input (4 frames per pose, 2 when dashing)
    if (!over && (Math.abs(inp.L) > 0.2 || Math.abs(inp.R) > 0.2)) { ouji.t += S.dash ? 2 : 1; if (ouji.t >= 4) { ouji.t = 0; ouji.pat = (ouji.pat + 1) % 4; } } else if (ouji.t === 0) ouji.pat = 0;
    acc -= stepDt; n++; G.frames++;
  }
  if (n === 5) acc = 0;
  draw(Math.min(acc / stepDt, 1));
  hud();
}

(async function init() {
  try {
    play = await (await fetch(`data/${STAGE}/play.json?v=1`)).json(); if (window.KText && !(window.__noText)) { try { await KText.load(); } catch (e) { G.err.push('text ' + e.message); } }
    mg = await loadGroup(STAGE, 'map'); og = await loadGroup(STAGE, 'obj'); ball = makeBall();
    try { ou = await loadGroup('common', 'ouji'); } catch (e) { G.err.push('ouji ' + e); }
    await loadUI();
    restart(); G.ready = true; $('load').style.display = 'none';
  } catch (e) { G.err.push(String(e)); $('load').textContent = 'load failed: ' + e; }
  requestAnimationFrame(t => { last = t; frame(t); });
})();

// ---- pause menu and tester report ----
// The catch rule is the one open question that changes the stage 1 feel (A48), so testers can flip it here. It reloads the page with ?catch=goal or without it.
function setPause(on) {
  if (S && (S.won || lost)) on = false;
  paused = on; $('pause').style.display = on ? 'flex' : 'none'; $('pText').style.display = 'none'; $('pNote').textContent = '';
  if (on) { const cm = qs.get('catch') === 'goal'; $('pCatch').textContent = 'Catch size: ' + (cm ? 'fitted to the goal' : 'from the data (default)') + ' (tap to switch)'; }
}
function reportText() {
  const now = performance.now(); const fps = Math.round(1000 / Math.max(1, last_dt * 1000));
  return ['Katamari Amore web port report', 'url: ' + location.href, 'stage: ' + STAGE + '  mode: ' + MODE + '  catch: ' + (qs.get('catch') || 'default'),
    'time: ' + (S.frame / KSim.FPS).toFixed(1) + ' s of ' + (S.timeLimit === Infinity ? 'no limit' : S.timeLimit) + '  diameter: ' + fmtDiam(S.diam) + '  goal: ' + fmtDiam(S.goal),
    'picked: ' + S.picked + '  layer: ' + S.layer + '  pos: ' + S.pos.map(v => v.toFixed(1)).join(', ') + '  target: ' + (S.targetLabel || 'none'),
    'fps ~' + fps + '  window: ' + innerWidth + 'x' + innerHeight + '  touch: ' + ('ontouchstart' in window), 'ua: ' + navigator.userAgent, '', 'what happened: '].join('\n');
}
$('bPause').onclick = () => setPause(true); $('pResume').onclick = () => setPause(false); $('pRestart').onclick = () => { setPause(false); restart(); };
$('pMenu').onclick = () => { location.href = 'menu.html?screen=stage&mode=' + MODE; };
$('pCatch').onclick = () => { const u = new URL(location.href); if (qs.get('catch') === 'goal') u.searchParams.delete('catch'); else u.searchParams.set('catch', 'goal'); location.href = u.toString(); };
$('pReport').onclick = () => { const t = $('pText'); t.value = reportText(); t.style.display = 'block'; t.focus(); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} try { if (navigator.clipboard) navigator.clipboard.writeText(t.value).catch(() => {}); ok = true; } catch (e) {} $('pNote').textContent = (ok ? 'Copied. ' : 'Select and copy this. ') + 'Paste it into a message and add what went wrong.'; };
document.addEventListener('visibilitychange', () => { if (document.hidden && S && !S.won && !lost) setPause(true); });

// ---- records (localStorage, per stage and mode): best clear time for story, biggest ball for the other two ----
function saveRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem('kam_rec') || '{}'), r = rec[STAGE] = rec[STAGE] || {}, el = S.frame / KSim.FPS;
    if (MODE === 'story') { if (S.won && (!r.story || el < r.story)) { r.story = +el.toFixed(1); r.newBest = true; } r.cleared = r.cleared || !!S.won; }
    else { const k = MODE; if (!r[k] || S.diam > r[k]) { r[k] = +S.diam.toFixed(1); r.newBest = true; } }
    localStorage.setItem('kam_rec', JSON.stringify(rec)); return r.newBest;
  } catch (e) { return false; }
}
