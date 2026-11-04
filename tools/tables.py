import struct
def parse_monolist(c):
    n = struct.unpack(">I", c[:4])[0]; o = 4; out = []
    for _ in range(n):
        rid = struct.unpack('>I', c[o:o+4])[0]; o += 4
        name = c[o:o+16].decode('latin1').rstrip(); o += 16
        o += 1
        model = c[o:o+8].decode('latin1').rstrip(); o += 8
        f = struct.unpack('>3f', c[o:o+12]); o += 12
        cat = c[o]; o += 1
        e = c.find(b'\0', o); e = len(c) if e < 0 else e
        desc = c[o:e].decode('shift_jis', 'replace'); o = e
        out.append(dict(id=rid, name=name, model=model, f=f, cat=cat, desc=desc))
    return out, o
def parse_mloc(c):
    n = struct.unpack('>H', c[:2])[0]
    names = [c[2+16*i:18+16*i].decode('latin1').rstrip() for i in range(n)]
    o = 2 + 16*n; m = struct.unpack('>H', c[o:o+2])[0]; o += 2
    recs = []
    for i in range(m):
        idx = struct.unpack('>H', c[o:o+2])[0]; v = struct.unpack('<6f', c[o+2:o+26]); o += 26
        recs.append(dict(name=names[idx], pos=v[:3], rot=v[3:]))
    return names, recs, len(c) - o

def parse_hitmap(h):
    nv = struct.unpack('>H', h[:2])[0]
    v = struct.unpack('>%df' % (nv * 3), h[2:2 + nv * 12]); o = 2 + nv * 12
    npoly = struct.unpack('>H', h[o:o+2])[0]; o += 2; polys = []
    while o < len(h):
        k = h[o]; n = struct.unpack('>H', h[o+1:o+3])[0]
        polys.append([k] + list(struct.unpack('>%dH' % n, h[o+3:o+3+2*n]))); o += 3 + 2 * n
    return list(v), polys, (len(polys) == npoly and o == len(h))
