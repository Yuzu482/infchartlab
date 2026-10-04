#!/usr/bin/env python3
"""Build the public catalog's verified SPC aggregates from the pinned local game."""
import argparse, hashlib, importlib, json, os, re, sys, tempfile
from pathlib import Path

PINS={"infalsus_spc_decode.py":"182f3bec94078b9b50982f126468f845f71a97d711970c67cbbe856c4a0a0f9b","infalsus_chart_probe.py":"5a88ebd5c788732efaec181cda778b427346fd695a653e7b6598f9a0be809a01","infalsus_mapping_object_reader.py":"37ec22f9926e6b25095697f55308e79f22bd8d3e9e65f342d7a454c21c0239bd"}
MAX_PUBLIC=8*1024*1024
class BuildError(Exception): pass
def sha(b): return hashlib.sha256(b).hexdigest()
def _stage(path,data):
    path.parent.mkdir(parents=True,exist_ok=True); fd,tmp=tempfile.mkstemp(prefix='.spc-tmp-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        return Path(tmp)
    except BaseException:
        try: os.unlink(tmp)
        except OSError: pass
        raise
def atomic_write(path,data):
    staged=_stage(path,data)
    try: os.replace(staged,path)
    except BaseException:
        try: staged.unlink()
        except OSError: pass
        raise
def atomic_write_pair(first,first_data,second,second_data,overwrite):
    targets=(Path(first),Path(second)); staged=[]; replaced=[]; originals={}
    try:
        for target,data in zip(targets,(first_data,second_data)):
            staged.append(_stage(target,data))
        if overwrite:
            for target in targets:
                if target.exists(): originals[target]=target.read_bytes()
        for temp,target in zip(staged,targets):
            os.replace(temp,target); replaced.append(target)
    except BaseException:
        for target in reversed(replaced):
            try:
                if target in originals:
                    restore=_stage(target,originals[target]); os.replace(restore,target)
                else: target.unlink()
            except OSError: pass
        raise
    finally:
        for temp in staged:
            try: temp.unlink()
            except OSError: pass
def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--game-root',required=True);p.add_argument('--deps',required=True);p.add_argument('--catalog',required=True);p.add_argument('--output',required=True);p.add_argument('--evidence-output',required=True);p.add_argument('--overwrite',action='store_true');a=p.parse_args(argv)
    outputs=[Path(a.output).absolute(),Path(a.evidence_output).absolute()]
    try:
        if outputs[0]==outputs[1] or (not a.overwrite and any(x.exists() for x in outputs)): raise BuildError('output-exists-or-conflict')
        project=Path(__file__).resolve().parents[2];tools=project/'tools';sys.dont_write_bytecode=True
        catpath=Path(a.catalog).absolute();resolved=[x.resolve() for x in outputs]
        if resolved[0]==resolved[1]: raise BuildError('output-exists-or-conflict')
        protected=[(tools/name).resolve() for name in PINS]+[catpath.resolve()]
        for target in resolved:
            if any(target==pin or pin in target.parents or target in pin.parents for pin in protected if not (pin==catpath.resolve() and target==outputs[0].resolve())): raise BuildError('output-input-overlap')
        for name,digest in PINS.items():
            if sha((tools/name).read_bytes())!=digest: raise BuildError('helper-source-hash-mismatch')
        sys.path.insert(0,str(tools));sys.path.insert(0,a.deps)
        probe=importlib.import_module('infalsus_chart_probe');reader=importlib.import_module('infalsus_mapping_object_reader');decoder=importlib.import_module('infalsus_spc_decode')
        if not Path(a.deps).is_dir(): raise BuildError('dependency-directory-unavailable')
        cp_path=project/probe.CHECKPOINT_REL
        if any(target==cp_path.resolve() or cp_path.resolve() in target.parents or target in cp_path.resolve().parents for target in resolved): raise BuildError('output-input-overlap')
        cp=probe.read_regular(cp_path,2*1024*1024,project)
        if sha(cp)!=probe.CHECKPOINT_SHA: raise BuildError('checkpoint-integrity-failed')
        cpdoc=json.loads(cp);rows=probe.chart_rows(cpdoc)
        if len(rows)!=303: raise BuildError('checkpoint-chart-count')
        catbytes=catpath.read_bytes();catalog=json.loads(catbytes)
        if catalog.get('format')!='infalsus-song-catalog-v1' or catalog.get('buildId')!='25594228' or len(catalog.get('songs',[]))!=78: raise BuildError('catalog-shape')
        game=Path(a.game_root).absolute();root=game/probe.INPUT_ROOT;mapping={};before={}
        for name,(size,digest) in probe.INPUTS.items():
            blob=probe.read_regular(root/name,size,game)
            if len(blob)!=size or sha(blob)!=digest: raise BuildError('mapping-integrity-failed')
            mapping[name]=blob;before[name]=sha(blob)
        UnityPy=importlib.import_module('UnityPy')
        if getattr(UnityPy,'__version__',None)!='1.25.3' or not Path(UnityPy.__file__).resolve().is_relative_to(Path(a.deps).resolve()): raise BuildError('dependency-invalid')
        entries=reader.read_entries(mapping,UnityPy)
        expected_ids={c['chartId'] for s in catalog['songs'] for c in s['charts']}
        if len(expected_ids)!=303 or sum(1 for s in catalog['songs'] for c in s['charts'] if c['available'])!=300: raise BuildError('catalog-chart-coverage')
        if expected_ids!=set(rows): raise BuildError('catalog-checkpoint-identity-mismatch')
        byid={c['chartId']:c for s in catalog['songs'] for c in s['charts']};allrefs={};referrors={}
        for cid in sorted(expected_ids):
            if not byid[cid]['available']: continue
            try:
                ref=probe.select_exact_reference(entries,cid);seed=ref.get('FullLookupPath');norm=probe.validate_mapping_path(seed);guid=ref.get('Guid');length=ref.get('FileLength')
                if not isinstance(guid,str) or not re.fullmatch(r'[0-9a-fA-F]{32}',guid) or type(length)is not int or not 1<=length<=probe.MAX_CHART: raise probe.ProbeError('chart-reference-invalid')
                path=game/'infalsus_Data/StreamingAssets/sam'/guid.lower();blob=probe.read_regular(path,probe.MAX_CHART,game)
                if len(blob)!=length: raise probe.ProbeError('chart-size-mismatch')
                allrefs[cid]=(seed,norm,guid.lower(),path,blob,sha(blob))
            except (probe.ProbeError,OSError) as e:
                referrors[cid]=e.code if isinstance(e,probe.ProbeError) else 'chart-file-unavailable'
        native_before={}
        for name,(lim,digest) in probe.NATIVE_INPUTS.items():
            h=sha(probe.read_regular(game/name,lim,game))
            if h!=digest: raise BuildError('native-integrity-failed')
            native_before[name]=h
        manifest=[];failed=0
        for cid in sorted(expected_ids):
            chart=byid[cid]
            if not chart['available']:
                chart['spc']={'status':'unsupported','errorCode':'chart-unavailable','lookupPath':None,'fileSha256':None,'bpm':None,'noteCount':None,'kindCounts':None,'time':None,'tracks':None};continue
            if cid in referrors:
                failed+=1;chart['spc']={'status':'error','errorCode':referrors[cid],'lookupPath':None,'fileSha256':None,'bpm':None,'noteCount':None,'kindCounts':None,'time':None,'tracks':None};manifest.append({'chartId':cid,'expectedError':referrors[cid],'lookupPath':None,'fileSha256':None});continue
            seed,norm,guid,path,blob,digest=allrefs[cid]
            try:
                r=decoder.decode_spc(blob,seed,note_limit=4);changes=r['tempo']['changes']
                if len(changes)>10000: raise decoder.DecodeError('tempo-change-limit')
                metric={'status':'ok','errorCode':None,'lookupPath':seed,'fileSha256':digest,'bpm':{'base':r['bpm'],'changes':changes},'noteCount':r['notes']['count'],'kindCounts':r['notes']['kindCounts'],'time':r['time'],'tracks':r['tracks']}
                row={'chartId':cid,'guid':guid,'lookupPath':seed,'fileSha256':digest,'expected':metric,'samples':[{'noteIndex':n['noteIndex'],'kind':n['kind'],'laneStart':n['laneStart'],'laneEnd':n['laneEnd'],'startMs':n['startMs'],'endMs':n['endMs'],'durationMs':n['durationMs'],'rawU64':[str(x) for x in n['rawU64']],'rawI32':n['rawI32'],'rawPairs':n['rawPairs'],'normalizedPairs':n['normalizedPairs'],'bpm':n['bpm']} for n in r['notes']['samples']]}
            except decoder.DecodeError as e:
                failed+=1;metric={'status':'error','errorCode':e.code,'lookupPath':None,'fileSha256':None,'bpm':None,'noteCount':None,'kindCounts':None,'time':None,'tracks':None};row={'chartId':cid,'guid':guid,'lookupPath':seed,'fileSha256':digest,'expectedError':e.code}
            chart['spc']=metric
            manifest.append(row)
        doc={**catalog,'spcSchema':'infalsus-spc-aggregate-v1','spcSource':{'decoderSha256':PINS['infalsus_spc_decode.py'],'checkpointSha256':probe.CHECKPOINT_SHA,'chartCount':303,'availableCount':300,'mappingSha256':{n:d for n,(size,d) in probe.INPUTS.items()},'nativeSha256':{n:d for n,(size,d) in probe.NATIVE_INPUTS.items()}}}
        payload=(json.dumps(doc,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n').encode('utf-8');ev=(json.dumps({'format':'infalsus-spc-private-evidence-v1','successCount':len(manifest)-failed,'errorCount':failed,'coverage':len(manifest),'charts':manifest},ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n').encode()
        if len(payload)>MAX_PUBLIC: raise BuildError('public-catalog-size-limit')
        # Verify every source again before publishing either artifact.
        if sha(cp_path.read_bytes())!=probe.CHECKPOINT_SHA or sha(catpath.read_bytes())!=sha(catbytes): raise BuildError('input-drift')
        for name,(size,digest) in probe.INPUTS.items():
            if sha(probe.read_regular(root/name,size,game))!=before[name]: raise BuildError('input-drift')
        for name,(limit,digest) in probe.NATIVE_INPUTS.items():
            if sha(probe.read_regular(game/name,limit,game))!=native_before[name]: raise BuildError('input-drift')
        for cid,(_,_,_,path,_,digest) in allrefs.items():
            if sha(probe.read_regular(path,probe.MAX_CHART,game))!=digest: raise BuildError('input-drift')
        if any(x.exists() for x in outputs) and not a.overwrite: raise BuildError('output-exists')
        atomic_write_pair(outputs[0],payload,outputs[1],ev,a.overwrite)
        return 0
    except (BuildError, OSError, ValueError, KeyError, TypeError, ImportError) as e:
        print('build-spc-catalog: '+(str(e) if isinstance(e,BuildError) else 'controlled-failure'),file=sys.stderr);return 2
if __name__=='__main__': raise SystemExit(main())
