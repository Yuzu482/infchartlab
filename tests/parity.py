import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True


def rec(sid=1, diff=1, score=10, timestamp=0, lamp=1, clear=4, ignored=b'\0'*6, unused=b'\0\0'):
    b = bytearray(96)
    struct.pack_into('<HBB', b, 0, sid, diff, lamp)
    b[4] = clear
    b[5] = 0xa5
    struct.pack_into('<Hh', b, 6, 123, -7)
    for i in range(4):
        struct.pack_into('<7H', b, 10+16*i, 1, 2, 3, 4, 5, 6, 7)
        b[24+16*i:26+16*i] = unused
    b[74:80] = ignored
    struct.pack_into('<QQ', b, 80, score, timestamp)
    return bytes(b)


def key(name, sid, diff):
    raw = name if isinstance(name, bytes) else name.encode('utf8')
    try:
        units = len(raw.decode('utf8').encode('utf-16-le')) // 2
    except UnicodeDecodeError:
        units = 1
    return b'\3' + struct.pack('<ii', ~len(raw), units) + raw + struct.pack('<HB', sid, diff)


def build(entries=None, history=None, capacity=8, prefix=b'noise', trailer=b'trailing'):
    entries = entries if entries is not None else [('alpha',1,1,rec(1,1,98_000_000)),('alpha',1,2,rec(1,2,90_000_000)),('beta',2,4,rec(2,4,79_000_000))]
    history = history if history is not None else [('alpha',rec(1,1,97_000_000)),('alpha',rec(1,1,98_000_000)),('alpha',rec(1,2,92_000_000)),(None,rec(99,8,0,timestamp=123))]
    best = b''.join(key(n,s,d)+v for n,s,d,v in entries)
    sec = b'\4'+struct.pack('<i',len(entries))+best
    hh = len(sec)
    arr = b''.join(v for _,v in history)+bytes(max(0,capacity-len(history))*96)
    sec += b'\2'+struct.pack('<i',capacity)+arr+struct.pack('<i',len(history))+trailer
    base = 1+len(prefix)
    return b'\11'+prefix+sec, {'section':base,'history_header':base+hh,'array':base+hh+5,'count':base+hh+5+capacity*96}


