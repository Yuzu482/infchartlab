import {readFile,open,link,rename,rm,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {decodeForPreview} from '../dist/spc-preview.mjs';
import {dto} from './export-private-spc.mjs';
import {validateCatalog} from '../dist/catalog.mjs';
import {canonical,digest,encryptDto,decryptEnvelope} from '../server/builtin-charts.mjs';
import {builtinManifest} from '../server/builtin-manifest.mjs';
export const metadataHash='050a098bf0e0c286864f7454900d7b8ae599906d5dedb893e42f8985a024a4c5';
export const preparedHash='6fea0c17f7552e4abc7941f16fd5b2d12e9ff2e0c4169a1faab4dbc6ff0b367d';
export const bases=['disruptorarray','kuukansouzou','megameteor','technopolis','yumenohajimari'];
export const ids=bases.flatMap(b=>[0,1,2,3].map(n=>b+n));
const project=fileURLToPath(new URL('../',import.meta.url));
const catalogPath=resolve(project,'dist/catalog.json'),manifestPath=resolve(project,'server/builtin-manifest.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const inside=(a,b)=>{const r=relative(a,b);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\'))};
export async function regular(path,max=4*1024*1024){
 const p=resolve(path);if(await realpath(p)!==p)throw Error('input-path');
 const s=await lstat(p);if(!s.isFile()||s.size>max)throw Error('input-size');return readFile(p);
}
export async function exclusive(path,data){
 const p=resolve(path),parent=dirname(p);if(inside(project,p)||await realpath(parent)!==parent)throw Error('output-path');
 const temp=p+'.'+process.pid+'.tmp';let f,created=false;
 try{f=await open(temp,'wx',0o600);created=true;await f.writeFile(data);await f.sync();await f.close();f=null;await link(temp,p)}finally{await f?.close();if(created)await rm(temp,{force:true})}
}
export async function loadPrepared(path){const raw=await regular(path);if(sha(raw)!==preparedHash)throw Error('prepared-pin');return JSON.parse(raw)}
export function coverage(charts){if(!Array.isArray(charts)||charts.length!==20||new Set(charts.map(c=>c.payload?.chartId)).size!==20||charts.some(c=>!ids.includes(c.payload?.chartId)))throw Error('coverage');return charts}
export async function prepare(gameRoot,metadataFile){
 const raw=await regular(metadataFile);if(sha(raw)!==metadataHash)throw Error('metadata-pin');const m=JSON.parse(raw),root=await realpath(resolve(gameRoot));
 if(m.format!=='infalsus-chunithm-metadata-v1'||m.mapping.length!==20)throw Error('metadata');
 const folder=resolve(root,'infalsus_Data/StreamingAssets/aa/StandaloneWindows64');
 for(const [file,hash] of Object.entries(m.source))if(!/^[a-f0-9]{32}\.bundle$/u.test(file)||sha(await regular(resolve(folder,file)))!==hash)throw Error('source-pin');
 const charts=[];
 for(const row of m.mapping){
  if(!/^[a-f0-9]{32}$/u.test(row.Guid)||!ids.includes(row.FullLookupPath.slice(0,-4)))throw Error('mapping');
  const bytes=await regular(resolve(root,'dlc/dlc-chunithm-0/sam',row.Guid),200000);if(bytes.length!==row.FileLength||sha(bytes)!==row.sha256)throw Error('chart-pin');
  const decoded=decodeForPreview(new Uint8Array(bytes),row.FullLookupPath),r=decoded.report,payload=dto(row.FullLookupPath.slice(0,-4),decoded);canonical(payload);
  charts.push({payload,aggregate:{status:'ok',errorCode:null,lookupPath:row.FullLookupPath,fileSha256:sha(bytes),bpm:r.bpm,noteCount:r.notes.count,kindCounts:r.notes.kindCounts,time:r.time,tracks:r.tracks}});
 }
 coverage(charts);return {format:'infalsus-chunithm-prepared-v1',metadata:m,charts};
}
export async function merge(catalog,data){
 validateCatalog(catalog);if(data.format!=='infalsus-chunithm-prepared-v1'||sha(Buffer.from(JSON.stringify(data.metadata)+'\n'))!==metadataHash)throw Error('prepared-metadata');coverage(data.charts);
 if(catalog.dlcSource||catalog.songs.some(s=>s.packIds.includes(8)))throw Error('already-applied');
 const result=structuredClone(catalog);result.packs.push(data.metadata.pack);
 const byId=new Map(data.charts.map(c=>[c.payload.chartId,c]));
 for(const song of data.metadata.songs){
  const charts=song.charts.map(c=>{const x=byId.get(c.Id);if(!x||x.aggregate.noteCount!==x.payload.timeline.kind.length)throw Error('aggregate');canonical(x.payload);return {chartId:c.Id,flag:c.Difficulty,tier:({1:'MIN',2:'EVO',4:'ULT',8:'FBD'})[c.Difficulty],rating:c.Rating,levelLabel:c.LevelSectionIndicator,available:true,designer:/^chartDesigner\d+$/iu.test(c.DisplayChartDesigner)||!c.DisplayChartDesigner?null:c.DisplayChartDesigner,spc:x.aggregate}});
  result.songs.push({songId:song.songId,basename:song.basename,title:song.title,artist:song.artist,bpm:charts[0].spc.bpm.base,chapterId:null,packIds:[8],charts,jacket:song.jacket});
 }
 result.songs.sort((a,b)=>a.songId-b.songId);result.dlcSource={packId:8,metadataSha256:metadataHash};return validateCatalog(result);
}
async function config(){let text='';for await(const x of process.stdin){text+=x;if(text.length>2048)throw Error('configuration')}const v=JSON.parse(text);if(!/^[A-Za-z0-9_-]{43}$/u.test(v.key)||!/^[A-Za-z0-9_-]{43,128}$/u.test(v.seedToken)||v.key===v.seedToken)throw Error('configuration');return v}
async function replacePair(changes){const originals=[],temps=[];try{for(const [p,data] of changes){originals.push([p,await readFile(p).catch(e=>{if(e.code==='ENOENT')return null;throw e})]);const tmp=p+'.'+process.pid+'.tmp';temps.push(tmp);const f=await open(tmp,'wx');try{await f.writeFile(data);await f.sync()}finally{await f.close()}}for(let i=0;i<changes.length;i++)await rename(temps[i],changes[i][0])}catch(e){for(const [p,data] of originals){if(data===null){await rm(p,{force:true});continue}const tmp=p+'.rollback.tmp';await (await import('node:fs/promises')).writeFile(tmp,data,{flag:'wx'});await rename(tmp,p)}throw e}finally{for(const p of temps)await rm(p,{force:true})}}
export async function run(args){
 let o;try{o=parseArgs({args,strict:true,allowPositionals:false,options:Object.fromEntries(['mode','game-root','metadata','source','output','bundle','url','jacket-dir'].map(k=>[k,{type:'string'}]))}).values;const needed={prepare:['game-root','metadata','output'],apply:['source','jacket-dir'],encrypt:['source','output'],seed:['bundle','url','jacket-dir'],verify:['source','url']}[o.mode];if(!needed||needed.some(k=>!o[k]))throw Error()}catch{throw Object.assign(Error('arguments'),{arg:true})}
 if(o.mode==='prepare'){const data=await prepare(o['game-root'],o.metadata);if(inside(await realpath(o['game-root']),resolve(o.output)))throw Error('output-game');await exclusive(o.output,JSON.stringify(data)+'\n');return {charts:20,events:data.charts.reduce((n,c)=>n+c.aggregate.noteCount,0)}}
 if(['apply','encrypt'].includes(o.mode)){
  const data=await loadPrepared(o.source),catalog=JSON.parse(await regular(catalogPath)),next=o.mode==='apply'?await merge(catalog,data):null;coverage(data.charts);
  if(o.mode==='apply'){const manifest={...builtinManifest};for(const x of data.charts){if(Object.hasOwn(manifest,x.payload.chartId))throw Error('manifest-conflict');const text=canonical(x.payload);manifest[x.payload.chartId]={version:1,plainSha256:await digest(text),plainBytes:Buffer.byteLength(text)}}const covers=[];for(const song of data.metadata.songs){const png=await regular(resolve(o['jacket-dir'],song.basename+'.png'));if(sha(png)!==song.jacket.sha256)throw Error('jacket-pin');const dest=resolve(project,'dist/jackets',song.basename+'.png');try{await lstat(dest);throw Error('jacket-exists')}catch(e){if(e.code!=='ENOENT')throw e}covers.push([dest,png])}await replacePair([...covers,[catalogPath,JSON.stringify(next)+'\n'],[manifestPath,'// Verified original-game chart hashes and sizes only; no timelines or secrets.\nexport const builtinManifest=Object.freeze('+JSON.stringify(manifest)+');\n']]);return {charts:20,library:320}}
  const c=await config(),envelopes=[];for(const x of data.charts){const {entry,envelope}=await encryptDto(x.payload,c.key);if(JSON.stringify(entry)!==JSON.stringify(builtinManifest[x.payload.chartId]))throw Error('manifest');await decryptEnvelope(envelope,c.key);envelopes.push(envelope)}await exclusive(o.output,JSON.stringify({format:'infalsus-encrypted-builtin-v1',charts:envelopes})+'\n');return {encrypted:20};
 }
 const u=new URL(o.url);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw Error('url');
 if(o.mode==='seed'){const c=await config(),bundle=JSON.parse(await regular(o.bundle));if(bundle.format!=='infalsus-encrypted-builtin-v1'||bundle.charts.length!==20||new Set(bundle.charts.map(x=>x.chartId)).size!==20||bundle.charts.some(x=>!ids.includes(x.chartId)))throw Error('bundle');for(const x of bundle.charts)await decryptEnvelope(x,c.key);for(const x of bundle.charts){const r=await fetch(new URL('/api/builtin-charts/import',u),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+c.seedToken,'content-type':'application/json'},body:JSON.stringify(x)});if(!r.ok)throw Error('seed_'+r.status)}return {imported:20}}
 const data=await loadPrepared(o.source);coverage(data.charts);let events=0;for(const x of data.charts){const r=await fetch(new URL('/api/builtin-charts/'+x.payload.chartId,u),{redirect:'error',signal:AbortSignal.timeout(30000),cache:'no-store'});if(!r.ok)throw Error('read_'+r.status);const {payload}=await r.json();if(canonical(payload)!==canonical(x.payload))throw Error('live-parity');events+=payload.timeline.kind.length}return {charts:20,events,anonymous:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(process.argv.slice(2)).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.arg?'invalid-arguments':'chunithm-operation-failed:'+(/^[a-z0-9-]+$/u.test(e.message)?e.message:'invalid'));process.exitCode=e.arg?2:1});
