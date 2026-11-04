import json, os, sys, math
import numpy as np
from PIL import Image
WEB = os.path.expanduser('~/work/web/data')

def load_group(stage, tag):
    base = f'{WEB}/{stage}/'
    man = json.load(open(base + tag + '.json')); blob = open(base + tag + '.bin', 'rb').read()
    tex = {n: np.array(Image.open(f'{base}tex/{n}.png').convert('RGBA')) for n in man['tex']}
    for m in man['models']:
        v = np.frombuffer(blob, np.float32, m['nv'] * 8, m['voff']).reshape(-1, 8)
        m['v'] = v; m['lo'] = v[:, :3].min(0); m['hi'] = v[:, :3].max(0)
        for s in m['subs']: s['idx'] = np.frombuffer(blob, np.uint16, s['n'], s['off']).reshape(-1, 3).astype(int)
    return man, tex

def persp_view(eye, target, w, h, fov=0.9):
    z = np.array(eye, float) - target; z /= np.linalg.norm(z)
    x = np.cross([0, 1, 0], z); x /= np.linalg.norm(x); y = np.cross(z, x)
    R = np.stack([x, y, z]); f = 1 / math.tan(fov / 2)
    return R, np.array(eye, float), f, w, h

def render(items, tex, view, bg=(140, 190, 240)):
    R, eye, f, W, H = view
    img = np.zeros((H, W, 3), np.uint8); img[:] = bg; zbuf = np.full((H, W), 1e30)
    asp = W / H
    L = np.array([0.4, 0.8, 0.5]); L /= np.linalg.norm(L)
    for it in items:   # (model, uniform scale, translation[, 3x3 rotation])
        m, mat_s, mat_t = it[:3]; Rm = it[3] if len(it) > 3 else np.eye(3)
        v = m['v']; P = (v[:, :3] * mat_s) @ Rm.T + mat_t; N = v[:, 3:6] @ Rm.T
        cam = (P - eye) @ R.T                   # camera space, looking down -z
        lit = 0.55 + 0.45 * np.abs(N @ L)
        for s in m['subs']:
            t = tex.get(s['tex']); th, tw = (t.shape[0], t.shape[1]) if t is not None else (1, 1)
            for a, b, c in s['idx']:
                pa, pb, pc = cam[a], cam[b], cam[c]
                if pa[2] > -0.05 or pb[2] > -0.05 or pc[2] > -0.05: continue
                sx = [(p[0] / -p[2]) * f / asp * W / 2 + W / 2 for p in (pa, pb, pc)]
                sy = [H / 2 - (p[1] / -p[2]) * f * H / 2 for p in (pa, pb, pc)]
                x0, x1 = int(max(min(sx), 0)), int(min(max(sx) + 1, W - 1)); y0, y1 = int(max(min(sy), 0)), int(min(max(sy) + 1, H - 1))
                if x1 < x0 or y1 < y0: continue
                den = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
                if abs(den) < 1e-9: continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                l0 = ((sy[1] - sy[2]) * (gx - sx[2]) + (sx[2] - sx[1]) * (gy - sy[2])) / den
                l1 = ((sy[2] - sy[0]) * (gx - sx[2]) + (sx[0] - sx[2]) * (gy - sy[2])) / den
                l2 = 1 - l0 - l1
                inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
                if not inside.any(): continue
                iw = np.array([1 / -pa[2], 1 / -pb[2], 1 / -pc[2]])
                pw = l0 * iw[0] + l1 * iw[1] + l2 * iw[2]
                depth = 1 / pw
                ys, xs = np.nonzero(inside)
                zz = depth[ys, xs]; py = ys + y0; px = xs + x0
                ok = zz < zbuf[py, px]
                if not ok.any(): continue
                ys, xs, zz, py, px = ys[ok], xs[ok], zz[ok], py[ok], px[ok]
                b0, b1, b2 = l0[ys, xs] * iw[0] / pw[ys, xs], l1[ys, xs] * iw[1] / pw[ys, xs], l2[ys, xs] * iw[2] / pw[ys, xs]
                if t is not None:
                    uv = v[a, 6:8][None] * b0[:, None] + v[b, 6:8][None] * b1[:, None] + v[c, 6:8][None] * b2[:, None]
                    tx = (np.floor((uv[:, 0] % 1.0) * tw).astype(int)) % tw; ty = (np.floor((uv[:, 1] % 1.0) * th).astype(int)) % th
                    col = t[ty, tx]; keep = col[:, 3] >= 100
                    rgb = col[:, :3].astype(float)
                else:
                    keep = np.ones(len(px), bool); rgb = np.tile([255., 0, 255.], (len(px), 1))
                ln = lit[a] * b0 + lit[b] * b1 + lit[c] * b2
                rgb = np.clip(rgb * ln[:, None], 0, 255).astype(np.uint8)
                img[py[keep], px[keep]] = rgb[keep]; zbuf[py[keep], px[keep]] = zz[keep]
    return img