def norm(b):
    if b.endswith(b'\r\n'):
        return b[:-2], 'CRLF'
    if b.endswith(b'\n'):
        return b[:-1], 'LF'
    return b, 'none'


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--probe',required=True)
    ap.add_argument('--node',default='node')
    ap.add_argument('--real-save')
    a=ap.parse_args()
    probe=Path(a.probe).resolve()
    parser=Path(__file__).resolve().parents[1]/'dist'/'parser.mjs'
    cases=[]
    def add(label,data,code=0): cases.append((label,data,code))
    base,_=build(); add('valid-base',base)
    names=['BOM\ufeffname','nonBMP😀','C1\x85name','line\u2028sep','quote"name','音楽😀']
    for i,n in enumerate(names): add('name-'+str(i),build(entries=[(n,1,1,rec())],history=[])[0])
    for n in (b'\xff',): add('malformed-utf8',build(entries=[(n,1,1,rec())],history=[])[0],2)
    for length in (512,513): add('name-bytes-'+str(length),build(entries=[('a'*length,1,1,rec())],history=[])[0],0 if length==512 else 2)
    for ts in (0,9007199254740993,18446744073709551615): add('timestamp-'+str(ts),build(entries=[('a',1,1,rec(timestamp=ts))],history=[])[0])
    for score in (101000000,101000001): add('score-'+str(score),build(entries=[('a',1,1,rec(score=score))],history=[])[0],0 if score<=101000000 else 2)
    add('zero-history-max',build(entries=[('a',1,1,rec(score=0))],history=[(None,rec(score=0))])[0])
    add('empty',b'',2); add('unsupported',b'\x08',2)
    add('truncated',b'\x09noise\x04\x01\x00\x00\x00',2)
    add('oversized',b'\x09'+bytes(16*1024*1024),2)
    add('unreadable',None,2)
    d,off=build(); add('history-capacity-1',build(history=[],capacity=1)[0])
    add('history-capacity-max',build(history=[],capacity=65536)[0])
    for cap in (0,65537):
        x,o=build(history=[],capacity=1); z=bytearray(x); struct.pack_into('<i',z,o['history_header']+1,cap); add('capacity-'+str(cap),bytes(z),2)
    for n in (1,2048): add('best-count-'+str(n),build(entries=[('n'+str(i),i%65535,1,rec(i%65535,1,1)) for i in range(n)],history=[],capacity=1)[0])
    for n in (0,2049):
        x=bytearray(b'\x09noise\x04'+struct.pack('<i',n)); add('best-count-'+str(n),bytes(x),2)
    for length in range(1,7): add('short-'+str(length),b'\x09'+bytes(length-1),2)
    add('prefix-shift',build(prefix=b'x'*137)[0])
    add('ignored-padding',build(entries=[('a',1,1,rec(ignored=b'123456',unused=b'xy'))],history=[])[0])
    add('duplicate-key',build(entries=[('a',1,1,rec()),('a',1,1,rec())],history=[])[0],2)
    add('identity-mismatch',build(entries=[('a',1,1,rec(2,1,1))],history=[])[0],2)
    x,o=build(history=[],capacity=2,trailer=b''); z=bytearray(x); z[o['array']]=1; add('nonzero-unused-history',bytes(z),2)
    add('candidate-limit',b'\x09noise'+(b'\x04\1\0\0\0\3'+struct.pack('<iiHB',-1,0,1,1)+rec())*513,2)
    add('ambiguous',base+base[base.find(b'\x04',1):],2)
    bom_name = b'\xef\xbb\xbfalpha'
    add('name-leading-bom', build(entries=[(bom_name, 1, 1, rec(1, 1, 1))])[0])
    exact_size = base + bytes((16 * 1024 * 1024) - len(base))
    add('valid-exact-16mib', exact_size)
    for label, name in [('name-c0', b'bad\x01name'), ('name-del', b'bad\x7fname'), ('name-slash', b'bad/name'), ('name-backslash', b'bad\\name'), ('name-dot', b'.'), ('name-dotdot', b'..')]:
        add(label, build(entries=[(name, 1, 1, rec(1, 1, 1))])[0], 2)
    anchor = b'\x04\x01\x00\x00\x00\x03' + struct.pack('<iiHB', -1, 0, 1, 1) + rec()
    add('512-plausible-invalid-anchors', b'\x09noise' + anchor * 512, 2)
    _, offsets = build()
    key_start = offsets['section'] + 5
    name_start = key_start + 9
    value_start = name_start + 5 + 3
    data = bytearray(base)
    struct.pack_into('<i', data, key_start + 5, 0x10005)
    add('name-utf16-high-bits', bytes(data), 2)
    data = bytearray(base)
    struct.pack_into('<i', data, key_start + 1, 0)
    add('name-raw-length-zero', bytes(data), 2)
    for label, offset, value in [('invalid-lamp', 3, 0xff), ('invalid-clear', 4, 0xff), ('invalid-record-difficulty', 2, 3)]:
        data = bytearray(base)
        record_start = value_start
        data[record_start + offset] = value
        add(label, bytes(data), 2)
    data = bytearray(build(entries=[('alpha', 1, 1, rec(1, 2, 1))])[0])
    add('key-record-difficulty-mismatch', bytes(data), 2)
    for label, count in [('history-count-negative', -1), ('history-count-over-capacity', 9)]:
        data = bytearray(base)
        struct.pack_into('<i', data, offsets['count'], count)
        add(label, bytes(data), 2)
    for label, cut in [('truncated-key-header', key_start + 8), ('truncated-name', name_start + 4), ('truncated-record', value_start + 95), ('truncated-history-count', offsets['count'] + 3)]:
        add(label, base[:cut], 2)
    entries = [('one', 1, 1, rec(1, 1, 5)), ('two', 1, 1, rec(1, 1, 6))]
    history = [('one', rec(1, 1, 5)), ('two', rec(1, 1, 6))]
    add('distinct-basenames-same-id-difficulty', build(entries=entries, history=history)[0])
    if a.real_save:
        rp=Path(a.real_save).resolve(); before=hashlib.sha256(rp.read_bytes()).digest()
        add('real-save',rp)
    checks=0; failures=[]; terms={}
    with tempfile.TemporaryDirectory(prefix='infalsus-parity-') as td:
        td=Path(td)
        for i,(label,data,expected) in enumerate(cases):
            path=td/(str(i)+'.sav')
            if isinstance(data,Path): path=data
            elif data is not None: path.write_bytes(data)
            else: path=td/'missing.sav'
            for mode in ('default','records'):
                option=[] if mode=='default' else ['--records']
                p=subprocess.run([sys.executable,'-B',str(probe),str(path),*option],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                n=subprocess.run([a.node,str(parser),str(path),*option],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                checks+=1
                if p.returncode!=expected or n.returncode!=expected:
                    failures.append({'case':label,'mode':mode,'exit':True})
                x,tx=norm(p.stdout); y,ty=norm(n.stdout); terms[label+'/'+mode]=[tx,ty]
                if x!=y: failures.append({'case':label,'mode':mode,'byte':next((j for j,(u,v) in enumerate(zip(x,y)) if u!=v),min(len(x),len(y)))})
                if label in ('valid-base','real-save'):
                    for command,first in (([sys.executable,'-B',str(probe),str(path),*option],p),([a.node,str(parser),str(path),*option],n)):
                        again=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                        if again.returncode!=first.returncode or again.stdout!=first.stdout: failures.append({'case':label,'mode':mode,'determinism':True})
    unchanged=True
    if a.real_save: unchanged=hashlib.sha256(Path(a.real_save).read_bytes()).digest()==before
    print(json.dumps({'checks':checks,'cases':len(cases),'modes':['default','records'],'failures':failures,'terminalNewlineNormalization':terms,'realTested':bool(a.real_save),'realUnchanged':unchanged},sort_keys=True,separators=(',',':')))
    return 1 if failures or not unchanged else 0


if __name__=='__main__':
    sys.exit(main())