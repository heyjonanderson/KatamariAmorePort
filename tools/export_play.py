# Writes data/<stage>/play.json: everything the simulation needs, in view space (z mirrored from logic space).
import os, sys, json, struct, math, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, mdl, tables as T
SRC = sys.argv[1]; OUT = sys.argv[2]; STAGES = sys.argv[3:] or ['S001']
def chunk(d, base, ents, name):
    e = [e for e in ents if e[1] == name]
    return d[base+e[0][2]+4: base+e[0][2]+e[0][3]] if e else None
def mis_sections(c):
    n = struct.unpack('>H', c[:2])[0]; ent = []
    for i in range(n):
        o = 2 + i*21; ent.append((c[o:o+16].decode('latin1').rstrip(), c[o+16], struct.unpack('>I', c[o+17:o+21])[0]))
    ends = [x[2] for x in ent[1:]] + [len(c)]
    return {nm: (ty, c[off:end]) for (nm, ty, off), end in zip(ent, ends)}
def floats(b): k = struct.unpack('>H', b[:2])[0]; return list(struct.unpack('>%df' % k, b[2:2+4*k]))
for st in STAGES:
    d, b, e, _ = dat.parse(f'{SRC}/{st}MIS.dat'); sec = mis_sections(d[b+e[0][2]+4: b+e[0][2]+e[0][3]])
    sp = floats(sec['SPEED_TABLE'][1]); recs = [sp[2+21*k: 23+21*k] for k in range((len(sp)-2)//21)]
    md = sec['MISSION_DATA'][1]; mf = [struct.unpack('>f', md[7+4*k: 11+4*k])[0] for k in range(11)]
    cf = floats(sec['CAMERA_DATA'][1]); cam = [cf[i:i+10] for i in range(0, len(cf) - 9, 10) if cf[i] >= 0]
    gb = sec['GRAPHICS'][1]; gr = struct.unpack('>4f', gb[2:18])
    tb = sec['TIME_LIMIT'][1]; tl = list(struct.unpack('>%dI' % struct.unpack('>H', tb[:2])[0], tb[2:]))
    es = sec['ERASE_STOPPER'][1] if 'ERASE_STOPPER' in sec else b'\x00\x00'; en = struct.unpack('>H', es[:2])[0]; ev = list(struct.unpack('>%di' % en, es[2:2+4*en])); stoppers = []
    for k in range(0, len(ev) - 1, 2):
        if ev[k] < 0: break
        stoppers.append([ev[k], ev[k+1]])
    rp = floats(sec['RECOVERY_POINT'][1]) if False else list(struct.unpack('>5f', sec['RECOVERY_POINT'][1][2:22]))   # [bottom, x, y, z, angle]; KatamariRecover.cppi: fell when y >= bottom (y down), respawn at the nearest point
    ex = sec['MISSION_DATA_EXT'][1]; target = ex[10:26].decode('latin1').strip()
    mis = dict(target=target, target_raw=target, stoppers=stoppers, addvol=floats(sec['VOLUME_RATIO'][1]), gravity=floats(sec['GRAVITY'][1]), speed=[list(r) for r in recs if len(r) == 21 and r[0] >= 0],
               mission_floats=mf, recover=rp, time_limit=tl, camera=cam, near=gr[0], far=gr[1], near2=gr[2], far2=gr[3], ouji_scale=floats(sec['OUJI_SCALE'][1])[0])
    d, b, e, _ = dat.parse(f'{SRC}/{st}MLST.dat'); mst = (d, b, e); mons, _ = T.parse_monolist(chunk(d, b, e, 'MONOLIST'))
    d, b, e, _ = dat.parse(f'{SRC}/{st}OBJM.dat'); have = {x[1]: mdl.parse(d[b+x[2]+4: b+x[2]+x[3]]) for x in e if x[0] == 2}
    nd, nb, ne, _ = dat.parse(f'{SRC}/English.lproj/MONONAME.dat'); nch = chunk(nd, nb, ne, 'MONONA%02d' % (int(st[1:]) - 1)); names_en = []
    if nch:
        cnt = struct.unpack('>I', nch[4:8])[0]; pool = 8 + 8 * cnt
        for k in range(cnt):
            off_, ln_ = struct.unpack('>2I', nch[8+8*k: 16+8*k]); names_en.append(nch[pool+off_: pool+off_+ln_].decode('utf-8', 'replace').replace('\x00', '').strip())
    info = {}
    for mi, m in enumerate(mons):
        real = m['model']; path_info = None; cse = None; anim = None
        if re.match(r'MI[a-z]', real):                       # mission item wrapper chunk (ANIME / PATH / CATCH_SE) that names the real model, e.g. MIaWDECK -> Msa0000
            mc = chunk(*mst, real); mm = re.search(rb'M[a-z]{2}\d{4}', mc) if mc else None
            if mm: real = mm.group(0).decode()
            if mc:
                ms = mis_sections(mc)
                if 'PATH' in ms and len(ms['PATH'][1]) >= 12: pbody = ms['PATH'][1]; path_info = dict(no=struct.unpack('>H', pbody[2:4])[0], speed=struct.unpack('>f', pbody[-4:])[0])
                if 'ANIME' in ms:                                  # [u16 version, u16 n, n x 16-byte model names, f32 speed]: a flip-book. Frames are shown in order, advancing `speed` frames per tick (A59)
                    ab = ms['ANIME'][1]; an = struct.unpack('>H', ab[2:4])[0]
                    if an > 1 and len(ab) >= 4 + 16 * an + 4:
                        fr = [ab[4+16*q: 20+16*q].decode('latin1').strip() for q in range(an)]; anim = dict(frames=fr, speed=round(struct.unpack('>f', ab[4+16*an: 8+16*an])[0], 5))
                if 'CATCH_SE' in ms: cse = struct.unpack('>%dH' % (len(ms['CATCH_SE'][1]) // 2), ms['CATCH_SE'][1])
        if real not in have: continue
        m = dict(m, model_real=real, special=bool(re.match(r'MI[a-z]', m['model'])))
        P = have[real]['pos']; lo = [min(p[k] for p in P) for k in range(3)]; hi = [max(p[k] for p in P) for k in range(3)]
        w, h, dd = [max(hi[k]-lo[k], 0.1) * 0.01 for k in range(3)]
        info[m['name']] = dict(path=path_info, catch_se=cse, anim=anim, cat=m['cat'], label=names_en[mi] if mi < len(names_en) else m['name'], model=real, special=m['special'], lo=lo, hi=hi, boxvol=w*h*dd, catch_mm=m['f'][0], vol_ratio=m['f'][1], add_ratio=m['f'][2])
    d, b, e, _ = dat.parse(f'{SRC}/{st}MLOC.dat'); objs = []
    inf = [x for x in e if x[1] == 'MP_INF'][0]; ib = d[b+inf[2]+4: b+inf[2]+inf[3]]; layers = []
    k = ib.find(b'MP_S00')
    while k >= 0 and ib[k:k+4] == b'MP_S' and len(layers) < 8:
        layers.append(dict(set=ib[k:k+16].decode().strip(), until=struct.unpack('>f', ib[k+16:k+20])[0])); k += 20
    mis['layers'] = layers
    sp_ch = [x for x in e if x[1] == 'SPLINE']; mis['splines'] = {}
    if sp_ch:
        sb = d[b+sp_ch[0][2]+4: b+sp_ch[0][2]+sp_ch[0][3]]; sm = mis_sections(sb)
        for nm, (ty, body) in sm.items():
            m_ = re.match(r'SPLINE_PATH(\d+)', nm)
            if not m_: continue
            fl = floats(body)
            mis['splines'][int(m_.group(1))] = [[round(fl[k], 3), round(fl[k+1], 3), round(-fl[k+2], 3)] for k in range(0, len(fl) - 2, 3)]
    for t, n, off, sz in e:
        if t == 4 and n.startswith('MP_S'):
            names, recs2, _ = T.parse_mloc(d[b+off+4: b+off+sz])
            for q in recs2:
                if q['name'] in info: objs.append(dict(n=q['name'], layer=int(n[-2:]), p=[round(q['pos'][0], 3), round(q['pos'][1], 3), round(-q['pos'][2], 3)], r=[round(x, 3) for x in q['rot']]))
    # HIT_MAP collision polygons, triangulated, z mirrored to view space. Sim treats steep ones as walls and uses all of them for camera rays
    d, b, e, _ = dat.parse(f'{SRC}/{st}IBI.dat'); hv, hp, _ok = T.parse_hitmap(chunk(d, b, e, 'HIT_MAP')); hit = []
    hit_kind = []
    for pl in hp:
        ix = pl[1:]
        for i in range(1, len(ix) - 1):
            hit_kind.append(pl[0])
            for k in (ix[0], ix[i], ix[i+1]): hit += [round(hv[k*3], 3), round(hv[k*3+1], 3), round(-hv[k*3+2], 3)]
    cv, cp, _ok = T.parse_hitmap(chunk(d, b, e, 'HIT_CAM')); camhit = []
    for pl in cp:
        ix = pl[1:]
        for i in range(1, len(ix) - 1):
            for k in (ix[0], ix[i], ix[i+1]): camhit += [round(cv[k*3], 3), round(cv[k*3+1], 3), round(-cv[k*3+2], 3)]
    dm, bm, em, _ = dat.parse(f'{SRC}/{st}MAPM.dat'); tris = []
    for t, n, off, sz in em:
        if t != 2: continue
        m = mdl.parse(dm[bm+off+4: bm+off+sz]); v = m['pos']
        for s in m['subs']:
            idx = s['tris']
            for i in range(0, len(idx), 3):
                a, bb, c = v[idx[i]], v[idx[i+1]], v[idx[i+2]]
                ux, uy, uz = bb[0]-a[0], bb[1]-a[1], bb[2]-a[2]; vx, vy, vz = c[0]-a[0], c[1]-a[1], c[2]-a[2]
                nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx; l = math.sqrt(nx*nx+ny*ny+nz*nz)
                if l > 0 and abs(ny/l) > 0.7: tris.extend([round(x, 2) for x in (*a, *bb, *c)])
    # Alternative catch sizes (A48): MonoHit.cppi computes the catch diameter from the box volume, vol_ratio and a ratio g (KPARAM f32GetRatio) that is not in the sources.
    # Mission float 9 looks like the goal diameter, so g is fitted per stage so that the target's catch size equals it.
    if target in info:
        t_ = info[target]; V_ = t_['boxvol'] * t_['vol_ratio']; d_eq = 200 * (3 * V_ / (4 * math.pi)) ** (1 / 3)
        g_ = (d_eq / mf[9]) ** 3 if mf[9] > 0 and d_eq > 0 else 1.0; mis['catch_g'] = g_
        for k_, v_ in info.items(): v_['catch_goal_mm'] = round(2000 * (3 * v_['boxvol'] * v_['vol_ratio'] / g_ / (4 * math.pi)) ** (1 / 3), 1)
    if target not in info: cand = [n for n in info if n.startswith(target)] or [n for n in info if target.startswith(n)]; mis['target'] = cand[0] if cand else target
    json.dump(dict(mis=mis, info=info, objs=objs, tris=tris, hit=hit, hit_kind=hit_kind, camhit=camhit), open(f'{OUT}/{st}/play.json', 'w'))
    print(st, 'objects', len(objs), 'ground tris', len(tris)//9, 'speed rows', len(mis['speed']), 'mission floats', [round(x, 2) for x in mf])