def ascii_art(img, cols=110):
    im = Image.fromarray(img); h = int(cols * im.height / im.width * 0.5)
    g = np.array(im.resize((cols, h)).convert('L')).astype(int); ramp = ' .:-=+*#%@'
    return '\n'.join(''.join(ramp[min(9, v * 10 // 256)] for v in row) for row in g)

def gallery(stage, cols=8, cell=128, yaw=0.7, pitch=0.35, bg=(140, 190, 240)):
    import math
    man, tex = load_group(stage, 'obj')
    ms = man['models']; rows = (len(ms) + cols - 1) // cols
    sheet = np.zeros((rows * cell, cols * cell, 3), np.uint8); sheet[:] = bg
    for i, m in enumerate(ms):
        lo, hi = m['lo'], m['hi']; c = (lo + hi) / 2; r = max(np.linalg.norm(hi - lo) / 2, 1e-3)
        d = r * 2.6
        eye = c + d * np.array([math.cos(pitch) * math.sin(yaw), math.sin(pitch), math.cos(pitch) * math.cos(yaw)])
        img = render([(m, 1.0, np.zeros(3))], tex, persp_view(eye, c, cell, cell), bg=bg)
        y, x = divmod(i, cols); sheet[y * cell:(y + 1) * cell, x * cell:(x + 1) * cell] = img
    return sheet, ms


def euler_view(rx, ry, rz):
    """logic space (z-mirrored) -> view space: M R_A M = Ry(-ry) Rx(-rx) Rz(rz); angles in degrees"""
    import math
    def Rx(a): c, s_ = math.cos(a), math.sin(a); return np.array([[1,0,0],[0,c,-s_],[0,s_,c]])
    def Ry(a): c, s_ = math.cos(a), math.sin(a); return np.array([[c,0,s_],[0,1,0],[-s_,0,c]])
    def Rz(a): c, s_ = math.cos(a), math.sin(a); return np.array([[c,-s_,0],[s_,c,0],[0,0,1]])
    d = math.radians
    return Ry(-d(ry)) @ Rx(-d(rx)) @ Rz(d(rz))

def stage_items(stage, letter='S'):
    import json
    man, tex = load_group(stage, 'map'); om, otex = load_group(stage, 'obj'); tex = {**tex, **otex}
    sj = json.load(open(f'{WEB}/{stage}/stage.json')); mdl = {m['name']: m for m in om['models']}; byname = {m['name']: m['model'] for m in sj['mono']}
    items = [(m, 1.0, np.zeros(3)) for m in man['models']]; miss = 0; n = 0
    for tname, recs in sj['mloc'].items():
        if tname[3] != letter: continue
        for nm, x, y, z, rx, ry, rz in recs:
            m = mdl.get(byname.get(nm))
            if m is None: miss += 1; continue
            items.append((m, 1.0, np.array([x, y, -z]), euler_view(rx, ry, rz))); n += 1
    return items, tex, man, (n, miss)
