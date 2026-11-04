import struct, numpy as np
from PIL import Image
def decode(pl, nibble='lo'):
    """pl = chunk payload (after the 4-byte length). returns (RGBA uint8 HxWx4, info dict)"""
    flags = pl[1]; cnt = struct.unpack('>H', pl[2:4])[0]
    w, h = struct.unpack('>HH', pl[4:8])
    alpha = flags & 1; idx8 = bool(flags & 8); direct = bool(flags & 0x10)
    body = pl[8:]
    if direct:
        bpp = 4 if alpha else 3
        a = np.frombuffer(body[:w*h*bpp], np.uint8).reshape(h, w, bpp)
        out = np.dstack([a, np.full((h,w,1),255,np.uint8)]) if bpp == 3 else a
        return out, dict(w=w,h=h,mode='direct%d'%(bpp*8))
    n = cnt if cnt else 256
    if idx8 and cnt == 0: n = 256
    ps = 4 if alpha else 3
    pal = np.frombuffer(body[:n*ps], np.uint8).reshape(n, ps)
    if ps == 3: pal = np.hstack([pal, np.full((n,1),255,np.uint8)])
    raw = np.frombuffer(body[n*ps:], np.uint8)
    if idx8:
        idx = raw[:w*h]
    else:
        raw = raw[:(w*h)//2]
        lo, hi = raw & 15, raw >> 4
        idx = np.stack([lo,hi],1).reshape(-1) if nibble=='lo' else np.stack([hi,lo],1).reshape(-1)
    idx = idx.reshape(h, w)
    full = np.zeros((256,4),np.uint8); full[:n] = pal
    return full[idx], dict(w=w,h=h,mode=('p8' if idx8 else 'p4')+('a' if alpha else ''), n=n)
def smooth(rgba):
    a = rgba[...,:3].astype(np.int16)
    return float(np.abs(np.diff(a,axis=1)).mean())
