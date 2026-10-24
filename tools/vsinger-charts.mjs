import {readFile,lstat,realpath,open,link,rename,rm} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {decodeForPreview} from '../dist/spc-preview.mjs';
import {dto} from './export-private-spc.mjs';
import {validateCatalog} from '../dist/catalog.mjs';
import {canonical,digest,encryptDto,decryptEnvelope} from '../server/builtin-charts.mjs';
import {builtinManifest} from '../server/builtin-manifest.mjs';

// Verified DLC startup mapping, pinned to build 25594228. No SPC bytes.
export const rows=`kakushicommand0 ca1c2d85de91fb843b172db4b6c0ea02 27164
kakushicommand1 a9508356523e5134db096a319e060473 47868
kakushicommand2 318dab32da43b4e418a622f5f9e50f1c 61740
kakushicommand3 13836241c5c5d67428c578bbd4cfc07e 88828
lostonesweeping0 c11673078127d294a95b7fe6773a12c0 15852
lostonesweeping1 6839bdb6c2a92d649a8ce4fe5a3af2e9 28812
lostonesweeping2 a455b47a65a701a47a7b3fb537e90495 44108
lostonesweeping3 27a3a1aa4acb8494fa91985223b1daf8 69868
monitoring0 c403048fe4b58734fa996e20b6943c7d 12652
monitoring1 f91e484eed819584d84bd9a789a1bd00 23164
monitoring2 f6f94ea55bb51b548b0c49e8623a11d6 37708
monitoring3 d611017fec0739e40a2bb613dc284be2 82828
nonbreathoblige0 205d388906880044085e3bee86e35b9e 23772
nonbreathoblige1 cef8ea6719290fd4494ae4e0c5a2c5cc 39660
nonbreathoblige2 52869f448da2e854ca66b917f2ca30a7 60668
nonbreathoblige3 3303b4b608718d94cb399634a605706a 112748
roki0 f94010894e99e32419da9490127625f4 26012
roki1 0abfbd7161a736d4f92b5f6b83fb5f16 42044
roki2 f10455faa089d884ba8c3f6b74b8b5f1 76268
roki3 3401a747279bb0f49b8e04ef13087305 145548`.split('\n').map(x=>{const [chartId,guid,size]=x.split(' ');return {chartId,guid,size:Number(size),lookupPath:chartId+'.spc'}});
const pins={
 'infalsus_Data/StreamingAssets/aa/StandaloneWindows64/cdd2b6723e4881a30b2c2c07ed43b566.bundle':'73ac8c3e4c9f2fd4c1526779644b5009ea941319c5f4a443a5200ebcc21fe7c4',
 'GameAssembly.dll':'0d4d339b050188cbd53922ee0204105ca71305abfb73bcfdb994affe1b33e70c',
 'infalsus_Data/il2cpp_data/Metadata/global-metadata.dat':'b3fccad7cb85f61e1e01cac8ff22e9878a0276b7349c42881caeb567c767ef83'
};
const project=fileURLToPath(new URL('../',import.meta.url));
const catalogPath=new URL('../dist/catalog.json',import.meta.url),manifestPath=new URL('../server/builtin-manifest.mjs',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const inside=(parent,child)=>{const r=relative(parent,child);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep))};
async function regular(path,max=256*1024*1024){
 for(let p=resolve(path);;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw Error('symlink');if(p===dirname(p))break}
 const s=await lstat(path);if(!s.isFile()||s.size>max)throw Error('input_size');return readFile(path);
}
export function coverage(catalog,mapping=rows){
 const expected=catalog.songs.filter(s=>s.packIds.includes(7)).flatMap(s=>s.charts.filter(c=>c.available).map(c=>c.chartId));
 if(expected.length!==20||mapping.length!==20||new Set(mapping.map(r=>r.chartId)).size!==20||new Set(mapping.map(r=>r.guid)).size!==20||mapping.some(r=>!expected.includes(r.chartId)||!/^[a-f0-9]{32}$/u.test(r.guid)||r.lookupPath!==r.chartId+'.spc'||!Number.isSafeInteger(r.size)||r.size<=0||r.size>150000))throw Error('coverage');return new Set(expected);
}
export function mergeCatalog(catalog,charts){
 const expected=coverage(catalog);if(charts.length!==20||new Set(charts.map(x=>x.payload.chartId)).size!==20||charts.some(x=>!expected.has(x.payload.chartId)))throw Error('coverage');
 const out=structuredClone(catalog),byId=new Map(charts.map(x=>[x.payload.chartId,x.aggregate]));
 for(const s of out.songs)for(const c of s.charts)if(byId.has(c.chartId))c.spc=structuredClone(byId.get(c.chartId));
 return validateCatalog(out);
}
export async function exclusive(path,text,gameRoot){
 const target=resolve(path),parent=await realpath(dirname(target));
 if(parent!==resolve(dirname(target))||inside(project,target)||(gameRoot&&inside(gameRoot,target)))throw Error('unsafe_output');
 for(let p=parent;;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw Error('symlink');if(p===dirname(p))break}
 const temp=target+'.'+process.pid+'.tmp';let f;
 try{f=await open(temp,'wx',0o600);await f.writeFile(text);await f.sync();await f.close();f=null;await link(temp,target)}finally{await f?.close();await rm(temp,{force:true})}
}
export async function prepare(gameRoot){
 const root=await realpath(resolve(gameRoot));if(root!==resolve(gameRoot))throw Error('game_root');
 const catalog=validateCatalog(JSON.parse(await readFile(catalogPath,'utf8')));coverage(catalog);
 for(const [p,h] of Object.entries(pins))if(hash(await regular(resolve(root,p)))!==h)throw Error('game_pin');
 const charts=[];
 for(const row of rows){const path=resolve(root,'dlc/dlc-vsingers-0/sam',row.guid),bytes=await regular(path,150000);if(bytes.length!==row.size)throw Error('chart_size');
  const decoded=decodeForPreview(new Uint8Array(bytes),row.lookupPath),r=decoded.report,payload=dto(row.chartId,decoded);canonical(payload);
  charts.push({payload,aggregate:{status:'ok',errorCode:null,lookupPath:row.lookupPath,fileSha256:hash(bytes),bpm:r.bpm,noteCount:r.notes.count,kindCounts:r.notes.kindCounts,time:r.time,tracks:r.tracks}});
  if(hash(await regular(path,150000))!==hash(bytes))throw Error('chart_changed');
 }
 if(charts.reduce((n,x)=>n+x.payload.timeline.kind.length,0)!==13256)throw Error('events');mergeCatalog(catalog,charts);
 for(const [p,h] of Object.entries(pins))if(hash(await regular(resolve(root,p)))!==h)throw Error('game_changed');
 return {format:'infalsus-vsinger-prepared-v1',charts};
}
async function secrets(){let text='';for await(const part of process.stdin){text+=part;if(text.length>2048)throw Error('configuration')}const value=JSON.parse(text);if(typeof value.key!=='string'||typeof value.seedToken!=='string'||! /^[A-Za-z0-9_-]{43}$/u.test(value.key)||! /^[A-Za-z0-9_-]{43,128}$/u.test(value.seedToken)||value.key===value.seedToken)throw Error('configuration');return value}
async function bundle(path){const value=JSON.parse(await regular(path,3*1024*1024));coverage(JSON.parse(await readFile(catalogPath,'utf8')),value.charts?.map(x=>({...rows.find(r=>r.chartId===x.chartId)}))||[]);if(value.format!=='infalsus-encrypted-builtin-v1')throw Error('bundle');return value.charts}
function origin(value){const u=new URL(value);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw Error('url');return u}
export async function run(args){
 let opts;try{opts=parseArgs({args,strict:true,allowPositionals:false,options:Object.fromEntries(['mode','game-root','output','source','bundle','url'].map(x=>[x,{type:'string'}]))}).values;if(!['prepare','encrypt','import','verify-live'].includes(opts.mode))throw Error();for(const k of ({prepare:['game-root','output'],encrypt:['source','output'],import:['bundle','url'],'verify-live':['bundle','url']}[opts.mode]))if(!opts[k])throw Error()}catch{throw Object.assign(Error('arguments'),{arg:true})}
 if(opts.mode==='prepare'){const data=await prepare(opts['game-root']);await exclusive(opts.output,JSON.stringify(data)+'\n',await realpath(resolve(opts['game-root'])));return {charts:20,events:13256}}
 if(opts.mode==='encrypt'){
  const value=await secrets(),data=JSON.parse(await regular(opts.source,3*1024*1024)),catalog=JSON.parse(await readFile(catalogPath,'utf8'));if(data.format!=='infalsus-vsinger-prepared-v1')throw Error('source');const next=mergeCatalog(catalog,data.charts),manifest={...builtinManifest},records=[];
  for(const x of data.charts){const {entry,envelope}=await encryptDto(x.payload,value.key);if(entry.plainSha256!==await digest(canonical(x.payload))||x.payload.timeline.kind.length!==x.aggregate.noteCount)throw Error('parity');if(manifest[x.payload.chartId]&&JSON.stringify(manifest[x.payload.chartId])!==JSON.stringify(entry))throw Error('manifest_conflict');manifest[x.payload.chartId]=entry;records.push(envelope)}
  if(Object.keys(manifest).length!==300||records.reduce((n,x)=>n+manifest[x.chartId].plainBytes,0)>2*1024*1024||data.charts.reduce((n,x)=>n+x.payload.timeline.kind.length,0)!==13256)throw Error('coverage');
  await exclusive(opts.output,JSON.stringify({format:'infalsus-encrypted-builtin-v1',charts:records})+'\n');
  const changes=[[catalogPath,JSON.stringify(next)+'\n'],[manifestPath,'// Verified original-game chart hashes and sizes only; no timelines or secrets.\nexport const builtinManifest=Object.freeze('+JSON.stringify(manifest)+');\n']],staged=[],old=[];
  try{for(const [url,text] of changes){const p=fileURLToPath(url),t=p+'.'+process.pid+'.tmp';old.push([p,await readFile(p)]);staged.push(t);const f=await open(t,'wx');try{await f.writeFile(text);await f.sync()}finally{await f.close()}}for(let i=0;i<changes.length;i++)await rename(staged[i],fileURLToPath(changes[i][0]))}
  catch(e){for(const [p,text] of old){const f=await open(p,'w');try{await f.writeFile(text)}finally{await f.close()}}await rm(resolve(opts.output),{force:true});throw e}finally{for(const t of staged)await rm(t,{force:true})}
  return {charts:20,events:13256,library:300};
 }
 const records=await bundle(opts.bundle),url=origin(opts.url);let events=0;
 if(opts.mode==='import'){const value=await secrets();for(const x of records)await decryptEnvelope(x,value.key);for(const x of records){const r=await fetch(new URL('/api/builtin-charts/import',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+value.seedToken,'content-type':'application/json'},body:JSON.stringify(x)});if(!r.ok)throw Error('import_'+r.status)}return {imported:records.length}}
 for(const x of records){const r=await fetch(new URL('/api/builtin-charts/'+x.chartId,url),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('read_'+r.status);const {payload}=await r.json();if(payload.chartId!==x.chartId||await digest(canonical(payload))!==builtinManifest[x.chartId]?.plainSha256)throw Error('integrity');events+=payload.timeline.kind.length}if(events!==13256)throw Error('events');return {charts:20,events,anonymous:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(process.argv.slice(2)).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.arg?'invalid-arguments':'vsinger-operation-failed');process.exitCode=e.arg?2:1});
