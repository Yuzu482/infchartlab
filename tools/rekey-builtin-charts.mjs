import {readFile,writeFile,readdir,lstat,rm} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonical,digest,encryptDto,decryptEnvelope,handleBuiltin} from '../server/builtin-charts.mjs';
import {exclusive} from './vsinger-charts.mjs';
export const seedPath=id=>'/api/builtin-charts/repair/'+encodeURIComponent(id);
export async function scanTree(folders,needles){
 let files=0;
 async function visit(path){const info=await lstat(path);if(info.isSymbolicLink())throw Error('scan_symlink');if(info.isDirectory()){for(const name of await readdir(path))await visit(resolve(path,name));return}if(!info.isFile())throw Error('scan_type');const data=await readFile(path);if(needles.some(s=>data.includes(Buffer.from(s))))throw Error('package_leak');files++}
 for(const folder of folders)await visit(folder);return files;
}
async function configuration(){
 if(process.stdin.isTTY)process.stdin.setRawMode(true);console.log('Ready for private configuration on stdin (input is hidden).');
 const lines=createInterface({input:process.stdin});let timer;
 try{const text=await new Promise((ok,no)=>{timer=setTimeout(()=>no(Error('configuration_timeout')),60000);lines.once('line',ok);lines.once('close',()=>no(Error('configuration_missing')))});if(text.length>2048)throw Error('configuration');const c=JSON.parse(text);if(!/^[A-Za-z0-9_-]{43}$/u.test(c.key)||!/^[A-Za-z0-9_-]{43,128}$/u.test(c.seedToken)||c.key===c.seedToken)throw Error('configuration');return c}
 finally{clearTimeout(timer);lines.close();if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause()}
}
async function records(o){const lists=await Promise.all([o.base,o.dlc].map(async p=>{const b=JSON.parse(await readFile(resolve(p),'utf8'));if(b.format!=='infalsus-encrypted-builtin-v1')throw Error('bundle');return b.charts}));if(lists[0].length!==280||lists[1].length!==20||new Set(lists.flat().map(x=>x.chartId)).size!==300)throw Error('coverage');return lists.flat()}
function url(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('url');return u}
async function verifyRemote(o,manifest){const base=url(o.url),results=[],list=await records(o);let events=0;for(const x of list){const r=await fetch(new URL('/api/builtin-charts/'+x.chartId,base),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('read_'+x.chartId+'_'+r.status);const {payload}=await r.json();if(payload.chartId!==x.chartId||await digest(canonical(payload))!==manifest[x.chartId]?.plainSha256)throw Error('integrity');events+=payload.timeline.kind.length;results.push({chartId:x.chartId,status:r.status,hashMatched:true,notes:payload.timeline.kind.length})}if(events!==198324)throw Error('events');
 const denied=await fetch(new URL('/api/builtin-charts/import',base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json'},body:'{}'});if(denied.status!==403)throw Error('write_auth');
 const wrong=await fetch(new URL('/api/builtin-charts/import',base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:'Bearer '+'A'.repeat(43)},body:'{}'});if(wrong.status!==403)throw Error('write_auth');
 await writeFile(resolve(o.evidence),JSON.stringify({charts:300,events,anonymous:true,unauthorizedWrite:403,wrongToken:403,results})+'\n',{flag:'wx'});return {charts:300,events,anonymous:true,unauthorizedWrite:403,wrongToken:403};}
export async function run(args){let o;try{o=parseArgs({args,strict:true,allowPositionals:false,options:Object.fromEntries(['mode','base','dlc','source','prepared','url','evidence'].map(x=>[x,{type:'string'}]))}).values;if(!['prepare','local','scan','seed','verify'].includes(o.mode))throw Error();for(const k of ({prepare:['base','dlc','source','prepared'],local:['base','dlc'],scan:['prepared'],seed:['base','dlc','url','evidence'],verify:['base','dlc','url','evidence']}[o.mode]))if(!o[k])throw Error()}catch{throw Object.assign(Error('arguments'),{arg:true})}
 if(o.mode==='prepare'){
  const c=await configuration(),raw=await readFile(resolve(o.source));if(await digest(raw)!=='1451b39ac88c23dfccac7107bfbe974db79609f7d18a945fb3052ee315caf001')throw Error('source_hash');
  const data=JSON.parse(raw),{builtinManifest:current}=await import('../server/builtin-manifest.mjs');
  if(data.format!=='infalsus-private-timelines-v2'||data.charts.length!==280||new Set(data.charts.map(x=>x.chartId)).size!==280||data.charts.reduce((n,x)=>n+x.timeline.kind.length,0)!==185068)throw Error('source_coverage');
  const envelopes=[];for(const payload of data.charts){if(await digest(canonical(payload))!==current[payload.chartId]?.plainSha256)throw Error('source_integrity');envelopes.push((await encryptDto(payload,c.key)).envelope)}
  await exclusive(o.base,JSON.stringify({format:'infalsus-encrypted-builtin-v1',charts:envelopes})+'\n');
  const r=spawnSync(process.execPath,['tools/vsinger-charts.mjs','--mode','encrypt','--source',o.prepared,'--output',o.dlc],{input:JSON.stringify(c)+'\n',encoding:'utf8',timeout:60000});
  if(r.error||r.signal||r.status!==0){await rm(resolve(o.base),{force:true});throw Error('prepare_failed')}return {charts:300,events:198324};
 }
 const {builtinManifest:manifest}=await import('../server/builtin-manifest.mjs');
 if(o.mode==='verify')return verifyRemote(o,manifest);
 const c=await configuration();
 if(o.mode==='scan'){const prepared=JSON.parse(await readFile(o.prepared,'utf8')),snippets=prepared.charts.map(x=>JSON.stringify(x.payload.timeline.startMs.slice(0,12))),needles=[c.key,c.seedToken,...snippets];const clientFiles=await scanTree(['dist/client'],[...needles,...Object.values(manifest).map(x=>x.plainSha256)]),serverFiles=await scanTree(['dist/server','.openai'],needles);return {filesScanned:clientFiles+serverFiles,secretsLeaked:false,timelinesLeaked:false}}
 const list=await records(o);for(const x of list)await decryptEnvelope(x,c.key,manifest);
 if(o.mode==='local'){const {createD1}=await import('../tests/helpers/d1-sqlite.mjs'),d=await createD1();let events=0;try{for(const x of list){const request=()=>new Request('https://site.test/api/builtin-charts/import',{method:'POST',headers:{authorization:'Bearer '+c.seedToken,'content-type':'application/json'},body:JSON.stringify(x)});for(let n=0;n<2;n++){d.resetInvocation();const r=await handleBuiltin(request(),{DB:d.DB,BUILTIN_CHART_KEY:c.key,BUILTIN_CHART_SEED_TOKEN:c.seedToken},manifest);if(!r.ok||d.invocationCount>32)throw Error('local_import')}const r=await handleBuiltin(new Request('https://site.test/api/builtin-charts/'+x.chartId),{DB:d.DB,BUILTIN_CHART_KEY:c.key},manifest);if(!r.ok)throw Error('local_read');const {payload}=await r.json();if(await digest(canonical(payload))!==manifest[x.chartId].plainSha256)throw Error('local_integrity');events+=payload.timeline.kind.length}if(d.db.prepare('SELECT count(*) n FROM builtin_chart').get().n!==300||events!==198324||d.db.prepare('SELECT count(*) n FROM builtin_chart_chunk WHERE length(payload)>65536').get().n)throw Error('local_coverage');return {charts:300,events,ciphertextOnly:true,idempotent:true}}finally{d.close()}}
 const base=url(o.url),outcomes=[];
 for(let i=0;i<list.length;i++){const x=list[i];const r=await fetch(new URL(seedPath(x.chartId),base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+c.seedToken,'content-type':'application/json'},body:JSON.stringify(x)});outcomes.push({chartId:x.chartId,status:r.status});await writeFile(resolve(o.evidence),JSON.stringify({outcomes})+'\n');if(!r.ok)throw Error('seed_'+x.chartId+'_'+r.status);if((i+1)%50===0)console.log(JSON.stringify({seeded:i+1}))}return {seeded:300};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(process.argv.slice(2)).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.arg?'invalid-arguments':e.message?.match(/^[a-zA-Z0-9_]+$/u)?e.message:'rekey-operation-failed');process.exitCode=e.arg?2:1});
