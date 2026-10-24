import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,readdir,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {rows,coverage,mergeCatalog} from '../tools/vsinger-charts.mjs';
import {encryptDto,decryptEnvelope,handleBuiltin,canonical,digest} from '../server/builtin-charts.mjs';
import {createD1} from './helpers/d1-sqlite.mjs';
import {scanTree,seedPath} from '../tools/rekey-builtin-charts.mjs';
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url),'utf8'));
test('leak scan covers nested files of every type and rejects planted secret or timeline',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vsinger-scan-'));
 try{await mkdir(join(dir,'assets'));await writeFile(join(dir,'assets','data.wasm'),Buffer.from([0,1,2,3]));assert.equal(await scanTree([dir],['private-test-key']),1);
  await writeFile(join(dir,'assets','source.map'),'private-test-key');await assert.rejects(()=>scanTree([dir],['private-test-key']),/package_leak/u);
  await rm(join(dir,'assets','source.map'));await writeFile(join(dir,'assets','notes.txt'),'[100,200,300]');await assert.rejects(()=>scanTree([dir],['[100,200,300]']),/package_leak/u);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('all 300 charts, including existing DLC, survive a second key rotation', {skip:!process.env.INFALSUS_BASE_SOURCE||!process.env.INFALSUS_VSINGER_SOURCE},async()=>{
 const base=JSON.parse(await readFile(process.env.INFALSUS_BASE_SOURCE,'utf8')),dlc=JSON.parse(await readFile(process.env.INFALSUS_VSINGER_SOURCE,'utf8')),payloads=[...base.charts,...dlc.charts.map(x=>x.payload)];assert.equal(payloads.length,300);
 const d=await createD1(),manifest={};try{for(let cycle=0;cycle<2;cycle++){const key=randomBytes(32).toString('base64url'),token=randomBytes(32).toString('base64url'),env={DB:d.DB,BUILTIN_CHART_KEY:key,BUILTIN_CHART_SEED_TOKEN:token};let events=0;
  for(const payload of payloads){const {entry,envelope}=await encryptDto(payload,key);if(cycle)assert.deepEqual(entry,manifest[payload.chartId]);manifest[payload.chartId]=entry;assert.equal(seedPath(payload.chartId),'/api/builtin-charts/repair/'+payload.chartId);
   const request=new Request('https://site.test'+seedPath(payload.chartId),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(envelope)}),saved=await handleBuiltin(request,env,manifest);assert.equal(saved.status,cycle?200:201);
   const read=await handleBuiltin(new Request('https://site.test/api/builtin-charts/'+payload.chartId),env,manifest);assert.equal(read.status,200);const result=(await read.json()).payload;assert.equal(await digest(canonical(result)),entry.plainSha256);events+=result.timeline.kind.length;
  }assert.equal(events,198324);assert.equal(d.db.prepare('SELECT count(*) n FROM builtin_chart').get().n,300);
 }}finally{d.close()}
});
test('DLC coverage uses song pack membership, all four tiers and unique pinned GUIDs',()=>{
 assert.equal(coverage(catalog).size,20);
 for(const mapping of [rows.slice(1),[...rows.slice(1),rows[1]],rows.map((r,i)=>i? r:{...r,guid:'../escape'})])assert.throws(()=>coverage(catalog,mapping));
 const copy=structuredClone(catalog);copy.songs.find(s=>s.packIds.includes(7)).packIds=[];assert.throws(()=>coverage(copy));
});
test('CLI invalid arguments and corrupt inputs leave no outputs; module import has no side effects',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vsinger-'));
 try{const source=join(dir,'bad.json'),output=join(dir,'out.json');await writeFile(source,'{');
  for(const [args,status] of [[[],2],[['--mode','other'],2],[['--mode','prepare','--game-root',join(dir,'absent'),'--output',output],1],[['--mode','encrypt','--source',source,'--output',output],1]]){
   const r=spawnSync(process.execPath,['tools/vsinger-charts.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8',input:JSON.stringify({key:randomBytes(32).toString('base64url'),seedToken:randomBytes(32).toString('base64url')}),timeout:10000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,status);assert.equal((await readdir(dir)).includes('out.json'),false);
  }
  const imported=spawnSync(process.execPath,['--input-type=module','-e',"await import('./tools/vsinger-charts.mjs')"],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});assert.equal(imported.status,0);assert.equal(imported.stdout,'');
  const rekeyArgs=spawnSync(process.execPath,['tools/rekey-builtin-charts.mjs','--mode','absent'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});assert.equal(rekeyArgs.status,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('actual DLC: aggregate parity, preserve base catalog, encrypted import and anonymous preview', {skip:!process.env.INFALSUS_VSINGER_SOURCE},async()=>{
 const data=JSON.parse(await readFile(process.env.INFALSUS_VSINGER_SOURCE,'utf8')),next=mergeCatalog(catalog,data.charts);
 assert.equal(data.charts.length,20);assert.equal(data.charts.reduce((n,x)=>n+x.payload.timeline.kind.length,0),13256);
 const ids=coverage(catalog),expected={kakushicommand:[142,338,582,769,1080],lostonesweeping:[162,197,357,551,873],monitoring:[132,157,288,471,1035],nonbreathoblige:[148,296,491,758,1409],roki:[150,322,514,951,1817]};
 for(let i=0;i<catalog.songs.length;i++)if(!catalog.songs[i].packIds.includes(7))assert.deepEqual(next.songs[i],catalog.songs[i]);
 const key=randomBytes(32).toString('base64url'),token=randomBytes(32).toString('base64url'),manifest={},records=[];
 for(const {payload,aggregate} of data.charts){assert.ok(ids.has(payload.chartId));const name=payload.chartId.slice(0,-1),tier=Number(payload.chartId.slice(-1));assert.equal(payload.bpm.base,expected[name][0]);assert.equal(payload.timeline.kind.length,expected[name][tier+1]);assert.equal(aggregate.noteCount,payload.timeline.kind.length);assert.equal(Object.values(aggregate.kindCounts).reduce((a,b)=>a+b,0),aggregate.noteCount);assert.equal(aggregate.lookupPath,payload.chartId+'.spc');assert.match(aggregate.fileSha256,/^[a-f0-9]{64}$/u);assert.deepEqual(aggregate.bpm.changes.map(x=>({timeMs:x.timeMs,bpm:x.bpm})),payload.bpm.changes);const encrypted=await encryptDto(payload,key);manifest[payload.chartId]=encrypted.entry;records.push(encrypted.envelope)}
 const d=await createD1(),env={DB:d.DB,BUILTIN_CHART_KEY:key,BUILTIN_CHART_SEED_TOKEN:token};
 try{for(const record of records){const make=()=>new Request('https://site.test/api/builtin-charts/import',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(record)});for(let i=0;i<2;i++){d.resetInvocation();const r=await handleBuiltin(make(),env,manifest);assert.ok(r.ok);assert.ok(d.invocationCount<=32)}const r=await handleBuiltin(new Request('https://site.test/api/builtin-charts/'+record.chartId),env,manifest);assert.equal(r.status,200);const {payload}=await r.json();assert.deepEqual(payload,await decryptEnvelope(record,key,manifest));assert.equal(await digest(canonical(payload)),manifest[record.chartId].plainSha256)}assert.equal(d.db.prepare('SELECT count(*) n FROM builtin_chart').get().n,20);assert.equal(d.db.prepare('SELECT max(length(payload)) n FROM builtin_chart_chunk').get().n<=65536,true)}finally{d.close()}
});
