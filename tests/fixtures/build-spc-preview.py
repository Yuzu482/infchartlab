#!/usr/bin/env python3
"""Build a deterministic synthetic ICP1 preview fixture; no game data is read."""
import argparse, base64, importlib.util, json, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('infalsus_spc_decode', ROOT/'tools/infalsus_spc_decode.py')
dec = importlib.util.module_from_spec(spec); spec.loader.exec_module(dec)
KEY = bytes.fromhex('f016284b7d9ec3a5')
SEED = 'synthetic-preview-chart'

def build():
    count, events = 1201, 2
    p = bytearray(28 + 80*count + 32*events)
    p[:4] = b'ICP1'; struct.pack_into('<4Hii ff', p, 4, 1,28,80,32,count,events,120.0,0.0)
    state = dec._initial_state(SEED,count,1)
    kinds = [1,2,3,4]
    for i in range(count):
        kind = kinds[i] if i < 4 else 1
        start = (-500 if i == 0 else 250 if i == 1 else 400 if i == 2 else 800 if i == 3 else 10*(i%1000))
        end = 12000 if i == 0 else start + 40
        vals = [start,end,kind,0,1,1,1,1]
        off = 28 + i*80
        clear = [i,0] + [x & 0xffffffff for x in vals]
        for f,x in enumerate(clear):
            rel,width = (8*f,8) if f < 2 else (16+4*(f-2),4)
            mask = dec._field_mask(state,i,f)
            p[off+rel:off+rel+width] = ((x+mask) & ((1<<(8*width))-1)).to_bytes(width,'little')
        for j,(a,b) in enumerate([(i%5,1),(0,1),(2 if kind==1 else 1,1),(0,1)]):
            struct.pack_into('<ii',p,off+48+8*j,a,b)
        pairs=[]; gcds=[]
        for j,(a,b) in enumerate([(i%5,1),(0,1),(2 if kind==1 else 1,1),(0,1)]):
            n,d,g=dec._normalize_pair(a,b);gcds.append(g);m=vals[4+j]
            pairs.append(((n*m)&0xffffffff, (d*m)&0xffffffff))
        def u(x): return x & 0xffffffff
        dec._mix_state(state,i,0,(u(end)<<32)|u(start))
        dec._mix_state(state,u(kind),0,(pairs[0][1]<<32)|pairs[0][0])
        dec._mix_state(state,(pairs[1][1]<<32)|pairs[1][0],(pairs[2][1]<<32)|pairs[2][0],(pairs[3][1]<<32)|pairs[3][0])
        dec._finish_note_checksum(state,i,i,gcds)
    base = 28+80*count
    for i,(t,bpm) in enumerate([(0,150.0),(2000,180.0)]):
        struct.pack_into('<QiI',p,base+32*i,i,t,1)
        struct.pack_into('<d',p,base+32*i+16,bpm)
    encrypted=bytes(v^KEY[i&7] for i,v in enumerate(p))
    decoded=dec.decode_spc(encrypted,SEED,4)
    assert decoded['notes']['count']==count and decoded['notes']['kindCounts']=={'1':1198,'2':1,'3':1,'4':1}
    assert decoded['time']['startMs']==-500 and decoded['time']['endMs']==12000
    return {'seed':SEED,'base64':base64.b64encode(encrypted).decode(),'expected':decoded}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);a=ap.parse_args()
    Path(a.output).write_text(json.dumps(build(),separators=(',',':'))+'\n',encoding='utf8')
if __name__=='__main__': main()
