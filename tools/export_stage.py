import glob, os, sys, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, tables as T
# Usage: export_stage.py APP_FOLDER OUT_DATA_DIR
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/work/k/Payload/katamari2.app'); OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/work/web/data')
def chunk(d, base, ents, name):
    e = [e for e in ents if e[1] == name]
    return d[base+e[0][2]+4: base+e[0][2]+e[0][3]] if e else None
stages = json.load(open(OUT + '/stages.json')); rep = {}
for st in stages:
    r = {}
    d, b, e, _ = dat.parse(f'{SRC}/{st}MLST.dat'); c = chunk(d, b, e, 'MONOLIST')
    mons, end = T.parse_monolist(c); r['mono'] = (len(mons), end == len(c), [m['id'] for m in mons] == list(range(1, len(mons)+1)))
    d, b, e, _ = dat.parse(f'{SRC}/{st}MLOC.dat'); mloc = {}; allnames = {m['name'] for m in mons}; bad = 0; nzr = 0; left = 0
    for t, n, off, sz in e:
        if t == 4 and n.startswith('MP_') and n != 'MP_INF':
            names, recs, lf = T.parse_mloc(d[b+off+4: b+off+sz]); left += lf
            bad += sum(x not in allnames for x in names)
            nzr += sum(1 for q in recs if abs(q['rot'][0]) > 1e-3 or abs(q['rot'][2]) > 1e-3)
            mloc[n] = [[q['name']] + [round(x, 3) for x in q['pos']] + [round(x, 3) for x in q['rot']] for q in recs]
    r['mloc'] = (len(mloc), sum(len(v) for v in mloc.values()), left == 0, bad, nzr)
    d, b, e, _ = dat.parse(f'{SRC}/{st}IBI.dat'); h = chunk(d, b, e, 'HIT_MAP'); hit = None
    if h:
        v, polys, ok = T.parse_hitmap(h); r['hit'] = (len(v)//3, len(polys), ok); hit = dict(v=[round(x, 2) for x in v], polys=polys)
    json.dump(dict(mono=mons, mloc=mloc, hit=hit), open(f'{OUT}/{st}/stage.json', 'w'), ensure_ascii=False)
    rep[st] = r
for st, r in rep.items(): print(st, 'mono(n,exact,ids)', r['mono'], '| mloc(tables,placements,exact,unknown names,nonzero rx/rz)', r['mloc'], '| hit(verts,polys,exact)', r.get('hit'))
