import glob, os, sys, json, struct, shutil, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, mdl
import numpy as np
# Usage: export.py APP_FOLDER OUT_DATA_DIR TEX_DIR   (TEX_DIR is what dump_tex.py wrote)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/work/k/Payload/katamari2.app')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/work/web/data')
TEX = sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser('~/work/out/tex')

def models_of(fn):
    d, base, ents, _ = dat.parse(os.path.join(SRC, fn))
    out = []
    for t,n,off,sz in ents:
        if t == 2: out.append((n, mdl.parse(d[base+off+4: base+off+sz])))
    return out

def export_group(models, texdirs, outdir, tag, report):
    os.makedirs(outdir, exist_ok=True)
    blob = bytearray(); man = []; used = set()
    for name, m in models:
        nv = len(m['pos'])
        vb = np.zeros((nv, 8), np.float32)
        vb[:, 0:3] = np.array(m['pos'], np.float32); vb[:, 3:6] = np.array(m['nrm'], np.float32); vb[:, 6:8] = np.array(m['uv'], np.float32)
        voff = len(blob); blob += vb.tobytes()
        subs = []
        for s in m['subs']:
            ioff = len(blob); idx = np.array(s['tris'], np.uint16); blob += idx.tobytes()
            subs.append(dict(tex=s['tex'], off=ioff, n=int(len(idx))))
            used.add(s['tex'])
        while len(blob) % 4: blob += b'\0'
        man.append(dict(name=name, voff=voff, nv=nv, subs=subs, bbox=m['bbox']))
    # textures
    missing = []
    texinfo = {}
    for tname in sorted(used):
        for td in texdirs:
            p = os.path.join(TEX, td, tname + '.png')
            if os.path.exists(p):
                os.makedirs(os.path.join(outdir, 'tex'), exist_ok=True)
                shutil.copy(p, os.path.join(outdir, 'tex', tname + '.png')); texinfo[tname] = td; break
        else: missing.append(tname)
    report[tag] = dict(models=len(man), verts=sum(x['nv'] for x in man), tris=sum(s['n']//3 for x in man for s in x['subs']), tex=len(used), missing=missing)
    open(os.path.join(outdir, tag + '.bin'), 'wb').write(blob)
    json.dump(dict(models=man, tex=sorted(used - set(missing))), open(os.path.join(outdir, tag + '.json'), 'w'))

if __name__ == '__main__':
    stages = sorted({re.match(r'(S\d{3})', os.path.basename(p)).group(1) for p in glob.glob(SRC + '/S[0-9][0-9][0-9]*.dat')})
    allrep = {}
    for st in stages:
        rep = {}
        mm = models_of(st + 'MAPM.dat'); om = models_of(st + 'OBJM.dat')
        export_group(mm, [st + 'MAPT', st + 'OBJT'], f'{OUT}/{st}', 'map', rep)
        export_group(om, [st + 'OBJT', st + 'MAPT'], f'{OUT}/{st}', 'obj', rep)
        allrep[st] = rep
    json.dump(stages, open(OUT + '/stages.json', 'w'))
    for st, r in allrep.items():
        print(st, 'map', {k: v for k, v in r['map'].items() if k != 'missing'}, 'miss', r['map']['missing'], '| obj', {k: v for k, v in r['obj'].items() if k != 'missing'}, 'miss', r['obj']['missing'])
