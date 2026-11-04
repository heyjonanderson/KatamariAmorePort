# Exports the prince models (GiOujiM0..2) and their textures from GAMEDATA.dat into data/common/ouji.{json,bin} + tex/
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, mdl, img, export as E
from PIL import Image
SRC = sys.argv[1]; OUT = sys.argv[2]
d, b, e, _ = dat.parse(f'{SRC}/GAMEDATA.dat')
tdir = '/tmp/gd_tex/GAMEDATA'; os.makedirs(tdir, exist_ok=True)
for x in e:
    if x[0] == 1:
        a, _i = img.decode(d[b+x[2]+4: b+x[2]+x[3]]); Image.fromarray(a, 'RGBA').save(f'{tdir}/{x[1]}.png')
models = [(x[1], mdl.parse(d[b+x[2]+4: b+x[2]+x[3]])) for x in e if x[0] == 2 and x[1].startswith('GiOujiM')]
E.TEX = '/tmp/gd_tex'; rep = {}
E.export_group(models, ['GAMEDATA'], f'{OUT}/common', 'ouji', rep)
print(json.dumps(rep))
