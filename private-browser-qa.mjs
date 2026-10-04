import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadSpcPreview} from './tests/fixtures/spc-preview.mjs';

const mod=process.env.INFALSUS_PLAYWRIGHT_MODULE,exe=process.env.INFALSUS_BROWSER_EXECUTABLE;
if(!mod||!exe)throw Error('browser configuration unavailable');
const pw=await import(mod.startsWith('file:')?mod:pathToFileURL(mod).href);
const base=process.env.INFALSUS_QA_URL||'http://127.0.0.1:18081/';
if(new URL(base).hostname!=='127.0.0.1')throw Error('loopback only');
const output=process.env.INFALSUS_QA_OUTPUT;
if(!output)throw Error('INFALSUS_QA_OUTPUT must name an external directory');
const browser=await pw.chromium.launch({headless:true,executablePath:exe}),f=loadSpcPreview(),bytes=Buffer.from(f.bytes),check=async(n,x)=>{assert.ok(await x,n);console.log('PASS',n)};
try{
 const c=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await c.newPage(),writes=[],storageWrites=[];let aliceId=null,postCount=0;
 await page.addInitScript(()=>{const mark=(n)=>()=>{window.__qaStorageWrites=(window.__qaStorageWrites||[]).concat(n)};for(const [o,k,n] of [[Storage.prototype,'setItem','localStorage/sessionStorage'],[IDBFactory.prototype,'open','indexedDB'],[CacheStorage.prototype,'open','cache'],[ServiceWorkerContainer.prototype,'register','serviceWorker']])if(o?.[k]){const original=o[k];o[k]=function(...args){mark(n)();return original.apply(this,args)}}});
 page.on('request',r=>{if(r.url().includes('/api/private-spc')&&r.method()==='POST'){postCount++;writes.push(JSON.parse(r.postData()||'{}'))}});
 page.on('response',async r=>{if(r.url().endsWith('/api/private-spc')&&r.request().method()==='POST'&&(r.status()===200||r.status()===201))aliceId=(await r.json()).id});
 await page.goto(base+'signin-with-chatgpt?user=alice');await page.waitForLoadState('domcontentloaded');
 await page.locator('#spc-surface-mount input[aria-label="精确 Lookup Path"]').fill(f.seed);await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'synthetic-only.spc',mimeType:'application/octet-stream',buffer:bytes});await page.waitForFunction(()=>document.querySelector('#spc-surface-mount .spc-preview canvas'));
 await page.waitForFunction(()=>!document.querySelector('.spc-cloud button')?.disabled);
 await check('no automatic save or browser storage writes',postCount===0&&(await page.evaluate(()=>window.__qaStorageWrites||[])).length===0);
 const save=page.locator('.spc-cloud button').filter({hasText:'保存到我的谱面'});await save.click();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('已私密保存'));
 await check('explicit save contains decoded allowlist only',writes.length===1&&Object.keys(writes[0]).sort().join(',')==='bpm,chartId,timeline'&&Object.keys(writes[0].timeline).sort().join(',')==='airCoordinates,airVersion,endMs,kind,laneEnd,laneStart,startMs'&&writes[0].timeline.airVersion===1&&Array.isArray(writes[0].timeline.airCoordinates)&&writes[0].timeline.airCoordinates.every(x=>Array.isArray(x)&&x.length===10)&&Object.keys(writes[0].bpm).sort().join(',')==='base,changes'&&!JSON.stringify(writes[0]).match(/SPC|seed|header|filename|sample|raw/i));
 await page.reload();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('1201 音符'));await page.locator('.spc-cloud button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>document.querySelector('.spc-preview canvas'));
 const readout=()=>page.locator('.spc-preview .preview-readout').innerText();
 await check('reload opens saved full timeline without SPC file',await page.locator('.spc-preview').innerText().then(t=>t.includes('1201 音符'))&&await page.locator('#spc-surface-mount button[aria-label="导出有界 SPC 报告 JSON"]').isDisabled());
 const expected=f.expected;await check('saved preview statistics and BPM match fixture',await readout().then(t=>t.includes(`${expected.notes.count} 音符`)&&t.includes(`BPM ${expected.bpm}`))&&await page.locator('.preview-legend').innerText().then(t=>t.includes('类型 1 (1198)')&&t.includes('类型 2 (1)')));
 const play=page.locator('.spc-preview button[aria-label="播放"]');await play.click();await check('play and pause controls work',await page.locator('.spc-preview button[aria-label="暂停"]').count()===1);await page.locator('.spc-preview button[aria-label="暂停"]').click();
 const seek=page.locator('.spc-preview input[aria-label="谱面时间位置"]');await seek.evaluate(el=>{el.value='2500';el.dispatchEvent(new Event('input',{bubbles:true}))});await check('seek updates preview time and BPM',await readout().then(t=>t.includes('0:02.5')&&t.includes('BPM 180')));
 await mkdir(output,{recursive:true});await page.screenshot({path:`${output}/private-1440.png`,fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/private-390.png`,fullPage:true});await check('mobile preview has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const bc=await browser.newContext({serviceWorkers:'block'}),bob=await bc.newPage();await bob.goto(base+'signin-with-chatgpt?user=bob');await bob.waitForLoadState('domcontentloaded');await bob.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('登录状态已确认'));
 await check('second user sees no Alice chart',await bob.locator('.spc-cloud').innerText().then(t=>!t.includes('1201 音符'))&&aliceId!==null);const forbidden=await bob.evaluate(async id=>(await fetch('/api/private-spc/'+id)).status,aliceId);await check('second user cannot read Alice full timeline',forbidden===404);
 let release;const delayed=new Promise(r=>release=r);await page.route(`**/api/private-spc/${aliceId}`,async route=>{await delayed;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({payload:writes[0]})})}catch{}});
 await page.locator('.spc-cloud button').filter({hasText:'打开'}).click();await page.waitForTimeout(100);await page.locator('#spc-surface-mount button').filter({hasText:'清除'}).click();release();await page.waitForTimeout(100);await check('clear during delayed open prevents preview resurrection',await page.locator('.spc-preview').count()===0);await page.unroute(`**/api/private-spc/${aliceId}`);
 await page.locator('.spc-cloud button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>document.querySelector('.spc-preview canvas'));
 await page.route(`**/api/private-spc/${aliceId}`,route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));await page.locator('.spc-cloud button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>!document.querySelector('.spc-preview')&&document.querySelector('.spc-cloud .saved-chart')===null);
 await check('401 on owner read clears private preview and list',await page.locator('.spc-cloud .saved-chart').count()===0);await page.unroute(`**/api/private-spc/${aliceId}`);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('1201 音符'));await page.evaluate(()=>document.querySelectorAll('details').forEach(el=>{el.open=true}));await page.locator('.spc-cloud button').filter({hasText:'删除'}).click();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('我的谱面')&&!document.querySelector('.spc-cloud')?.querySelector('.saved-chart'));await check('owner can delete saved chart',true);await bc.close();await c.close()
}finally{await browser.close()}
