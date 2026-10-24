import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {validateCatalog} from '../dist/catalog.mjs';
import {coverage,ids,exclusive,loadPrepared} from '../tools/chunithm-charts.mjs';
import {builtinManifest} from '../server/builtin-manifest.mjs';
import {canonical,encryptDto,handleBuiltin} from '../server/builtin-charts.mjs';
import {createD1} from './helpers/d1-sqlite.mjs';
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
test('CHUNITHM pinned extension includes exact20 charts and baseline remains valid',()=>{
 assert.equal(validateCatalog(catalog),catalog);assert.equal(catalog.songs.length,83);assert.equal(catalog.packs.length,8);
 const added=catalog.songs.filter(s=>s.packIds.includes(8));assert.deepEqual(added.flatMap(s=>s.charts.map(c=>c.chartId)).sort(),[...ids].sort());
 assert.equal(Object.keys(builtinManifest).length,320);assert.ok(added.every(s=>s.jacket?.width===256&&s.charts.every(c=>c.designer===null&&c.spc.status==='ok')));
 const old=structuredClone(catalog);old.songs=old.songs.filter(s=>!s.packIds.includes(8));old.packs=old.packs.filter(p=>p.packId!==8);delete old.dlcSource;assert.equal(validateCatalog(old),old);
 for(const mutate of [c=>delete c.dlcSource,c=>c.dlcSource.metadataSha256='a'.repeat(64),c=>c.songs.find(s=>s.songId===77).charts[0].chartId='unknown',c=>c.songs.find(s=>s.songId===77).packIds=[7]]){const c=structuredClone(catalog);mutate(c);assert.throws(()=>validateCatalog(c));}
});
test('coverage rejects duplicates or missing payloads',()=>{assert.throws(()=>coverage([]));assert.throws(()=>coverage(Array.from({length:20},()=>({payload:{chartId:ids[0]}}))));});
test('exclusive output and CLI failure leave no temporary files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'chunithm-'));
 try{const p=join(dir,'out.json');await exclusive(p,'original');await assert.rejects(exclusive(p,'replaced'));assert.equal(await readFile(p,'utf8'),'original');assert.deepEqual(await readdir(dir),['out.json']);
  const tool=fileURLToPath(new URL('../tools/chunithm-charts.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[tool,'--mode','prepare','--unknown','x'],{encoding:'utf8'});assert.equal(result.status,2);
  await writeFile(join(dir,'bad.json'),'{}');await assert.rejects(loadPrepared(join(dir,'bad.json')),/prepared-pin/);const bad=spawnSync(process.execPath,[tool,'--mode','prepare','--game-root',dir,'--metadata',join(dir,'bad.json'),'--output',join(dir,'never.json')],{encoding:'utf8'});assert.equal(bad.status,1);assert.deepEqual((await readdir(dir)).sort(),['bad.json','out.json']);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('real twenty charts encrypted roundtrip, partial seed rerun, anonymous reads',{skip:!process.env.INFALSUS_CHUNITHM_PREPARED},async()=>{
 const data=JSON.parse(await readFile(process.env.INFALSUS_CHUNITHM_PREPARED));coverage(data.charts);const key=randomBytes(32).toString('base64url'),token=randomBytes(32).toString('base64url'),d=await createD1();
 try{const env={DB:d.DB,BUILTIN_CHART_KEY:key,BUILTIN_CHART_SEED_TOKEN:token};let events=0;
  const envelopes=await Promise.all(data.charts.map(async c=>(await encryptDto(c.payload,key)).envelope));
  const seed=async x=>{d.resetInvocation();return handleBuiltin(new Request('https://site.test/api/builtin-charts/import',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(x)}),env)};
  for(const x of envelopes.slice(0,7))assert.equal((await seed(x)).status,201);
  for(let i=0;i<envelopes.length;i++){assert.equal((await seed(envelopes[i])).status,i<7?200:201);d.resetInvocation();const r=await handleBuiltin(new Request('https://site.test/api/builtin-charts/'+ids[i]),env);assert.equal(r.status,200);const {payload}=await r.json();assert.equal(canonical(payload),canonical(data.charts[i].payload));events+=payload.timeline.kind.length;}
  assert.equal(events,13922);assert.equal(d.db.prepare('SELECT count(*) n FROM builtin_chart').get().n,20);
  assert.equal((await handleBuiltin(new Request('https://site.test/api/builtin-charts/import',{method:'POST'}),env)).status,403);
 }finally{d.close()}
});
