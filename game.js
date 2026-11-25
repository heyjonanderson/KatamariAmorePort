var KSnd = window.KSnd || { bgm() {}, stopBgm() {}, se() {}, start() {}, setMuted() {}, isMuted: () => false };   // audio.js is optional (tests run without it)
'use strict';
// Katamari Amore web port: playable stage. Rendering only; all rules are in sim.js (see ASSUMPTIONS.md, P entries).
const $ = id => document.getElementById(id);
const canvas = $('c');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
const qs = new URLSearchParams(location.search);
const STAGE = qs.get('stage') || 'S001', MODE = qs.get('mode') || 'story';
const STAGE_N = parseInt(STAGE.slice(1), 10), PACK = STAGE_N <= 7 ? 1 : STAGE_N <= 14 ? 2 : 3, LOCAL = (STAGE_N - 1) % 7;   // 7 stage slots per pack: the sixth is the mini-game extra (FUN_00041520: pack digit, stage mod 7)   // story: catch the target; timeattack: biggest in the time limit; eternal: no limit
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
  precision mediump float; varying vec3 vN; varying vec2 vUv; uniform sampler2D uTex; uniform float uUseTex; uniform vec3 uTint; uniform vec3 uLight;
  void main() {
    vec4 c = uUseTex > 0.5 ? texture2D(uTex, vUv) : vec4(uTint, 1.0);
    if (c.a < 0.002) discard;   // the engine's alpha test is GL_NOTEQUAL 0 (A117); the rest of the alpha is blended below
    vec3 n = normalize(vN);
    // uLight.z = 1: the engine's fixed-function light. Ambient 0.3 (light) + 0.2 (GL default scene ambient), diffuse 1.0, direction (42, -349, -29) from the binary with y flipped for our y-up frame (A117). Others: my presets
    float l = uLight.z > 0.5 ? min(uLight.x + uLight.y * max(dot(n, normalize(vec3(42.0, 349.0, -29.0))), 0.0), 1.0) : uLight.x + uLight.y * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
    gl_FragColor = vec4(c.rgb * l, c.a);
  }`);
const L = { pos: gl.getAttribLocation(P, 'aPos'), nrm: gl.getAttribLocation(P, 'aNrm'), uv: gl.getAttribLocation(P, 'aUv'),
  vp: gl.getUniformLocation(P, 'uVP'), model: gl.getUniformLocation(P, 'uModel'),
  tex: gl.getUniformLocation(P, 'uTex'), use: gl.getUniformLocation(P, 'uUseTex'), tint: gl.getUniformLocation(P, 'uTint'), light: gl.getUniformLocation(P, 'uLight') };

// ---- loading (same data layout as the viewer) ----
const pow2 = n => (n & (n - 1)) === 0;
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + url)); i.src = url; }); }
// ---- settings (A67): lighting and texture filtering, kept in localStorage. The original's own values are not in the data, so these are choices, not a copy ----
// Back-face culling (A8, A117): the engine enables GL_CULL_FACE with glFrontFace(GL_CW) (FUN_0000dd90) and the model data agrees: the signed volume of every closed object is negative, i.e. faces are clockwise seen from outside in data axes. The port mirrors x in the projection (P20), so on screen the front faces turn counter-clockwise: default GL front face
const FARMODE = new URLSearchParams(location.search).get('far') || 'engine';
const CULLMODE = new URLSearchParams(location.search).get('cull') || 'ccw';
const setCull = () => { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);  if (CULLMODE === 'off') gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(CULLMODE === 'cw' ? gl.CW : gl.CCW); } };
const LIGHTS = [['Original', 0.5, 1, 1], ['Soft', 0.55, 0.45, 0], ['Flat', 1, 0, 0], ['Strong', 0.3, 0.7, 0]], FILTERS = ['Smooth', 'Sharp', 'Pixel'], SET = { light: 0, filter: 0 }, ALLTEX = [];
try { const s = JSON.parse(localStorage.getItem('kam_set') || '{}'); SET.light = s.lt === 2 ? s.light | 0 : 0; SET.filter = s.filter | 0; } catch (e) {}   // lt 2 = the preset list with Original first; older saved values meant the old list, so they fall back to Original
if (!LIGHTS[SET.light]) SET.light = 0; if (!FILTERS[SET.filter]) SET.filter = 0;
function saveSet() { try { localStorage.setItem('kam_set', JSON.stringify({ light: SET.light, filter: SET.filter, lt: 2 })); } catch (e) {} }
function texFilter(t, mip) {
  gl.bindTexture(gl.TEXTURE_2D, t); const f = SET.filter;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f === 2 ? (mip ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST) : mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f === 0 ? gl.LINEAR : gl.NEAREST);
}
function applyFilter() { for (const q of ALLTEX) texFilter(q.t, q.mip); }
function makeTex(img) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const ok = pow2(img.width) && pow2(img.height);
  if (ok) gl.generateMipmap(gl.TEXTURE_2D);
  const wrap = ok ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  ALLTEX.push({ t, mip: ok }); texFilter(t, ok);
  return t;
}
const NOLOAD = { step() {}, set() {}, grow() {}, expect() {}, label() {}, end() {} };   // used when load.js is absent (tests)
async function getBuf(url, task, units) {   // units = how much of the progress bar this file is worth; moves as bytes arrive
  if (!window.KLoad) return (await fetch(url)).arrayBuffer();
  let sent = 0; const b = await KLoad.fetchBuf(url, (d, t) => { const u = units * d / Math.max(t, 1); task.step(u - sent); sent = u; }); task.step(units - sent); return b;
}
async function loadGroup(stage, tag, task) {
  task = task || NOLOAD; const base = `data/${stage}/`;
  task.grow(5); const man = await (await fetch(`${base}${tag}.json?v=13`)).json(); task.step(1);
  const blob = await getBuf(`${base}${tag}.bin?v=13`, task, 4);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, blob, gl.STATIC_DRAW);
  const texs = {};
  task.grow(man.tex.length); await Promise.all(man.tex.map(async n => { texs[n] = makeTex(await loadImage(`${base}tex/${n}.png`)); task.step(1); }));
  const mods = {}; for (const m of man.models) mods[m.name] = m;
  return { man, vbo, ibo, texs, mods, blob: tag === 'core' ? blob : null };
}

// ---- the ball: generated UV sphere, procedural texture (PLACEHOLDER B9) ----
function makeBall() {
  const nu = 32, nv = 16, v = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const th = j / nv * Math.PI, ph = i / nu * Math.PI * 2, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    v.push(x, y, z, x, y, z, i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); const data = new Float32Array(v); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#2f8ea3'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 14; k++) { g.fillStyle = k % 2 ? '#4fb0c2' : '#216f82'; g.fillRect(Math.random() * 128, Math.random() * 128, 18 + Math.random() * 30, 8 + Math.random() * 18); }
  g.fillStyle = '#9fe0ea'; for (let k = 0; k < 4; k++) g.fillRect(k * 32, 0, 5, 128);
  const nvv = data.length / 8, base = new Float32Array(nvv * 3), dir = new Float32Array(nvv * 3);
  for (let i = 0; i < nvv; i++) for (let k = 0; k < 3; k++) { base[i * 3 + k] = data[i * 8 + k]; dir[i * 3 + k] = data[i * 8 + k]; }
  return { vbo, ibo, n: idx.length, tex: makeTex(c), data, base, dir, mult: new Float32Array(nvv).fill(1), dirty: false };
}
// the real core mesh from GAMEDATA (GiCorM01..21 with GiCorT01..21, one per stage): a faceted ball with a pattern per stage. Scaled so its mean radius is 1 (A69)
function makeBallCore(cg, no) {
  const m = cg.mods['GiCorM' + String(no).padStart(2, '0')] || cg.mods.GiCorM01, sub = m.subs[0], nv = m.nv;
  const data = new Float32Array(cg.blob.slice(m.voff, m.voff + nv * 32)), base = new Float32Array(nv * 3), dir = new Float32Array(nv * 3);
  let rs = 0; for (let i = 0; i < nv; i++) rs += Math.hypot(data[i * 8], data[i * 8 + 1], data[i * 8 + 2]); const rm = rs / nv;
  for (let i = 0; i < nv; i++) { const o = i * 8, x = data[o] / rm, y = data[o + 1] / rm, z = data[o + 2] / rm, l = Math.hypot(x, y, z) || 1; data[o] = base[i * 3] = x; data[o + 1] = base[i * 3 + 1] = y; data[o + 2] = base[i * 3 + 2] = z; dir[i * 3] = x / l; dir[i * 3 + 1] = y / l; dir[i * 3 + 2] = z / l; }
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cg.blob.slice(sub.off, sub.off + sub.n * 2)), gl.STATIC_DRAW);
  return { vbo, ibo, n: sub.n, tex: cg.texs[sub.tex], data, base, dir, mult: new Float32Array(nv).fill(1), dirty: true };
}

// ---- state ----
let play = null, og = null, mg = null, ou = null, ball = null, S = null;
const CAM_FRAMES = 32;   // frames a camera row change takes (mission struct word 4, FUN_00010d20)
const cam = { yaw: 0, ready: false, idx: 0, trans: 0, far: 800, back: 20, up: 8, ahead: 8, lookUp: 0 };
const keys = {};
const pads = { S: null };                    // touch stick: {id, ox, oy, x, y}. One floating stick on the left, like the original (A70)
let touchDash = false, touchFlip = false, lastPick = null;
let last_dt = 0.016, acc = 0, last = 0, prevPos = [0,0,0], prevYaw = 0, lost = false, ouji = { pat: 0, t: 0 };
const UI = {};                                // HUD images


// CATCH_SE = [2, 0, n, 0, every]: n is the catchSeNo, every = repeat interval in frames. requestMonoSe (FUN_00045d88) plays the sound id found in a table at 0x89260:
// one row of four ids per STAGE (global stage index 0 to 20, so S007, S014 and S021 are empty rows), indexed by n. Id 87 and up is KD2_SE_mono_01 and up (id - 86) (A53, A99, A104)
const catchSeFile = (stage, n) => { const N = parseInt(stage.slice(1), 10), row = N <= 6 ? [[1, 2], [3, 4], [5, 6], [7, 8, 9], [10, 11], [12, 13]][N - 1] : N >= 8 && N <= 13 ? [14 + 2 * (N - 8), 15 + 2 * (N - 8)] : N >= 15 && N <= 20 ? [26 + 2 * (N - 15), 27 + 2 * (N - 15)] : []; return row[n] || 0; };   // 0 = no sound
let activeCatch = null, paused = false;
// restart builds the whole stage again, which blocks the page for a moment on the big stages, so show the spinner first (A62)
function restartUI() { const t = window.KLoad ? KLoad.begin('Restarting', { now: true }) : NOLOAD; setTimeout(() => { restart(); t.end(); }, 40); }
function restart() {
  S = KSim.create(play, Object.assign(MODE === 'story' ? {} : { noTarget: true }, { set: { story: 'S', timeattack: 'T', exact: 'J', eternal: 'E' }[MODE] || 'S' }, qs.get('catch') ? { catchMode: qs.get('catch') } : {})); G.S = S; resShown = false; activeCatch = null; pulse = 0; puffs.length = 0; bang = 0; airT = 0; lastPick = null; if (ball) { ball.mult.fill(1); ball.dirty = true; for (let i = 0; i < ball.mult.length; i++) { const o = i * 8; ball.data[o] = ball.data[o + 3]; ball.data[o + 1] = ball.data[o + 4]; ball.data[o + 2] = ball.data[o + 5]; } } if (dlgRes) { dlgRes.stop(); dlgRes = null; } $('res').style.display = 'none';
  for (let i = 0; i < 60; i++) KSim.step(S, { fwd: 0, turn: 0 });   // settle on the floor, same as the bot test
  S.frame = 0; S.events.length = 0;
  prevPos = S.pos.slice(); prevYaw = S.yaw; cam.yaw = S.yaw; cam.ready = false; echo.on = echo.want = false; lost = false; toast = null; for (const k in runItems) delete runItems[k]; KSnd.bgm(MODE === 'timeattack' ? 'BGM_ST00' : 'BGM_ST' + String(parseInt(STAGE.slice(1), 10)).padStart(2, '0'));   // time attack plays BGM id 3 (BGM_ST00) on every stage; the other modes use the stage's own track (FUN_0002d244, mode field == 1, A125) ouji = { pat: 0, t: 0 };
  { const tl = play.mis.time_limit_n || [240, 120, 300, 240, 10000, 10000]; S.timeLimit = { story: tl[2], timeattack: tl[3], exact: tl[4], eternal: tl[5] }[MODE]; if (!(S.timeLimit < 10000)) S.timeLimit = Infinity; }   // TIME_LIMIT_1: [par, ?, story, time attack, exact, eternal]; 10000 s means no limit (A90)
  if (MODE === 'exact') S.goal = play.mis.exact_mm / 10;   // MISSION_DATA_EXT: the exact-size target, in mm (A91)
  $('msg').style.display = 'none'; acc = 0;
}

// ---- input ----
// Keyboard (easy mode): forward/back and left/right are mixed into two stick values. Touch: drag on the left half = left stick, right half = right stick.
function readInput() {
  const dash = !!(keys.ShiftLeft || keys.ShiftRight || keys.Space || touchDash), flip = !!(keys.KeyQ || keys.KeyE || touchFlip);
  const p = pads.S;
  if (qs.get('ctl') === 'pad') {   // ?ctl=pad: the engine's one-pad mapping (sim padSticks, A121): spin zones at the sides, forward needs only a small push, no reverse
    let r = 0, f = 0;
    if (p) { r = (p.x - p.ox) / PAD_R; f = -(p.y - p.oy) / PAD_R; } else { f = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0); r = ((keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0)) * (f > 0 ? 0.3 : 1); }
    const t = KSim.tank(Math.max(0, f), -r * 0.5); return { L: t.L, R: t.R, pad: [r, f], dash, flip };
  }
  if (qs.get('ctl') === 'stick') {   // ?ctl=stick: one stick vector drives both sticks, the engine's angle rule steers (sim readCtrl, A121). Default stays the tank mix below
    let x = 0, y = 0;
    if (p) { x = (p.x - p.ox) / PAD_R; y = -(p.y - p.oy) / PAD_R; } else { x = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0); y = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0); }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const t = KSim.tank(y, -x * 0.5); return { L: t.L, R: t.R, sx: x, sz: y, dash, flip };   // L and R only feed the HUD and the prince animation
  }
  if (p) {   // one stick: up = forward, sideways = steer, mixed into the two track values the sim wants (same mix as the keyboard)
    let x = (p.x - p.ox) / PAD_R, y = -(p.y - p.oy) / PAD_R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const t = KSim.tank(y, -x * (Math.abs(y) > 0.2 ? 0.5 : 1)); return { L: t.L, R: t.R, dash, flip, P: Math.abs(y) > 0.2 ? Math.min(1, Math.abs(y) / 0.85) : undefined };   // P: push strength for the speed curve, kept apart from steering (A75)
  }
  const fwd = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  const left = (keys.ArrowLeft || keys.KeyA ? 1 : 0) - (keys.ArrowRight || keys.KeyD ? 1 : 0);
  const t = KSim.tank(fwd, left * (fwd ? 0.5 : 1));     // while driving, steer gently; standing still, spin
  return { L: t.L, R: t.R, dash, flip, P: fwd ? 1 : undefined };
}
window.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyR') restartUI(); if (e.code === 'Escape' || e.code === 'KeyP') setPause(!paused); if (e.code === 'KeyM') { KSnd.setMuted(!KSnd.isMuted()); syncSnd(); } if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });
const bSnd = document.getElementById('bSnd'); const syncSnd = () => { bSnd.textContent = KSnd.isMuted() ? 'Sound off' : 'Sound on'; }; bSnd.onclick = () => { KSnd.setMuted(!KSnd.isMuted()); syncSnd(); }; syncSnd();
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const PAD_R = 70;
canvas.addEventListener('pointerdown', e => {
  if (e.clientX > window.innerWidth * 0.62 || pads.S) return;
  pads.S = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); G.touched = true;
});
canvas.addEventListener('pointermove', e => { const p = pads.S; if (p && p.id === e.pointerId) { p.x = e.clientX; p.y = e.clientY; } });
const endPad = e => { if (pads.S && pads.S.id === e.pointerId) pads.S = null; };
canvas.addEventListener('pointerup', endPad); canvas.addEventListener('pointercancel', endPad);
$('bRestart').onclick = restartUI; $('bAgain').onclick = restartUI;
$('bTurn').addEventListener('pointerdown', e => { touchFlip = true; e.stopPropagation(); }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('bTurn').addEventListener(ev, () => { touchFlip = false; });
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
// ---- lumps (A64): the sim lifts the ball over them. The mesh itself stays round: the original draws the core with a rotation matrix only (mDistort is a copy of mLocalWorld, KatamariHit.cppi), so the stretching I had here (A60) was a guess and is gone (A85, A111) ----
let pulse = 0;
function shapeBall(R) {
  const D = ball.data, M_ = ball.mult, B = ball.base, U = ball.dir, lm = S.lumps; let changed = false;
  for (let i = 0, n = M_.length; i < n; i++) {
    const o = i * 8, j = i * 3, t = lm.length ? KSim.lumpMult(lm, [U[j], U[j + 1], U[j + 2]]) : 1;
    const c = M_[i] + (t - M_[i]) * 0.25; if (Math.abs(c - M_[i]) > 1e-4) { M_[i] = c; changed = true; } else M_[i] = t;
    D[o] = B[j] * M_[i]; D[o + 1] = B[j + 1] * M_[i]; D[o + 2] = B[j + 2] * M_[i];
  }
  if (changed || ball.dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, ball.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, D); ball.dirty = changed; }
}
const iconCv = document.createElement('canvas'); iconCv.width = iconCv.height = 128; const iconCx = iconCv.getContext('2d');
function drawIcon(now) {   // renders lastPick's model into the bottom left 128 px of the canvas, copies it into iconCv, and the scene is cleared and drawn over it
  if (!lastPick || !og || canvas.width < 128 || canvas.height < 128) return; const i = lastPick.info, m = og.mods[i.model]; if (!m) return;
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 128, 128); gl.viewport(0, 0, 128, 128); gl.clearColor(0.6, 0.6, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); setCull();
  const c = [0, 1, 2].map(k => (i.lo[k] + i.hi[k]) / 2), r = 0.5 * Math.hypot(i.hi[0] - i.lo[0], i.hi[1] - i.lo[1], i.hi[2] - i.lo[2]) || 1, a = now / 1000 * 1.4, ca = Math.cos(a), sa = Math.sin(a);
  const Rs = [ca, 0, sa, 0, 1, 0, -sa, 0, ca], t = [-(Rs[0] * c[0] + Rs[1] * c[1] + Rs[2] * c[2]), -(Rs[3] * c[0] + Rs[4] * c[1] + Rs[5] * c[2]), -(Rs[6] * c[0] + Rs[7] * c[1] + Rs[8] * c[2])];
  const vp = M.mul(M.persp(0.5, 1, r * 0.2, r * 10), M.look([0, r * 1.3, r * 3.4], [0, 0, 0], [0, 1, 0]));
  gl.useProgram(P); gl.uniform3f(L.light, LIGHTS[SET.light][1], LIGHTS[SET.light][2], LIGHTS[SET.light][3]); gl.uniformMatrix4fv(L.vp, false, vp); gl.uniform1i(L.tex, 0);
  gl.enableVertexAttribArray(L.pos); gl.enableVertexAttribArray(L.nrm); gl.enableVertexAttribArray(L.uv); bindGroup(og); drawModel(og, m, M.fromR3(Rs, t, 1));
  iconCx.clearRect(0, 0, 128, 128); iconCx.drawImage(canvas, 0, canvas.height - 128, 128, 128, 0, 0, 128, 128);
  gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.55, 0.75, 0.95, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}
function camInit() {   // gYm_CameraInit: the row for the current size, no transition
  const idx = KSim.cameraRow(S), cp = KSim.cameraParams(S, idx);
  cam.idx = idx; cam.back = cp.back; cam.up = cp.up; cam.ahead = cp.ahead; cam.lookUp = cp.lookUp; cam.far = cp.far; cam.trans = 0; cam.ready = true;
}
function camStep() {   // once per sim frame. A new row is picked only when the ball outgrows the current row and no move is running (FUN_00029948); the offsets then move linearly over 32 frames (FUN_0002918c), the far plane at once
  if (echo.on) { echo.x += echo.dx; echo.y += echo.dy; if (--echo.n <= 0) echo.on = false; }
  if (!cam.ready) camInit();
  if (cam.trans > 0) {
    cam.back += cam.vel.back; cam.up += cam.vel.up; cam.ahead += cam.vel.ahead; cam.lookUp += cam.vel.lookUp;
    if (--cam.trans === 0) { const t = cam.target; cam.back = t.back; cam.up = t.up; cam.ahead = t.ahead; cam.lookUp = t.lookUp; }
    return;
  }
  const idx = KSim.cameraRow(S); if (idx < 0 || idx === cam.idx || !(S.cam[cam.idx][0] < S.diam)) return;
  const t = KSim.cameraParams(S, idx), N = CAM_FRAMES;
  cam.idx = idx; cam.target = t; cam.far = t.far; cam.trans = N;
  cam.vel = { back: (t.back - cam.back) / N, up: (t.up - cam.up) / N, ahead: (t.ahead - cam.ahead) / N, lookUp: (t.lookUp - cam.lookUp) / N };
  echoStart(); KSnd.se('KD_SE_game_14');   // sound id 0x14 (game_14) plays when the camera starts pulling back (FUN_00029948, A102)
}
// Zoom echo when the camera steps out (FUN_00034e58, 34e90, 34f94, called from FUN_00029948 with 0, 3.0 and 30 frames, A108): the frame as it was is kept, and for 30 frames four copies are drawn over the scene.
// x runs 1 to 3 and y 1 to 0 in equal steps; copy i (4 down to 1) is scaled max(x - i/10, 1) about the centre at alpha 0.25 * y
const echo = { on: false, want: false, x: 1, y: 1, dx: 0, dy: 0, n: 0, img: null };
function echoStart() { echo.want = true; echo.on = false; echo.x = 1; echo.y = 1; echo.dx = (3 - 1) / 30; echo.dy = (0 - 1) / 30; echo.n = 30; }
function echoCapture() { if (!echo.want) return; echo.want = false; if (!echo.img) echo.img = document.createElement('canvas'); echo.img.width = canvas.width; echo.img.height = canvas.height; try { echo.img.getContext('2d').drawImage(canvas, 0, 0); echo.on = true; } catch (e) {} }
function echoDraw(W, H) {
  if (!echo.on || !echo.img) return;
  hx.save(); for (let i = 4; i >= 1; i--) { const sc = Math.max(echo.x - i / 10, 1); hx.globalAlpha = Math.max(0, 0.25 * echo.y); hx.drawImage(echo.img, W / 2 - W * sc / 2, H / 2 - H * sc / 2, W * sc, H * sc); } hx.restore();
}
function draw(alpha) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  { const c = play.mis.clear || [0.55, 0.75, 0.95]; gl.viewport(0, 0, w, h); gl.clearColor(c[0], c[1], c[2], 1); }   // the stage's own clear colour from GRAPHICS (A116); S015 and S017 have no GRAPHICS section and keep the old blue
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); setCull();
  if (!G.ready || !S) return;
  drawIcon(performance.now());
  G.tris = 0;
  const R = KSim.radius(S);
  const pos = [0,1,2].map(k => prevPos[k] + (S.pos[k] - prevPos[k]) * alpha);
  // camera from the stage's CAMERA_DATA table. The engine puts the eye at ball + (prince to ball direction) * row offset with no easing (FUN_00028cb8), the prince
  // sitting exactly behind the ball along his own yaw (FUN_000271a4), so the heading is the interpolated yaw. Rows change by camStep (A102)
  if (!cam.ready) camInit();
  cam.yaw = prevYaw + (S.yaw - prevYaw) * alpha;
  const cfx = Math.sin(cam.yaw), cfz = Math.cos(cam.yaw);
  const eyeFull = [pos[0] - cfx * cam.back, pos[1] + cam.up, pos[2] - cfz * cam.back];
  // keep the camera inside the room, as the engine does (FUN_000295ec, A112). One ray from the ball to the wanted eye against the stage's camera hit data. No hit: nothing changes. A hit at fraction f of the way
  // swings the eye straight up, about the horizontal axis across the view, by 10 degrees + 75 degrees * (1 - f), but never past 85 degrees of elevation, at the same distance and with no easing; the eye is then kept
  // at least 0.1 cm above the floor. (My old rule shrank the distance and eased back; the engine does neither.) cam.L is the eye distance, used below to hide the prince when the camera is on top of the ball
  const tgt = [pos[0] + cfx * cam.ahead, pos[1] + cam.lookUp, pos[2] + cfz * cam.ahead];
  const rb = [eyeFull[0] - pos[0], eyeFull[1] - pos[1], eyeFull[2] - pos[2]], lb = Math.hypot(rb[0], rb[1], rb[2]) || 1;   // the test ray: ball to the wanted eye
  const d0 = [eyeFull[0] - tgt[0], eyeFull[1] - tgt[1], eyeFull[2] - tgt[2]], len0 = Math.hypot(d0[0], d0[1], d0[2]) || 1, hz = Math.hypot(d0[0], d0[2]) || 1, e0 = Math.atan2(d0[1], hz);   // the swing turns the eye round the look-at point (c60c: eye = look + R * (eye - look))
  let e = e0; { const t = KSim.rayHit(S, pos[0], pos[1], pos[2], rb[0] / lb, rb[1] / lb, rb[2] / lb, lb);
    if (t !== null) { const f = t / lb, sw = Math.min(10 + 75 * Math.min(1, Math.max(0, 1 - f)), 85 - e0 * 180 / Math.PI); e = e0 + Math.max(0, sw) * Math.PI / 180; } }
  cam.e = e; cam.L = lb;
  const eye = [tgt[0] + d0[0] / hz * Math.cos(e) * len0, Math.max(0.1, tgt[1] + Math.sin(e) * len0), tgt[2] + d0[2] / hz * Math.cos(e) * len0];
  const far = FARMODE === 'old' ? Math.max(cam.far, play.mis.far || 800, play.mis.far2 || 0, cam.back * 3) : (play.mis.far || 800);   // The scene camera (the singleton FUN_0002bca8 draws the world with) gets the FIRST near/far pair of GRAPHICS (A52); the second pair goes to another object. Far is fixed per stage, 800 cm in stage 1. ?far=old brings back the longer clip range I used before
  // The original's scene camera is perspective(fov 48 degrees HORIZONTAL, aspect = height / width): FUN_0002a8b8, fov 0x42400000 set in FUN_0002c5xx. Vertical is 33 degrees at 3:2 (A88)
  const vp = M.mul(M.persp(2 * Math.atan(Math.tan(24 * Math.PI / 180) * h / w), w / h, Math.max(R * 0.03, 0.05), far), M.look(eye, tgt, [0,1,0]));
  gl.useProgram(P); gl.uniform3f(L.light, LIGHTS[SET.light][1], LIGHTS[SET.light][2], LIGHTS[SET.light][3]); gl.uniformMatrix4fv(L.vp, false, vp); gl.uniform1i(L.tex, 0);
  gl.enableVertexAttribArray(L.pos); gl.enableVertexAttribArray(L.nrm); gl.enableVertexAttribArray(L.uv);
  // map
  bindGroup(mg); for (const m of mg.man.models) drawModel(mg, m, M.I());
  // loose objects
  bindGroup(og);
  for (const o of S.objs) { if (o.state !== 'map' && o.state !== 'fly') continue; const an = S.info[o.n].anim; let m = og.mods[an ? an.frames[Math.floor((o.aph || 0) + alpha * an.speed) % an.frames.length] : o.model] || og.mods[o.model]; if (!m) continue;   // flip-book monos (A59)
    let sc = 1; if (o.born !== undefined) { const d = Math.hypot(o.pos[0] - pos[0], o.pos[2] - pos[2]); const k = (S.frame + alpha - o.born - Math.min(d / 40, 24)) / 10; if (k <= 0) continue; if (k < 1) { const c = 1.70158, x = k - 1; sc = 1 + (c + 1) * x * x * x + c * x * x; } }   // grow in over ~0.35 s, nearer ones first
    drawModel(og, m, M.fromR3(o.rot, o.ppos ? [0,1,2].map(q => o.ppos[q] + (o.pos[q] - o.ppos[q]) * alpha) : o.pos, sc)); }
  const bpos = pos; pulse *= 0.86;
  G.vp = vp.slice ? vp.slice() : vp;
  { const cw = vp[3] * bpos[0] + vp[7] * bpos[1] + vp[11] * bpos[2] + vp[15]; if (cw > 0.01) G.ballScr = { x: (vp[0] * bpos[0] + vp[4] * bpos[1] + vp[8] * bpos[2] + vp[12]) / cw * 0.5 + 0.5, y: 0.5 - (vp[1] * bpos[0] + vp[5] * bpos[1] + vp[9] * bpos[2] + vp[13]) / cw * 0.5, r: R / cw * 0.5 * h / Math.tan(0.45) / h }; }   // screen position and radius (as a fraction of screen height) for the 2D effects
  // attached objects: world = T(ball) * R * [lrot | lpos]
  for (const o of S.attached) {
    const an = S.info[o.n].anim, m = og.mods[an ? an.frames[Math.floor((o.aph || 0) + alpha * an.speed * 3) % an.frames.length] : o.model] || og.mods[o.model]; if (!m) continue;   // stuck monos animate at three times the speed (A59)
    const wr = KSim.mmul(S.R, o.lrot), wp = KSim.mvec(S.R, o.lpos);
    drawModel(og, m, objMat(wr, [bpos[0] + wp[0], bpos[1] + wp[1], bpos[2] + wp[2]]));
  }
  // prince, behind the ball (PLACEHOLDER P15: placement, scale, walk cycle order and which way the model faces are guesses)
  if (ou && S.diam < 100 && (cam.L === undefined || cam.L > R * 3.5)) {   // hidden if the clipped camera is right on top of it
    const yawI = prevYaw + (S.yaw - prevYaw) * alpha, m = ou.mods['GiOujiM' + (S.flipT > 0 ? 0 : [0, 1, 0, 2][ouji.pat % 4])], fx = Math.sin(yawI), fz = Math.cos(yawI);
    let off = KSim.tableParams(S).oujiZ; {   // distance behind the ball centre: the speed table's column 17 (f32OujiOffsetZ), not my R + 1.6 (A89)
      const t = KSim.rayHit(S, pos[0], pos[1] - R * 0.5, pos[2], -fx, 0, -fz, off + 1.5); if (t !== null) off = Math.max(R * 0.6, t - 1.5); }   // do not stand inside a wall behind the ball
    const c = Math.cos(yawI), sn = Math.sin(yawI), Ry = [-c,0,-sn, 0,1,0, sn,0,-c];    // rotY(yaw + 180 degrees), like the original's prince matrix (FUN_00025bf4): the model's -z face points along the roll direction (A81)
    const ppos = [pos[0] - fx * off, pos[1] - R, pos[2] - fz * off];
    if (S.flipT > 0) {   // quick turn (A66, A89): FUN_00026f24 puts him on a straight line over the ball along the heading the hop started with, from z0 behind to z0 in front, peak 2 x diameter high (sin of progress x pi)
      const t = Math.max(0, Math.min(1, 1 - (S.flipT - alpha) / S.flipN)), f0x = Math.sin(S.flipYaw0), f0z = Math.cos(S.flipYaw0), z0 = KSim.tableParams(S).oujiZ;
      ppos[0] = pos[0] + f0x * z0 * (2 * t - 1); ppos[2] = pos[2] + f0z * z0 * (2 * t - 1); ppos[1] += Math.sin(Math.PI * t) * 2 * S.diam; G.princeScr = true;
    }
    // lean into the roll and bob with each step (A63). The model faces -z, so a lean about its x axis tips the head forward
    const moving = S.speed > 0.05, lean = S.dash ? 0.28 : moving ? Math.min(0.1, S.speed * 0.03) : 0, ca = Math.cos(lean), sa = Math.sin(lean);
    const Rl = KSim.mmul(Ry, [1, 0, 0, 0, ca, -sa, 0, sa, ca]); ppos[1] += moving ? Math.abs(Math.sin((ouji.pat + ouji.t / 4) * Math.PI / 2)) * 0.12 : 0;
    bindGroup(ou); if (m) drawModel(ou, m, M.fromR3(Rl, ppos, 1));
  }
  // ball
  gl.bindBuffer(gl.ARRAY_BUFFER, ball.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ball.ibo);
  gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, 24);
  { const R0 = S.startDiam / 2, Rd = R0 + (R - R0) * 0.38;   // the core is drawn smaller than the physical ball: diameter = start + (d - start) * DispScaleRatio 0.38 (KatamariMain.cppi gYm_KatamariMakeScaleMatrix, drawn with mScaleDisp, A111)
    gl.uniformMatrix4fv(L.model, false, M.fromR3(S.R, bpos, Rd * (1 + 0.05 * pulse))); } gl.uniform1f(L.use, 1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ball.tex);
  gl.drawElements(gl.TRIANGLES, ball.n, gl.UNSIGNED_SHORT, 0);
}

// ---- HUD: original art (GAMEDATA / IMAGE .dat), layout is mine (PLACEHOLDER P16) ----
const hudc = $('hud'), hx = hudc.getContext('2d');
const IMGS = { SIZEB: 'ui/GAMEDT2x/GiSIZEB.png', SIZEF: 'ui/GAMEDT2x/GiSIZEF.png', NUMW: 'ui/GAMEDT2x/GiNUM_W.png', NUMO: 'ui/GAMEDT2x/GiNUM_O.png', TIMER: 'ui/GAMEDT2x/GiTIMER.png', PAD: 'ui/IMAGE/SYSPAD.png', PADC: 'ui/IMAGE/SYSPADC.png', FX1: 'ui/GAMEDT2x/GiFx01.png', FX3: 'ui/GAMEDT2x/GiFx03.png', MONO: 'ui/GAMEDT2x/GiMONO.png', TIMERH: 'ui/GAMEDT2x/GiTIMERH.png', EARTH: 'ui/GAMEDT2x/GiEARTH.png', OUJI: 'ui/GAMEDT2x/GiOUJI.png', HAND: 'ui/GAMEDT2x/GiHAND.png', FX2: 'ui/GAMEDT2x/GiFx02.png' };
async function loadUI(task) { await Promise.all(Object.entries(IMGS).map(async ([k, u]) => { try { UI[k] = await loadImage(u); } catch (e) { G.err.push(String(e)); } task && task.step(1); })); }
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
function fmtDiamHud(cm) {   // as the original shows it: 6cm4mm, 1m24cm1mm
  const t = Math.floor(cm * 10 + 1e-6), m = Math.floor(t / 1000), c = Math.floor((t % 1000) / 10), mm = t % 10;
  return m > 0 ? m + 'm' + String(c).padStart(2, '0') + 'cm' + mm + 'mm' : c > 0 ? c + 'cm' + mm + 'mm' : mm + 'mm';   // tester: 4.028632 m is 4m02cm8mm (A72)
}
function fmtDiam(cm) { return fmtDiamHud(cm); }
function drawHud() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = hudc.clientWidth, H = hudc.clientHeight;
  if (hudc.width !== Math.floor(W * dpr)) { hudc.width = Math.floor(W * dpr); hudc.height = Math.floor(H * dpr); }
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, W, H);
  if (!G.ready || !S) return;
  echoDraw(W, H);
  const gs = Math.max(120, Math.min(190, Math.min(W, H) * 0.3));
  // size gauge: green gear, rainbow fills outward from the corner as the ball grows toward the goal
  const prog = MODE === 'exact' ? 0 : Math.max(0, Math.min(1, (S.diam - S.startDiam) / (S.goal - S.startDiam)));
  if (UI.SIZEB) hx.drawImage(UI.SIZEB, 0, 0, gs, gs);
  if (UI.SIZEF) { hx.save(); hx.beginPath(); hx.moveTo(0, 0); hx.arc(0, 0, gs * (0.12 + 0.9 * prog), 0, Math.PI / 2); hx.closePath(); hx.clip(); hx.drawImage(UI.SIZEF, 0, 0, gs, gs); hx.restore(); }
  // size number
  const nh = gs * 0.26; if (MODE !== 'exact') { hx.save(); hx.shadowColor = '#000a'; hx.shadowBlur = 4; drawNum(fmtDiamHud(S.diam), 10, gs * 0.64, nh, 'NUMW'); hx.restore(); }   // Exact Size: the size is the puzzle, so it is not shown (tester)
  // goal marker text
  hx.fillStyle = '#fff'; hx.font = '12px system-ui, sans-serif'; hx.shadowColor = '#000'; hx.shadowBlur = 3; hx.fillText((S.targetLabel ? 'catch: ' + S.targetLabel + ' (' + fmtDiam(S.goal) + ')' : MODE === 'exact' ? 'make it ' + fmtDiam(S.goal) : 'goal ' + fmtDiam(S.goal)) + '   ' + S.picked + ' picked', 10, gs * 0.64 + nh + 18); hx.shadowBlur = 0;
  // timer, as in the original: minutes left in white beside a clock whose needle sweeps once a minute. The last minute turns red and counts seconds (A70)
  const inf = !isFinite(S.timeLimit), el = S.frame / KSim.FPS, left = inf ? el : Math.max(0, S.timeLimit - el), ts = Math.max(64, Math.min(96, Math.min(W, H) * 0.16)), tx = W - ts - 12, ty = 12;
  const lastMin = !inf && left < 60, face = lastMin ? UI.TIMERH : UI.TIMER;
  const showTimer = MODE !== 'exact' && MODE !== 'eternal';   // no clock in Exact Size and Eternal (tester)
  if (face && showTimer) hx.drawImage(face, tx, ty, ts, ts);
  if (showTimer) { const cx = tx + ts / 2, cy = ty + ts / 2, a = (el % 60) / 60 * Math.PI * 2, len = ts * 0.4, sx = Math.sin(a), sy = -Math.cos(a), px = -sy, py = sx, bw = ts * 0.045;
    hx.beginPath(); hx.moveTo(cx + sx * len, cy + sy * len); hx.lineTo(cx + px * bw, cy + py * bw); hx.lineTo(cx - px * bw, cy - py * bw); hx.closePath(); hx.fillStyle = '#fff'; hx.fill();
    hx.beginPath(); hx.arc(cx, cy, ts * 0.06, 0, Math.PI * 2); hx.fillStyle = '#fff'; hx.fill(); }
  if (showTimer) { const n = lastMin ? Math.ceil(left) : Math.floor(left / 60), str = String(Math.min(99, n)).padStart(2, '0'), sh = lastMin ? 'NUMO' : 'NUMW', nh2 = ts * 0.46;
    hx.save(); hx.globalAlpha = 0; const w = drawNum(str, 0, 0, nh2, sh); hx.restore();
    hx.save(); hx.shadowColor = '#0008'; hx.shadowBlur = 3; drawNum(str, tx - w - 8, ty + ts * 0.08, nh2, sh); hx.restore(); }
  // dash meter (placeholder look)
  if (S.dashCool > 0 || S.dashT > 0) { const f = S.dashCool > 0 ? 1 - S.dashCool / 240 : 1 - S.dashT / 240; hx.fillStyle = '#0006'; hx.fillRect(tx, ty + ts + 4, ts, 5); hx.fillStyle = S.dashCool > 0 ? '#888' : '#ffd24a'; hx.fillRect(tx, ty + ts + 4, ts * f, 5); }
  // last thing picked up: round tag with the object drawn in it and its name under it (the icon is the real model, drawn in draw() into iconCv)
  if (lastPick && UI.MONO) {
    const ms = ts * 0.98, mx = W - ms - 14, my = ty + ts + 16, r = ms * 0.36;
    hx.drawImage(UI.MONO, mx, my, ms, ms);
    hx.save(); hx.beginPath(); hx.arc(mx + ms / 2, my + ms / 2, r, 0, Math.PI * 2); hx.clip(); hx.drawImage(iconCv, mx + ms / 2 - r, my + ms / 2 - r, r * 2, r * 2); hx.restore();
    hx.save(); hx.font = `bold ${Math.round(ms * 0.19)}px system-ui, sans-serif`; hx.textAlign = 'right'; hx.fillStyle = '#fff'; hx.shadowColor = '#000'; hx.shadowBlur = 4; hx.fillText(lastPick.label, W - 8, my + ms + ms * 0.2); hx.restore();
  }
  // prince in the bottom right corner over the earth, like the original (GiOUJI frames: walk cycle, leaning when dashing)
  if (UI.EARTH && UI.OUJI) {
    const es = Math.max(120, Math.min(260, H * 0.3)); hx.drawImage(UI.EARTH, 32, 26, 126, 132, W - es * 126 / 132, H - es, es * 126 / 132, es);   // the picture's own edges sit on the screen corner
    const moving = S.speed > 0.05 && (Math.abs(S.input && S.input.L || 0) > 0.2 || Math.abs(S.input && S.input.R || 0) > 0.2), fr = S.dash ? (S.frame >> 2 & 1 ? 7 : 11) : moving ? [0, 1, 2, 3][ouji.pat % 4] : 0, ph = es * 0.66;
    const OX = [[24, 146, 268, 390], [20, 144, 267, 386], [22, 143, 265, 382]], OY = [12, 174, 335], rw = ph * 96 / 152;   // frame rectangles measured from the sheet
    hx.drawImage(UI.OUJI, OX[fr >> 2][fr & 3], OY[fr >> 2], 96, 152, W - rw - es * 0.04, H - ph - es * 0.02, rw, ph);
  }
  // touch stick: drawn where it is held, and parked at the lower left on touch screens while idle
  { const p = pads.S, coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches; if (p || coarse) { const ps = 150, bx = p ? p.ox : ps * 0.75 + 14, by = p ? p.oy : H - ps * 0.75 - 18;
    hx.save(); hx.globalAlpha = p ? 0.9 : 0.5; if (UI.PAD) hx.drawImage(UI.PAD, bx - ps / 2, by - ps / 2, ps, ps);
    let kx = 0, ky = 0; if (p) { kx = p.x - p.ox; ky = p.y - p.oy; const m = Math.hypot(kx, ky); if (m > PAD_R) { kx *= PAD_R / m; ky *= PAD_R / m; } kx *= 0.6; ky *= 0.6; }
    if (UI.PADC) hx.drawImage(UI.PADC, bx + kx - 32, by + ky - 32, 64, 64); hx.restore(); } }
}
let toast = null, resShown = false, dlgRes = null, failSnd = false, failN = 0;

// End of a run: the King comments in his own words (STRING.dat). The rules below are the original's own (FUN_00041520, A92)
function showResult() {
  resShown = true; const KT = window.KText; if (!KT) return; saveRecord(); saveAlbum();
  const elapsed = S.frame / KSim.FPS, v = { goal: S.targetLabel || '', time: KT.fmtTime(elapsed), size: fmtDiam(S.diam) }, mm = Math.floor(S.diam * 10 + 1e-6), mis = play.mis, par = (mis.time_limit_n || [])[0];
  let names;
  if (MODE === 'story') names = S.won ? [PACK === 2 && LOCAL === 0 ? '=STORY_RES002' : 'STORY_RES01', elapsed > par ? 'STORY_RES02' : 'STORY_RES03'] : ['STORY_FAIL'];   // caught it: the King tells the time, then judges it against the par time (TIME_LIMIT_1[0])
  else if (MODE === 'exact') { const e = exactErr(); names = [e === 0 ? 'SIZE_RES03' : e > mis.exact_tol_mm ? 'SIZE_RES02' : 'SIZE_RES01']; v.size = fmtDiam(e === 0 || e <= mis.exact_tol_mm ? S.diam : S.goal); }   // [SIZE] is the player's size in SIZE_RES03 and the target in SIZE_RES02 ("to make the katamari [SIZE]"); spot on / outside the tolerance / inside it (MISSION_DATA_EXT) / outside the tolerance / inside it (MISSION_DATA_EXT)
  else if (MODE === 'eternal') names = ['ETER_RES'];
  else names = ['TIME_RES01', mm < mis.ta_goal_mm ? 'TIME_RES02' : 'TIME_RES03'];   // time attack: under the stage's size threshold or not
  if (S.won) names.unshift({ story: 'STORY_END', timeattack: 'TIME_END', exact: 'SIZE_END', eternal: 'ETER_END' }[MODE], 'END_COM');   // the success path (FUN_00033544 > FUN_00033620) plays the mode's own two-line goodbye, then END_COM ("Royal Rainbow!", FUN_0004014c right after the goodbye) before the result; the failure path (FUN_0003342c) goes straight to STORY_FAIL (A93)
  const endN = S.won ? KT.pages([names[0], names[1]], v).length : 0, pages = KT.pages(names, v);
  $('res').style.display = 'block'; $('rRetry').style.display = $('rMenu').style.display = 'none';
  const done = () => { $('rRetry').style.display = $('rMenu').style.display = 'block'; };
  if (dlgRes) dlgRes.stop(); dlgRes = KT.dialog($('rDlg'), pages, done, i => { if (S.won && i === endN) KSnd.se('KD_SE_res_00'); });   // success: res_00 once the end dialog is over (A94)
  failSnd = !S.won; if (failSnd) { KSnd.se('KD_SE_over_01'); (function again() { if (!failSnd) return; setTimeout(() => { if (!failSnd) return; KSnd.se('KD_SE_over_00' + (failN++ % 2 ? '_2' : '')); again(); }, (KSim.FPS + Math.floor(Math.random() * 4 * KSim.FPS)) / KSim.FPS * 1000); })(); }   // failure: over_01, then over_00 / over_00_2 alternating every 1 to 5 s (FUN_0003342c, A94)
}
$('rRetry').onclick = () => { failSnd = false; restartUI(); }; $('rMenu').onclick = () => { failSnd = false; location.href = 'menu.html?screen=stage&pack=' + PACK + '&mode=' + MODE; };
if (window.KText) KText.fit($('rbox'));

// ---- dust kicked up by the ball (GiFx03, small soft puffs) and a "!" over the prince when things fall off (GiHAND is an exclamation mark, not a hand). Original sprites, my timing (A66) ----
const puffs = []; let bang = 0, airT = 0;
function addPuff(x, y, z, vx, vy, vz, size, life) { if (puffs.length < 90) puffs.push({ p: [x, y, z], v: [vx, vy, vz], s: size, t0: performance.now(), life }); }
function burst(n) { const R = KSim.radius(S); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283; addPuff(S.pos[0] + Math.cos(a) * R * 0.8, S.pos[1] - R * 0.9, S.pos[2] + Math.sin(a) * R * 0.8, Math.cos(a) * R * 1.2, R * 0.5 + Math.random() * R * 0.4, Math.sin(a) * R * 1.2, R * (0.35 + Math.random() * 0.25), 500 + Math.random() * 300); } }
function spawnDust(over) {
  if (!S || over) return; const R = KSim.radius(S), sp = S.speed, vmax = KSim.tableParams(S).speed;
  if (S.cw && S.cw.on) { airT = 0; return; }                              // wall climb: no landing puff
  if (!S.grounded) { airT++; return; }
  if (airT > 6) { burst(Math.min(14, 4 + airT / 3)); KSnd.se('KD_SE_game_07'); } airT = 0;   // landing after a fall or a ramp. The engine sets LandingSe when the fly time reaches 0.1 of 70 frames, i.e. 7 frames, and plays id 0x0d = game_07 (A101)
  if (sp < vmax * 0.5) return;
  const k = Math.min(1, (sp / vmax - 0.5) / 1.2) * (S.dash ? 1.6 : 0.8); if (Math.random() > k) return;
  const dx = S.v[0] / sp, dz = S.v[1] / sp, side = (Math.random() - 0.5) * R;
  addPuff(S.pos[0] - dx * R * 0.7 - dz * side, S.pos[1] - R * 0.95, S.pos[2] - dz * R * 0.7 + dx * side, -dx * sp * 8 + (Math.random() - 0.5) * R, R * 0.35, -dz * sp * 8 + (Math.random() - 0.5) * R, R * (0.25 + Math.random() * 0.2), 450 + Math.random() * 300);
}
function projPt(x, y, z) { const m = G.vp; if (!m) return null; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; if (w < 0.05) return null; return { x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5, y: 0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5, w }; }
function drawPuffs(W, H, now) {
  if (!UI.FX3) return;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const q = puffs[i], age = now - q.t0; if (age >= q.life) { puffs.splice(i, 1); continue; }
    const dt = last_dt || 0.016; q.v[1] -= 0.5 * dt * KSim.radius(S) * 4; for (let k = 0; k < 3; k++) q.p[k] += q.v[k] * dt; q.v[0] *= 0.96; q.v[2] *= 0.96;
    const f = age / q.life, a = projPt(q.p[0], q.p[1], q.p[2]), b = projPt(q.p[0], q.p[1] + q.s * (1 + f), q.p[2]); if (!a || !b) continue;
    const sz = Math.abs(b.y - a.y) * H * 1.3; if (sz < 1) continue;
    hx.save(); hx.globalAlpha = 0.55 * (1 - f) * Math.min(1, f * 8); hx.drawImage(UI.FX3, 0, 0, 32, 32, a.x * W - sz / 2, a.y * H - sz / 2, sz, sz); hx.restore();
  }
}
function drawBang(W, H, now) {
  const age = now - bang; if (!UI.HAND || age > 900) return; const sc = G.ballScr; if (!sc) return;
  const k = Math.min(1, age / 140), pop = k < 1 ? 1 + 0.4 * Math.sin(k * Math.PI) : 1, fade = age > 650 ? 1 - (age - 650) / 250 : 1;
  const h = H * 0.12 * pop, w = h * 24 / 76, bob = Math.sin(age / 90) * H * 0.006;
  hx.save(); hx.globalAlpha = fade; hx.shadowColor = '#0008'; hx.shadowBlur = 6;
  hx.drawImage(UI.HAND, 0, 0, 24, 76, sc.x * W - w / 2, (sc.y - sc.r) * H - h * 1.05 + bob, w, h); hx.restore();
}
// ---- effects on the 2D layer: speed lines while dashing (GiFx01), a ring when something sticks (GiFx02). Original sprites, my timing (A63) ----
const rings = []; let fxDash = 0;
function drawFx() {
  const sc = G.ballScr, W = hudc.width, H = hudc.height, now = performance.now(), over = S.won || lost;
  fxDash = (S.dash && !over && S.speed > 0.1) ? Math.min(1, fxDash + 0.12) : Math.max(0, fxDash - 0.08);
  if (fxDash > 0 && UI.FX1) {
    hx.save(); hx.globalAlpha = 0.5 * fxDash;
    for (let k = 0; k < 16; k++) {
      const side = k % 2 ? 1 : -1, spread = ((k * 0.6180339) % 1) * 0.26, x = 0.5 + side * (0.26 + spread) , ph = ((now / 260 + k * 0.37) % 1), y = ph * 1.3 - 0.15, len = H * (0.22 + 0.1 * ((k * 0.37) % 1));
      hx.drawImage(UI.FX1, 0, 0, 32, 32, x * W - W * 0.01, y * H - len / 2, W * 0.02, len);
    }
    hx.restore();
  }
  drawPuffs(W, H, now); drawBang(W, H, now);
  if (sc && UI.FX2) for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i], p = (now - r.t0) / 420; if (p >= 1) { rings.splice(i, 1); continue; }
    const sz = H * sc.r * 2 * (1.05 + 0.9 * p); hx.save(); hx.globalAlpha = 0.75 * (1 - p); hx.globalCompositeOperation = 'lighter';
    hx.drawImage(UI.FX2, 0, 0, 64, 64, sc.x * W - sz / 2, sc.y * H - sz / 2, sz, sz); hx.restore();
  }
}
function hud() {
  drawHud();
  if (S && G.ready) drawFx();
  if (!S) return;
  if (toast) { const cv = $('hud'), x = cv.getContext('2d'), a = Math.min(1, toast.t / 30); x.save(); x.globalAlpha = a; x.font = `bold ${Math.round(cv.height * 0.035)}px sans-serif`; x.textAlign = 'center'; x.shadowColor = '#000c'; x.shadowBlur = 6; x.fillStyle = '#fff'; toast.text.split('\n').forEach((ln, k) => x.fillText(ln, cv.width / 2, cv.height * (0.2 + 0.045 * k))); x.restore(); toast.t--; if (toast.t <= 0) toast = null; }
  if ((S.won || lost) && !resShown) showResult();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!G.ready) return;
  const dt = Math.min((now - last) / 1000, 0.25); last = now; last_dt = dt;
  if (paused) { acc = 0; return; }
  acc += dt; const stepDt = 1 / KSim.FPS;
  const inp = readInput();
  let n = 0;
  while (acc >= stepDt && n < 5) {
    prevPos = S.pos.slice(); prevYaw = S.yaw;
    const over = S.won || lost;
    KSim.step(S, over ? { L: 0, R: 0 } : inp); camStep();
    let gotPick = false;
    for (const ev of S.events) { if (ev.type === 'spin') KSnd.se('KD_SE_game_09'); else if (ev.type === 'dash') KSnd.se('KD_SE_game_10'); }   // SND_SE_SPIN (id 15) on the stroke that starts the wheel spin, SND_SE_DASH (id 16) on the one that starts the dash (OujiDash.cppi, A101, A120)
    for (const ev of S.events) {                                             // sound cues (guesses: ASSUMPTIONS P23)
      if (ev.type === 'pickup') gotPick = true;
      if (ev.type === 'pickup') collect(ev.name);
      if (ev.type === 'pickup') { const i = S.info[ev.name]; if (i) lastPick = { label: i.label || ev.name, info: i }; }
      if (ev.type === 'pickup') { pulse = Math.min(1, pulse + 0.6); if (rings.length < 6) rings.push({ t0: performance.now() }); }   // the core pops out a little when something sticks (A61)
      if (ev.type === 'pickup') { const i = S.info[ev.name], cs = i && i.catch_se; if (cs) { const f = catchSeFile(STAGE, cs[2]); activeCatch = { se: f, every: cs[4] || 300, next: S.frame + (cs[4] || 300) }; if (f) KSnd.se('KD2_SE_mono_' + String(f).padStart(2, '0')); } }   // requestMonoSe at the catch, then catchSE every N frames while it is the active one (A53)
      else if (ev.type === 'crush') KSnd.se(S.diam * 10 < 1000 ? 'KD_SE_game_03' : 'KD_SE_game_04');   // reqCrush (FUN_00045cb8): id 9 under 1 m, id 10 from 1 m (A99, A100)
      else if (ev.type === 'crumble') { KSnd.se(S.diam * 10 < 1000 ? 'KD_SE_game_05' : 'KD_SE_game_06'); bang = performance.now(); }   // reqCrumble (FUN_00045cf4): id 11 under 1 m, 12 from 1 m (A99)
      else if (ev.type === 'flip') { KSnd.se('KD_SE_game_13'); burst(10); }   // Jump180 start plays sound id 0x13 = game_13 (FUN_00025e30, A101)
      else if (ev.type === 'brake') KSnd.se('KD_SE_game_12');   // SND_SE_BRAKE = id 0x12 = game_12 (FUN_0001ee7c, A101)
      else if (ev.type === 'won') { KSnd.stopBgm(); KSnd.se('KD_SE_game_20'); }   // end of a successful run: the end whistle (id 0x51 = game_20); res_00 comes after the King's end dialog (A94)
    }
    if (gotPick) KSnd.se('KD_SE_game_0' + Math.floor(Math.random() * 3));   // MonoHit: when anything was picked up this frame, one of SND_SE_CATCH0..2 (ids 6 to 8 = game_00 to game_02) at random (A99)
    if (activeCatch && !over && S.frame >= activeCatch.next) { if (activeCatch.se) KSnd.se('KD2_SE_mono_' + String(activeCatch.se).padStart(2, '0')); activeCatch.next = S.frame + activeCatch.every; }   // the original repeats the object's own sound every N frames while it sits on the ball (MonoMain catchSE)
    if (S.events.some(e => e.type === 'recover')) { prevPos = S.pos.slice(); prevYaw = S.yaw; cam.yaw = S.yaw; cam.ready = false; toast = { t: 2 * KSim.FPS, text: 'Back on the map' }; }   // fell out of the map: respawn at the recover point (A56)
    if (!over && isFinite(S.timeLimit) && S.timeLimit * KSim.FPS - S.frame <= 30 * KSim.FPS && S.frame % KSim.FPS === 0) KSnd.se('KD_SE_game_19');   // last 30 seconds: a 1 s sound (id 0x19, game_19) is restarted whenever it is not playing (A94)
    if (isFinite(S.timeLimit) && S.timeLimit > 60 && S.frame === Math.round((S.timeLimit - 60) * KSim.FPS) && window.KText) toast = { t: 2.5 * KSim.FPS, text: KText.clean(KText.group('REMAIN_1MIN')[0]) };   // "1 minute remaining", from FUN_00024xxx: shown when the remaining-frames counter hits 60 s (A93)
    if (!over && S.frame / KSim.FPS >= S.timeLimit) { if (MODE === 'timeattack') { S.won = true; KSnd.stopBgm(); KSnd.se('KD_SE_game_20'); } else { lost = true; KSnd.stopBgm(); } }   // time attack: running out the clock is how the run ends (sCheckTime), story: failed (A92)
    // prince walk cycle: advances while there is stick input (4 frames per pose, 2 when dashing)
    if (!over && (Math.abs(inp.L) > 0.2 || Math.abs(inp.R) > 0.2)) { ouji.t += S.dash ? 2 : 1; if (ouji.t >= 4) { ouji.t = 0; ouji.pat = (ouji.pat + 1) % 4; } } else if (ouji.t === 0) ouji.pat = 0;
    spawnDust(over);
    acc -= stepDt; n++; G.frames++;
  }
  if (n === 5) acc = 0;
  draw(Math.min(acc / stepDt, 1)); echoCapture();
  hud();
}

(async function init() {
  const task = window.KLoad ? KLoad.begin('Loading stage', { expect: 8, cover: true }) : NOLOAD;
  try {
    play = await (await fetch(`data/${STAGE}/play.json?v=38`)).json(); task.step(2); if (window.KText && !(window.__noText)) { try { await KText.load(); KText.setPack(PACK); if (KText.lang !== 'en') { const nm = await (await fetch(`data/${STAGE}/names_${KText.lang}.json?v=38`)).json(); for (const k in nm) if (play.info[k]) play.info[k].label = nm[k]; } }   // object names in the chosen language (MONONAME.dat, A95)
         catch (e) { G.err.push('text ' + e.message); } } task.step(1);
    mg = await loadGroup(STAGE, 'map', task); og = await loadGroup(STAGE, 'obj', task);
    try { const cg = await loadGroup('common', 'core', task); ball = makeBallCore(cg, parseInt(STAGE.slice(1), 10)); } catch (e) { G.err.push('core ' + e); ball = makeBall(); }
    try { ou = await loadGroup('common', 'ouji', task); } catch (e) { G.err.push('ouji ' + e); }
    task.grow(Object.keys(IMGS).length); await loadUI(task);
    task.label('Setting up the stage'); task.grow(3); await new Promise(r => setTimeout(r, 30)); task.step(1);   // let the bar paint before the blocking part
    restart(); task.step(2); G.ready = true; $('load').style.display = 'none';
  } catch (e) { G.err.push(String(e)); $('load').textContent = 'load failed: ' + e; }
  task.end();
  requestAnimationFrame(t => { last = t; frame(t); });
})();

// ---- pause menu and tester report ----
// The catch rule is the one open question that changes the stage 1 feel (A48), so testers can flip it here. It reloads the page with ?catch=goal or without it.
function setPause(on) {
  if (S && (S.won || lost)) on = false;
  paused = on; $('pStop').style.display = MODE === 'exact' ? 'block' : 'none'; $('pQuit').style.display = MODE === 'eternal' ? 'block' : 'none'; resetConfirms(); $('pause').style.display = on ? 'flex' : 'none'; $('pText').style.display = 'none'; $('pNote').textContent = '';
  if (on) { const cm = qs.get('catch') === 'f0'; $('pCatch').textContent = 'Catch size: ' + (cm ? 'old guess (first monolist float)' : 'from the engine formula (default)') + ' (tap to switch)'; }
}
function reportText() {
  const now = performance.now(); const fps = Math.round(1000 / Math.max(1, last_dt * 1000));
  return ['Katamari Amore web port report', 'url: ' + location.href, 'stage: ' + STAGE + '  mode: ' + MODE + '  catch: ' + (qs.get('catch') || 'default'),
    'time: ' + (S.frame / KSim.FPS).toFixed(1) + ' s of ' + (S.timeLimit === Infinity ? 'no limit' : S.timeLimit) + '  diameter: ' + fmtDiam(S.diam) + '  goal: ' + fmtDiam(S.goal),
    'picked: ' + S.picked + '  layer: ' + S.layer + '  pos: ' + S.pos.map(v => v.toFixed(1)).join(', ') + '  target: ' + (S.targetLabel || 'none'),
    'fps ~' + fps + '  window: ' + innerWidth + 'x' + innerHeight + '  touch: ' + ('ontouchstart' in window), 'ua: ' + navigator.userAgent, '', 'what happened: '].join('\n');
}
$('bStop').style.display = MODE === 'exact' || MODE === 'eternal' ? 'block' : 'none'; $('bStop').textContent = MODE === 'exact' ? 'Stop with this size' : 'Stop rolling';   // a visible way to end Exact Size and Eternal, under the size gauge (tester); it asks the same question as the pause menu (A93)
$('bStop').onclick = () => { setPause(true); $(MODE === 'exact' ? 'pStop' : 'pQuit').onclick(); };
$('bPause').onclick = () => setPause(true); $('pResume').onclick = () => setPause(false);
// Restart, quit and the two ways of ending a run ask the question from the original's PAUSE_MENU strings first: 0 exit to the menu, 1 exact size, 2 eternal, 3 restart (A93). Second tap = yes. The yes/no buttons themselves are mine
const CONFIRMS = [['pMenu', 0, 'Back to stages', () => { location.href = 'menu.html?screen=stage&pack=' + PACK + '&mode=' + MODE; }], ['pRestart', 3, 'Restart', () => { setPause(false); restartUI(); }],
  ['pStop', 1, 'Stop with this size', () => { paused = false; $('pause').style.display = 'none'; S.won = true; KSnd.stopBgm(); KSnd.se('KD_SE_game_20'); }], ['pQuit', 2, 'Finish Eternal mode', () => { paused = false; $('pause').style.display = 'none'; S.won = true; KSnd.stopBgm(); KSnd.se('KD_SE_game_20'); }]];
let armed = null;
function resetConfirms() { armed = null; for (const [id, , label] of CONFIRMS) $(id).textContent = label; $('pNote').textContent = ''; }
for (const [id, q, label, go] of CONFIRMS) $(id).onclick = () => {
  if (armed !== id) { resetConfirms(); armed = id; const t = window.KText ? KText.group('PAUSE_MENU')[q] : label + '?'; $(id).textContent = 'Yes: ' + label; $('pNote').textContent = t + '  (tap the button again to confirm)'; return; }
  go();
};
const syncSet = () => { $('pLight').textContent = 'Lighting: ' + LIGHTS[SET.light][0]; $('pTex').textContent = 'Textures: ' + FILTERS[SET.filter]; };
$('pLight').onclick = () => { SET.light = (SET.light + 1) % LIGHTS.length; saveSet(); syncSet(); };
$('pTex').onclick = () => { SET.filter = (SET.filter + 1) % FILTERS.length; saveSet(); applyFilter(); syncSet(); };
syncSet();
$('pCatch').onclick = () => { const u = new URL(location.href); if (qs.get('catch') === 'f0') u.searchParams.delete('catch'); else u.searchParams.set('catch', 'f0'); location.href = u.toString(); };
$('pReport').onclick = () => { const t = $('pText'); t.value = reportText(); t.style.display = 'block'; t.focus(); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} try { if (navigator.clipboard) navigator.clipboard.writeText(t.value).catch(() => {}); ok = true; } catch (e) {} $('pNote').textContent = (ok ? 'Copied. ' : 'Select and copy this. ') + 'Paste it into a message and add what went wrong.'; };
document.addEventListener('visibilitychange', () => { if (document.hidden && S && !S.won && !lost) setPause(true); });


// ---- achievements, mini-game items and the album (MonoHit.cppi, A114) ----
// Picking up a mono whose id STARTS WITH one of the pack's 14 achievement ids (strncmp on the id's length) for the first time shows ACHIEVEMENT; the pack's own extra id (PACMAN, TEKKENKUMA, GALAGA) shows UNLOCK_EX once.
// The ids and their order are the strings in the binary (AchievementIDs; 14 per pack, the last being COMPLETEPACKn which is not a pickup). The original gates the achievement on Game Center and shows the King's dialog; the port shows the same text as a banner and keeps the state in localStorage
const ACH_IDS = [['CARD', 'CHECKBOARD', 'SKULL', 'MANTANKEN_D', 'SALE', 'COFFIN', 'CHINAMENU', 'KIRIN', 'SPACEDOG', 'CHAKURIKU', 'GRANGE', 'SEADRA', 'BERRY'],
  ['MASCOT', 'MONOCYCLE', 'MANHOLE', 'OBELISK', 'BEEFBONE', 'BIGMONEY', 'REDBEANS', 'SHERIFF', 'ROSETTA', 'SHIP06', 'TAXFREE', 'COLTOWER', 'FISH04_D'],
  ['GREETING', 'PICTUREBOOK', 'TOOTHFAIRY', 'MANBALLOON_D', 'WOLFMAN', 'JACK02', 'GUARD', 'TABLESOCCER', 'HOTDOGSHOP', 'TURKEY', 'GASBAG', 'CHERRY', 'BOSSGALAGA']], EXTRA_ID = ['PACMAN', 'TEKKENKUMA', 'GALAGA'];
const runItems = {};                                        // what is stuck on the ball this run, by label (the album keeps it when the stage is cleared)
function colLoad() { try { const c = JSON.parse(localStorage.getItem('kam_col') || '{}'); c.ach = c.ach || {}; c.extra = c.extra || [0, 0, 0]; c.alb = c.alb || {}; return c; } catch (e) { return { ach: {}, extra: [0, 0, 0], alb: {} }; } }
function colSave(c) { try { localStorage.setItem('kam_col', JSON.stringify(c)); } catch (e) {} }
function collect(name) {
  const inf = S.info[name], lab = (inf && inf.label) || name; runItems[lab] = (runItems[lab] || 0) + 1;
  const KT = window.KText; if (!KT) return; const c = colLoad(); let msg = null;
  if (name.startsWith(EXTRA_ID[PACK - 1]) && !c.extra[PACK - 1]) { c.extra[PACK - 1] = 1; msg = KT.clean(KT.group('UNLOCK_EX')[0] || ''); }
  for (const id of ACH_IDS[PACK - 1]) { if (!name.startsWith(id) || c.ach[id]) continue; if (id === 'GUARD' && STAGE_N !== 18) continue;   // index 34 only counts in stage 17 (0-based), as the original does
    c.ach[id] = 1; if (!msg) msg = KT.clean(KT.group('ACHIEVEMENT')[0] || ''); }
  if (msg) { colSave(c); toast = { t: 4 * KSim.FPS, text: msg }; }
}
function saveAlbum() { if (!S.won) return;   // every mode counts: the result builder (FUN_00040e20) calls the album update (FUN_000413b4) whatever the mode (A127). Whether a failed Story run counts is not known, so only finished runs are kept
  const c = colLoad(), a = c.alb[STAGE] = c.alb[STAGE] || {}; for (const k in runItems) a[k] = Math.max(a[k] || 0, runItems[k]); colSave(c); }

// ---- records (localStorage, per stage and mode): best clear time for story, biggest ball for the other two ----
function saveRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem('kam_rec') || '{}'), r = rec[STAGE] = rec[STAGE] || {}, el = S.frame / KSim.FPS;
    if (MODE === 'story') { if (S.won && (!r.story || el < r.story)) { r.story = +el.toFixed(1); r.newBest = true; } r.cleared = r.cleared || !!S.won; }
    else if (MODE === 'exact') { const e = exactErr(); if (r.exactMm === undefined || e < r.exactMm) { r.exactMm = e; r.newBest = true; } }
    else { const k = MODE; if (!r[k] || S.diam > r[k]) { r[k] = +S.diam.toFixed(1); r.newBest = true; } }
    localStorage.setItem('kam_rec', JSON.stringify(rec)); return r.newBest;
  } catch (e) { return false; }
}

// ---- exact size mode ----
// Roll to the target size, then "Stop with this size" in the pause menu (the King's own line asks for it). Target and tolerance come from the stage's MISSION_DATA_EXT (A91).
function exactErr() { return Math.abs(Math.floor(S.diam * 10 + 1e-6) - play.mis.exact_mm); }   // whole mm away from the target
