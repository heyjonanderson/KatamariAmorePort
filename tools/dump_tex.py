# Decode every type-1 chunk of every .dat in the unzipped app folder to PNG. Layout: out/tex/<dat stem>/<chunk name>.png
import glob, os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
import dat, img
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
n = 0
for p in sorted(glob.glob(os.path.join(src, '*.dat'))):
    d, base, ents, _ = dat.parse(p); stem = os.path.basename(p)[:-4]
    for t, name, off, sz in ents:
        if t != 1: continue
        a, info = img.decode(d[base+off+4: base+off+sz], 'hi')
        os.makedirs(os.path.join(out, stem), exist_ok=True)
        Image.fromarray(a, 'RGBA').save(os.path.join(out, stem, name + '.png')); n += 1
print('textures written:', n)
