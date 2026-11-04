# Writes data/strings_en.json from English.lproj/STRING.dat: {names: [[name, first string index]], strings: [...]}.
import sys, os, struct, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dat
SRC = sys.argv[1]; OUT = sys.argv[2]
d, b, e, _ = dat.parse(f'{SRC}/English.lproj/STRING.dat'); x = e[0]; c = d[b+x[2]+4: b+x[2]+x[3]]
n = struct.unpack('>I', c[:4])[0]; ent = [(c[4+i*20: 20+i*20].decode('latin1').strip(), struct.unpack('>I', c[20+i*20: 24+i*20])[0]) for i in range(n)]
p = 4 + n * 20; cnt = struct.unpack('>I', c[p:p+4])[0]; pool = p + 4 + cnt * 8; S = []
for k in range(cnt):
    o, l = struct.unpack('>2I', c[p+4+k*8: p+12+k*8]); S.append(c[pool+o: pool+o+l].decode('utf-8', 'replace'))
json.dump(dict(names=ent, strings=S), open(OUT, 'w'), ensure_ascii=False); print(n, 'groups', cnt, 'strings')
