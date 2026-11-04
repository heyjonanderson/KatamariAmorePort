// Smoke test for game.js under a mocked DOM and WebGL (no real browser here, see C1). Checks it loads, steps, draws without throwing.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const K = require(path.join(root, 'sim.js'));
// 1. sim rotation vs the viewer's placement matrix
const M = { rx(d){const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];}, ry(d){const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1];}, rz(d){const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1];},
  mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;} };
const play = JSON.parse(fs.readFileSync(path.join(root, 'data/S001/play.json')));
let worst = 0;
for (const o of play.objs.slice(0, 300)) {
  const [rx, ry, rz] = o.r; const V = M.mul(M.ry(-ry), M.mul(M.rx(-rx), M.rz(rz)));
  // note: play.json r holds raw logic angles; viewer negates rx, ry itself
  const R3 = K.eulerView(rx, ry, rz);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(V[c*4+r] - R3[r*3+c]));
}
console.log('rotation mismatch sim vs viewer matrix (max abs):', worst.toExponential(2));
if (worst > 1e-6) { console.log('FAIL rotation'); process.exit(1); }
// 2. page smoke
const calls = {};
const glp = new Proxy({}, { get: (t, k) => { if (k in t) return t[k]; return (...a) => { calls[k] = (calls[k] || 0) + 1; if (/^get(Shader|Program)Parameter$/.test(k)) return true; if (/^(create|get)/.test(k) && !/Info/.test(k)) return {}; return undefined; }; } });
const el = () => { const e = { style: {}, dataset: {}, textContent: '', clientWidth: 800, clientHeight: 600, width: 0, height: 0, firstElementChild: null, children: [],
  getContext: () => new Proxy({}, { get: (tg, k) => (k in tg ? tg[k] : () => undefined), set: (tg, k, v) => { tg[k] = v; return true; } }), addEventListener() {}, setPointerCapture() {}, appendChild() {}, set onclick(f) {} }; return e; };
const els = {}; const canvas = el(); canvas.getContext = () => glp;
const doc = { getElementById: id => id === 'c' ? canvas : (els[id] = els[id] || (() => { const e = el(); e.firstElementChild = el(); return e; })()), createElement: () => { const e = el(); return e; }, addEventListener() {}, hidden: false };
let raf = null; const listeners = {};
const ctx = { document: doc, window: null, console, Math, Promise, Float32Array, Uint16Array, Array, Object, Set, Map, JSON, URLSearchParams, Error, Number, String, isFinite,
  location: { search: process.env.QS || '' }, requestAnimationFrame: f => { raf = f; return 1; }, devicePixelRatio: 1,
  fetch: async url => { const p = path.join(root, url.split('?')[0]); if (!fs.existsSync(p)) throw new Error('404 ' + url); const buf = fs.readFileSync(p); return { json: async () => JSON.parse(buf), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; },
  Image: class { set src(v) { this.width = 64; this.height = 64; setTimeout(() => this.onload(), 0); } } };
ctx.window = ctx; ctx.window.addEventListener = (n, f) => { listeners[n] = f; }; ctx.window.innerWidth = 800;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'sim.js'), 'utf8'), ctx);
// gl constants used as props on the proxy return functions; make them numbers
for (const k of ['VERTEX_SHADER','FRAGMENT_SHADER','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','TEXTURE_2D','RGBA','UNSIGNED_BYTE','UNSIGNED_SHORT','FLOAT','TRIANGLES','TEXTURE0','LINEAR','LINEAR_MIPMAP_LINEAR','REPEAT','CLAMP_TO_EDGE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','UNPACK_FLIP_Y_WEBGL','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','DEPTH_TEST','COMPILE_STATUS','LINK_STATUS']) glp[k] = 1;
vm.runInContext(fs.readFileSync(path.join(root, 'game.js'), 'utf8'), ctx);
(async () => {
  for (let i = 0; i < 100 && !(ctx.window.__kg && ctx.window.__kg.ready); i++) await new Promise(r => setTimeout(r, 20));
  const g = ctx.window.__kg; if (!g.ready) { console.log('FAIL not ready', g.err); process.exit(1); }
  listeners.keydown && listeners.keydown({ code: 'ArrowUp', preventDefault() {} }); listeners.keydown && listeners.keydown({ code: 'ShiftLeft', preventDefault() {} });
  let t = 0; for (let i = 0; i < 300; i++) { t += 16.7; raf(t); }
  const S = g.S; const nan = S.pos.some(v => !isFinite(v));
  console.log('frames stepped', g.frames, 'pos', S.pos.map(v => v.toFixed(1)).join(','), 'speed', S.speed.toFixed(2), 'drawElements calls', calls.drawElements, 'tris/frame', g.tris, 'errors', JSON.stringify(g.err));
  if (nan || g.err.length || !calls.drawElements || g.frames < 100) { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
})();
