import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bases,coverage} from './chunithm-charts.mjs';
const {INFALSUS_CHUNITHM_PREPARED:source,INFALSUS_PLAYWRIGHT_MODULE:mod,INFALSUS_BROWSER_EXECUTABLE:exe,INFALSUS_QA_OUTPUT:out}=process.env;
if(!source||!mod||!exe||!out)throw Error('QA configuration');
const live=process.env.INFALSUS_QA_URL;
if(live&&live!=='https://infchartlab.wantiaoyoulinai.chatgpt.site/')throw Error('QA live origin');
const prepared=JSON.parse(await readFile(source));coverage(prepared.charts);const payloads=new Map(prepared.charts.map(x=>[x.payload.chartId,x.payload]));
const root=await realpath(resolve('dist/client')),mime={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 if(req.method!=='GET')throw Error('method');const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/session'){res.setHeader('content-type','application/json');return res.end('{"signedIn":false}')}
 if(path.startsWith('/api/builtin-charts/')){const payload=payloads.get(path.split('/').pop());if(!payload)throw Error('missing');res.setHeader('content-type','application/json');return res.end(JSON.stringify({payload}))}
 const file=await realpath(resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)))),rel=relative(root,file);if(isAbsolute(rel)||rel.startsWith('..'))throw Error('path');res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.statusCode=404;res.end()}});
let browser;
try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));await mkdir(out,{recursive:true});const pw=await import(mod.startsWith('file:')?mod:pathToFileURL(mod).href);browser=await pw.chromium.launch({headless:true,executablePath:exe});
 const origin=live||'http://127.0.0.1:'+server.address().port;
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin,{waitUntil:'networkidle'});
 for(const base of bases){
  await page.locator('input[type=search]').first().fill(base);const card=page.locator('.song-card');assert.equal(await card.count(),1);await card.click();
  await page.waitForFunction(()=>document.querySelector('.song-detail img')?.naturalWidth===256);
  for(let tier=0;tier<4;tier++){await page.locator('.tier-button').nth(tier).click();const response=page.waitForResponse(r=>r.url().endsWith('/api/builtin-charts/'+base+tier));await page.locator('.chart-open-action').click();assert.equal((await response).status(),200);await page.locator('.spc-preview').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.overview-tile').length>0);}
  const cover=await page.request.get(new URL('/jackets/'+base+'.png',origin).href);assert.equal(cover.status(),200);assert.ok((await cover.body()).length>1000);
 }
 await page.screenshot({path:resolve(out,'desktop.png'),fullPage:false});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:resolve(out,'mobile.png'),fullPage:false});assert.deepEqual(errors,[]);console.log(JSON.stringify({songs:5,previews:20,covers:5,anonymous:true,mobile:true,browserErrors:0}));
}finally{await browser?.close();await new Promise(ok=>server.close(ok))}
