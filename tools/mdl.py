import struct
class Bad(Exception): pass
def parse(c):
    """c = chunk payload after 4-byte length. returns dict or raises Bad."""
    o = 0
    def u16():
        nonlocal o
        if o+2 > len(c): raise Bad('eof u16 @%d'%o)
        v = struct.unpack('>H', c[o:o+2])[0]; o += 2; return v
    def fl(n):
        nonlocal o
        if o + 4*n > len(c): raise Bad('eof floats @%d need %d'%(o,n))
        v = struct.unpack('>%df'%n, c[o:o+4*n]); o += 4*n; return v
    m = {}
    m['flags'] = u16()
    m['bbox'] = fl(6) if m['flags'] & 0x10 else None
    n = u16(); p = fl(n*3); m['pos'] = [p[i:i+3] for i in range(0,len(p),3)]
    n2 = u16(); q = fl(n2*3); m['nrm'] = [q[i:i+3] for i in range(0,len(q),3)]
    n3 = u16(); m['ncol'] = n3
    if n3:
        if o + 4*n3 > len(c): raise Bad('eof col')
        m['col'] = c[o:o+4*n3]; o += 4*n3
    n4 = u16(); r = fl(n4*2); m['uv'] = [r[i:i+2] for i in range(0,len(r),2)]
    ns = u16(); m['subs'] = []
    for _ in range(ns):
        if o+3+8 > len(c): raise Bad('eof sub hdr')
        pre = c[o:o+3]; o += 3
        name = c[o:o+8].decode('latin1').rstrip(' \x00'); o += 8
        nt = u16()
        if o + nt*6 > len(c): raise Bad('eof idx @%d nt=%d'%(o,nt))
        idx = struct.unpack('>%dH'%(nt*3), c[o:o+nt*6]); o += nt*6
        m['subs'].append(dict(pre=pre.hex(), tex=name, tris=idx))
    m['trail'] = len(c) - o
    return m
