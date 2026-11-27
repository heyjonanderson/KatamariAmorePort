// Galaga extra stage (S021): stage flow, enemy entry and dive paths, dive selection, enemy shots, group bonuses and the score, ported from the binary (A161).
// Function addresses are for k2_armv7 (iOS Katamari Amore 1.3.2). Data is data/S021/galaga.json (paths 0x788f0, sine table 0x78f70, offsets 0x8ad68 and 0x8ae58, stage rows 0x89e68, bonus table 0x89e20, beam table 0x89e28).
// Units: cm, 30 frames a second. Enemy coordinates are the original's (x, z) with z the NEGATIVE of the node z; the host puts z on the port's world z as -z.
(function (root) {
  const FPS = 30, T = Math.trunc;
  const VAL = [100, 400, 160, 100, 320];     // 0x89e0c table by mono type 1..5 (GALAGA, GOEI, BOSSGALAGA, TONBO, GALBOSS) -> [T4, T0, T2, T3, T1] in the binary's order: type1 100, type2 160, type3 400, type4 100, type5 320
  const TYPE_VAL = { 1: 100, 2: 160, 3: 400, 4: 100, 5: 320 };
  const PLAYER_Z = 60, PLAYER_X = 70, BULLET_SPEED = 2, BULLET_END_Z = 180, FIRE_Z = [0, 20], FIRE_DIAM = 16, HIT_K = 0.75, DROP = 0.2;
  const WINDOW = [0, 20];
  // tractor beam (FUN_000543f0, FUN_00054aa0, FUN_00054b48, FUN_00053cf4): a boss on path 0x19 holds still at waypoint 7 for 240 ticks and the beam is on while 'rem' is below 210
  const BEAM_PATH = 0x19, BEAM_IDX = 8, BEAM_REM = 210, CAP_DX = 10, CAP_TAKE = 0.5, POOLMAP = [3, 5, 2, 4, 1], REL_KEEP = 0.4, REL_RET = 1.4, TRACTOR_DZ = 24, CAPMA_DZ = -16;   // POOLMAP: virtual count slot -> mono type (the order of DAT_0009a058 and DAT_0009a070)
  // formation (FUN_00052f5c): slot index -> [x, z]
  const FORM = []; for (let i = 0; i < 4; i++) FORM[i] = [(i - 1.5) * 12, -120]; for (let k = 0; k < 8; k++) { FORM[4 + k] = [(k - 3.5) * 12, -100]; FORM[12 + k] = [(k - 3.5) * 12, -80]; } for (let k = 0; k < 10; k++) { FORM[20 + k] = [(k - 4.5) * 12, -60]; FORM[30 + k] = [(k - 4.5) * 12, -40]; }

  // ---- the path engine (FUN_00055038 start, FUN_00054e94 step) ----
  function pathInit(D, id) {
    id = Math.max(0, Math.min(25, id)); const w = D.paths[id];
    return { id, x: w[0] * 65536, y: w[1] * 65536, ang: w[2], idx: 3, spd: 0, turn: 0, rem: 0, tick: 0, on: true };
  }
  function pathStep(D, p) {
    if (!p.on) return;
    let move = false;
    if (p.rem === 0) {
      const w = D.paths[p.id][p.idx++]; p.spd = (w >> 16) & 0xff; p.turn = (w << 16) >> 24; const ticks = w & 0xff;   // byte 2 speed nibbles, byte 1 signed turn, byte 0 length
      if (p.spd === 0xff) p.on = false; else { p.rem = ticks; if (ticks !== 0) move = true; }
    } else move = true;
    if (move) {
      p.ang = (p.ang - p.turn) & 0x3ff;
      const a2 = (p.ang + 0x100) & 0x3ff, sa = D.sin[p.ang], sb = D.sin[a2], A = Math.abs(sa), B = Math.abs(sb);
      let dx, dy;
      if (A <= B) { dx = (a2 >= 0x201 ? -65536 : 65536); dy = T(sa * 65536 / B); }
      else { dx = T(sb * 65536 / A); dy = (p.ang >= 0x201 ? -65536 : 65536); }
      const n = (p.tick & 1) === 0 ? (p.spd >> 4) & 0xf : p.spd & 0xf;
      p.x += n * dx; p.y -= n * dy; p.rem--;
    }
    p.tick++;
  }
  // FUN_00053a98: path point -> enemy coordinates. rot, fx, fy are flags, off = [scaleX, scaleZ, offX, offZ], so = the slot's own offset pair
  function place(p, rot, fx, fy, off, so) {
    let X = (p.x / 65536 - 112) * 1.25, Y = (p.y / 65536 - 144) * -1.25, a = p.ang * 2 * Math.PI / 1024;
    if (rot) { const t = X; X = Y; Y = -t; a += 4.71238899230957; }
    if (fx) { X = -X; a = Math.PI - a; }
    if (fy) { Y = -Y; a = -a; }
    a += Math.PI / 2;
    return { x: X * off[0] + off[2] + so[0], z: Y * off[1] + off[3] + so[1], ang: a };
  }

  function create(D, ctx, seed) {
    let s = (seed >>> 0) || 1;
    const rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const G = { D, ctx, rng, stage: 0, timers: [], slots: [], bullets: [], groups: [], bonus: 0, pat: 0, par: 0, events: [], frame: 0, beams: [], pool: [0, 0, 0, 0, 0], lockX: null };
    initStage(G, 1); return G;
  }
  const emptyGroup = () => ({ monos: [], kind: -1, count: 0, remaining: 0 });
  function initStage(G, st) {    // FUN_000551f0 and FUN_00053034
    const D = G.D, rows = D.rows[st - 1]; G.stage = st; G.slots = []; G.timers = []; G.groups = []; G.bullets = [];
    for (let i = 0; i < 10; i++) G.groups.push(emptyGroup());
    for (let i = 0; i < 4; i++) G.bullets.push({ on: false, x: 0, z: 0, tx: 0, tz: 0, mono: 120 + i });
    let beam = 0;
    G.beams = []; G.pool = [0, 0, 0, 0, 0];   // FUN_00054a40 clears the four beams and the virtual counts at every stage
    for (let i = 0; i < 4; i++) G.beams.push({ on: false, cap: false, t: 0, x: 0, z: 0, boss: -1, list: [], types: [], cnt: [0, 0, 0, 0, 0] });
    if (G.ctx.beamOff) G.ctx.beamOff(); for (let i = 0; i < 4; i++) G.ctx.cap && G.ctx.cap(i, 0, 0, 0);
    for (let i = 0; i < 40; i++) {
      const row = rows[i];
      G.slots.push({ i, st: 0, lives: 3, row, pi: null, x: 1000, z: 1000, ang: 0, ox: 0, oz: 0, f65: 1, stage0: st - 1, grp: i >> 3, beam: row[6] === 0 ? beam++ : -1, dropped: false, mono: row[7] });
      G.ctx.show(row[7], false); G.ctx.place(row[7], 1000, 1000, 0);
    }
    for (let i = 0; i < 4; i++) G.ctx.show(120 + i, false);
    if (st === 2) {   // bonus stage: groups of four, bonus kinds 2, 2, 4, 2, 3, 4, 5, 5, 5, 4
      const kinds = [2, 2, 4, 2, 3, 4, 5, 5, 5, 4];
      for (let i = 0; i < 40; i++) { const g = G.groups[i >> 2]; if (g.count < 8) { g.monos.push(G.slots[i].mono); g.count++; g.remaining++; } }
      G.groups.forEach((g, k) => g.kind = kinds[k]);
    }
    const unit = (st === 2 ? 10 : 5) * FPS;
    for (let i = 0; i < 40; i++) G.timers.push({ on: true, n: (i >> 3) * unit + T(rows[i][2] * FPS / 50) });
    for (let i = 40; i < 44; i++) G.timers.push({ on: false, n: 0 });
    if ((st | 2) === 3) G.timers[0x28] = { on: true, n: unit * 5 };
    G.events.push({ t: 'stage', stage: st });
  }
  const groupRemove = (G, mono) => {   // FUN_000544e4 for every group (FUN_00053c5c): returns the bonus when the last member is gone
    let bonus = 0;
    for (const g of G.groups) {
      for (let k = 0; k < g.count; k++) if (g.monos[k] === mono) { g.monos[k] = -1; g.remaining--; }
      if (g.remaining < 1) { if (g.kind >= 0) bonus = G.D.t89e20[g.kind]; g.kind = -1; g.count = 0; g.remaining = 0; g.monos = []; }
    }
    return bonus;
  };
  const dissolve = (G, mono) => { for (const g of G.groups) if (g.monos.includes(mono)) { g.kind = -1; g.count = 0; g.remaining = 0; g.monos = []; } };   // FUN_00054484

  // ---- dive start (FUN_0005392c) ----
  function startDive(G, sl, mode) {
    const D = G.D, row = sl.row;
    sl.st = 4; sl.f65 = 0;
    let id, off;
    if (mode === 1) { id = 2; off = 2; } else if (mode === 2) { id = 1; off = 1; } else if (mode === 3) { id = 0x19; off = 3; } else { id = row[3]; off = row[3] < 4 ? row[3] : 3; }
    sl.pi = pathInit(D, id); sl.doff = off;
    const st = place(sl.pi, 0, row[4] & 1, (row[4] >> 8) & 1, D.diveOff[off], [0, 0]);   // where the path would start; the slot offset carries the enemy there from where it hangs now
    sl.ox = sl.x - st.x; sl.oz = sl.z - st.z;
  }
  const free = (G, sl) => sl.st === 3 && sl.lives > 0 && !G.ctx.att(sl.mono) && !sl.dropped;
  function collect(G, out, max, cls, par) {   // FUN_000537e4 and FUN_00053848
    for (const sl of G.slots) {
      if (out.length >= max) return;
      if (free(G, sl) && sl.row[6] === cls && (par === undefined || (sl.row[4] & 1) === par)) out.push(sl.i);
    }
  }
  function beamDive(G, sl) {   // FUN_000538c4: whether this boss goes on the beam path on this pass
    return 4 - sl.lives === G.D.t89e28[G.stage * 4 + (sl.beam & 3)];   // table at 0x89e28, one row of four per stage (stage 1: 1 2 1 2, stage 2: none, stage 3: 1 2 1 2)
  }
  function groupAdd(G, monos, kind) {
    const g = G.groups.find(q => q.count === 0); if (!g) return;
    g.kind = kind; for (const m of monos) { if (g.count < 8) { g.monos.push(m); g.count++; g.remaining++; } }
  }
  function selectDive(G) {   // FUN_000533f8
    const list = [], sl = G.slots, pat = G.pat;
    const shuffle = () => { for (let k = 0; k < 16 && list.length > 0; k++) { const a = Math.floor(G.rng() * list.length), b = Math.floor(G.rng() * list.length); const t = list[a]; list[a] = list[b]; list[b] = t; } };
    if (pat === 0) { collect(G, list, 20, 4); collect(G, list, 20, 2); collect(G, list, 20, 1); collect(G, list, 20, 0); shuffle(); }
    else if (pat === 1) {
      collect(G, list, 3, 1, G.par); G.par ^= 1;
      if (list.length < 3) { collect(G, list, 3, 1); collect(G, list, 3, 4); collect(G, list, 3, 2); collect(G, list, 3, 0); }
      shuffle();
    } else { collect(G, list, 2, 0); collect(G, list, 2, 1); collect(G, list, 2, 2); collect(G, list, 2, 4); }
    G.pat = (pat + 1) % 3;
    if (list.length < 1) return;
    const s0 = sl[list[0]];
    if (s0.row[6] === 0) {
      if (beamDive(G, s0)) startDive(G, s0, 3);
      else {
        startDive(G, s0, 0); const mem = [s0.mono];
        const esc = []; for (const q of sl) if (esc.length < 2 && free(G, q) && Math.abs(q.row[5] - (s0.row[5] + 6)) < 2) esc.push(q);
        for (const q of esc) { startDive(G, q, 1); mem.push(q.mono); }
        groupAdd(G, mem, 0);
      }
    } else if (!(list.length >= 3 && sl[list[1]].row[6] === 1 && sl[list[2]].row[6] === 1)) {
      startDive(G, s0, 0); if (list.length > 1) startDive(G, sl[list[1]], 0);
    } else {
      const three = [sl[list[0]], sl[list[1]], sl[list[2]]]; for (const q of three) startDive(G, q, 2); groupAdd(G, three.map(q => q.mono), 1);
    }
    G.events.push({ t: 'dive' });   // sound id 0x4b
  }


  // ---- tractor beam and capture ----
  const shuf = (G, a) => { for (let k = 0; k < 100 && a.length > 1; k++) { const i = Math.floor(G.rng() * a.length), j = Math.floor(G.rng() * a.length); const t = a[i]; a[i] = a[j]; a[j] = t; } };
  const capScale = t => t < 60 ? 0 : t >= 180 ? 0.5 : Math.floor((t - 60) / 30) / 10 + 0.1;   // FUN_0005413c: the captured ball (CAPTAMA) hanging behind the boss grows 0.1 to 0.5 in steps of 0.1 every 30 ticks from tick 60 of the beam
  function startBeam(G, b, sl) { b.on = true; b.cap = false; b.frz = null; b.t = 0; b.x = sl.x; b.z = sl.z; b.boss = sl.mono; G.ctx.beamPlace(b.x, b.z); G.events.push({ t: 'beam' }); }   // FUN_000543f0: the beam is put on the boss, sound id 0x3d
  function stopBeam(G, b) { b.on = false; b.cap = false; b.frz = null; G.ctx.beamOff(); }
  function capture(G, b) {   // FUN_00054aa0 then FUN_00054b48 with 0.5: half of what is on the ball (rounded up) goes into the beam's list; the virtual count makes up the same share
    const ctx = G.ctx; b.cap = true; ctx.tractor(b.x, b.z + TRACTOR_DZ);
    const att = ctx.attached(); shuf(G, att);
    const nA = att.length, pc = G.pool.reduce((a, c) => a + c, 0), c1 = Math.ceil(nA * CAP_TAKE), T = Math.ceil((pc + nA) * CAP_TAKE);
    for (let k = 0; k < c1 && k < nA; k++) { const q = att[k]; ctx.takeOff(q.mono); if (b.list.length < 0x77) { b.list.push(q.mono); b.types.push(q.type); } }
    let r = T - Math.min(c1, nA); const per = Math.trunc(r / 5), take = [0, 0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { take[k] = Math.min(G.pool[k], per); r -= take[k]; }
    take[4] = Math.max(0, r);   // the fifth count takes whatever is left, so it can go below zero
    for (let k = 0; k < 5; k++) { b.cnt[k] += take[k]; G.pool[k] -= take[k]; }
    G.events.push({ t: 'capture' });
  }
  function rescue(G, b, idx) {   // FUN_00053ca0 and FUN_00053cf4: a boss that is picked up gives its list back at the ball; the virtual counts grow by 40% of the list and 140% of what the beam took from them
    if (b.list.length === 0) return; const ctx = G.ctx, n = [0, 0, 0, 0, 0];
    ctx.release(b.list); for (const ty of b.types) { const k = POOLMAP.indexOf(ty); if (k >= 0) n[k]++; }
    for (let k = 0; k < 5; k++) { G.pool[k] += Math.ceil(n[k] * REL_KEEP) + Math.ceil(b.cnt[k] * REL_RET); b.cnt[k] = 0; }
    b.list = []; b.types = []; ctx.cap(idx, 0, 0, 0); G.events.push({ t: 'rescue' });
  }
  const virt = (G, volOf) => { let v = 0; for (let k = 0; k < 5; k++) v += volOf(POOLMAP[k]) * G.pool[k]; return Math.max(0, v); }   // FUN_000533b8, times the add-volume ratio of the table at the ball's size (host)

  // ---- one frame (FUN_000553a0, after the host has clamped the ball) ----
  function step(G, ball) {   // ball: { x, z, diam } in the enemy frame (z = PLAYER_Z)
    const D = G.D, ctx = G.ctx; G.frame++; if (G.stage >= 4) return;
    G.lockX = null; let locked = false;
    for (let k = 0; k < 4; k++) {   // the beams: model placed, capture tested (|beam x - ball x| < 10 and something on the ball), ball held at the beam's x while captured
      const b = G.beams[k];
      if (b.on) { ctx.beamPlace(b.x, b.z); b.t++; }
      const inb = b.on && !b.cap && Math.abs(b.x - ball.x) < CAP_DX;
      if (inb && ctx.attCount() > 0) capture(G, b);
      else if (inb && b.frz == null) b.frz = ball.x;   // FUN_00025bdc runs even with nothing on the ball: the controls stay off until the beam ends (FUN_00025bc0)
      if (b.cap) { G.lockX = b.x; locked = true; } else if (b.on && b.frz != null) { G.lockX = b.frz; locked = true; }
    }
    // shots
    for (const b of G.bullets) {
      if (!b.on) continue;
      let dx = b.tx - b.x, dz = b.tz - b.z; const d = Math.hypot(dx, dz);
      if (d < BULLET_SPEED) { b.x = b.tx; b.z = b.tz; b.on = false; ctx.show(b.mono, false); }
      else { b.x += BULLET_SPEED * dx / d; b.z += BULLET_SPEED * dz / d; }
      ctx.place(b.mono, b.x, b.z, Math.atan2(dx, dz) + Math.PI);
      if (b.on && Math.hypot(b.x - ball.x, b.z - ball.z) < HIT_K * ball.diam / 2) { b.on = false; ctx.show(b.mono, false); G.events.push({ t: 'hit' }); ctx.drop(DROP); }   // FUN_000548c8: id 0x4f, then FUN_00054618 throws 20% of what is attached
    }
    let alive = 0;
    for (const sl of G.slots) {
      const att = ctx.att(sl.mono), row = sl.row;
      if (!att && !sl.dropped && sl.st !== 0) {
        if (sl.st === 1) {   // FUN_00053f94: the entry path
          pathStep(D, sl.pi); const q = place(sl.pi, row[1] & 1, (row[1] >> 8) & 1, (row[1] >> 16) & 1, D.entryOff[sl.stage0 * 5 + sl.grp], [sl.ox, sl.oz]);
          sl.x = q.x; sl.z = q.z; sl.ang = q.ang; ctx.place(sl.mono, sl.x, sl.z, sl.ang);
          if (!sl.pi.on) { if (row[5] < 0) { sl.st = 0; sl.lives = 0; ctx.show(sl.mono, false); } else sl.st = 2; }
        } else if (sl.st === 2 || sl.st === 5) {   // FUN_00054048: back to the formation slot at 3 a frame
          const f = FORM[row[5]], d = Math.hypot(sl.x - f[0], sl.z - f[1]);
          if (d < 3) { sl.x = f[0]; sl.z = f[1]; sl.st = 3; } else { sl.x += 3 * (f[0] - sl.x) / d; sl.z += 3 * (f[1] - sl.z) / d; }
          sl.ang = 0; ctx.place(sl.mono, sl.x, sl.z, 0);
          if (row[6] === 0 && sl.beam >= 0 && sl.beam < 4 && G.beams[sl.beam].list.length) ctx.cap(sl.beam, sl.x, sl.z + CAPMA_DZ, 0.5);   // FUN_00054048
        } else if (sl.st === 4) {   // FUN_0005413c: the dive path
          pathStep(D, sl.pi); const q = place(sl.pi, 0, row[4] & 1, (row[4] >> 8) & 1, D.diveOff[sl.doff], [sl.ox, sl.oz]);
          sl.x = q.x; sl.z = q.z; sl.ang = q.ang; ctx.place(sl.mono, sl.x, sl.z, sl.ang);
          if (row[6] === 0 && sl.beam >= 0 && sl.beam < 4) {   // FUN_0005413c: the boss on the beam path puts the beam on and takes it off, and carries the captured ball
            const b = G.beams[sl.beam], on = sl.pi.id === BEAM_PATH && sl.pi.idx === BEAM_IDX && sl.pi.rem < BEAM_REM;
            if (!b.on) { if (on) startBeam(G, b, sl); } else if (!on) stopBeam(G, b);
            if (b.list.length) ctx.cap(sl.beam, sl.x, sl.z + CAPMA_DZ, capScale(b.t));
          }
          if (!sl.pi.on) {
            if (sl.lives > 0) sl.lives--;
            if (row[5] >= 0 && sl.lives >= 1) { sl.st = 5; dissolve(G, sl.mono); if (sl.pi.id !== 0x19) sl.z = -180; else if (row[6] === 0 && sl.beam >= 0 && sl.beam < 4 && G.beams[sl.beam].list.length) { ctx.cap(sl.beam, sl.x, sl.z + CAPMA_DZ, 0.1); G.events.push({ t: 'beamBack' }); } }
            else { sl.st = 0; sl.lives = 0; ctx.show(sl.mono, false); }
          }
        }
      }
      // shots: a diving enemy that is not a boss and is in the window fires at the ball while a shot is free (FUN_0005452c, FUN_00054558)
      if (!locked && !att && !sl.dropped && sl.lives > 0 && ball.diam >= FIRE_DIAM && sl.st === 4 && sl.f65 === 0 && sl.z >= WINDOW[0] && sl.z <= WINDOW[1] && row[6] !== 0) {
        const b = G.bullets.find(q => !q.on);
        if (b) { b.on = true; b.x = sl.x; b.z = sl.z; b.tz = BULLET_END_Z; b.tx = sl.x + (ball.x - sl.x) * (BULLET_END_Z - sl.z) / (ball.z - sl.z); ctx.show(b.mono, true); ctx.place(b.mono, b.x, b.z, 0); G.events.push({ t: 'shot' }); }
      }
      if (att && !sl.wasAtt && row[6] === 0 && sl.beam >= 0 && sl.beam < 4) { const b = G.beams[sl.beam]; if (b.on) stopBeam(G, b); rescue(G, b, sl.beam); }   // a boss picked up while it holds captured things
      sl.wasAtt = att;
      if (att && (sl.st === 1 || sl.st === 4)) G.bonus += groupRemove(G, sl.mono);   // FUN_00053c5c: the last member of a dive group picked up pays the group bonus
      if (!att && sl.lives > 0) alive++;
      if (att && sl.st !== 0 && sl.st !== 3 && sl.st !== 99) { /* an attached enemy is out of the game */ }
    }
    // timers
    for (let i = 0; i < 0x2c; i++) {
      const t = G.timers[i]; if (!t.on) continue;
      if (t.n > 0) t.n--;
      if (t.n < 1) {
        t.on = false;
        if (i < 0x28) { const sl = G.slots[i]; sl.st = 1; sl.lives = 3; sl.f65 = 1; sl.dropped = false; sl.pi = pathInit(D, sl.row[0]); sl.ox = 0; sl.oz = 0; ctx.show(sl.mono, true); }   // FUN_00053c18
        else if (i === 0x28) { selectDive(G); t.on = true; t.n = FPS * 5; }
      }
    }
    if (alive === 0) {   // every enemy is gone or on the ball: the next stage, or the end after the third
      for (const t of G.timers) { t.on = false; t.n = 0; }
      for (const b of G.bullets) { b.on = false; ctx.show(b.mono, false); }
      if (G.stage < 3) initStage(G, G.stage + 1); else { G.stage = 4; G.events.push({ t: 'clear' }); }
    }
  }
  // FUN_0005328c: score = tier(100 * attached) + sum of the attached enemies' values + the group bonuses
  function tier(n) { const v = n * 100; return v < 2400 ? 1000 : v < 6000 ? 2000 : v < 9000 ? 4000 : v < 12000 ? 8000 : v < 14400 ? 16000 : v < 16800 ? 32000 : 64000; }
  function score(G, types) { let sum = 0, n = 0; for (const t of types) { if (TYPE_VAL[t]) { sum += TYPE_VAL[t]; n++; } } return tier(n) + sum + G.bonus; }
  const API = { FPS, FORM, TYPE_VAL, PLAYER_Z, PLAYER_X, HIT_K, DROP, pathInit, pathStep, place, create, initStage, step, startDive, selectDive, groupRemove, tier, score, virt, capScale, POOLMAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KGal = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
