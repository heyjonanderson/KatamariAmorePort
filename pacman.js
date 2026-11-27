// Pac-Man extra stage (S007): the ghost walk, the eyes' way home, the frightened timer, the hit rule and the scoring, ported from the binary (A160).
// Function addresses are for k2_armv7 (iOS Katamari Amore 1.3.2). The maze is data/S007/maze.json (nodes 0x786d0, edges 0x89894).
// Units: cm, 30 frames a second. Node z is the NEGATIVE of the world z (FUN_00050284 stores -z).
(function (root) {
  const FPS = 30;
  const PTS = [10, 100, 800, 800, 800, 800, 800];   // 0x89878: COCKIE, PCOCKIE, CHERRY, BERRY, ORANGE, APPLE, MELON (FUN_0005054c adds the entry matching the picked object)
  const NAMES = ['COCKIE', 'PCOCKIE', 'CHERRY', 'BERRY', 'ORANGE', 'APPLE', 'MELON'];
  const BONUS0 = 200, BONUS_MAX = 6400;               // FUN_0005011c: monsterScore += bonus, bonus = min(bonus * 2, 0x1900); FUN_00050698 resets it to 200 when the timer runs out
  const FRIGHT = 20 * FPS, STUN = 3 * FPS, HIT_DIST = 10, TUNNEL = 148;
  const T = Math.trunc;

  function create(maze, seed) {
    let s = (seed >>> 0) || 1;
    const rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const P = { maze, rng, fright: 0, stun: 0, bonus: BONUS0, score: 0, mscore: 0, cookies: 0, ghosts: [], pel: [false, false, false, false], blinkOff: false };
    for (let i = 0; i < 4; i++) P.ghosts.push({ st: 0, edge: 0x57, dir: 1, prog: i * 0.33 });   // FUN_00051234: state 0, edge 0x57, dirbit 1, progress = index * 0.33
    return P;
  }
  const nodeX = (m, n) => m.nodes[n][0], nodeZ = (m, n) => m.nodes[n][1];
  function edgeLen(m, e) { const a = m.edges[e][0], b = m.edges[e][1]; return Math.abs(T(nodeX(m, b) - nodeX(m, a))) + Math.abs(T(nodeZ(m, b) - nodeZ(m, a))); }   // FUN_0005129c: |dx| + |dz| as truncated ints
  const endNode = (m, g) => m.edges[g.edge][g.dir ? 1 : 0];                                                                                              // dirbit 1 heads to the second node (FUN_00050ef8, FUN_00050fc0)
  function lerp(m, g, p) {                                                                                                                                 // FUN_00050e9c; p is not clamped
    const e = m.edges[g.edge], a = g.dir ? e[0] : e[1], b = g.dir ? e[1] : e[0];
    return { x: nodeX(m, a) + (nodeX(m, b) - nodeX(m, a)) * p, z: nodeZ(m, a) + (nodeZ(m, b) - nodeZ(m, a)) * p };
  }
  function angle(m, g) {                                                                                                                                   // end of FUN_0005129c: |dz| < |dx| turns by (pi/2, 3pi/2), else (pi, 0); the second of each pair when dirbit is 1
    const e = m.edges[g.edge], dx = Math.abs(T(nodeX(m, e[1]) - nodeX(m, e[0]))), dz = Math.abs(T(nodeZ(m, e[1]) - nodeZ(m, e[0])));
    const t = dz < dx ? [Math.PI / 2, 3 * Math.PI / 2] : [Math.PI, 0]; return t[g.dir ? 1 : 0];
  }
  function pose(P, g) { const q = lerp(P.maze, g, g.prog); return { x: q.x, z: q.z, ang: angle(P.maze, g) }; }
  // FUN_00050ef8: at the end of an edge a walking ghost takes a random one of the other edges (at most 4, in table order) that share the node. A dead end turns it round
  function walkNext(P, g) {
    const m = P.maze, node = endNode(m, g), c = [];
    for (let k = 0; k < m.edges.length; k++) if (k !== g.edge && (m.edges[k][0] === node || m.edges[k][1] === node) && c.length < 4) c.push(k);
    if (c.length > 0) g.edge = c[Math.floor(P.rng() * c.length)];
    g.dir = node === m.edges[g.edge][0] ? 1 : 0;
  }
  // FUN_00050fc0: the edge that ends (modes 0, 2) or starts (1, 3) at the node and runs along z (0, 1) or along x (2, 3); a run shorter than 1 cm does not count
  function findEdge(m, node, mode) {
    for (let k = 0; k < m.edges.length; k++) {
      const a = m.edges[k][0], b = m.edges[k][1];
      if (mode === 2 ? b !== node : mode === 3 ? a !== node : mode === 1 ? a !== node : b !== node) continue;
      const d = mode >= 2 ? nodeX(m, a) - nodeX(m, b) : nodeZ(m, a) - nodeZ(m, b);
      if (Math.abs(T(d)) >= 1) return k;
    }
    return -1;
  }
  // FUN_00051060: where the eyes go next. Returns 0 when they reach the house (node 0x40 or 0x41), else 1 with edge and direction set
  function eyesNext(P, g, x, z) {
    const m = P.maze, n = endNode(m, g), set = (e, d) => { g.edge = e; g.dir = d; return 1; };
    if (n === 0x40 || n === 0x41) return 0;
    if (n === 0x42) return set(0x56, 1);
    if (n === 0x43) return set(0x57, 0);
    switch (n) {
      case 8: return set(0x13, 1); case 9: return set(0xc, 0); case 10: return set(0xe, 1); case 0xb: return set(0x14, 1);
      case 0x16: case 0x1a: return set(findEdge(m, n, 3), 1);
      case 0x17: return set(0x54, 1); case 0x18: return set(0x55, 1);
      case 0x19: case 0x1d: return set(findEdge(m, n, 2), 0);
    }
    g.edge = -1; let k = -1;
    if (Math.abs(T(z + 39.60052490234375)) >= 1) k = findEdge(m, n, z < -39.60052490234375 ? 1 : 0);   // the first choice runs along z, toward the house row z = -39.6
    if (k < 0) { k = findEdge(m, n, x < 0 ? 3 : 2); if (k < 0) k = findEdge(m, n, x < 0 ? 2 : 3); }
    if (k < 0) { g.edge = 0x57; g.dir = 1; return 0; }
    g.edge = k; g.dir = n === m.edges[k][0] ? 1 : 0; return 1;
  }
  // FUN_0005129c: one frame. State 0 walks at 0.8 / length, state 1 (frightened) at 0.5333 / length, state 2 (eyes) at 2.0 / length. Returns 'home' when eyes arrive
  function stepGhost(P, g) {
    const m = P.maze, L = edgeLen(m, g.edge), base = 0.1 / L; let ev = null;
    g.prog += g.st === 0 ? base * 8 : g.st === 1 ? base * 8 * (2 / 3) : base * 20;
    if (g.prog >= 1) {
      if (g.st !== 2) walkNext(P, g);
      else {
        const q = lerp(m, g, g.prog);
        if (!eyesNext(P, g, q.x, q.z)) { g.st = 0; g.edge = 0x57; g.dir = 1; ev = 'home'; }
      }
      g.prog = 0;
    }
    return ev;
  }
  // FUN_00050228: a ghost in state 0 within 10 cm (3D) of the ball turns round (FUN_00051278) and hurts
  function touch(P, i, ball, ghostPos) {
    const g = P.ghosts[i]; if (g.st !== 0) return false;
    if (Math.hypot(ball[0] - ghostPos[0], ball[1] - ghostPos[1], ball[2] - ghostPos[2]) >= HIT_DIST) return false;
    g.dir = g.dir ? 0 : 1; g.prog = 1 - g.prog; return true;
  }
  // FUN_000502c4: which of the 16 ghost objects are shown. Index i (red, blue, orange, pink), 4 + i frightened, 8 + i frightened and flashing (last 5 s), 12 + i eyes
  function shown(P) {
    const v = new Array(16).fill(false), flash = P.fright <= 5 * FPS;
    for (let i = 0; i < 4; i++) { const st = P.ghosts[i].st; v[i] = st === 0; v[4 + i] = !flash && st === 1; v[8 + i] = flash && st === 1; v[12 + i] = st === 2; }
    return v;
  }
  function eat(P) { const b = P.bonus; P.mscore += b; P.bonus = Math.min(b * 2, BONUS_MAX); return b; }   // FUN_0005011c
  function powerUp(P) { P.fright = FRIGHT; for (const g of P.ghosts) g.st = 1; }                          // FUN_000500a8: 20 s, every ghost (eyes too) turns blue
  function tick(P) {                                                                                      // FUN_00050698: the timer only runs while Pac-Man is not stunned and no pellet was just eaten
    if (P.fright > 0 && --P.fright === 0) { P.bonus = BONUS0; for (const g of P.ghosts) g.st = 0; return 'end'; }
    return null;
  }
  // FUN_00050790: when hit, 20% of the attached pac-dots (truncated, at least one comes off) are thrown off and 10 points each are taken from the score
  const dropCount = n => T(n * 0.2);
  const API = { FPS, PTS, NAMES, FRIGHT, STUN, TUNNEL, HIT_DIST, create, edgeLen, lerp, angle, pose, walkNext, findEdge, eyesNext, stepGhost, touch, shown, eat, powerUp, tick, dropCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KPac = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
