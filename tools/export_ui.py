# Exports UI images (HUD, pad, menus) to ui/<file>/<name>.png and a contact sheet per file.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat, img
from PIL import Image, ImageDraw
SRC = sys.argv[1]; OUT = sys.argv[2]; FILES = sys.argv[3:]
for f in FILES:
    d, b, e, _ = dat.parse(f'{SRC}/{f}.dat'); od = f'{OUT}/{f}'; os.makedirs(od, exist_ok=True); info = {}; ims = []
    for x in e:
        if x[0] != 1: continue
        try:
            a, inf = img.decode(d[b+x[2]+4: b+x[3]] if False else d[b+x[2]+4: b+x[2]+x[3]])
        except Exception as ex:
            print('fail', f, x[1], ex); continue
        im = Image.fromarray(a, 'RGBA'); im.save(f'{od}/{x[1]}.png'); info[x[1]] = [im.width, im.height]; ims.append((x[1], im))
    json.dump(info, open(f'{od}/sizes.json', 'w'))
    # contact sheet on checker bg
    cell = 200; cols = 6; rows = (len(ims) + cols - 1) // cols
    sh = Image.new('RGBA', (cols * cell, rows * (cell + 14)), (60, 60, 70, 255)); dr = ImageDraw.Draw(sh)
    for i, (n, im) in enumerate(ims):
        s = min((cell - 8) / im.width, (cell - 8) / im.height, 1.0); t = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))))
        x0, y0 = (i % cols) * cell + 4, (i // cols) * (cell + 14) + 14
        sh.alpha_composite(t, (x0, y0)); dr.text((x0, y0 - 12), f'{n} {im.width}x{im.height}', fill=(255, 255, 0, 255))
    os.makedirs(f'{OUT}/_sheets', exist_ok=True); sh.convert('RGB').save(f'{OUT}/_sheets/{f}.png'); print(f, len(ims), 'images')
