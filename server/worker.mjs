import {handlePrivate} from './private-spc.mjs';
import {handleBuiltin} from './builtin-charts.mjs';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','vary':'Cookie, oai-authenticated-user-id'}});
const uidFor=request=>{const a=request.headers.get('oai-authenticated-user-id');if(!a||a.length>256||/[\u0000-\u001f\u007f]/u.test(a))return null;return a};
async function chartIds(env){try{const r=await env.ASSETS.fetch(new Request(new URL('/catalog.json','https://assets.invalid')));if(!r.ok)return new Set();const d=await r.json();return new Set(d.songs.flatMap(s=>s.charts.map(c=>c.chartId)))}catch{return new Set()}}
export default {async fetch(request,env){const u=new URL(request.url);if(u.pathname.startsWith('/api/builtin-charts/'))return handleBuiltin(request,env);if(u.pathname==='/api/session'&&request.method==='GET')return json({signedIn:Boolean(uidFor(request))});if(u.pathname==='/api/private-spc'||u.pathname.startsWith('/api/private-spc/'))return handlePrivate(request,env,uidFor(request),await chartIds(env));return env.ASSETS.fetch(request)}};
