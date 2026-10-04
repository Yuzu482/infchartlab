import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';

export async function createD1(path=':memory:'){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
 const sql=await readFile(new URL('../../drizzle/0000_wandering_kate_bishop.sql',import.meta.url),'utf8');
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='private_spc'").get())for(const part of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))db.exec(part);
 const builtinSql=await readFile(new URL('../../drizzle/0001_absurd_payback.sql',import.meta.url),'utf8');if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='builtin_chart'").get())for(const part of builtinSql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))db.exec(part);
 let count=0,failAt=0,invocationCount=0;const metadata=new WeakMap();
 function wrap(query){if(Buffer.byteLength(query)>16384)throw Error('sql limit');const stmt=db.prepare(query);return{bind(...args){if(args.length>=24||args.some(x=>(typeof x==='string'&&Buffer.byteLength(x)>65536)||(x instanceof Uint8Array&&x.byteLength>65536)))throw Error('cell or parameter limit');const item={bindingsSize:args.reduce((n,x)=>n+(typeof x==='string'?Buffer.byteLength(x):x instanceof Uint8Array?x.byteLength:8),0),run(){count++;invocationCount++;const r=stmt.run(...args);return{meta:{changes:Number(r.changes)}}},first(){count++;invocationCount++;return stmt.get(...args)||null},all(){count++;invocationCount++;return{results:stmt.all(...args)}}};metadata.set(item,{sqlBytes:Buffer.byteLength(query)});return item}}}
 return{DB:{prepare:wrap,async batch(items){if(items.length>32||items.reduce((n,x)=>n+metadata.get(x).sqlBytes,0)>16384||items.reduce((n,x)=>n+metadata.get(x).sqlBytes+x.bindingsSize,0)>1677721)throw Error('query/batch limit');const tx=db.prepare('SAVEPOINT d1batch');tx.run();try{const results=[];for(let i=0;i<items.length;i++){const item=items[i];if(failAt===i+1){failAt=0;throw Error('injected')}results.push(item.run())}db.exec('RELEASE d1batch');return results}catch(e){db.exec('ROLLBACK TO d1batch');db.exec('RELEASE d1batch');throw e}}},db,failNext(at=1){failAt=at},resetInvocation(){invocationCount=0},get invocationCount(){return invocationCount},close(){db.close()},get queryCount(){return count}};
}
