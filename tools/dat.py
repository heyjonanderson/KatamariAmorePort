import struct, sys, os, glob, collections
def parse(path):
    d = open(path,'rb').read()
    tsize = struct.unpack('>I', d[:4])[0]
    count = d[4]
    base = 4 + tsize
    ents = []
    for i in range(count):
        o = 5 + i*13
        t = d[o]; name = d[o+1:o+9].decode('latin1').rstrip(' \x00'); off = struct.unpack('>I', d[o+9:o+13])[0]
        ents.append([t,name,off])
    ok = (tsize == 1 + 13*count)
    for i,e in enumerate(ents):
        end = ents[i+1][2] if i+1 < len(ents) else len(d)-base
        e.append(end-e[2])
    return d, base, ents, ok
if __name__ == '__main__':
    root = sys.argv[1]
    bad = 0; types = collections.Counter(); tot = 0
    for p in sorted(glob.glob(root+'/*.dat')):
        try:
            d, base, ents, ok = parse(p)
        except Exception as ex:
            print('FAIL', os.path.basename(p), ex); bad += 1; continue
        mono = all(ents[i][2] <= ents[i+1][2] for i in range(len(ents)-1))
        last_ok = (not ents) or (base + ents[-1][2] <= len(d))
        if not (ok and mono and last_ok):
            print('SUSPECT', os.path.basename(p), ok, mono, last_ok); bad += 1
        for e in ents: types[e[0]] += 1; tot += 1
    print('files parsed, bad =', bad, ' chunks =', tot, ' types =', dict(types))
