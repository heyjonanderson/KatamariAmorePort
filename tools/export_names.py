# Writes data/<stage>/names_<lang>.json: the object names the HUD shows when something sticks, in the app's six languages ({monolist name: label}).
# Usage: python export_names.py <app dir> <data dir> [stage ...]
import os, sys, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, tables as T
SRC = sys.argv[1]; OUT = sys.argv[2]; STAGES = sys.argv[3:] or ['S001', 'S002', 'S003', 'S004', 'S005', 'S006']
LANGS = {'en': 'English', 'fr': 'French', 'de': 'German', 'it': 'Italian', 'es': 'Spanish', 'ja': 'Japanese'}
def chunk(d, base, ents, name):
    e = [e for e in ents if e[1] == name]
    return d[base+e[0][2]+4: base+e[0][2]+e[0][3]] if e else None
for st in STAGES:
    d, b, e, _ = dat.parse(f'{SRC}/{st}MLST.dat'); mons, _ = T.parse_monolist(chunk(d, b, e, 'MONOLIST'))
    for code, folder in LANGS.items():
        nd, nb, ne, _ = dat.parse(f'{SRC}/{folder}.lproj/MONONAME.dat'); nch = chunk(nd, nb, ne, 'MONONA%02d' % (int(st[1:]) - 1)); names = []
        if nch:
            cnt = struct.unpack('>I', nch[4:8])[0]; pool = 8 + 8 * cnt
            for k in range(cnt):
                off_, ln_ = struct.unpack('>2I', nch[8+8*k: 16+8*k]); names.append(nch[pool+off_: pool+off_+ln_].decode('utf-8', 'replace').replace('\x00', '').strip())
        out = {m['name']: names[i] for i, m in enumerate(mons) if i < len(names) and names[i]}
        with open(f'{OUT}/{st}/names_{code}.json', 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        print(st, code, len(out))
