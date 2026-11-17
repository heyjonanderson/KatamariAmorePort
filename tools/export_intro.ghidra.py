import struct, json
mem = currentProgram.getMemory(); af = currentProgram.getAddressFactory().getDefaultAddressSpace()
def A(a): return af.getAddress('%08x' % a)
def W(a): return mem.getInt(A(a)) & 0xffffffff
def f(v): return struct.unpack('<f', struct.pack('<I', v))[0]
def sg(v): return v if v < 0x80000000 else v - 0x100000000
packs = {1: (0x8ae98, 0x8c6b0), 2: (0x8cc70, 0x8dfe4), 3: (0x8e5a4, 0x90188)}
out = {}
for p, (tb, nl) in packs.items():
    rows = []
    a = tb
    while True:
        w = [W(a + 4*i) for i in range(15)]
        if w[0] == 0 or w[0] > 0x1e or len(rows) > 600: break
        rows.append({'op': w[0], 'spr': sg(w[1]), 'page': sg(w[2]), 't0': sg(w[3]), 't1': sg(w[4]), 'x': sg(w[5]), 'y': sg(w[6]),
                     'p0': sg(w[7]), 'p1': sg(w[8]), 'rgb': [w[9], w[10], w[11]], 'layer': sg(w[12]), 'f6': f(w[13]), 'w14': w[14]})
        a += 60
    names = []
    a = nl
    while len(names) < 200:
        b = ''
        for i in range(8):
            c = mem.getByte(A(a + i)) & 0xff
            if c == 0: break
            b += chr(c)
        if len(b) < 3 or not all(32 < ord(c) < 127 for c in b) or not b.startswith('Dem'): break
        w = [W(a + 8 + 4*i) for i in range(6)]
        names.append({'name': b, 'a': w[0] & 0xffff, 'b': w[0] >> 16, 'c': w[1] & 0xffff, 'd': w[1] >> 16, 'e': w[2], 'fw': f(w[3]), 'fh': f(w[4]), 'f1': f(w[5])})
        a += 32
    out[p] = {'table': tb, 'rows': rows, 'names': names, 'nameEnd': a}
    print('pack', p, 'rows', len(rows), 'names', len(names), hex(a))
open('out/intro.json', 'w').write(json.dumps(out))
