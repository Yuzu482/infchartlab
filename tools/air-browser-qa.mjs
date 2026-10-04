import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const python=process.env.INFALSUS_PYTHON_EXECUTABLE||'python';
const encoded=spawnSync(python,['-B','-c',`import base64,sys\nsys.path.insert(0, ${JSON.stringify(resolve(root,'tools/tests'))})\nfrom infalsus_spc_decode_test import encoded_notes_fixture\npairs=[(1,2),(3,4),(1,4),(1,4)]\nspecs=[(4,5,0x18|0xC0,pairs),(4,4,0x400,[(1,5),(2,5),(1,10),(1,10)]),(4,4,0,pairs),(4,9,0,[(1,0),(1,1),(1,1),(1,1)])]\nprint(base64.b64encode(encoded_notes_fixture(specs)).decode())`],{encoding:'utf8'});
if(encoded.status!==0)throw Error(`synthetic fixture encoder failed: ${encoded.stderr}`);
const bytes=Buffer.from(encoded.stdout.trim(),'base64');
const mod=process.env.INFALSUS_PLAYWRIGHT_MODULE,exe=process.env.INFALSUS_BROWSER_EXECUTABLE,output=process.env.INFALSUS_QA_OUTPUT,base=process.env.INFALSUS_QA_URL||'http://127.0.0.1:18083/';
if(!mod||!exe||!output||new URL(base).hostname!=='127.0.0.1')throw Error('browser configuration or bounded loopback URL unavailable');
const pw=await import(mod.startsWith('file:')?mod:pathToFileURL(mod).href),browser=await pw.chromium.launch({headless:true,executablePath:exe});
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS',name)};
try{
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:960}}),page=await context.newPage(),posts=[];
 await page.addInitScript(()=>{window.__airDraw=[];window.__airFills=[];let path=[];const proto=CanvasRenderingContext2D.prototype;for(const name of ['fillText','fillRect','strokeRect','moveTo','lineTo','arc','rect','clip','drawImage','beginPath','fill']){const original=proto[name];proto[name]=function(...args){window.__airDraw.push([name,...args]);if(name==='beginPath')path=[];if(name==='moveTo'||name==='lineTo')path.push([args[0],args[1]]);if(name==='fill')window.__airFills.push(path.map(p=>[...p]));return original.apply(this,args)}}});
 page.on('request',r=>{if(r.url().includes('/api/private-spc')&&r.method()==='POST')posts.push(JSON.parse(r.postData()||'{}'))});
 await page.goto(`${base}signin-with-chatgpt?user=alice`);await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>document.querySelector('.spc-cloud'));await page.evaluate(()=>document.querySelectorAll('details').forEach(node=>{node.open=true}));
 await page.locator('#spc-surface-mount input[aria-label="精确 Lookup Path"]').fill('encoded-air');await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'synthetic-only.spc',mimeType:'application/octet-stream',buffer:bytes});
 await page.waitForFunction(()=>document.querySelector('#spc-surface-mount .spc-preview canvas'));
 await page.waitForFunction(()=>[...document.querySelectorAll('.spc-cloud button')].some(b=>b.textContent.includes('保存到我的谱面')&&!b.disabled));
 const stats=await page.locator('.preview-readout').innerText();check('actual worker decodes compact Catch/Flick/unknown air tuples',stats.includes('空轨坐标已解析 3/4')&&stats.includes('Catch 1')&&stats.includes('Flick 2'));
 
 await page.waitForFunction(()=>window.__airDraw.some(x=>x[0]==='drawImage'));
 const {draw,fills}=await page.evaluate(()=>({draw:window.__airDraw,fills:window.__airFills}));
 const taper=sign=>fills.some(p=>p.length===4&&p[0][0]===p[3][0]&&p[1][0]===p[2][0]&&Math.sign(p[1][0]-p[0][0])===sign&&Math.abs(p[2][1]-p[1][1])>Math.abs(p[3][1]-p[0][1])&&Math.abs(p[3][1]-p[0][1])>0);
 check('canvas draws six fixed lanes, Catch polygons and native Flick heads with both trail directions',['L','1','2','3','4','R'].every(label=>draw.some(x=>x[0]==='fillText'&&x[1]===label))&&fills.some(p=>p.length>=34)&&taper(1)&&taper(-1)&&draw.filter(x=>x[0]==='drawImage').length>=2);
 check('air glyphs apply a plot-area clipping path',draw.some((x,i)=>x[0]==='rect'&&x[1]===0&&x[2]===28&&x[3]>0&&x[4]>0&&draw[i+1]?.[0]==='clip'));
 check('no automatic private save',posts.length===0);
 const saveResponse=page.waitForResponse(r=>r.url().includes('/api/private-spc')&&r.request().method()==='POST');await page.locator('.spc-cloud button').filter({hasText:'保存到我的谱面'}).click();const savedResponse=await saveResponse,savedId=(await savedResponse.json()).id;assert.ok(savedId);await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('已私密保存'));const privateRead=await context.request.get(new URL(`/api/private-spc/${encodeURIComponent(savedId)}`,base).href);check('saved coordinates are readable through owner-private GET',privateRead.ok()&&(await privateRead.json()).payload.timeline.airCoordinates.length===4);
 const dto=posts[0];check('explicit v2 save carries only compact coordinate DTO',posts.length===1&&Object.keys(dto).sort().join(',')==='bpm,chartId,timeline'&&dto.timeline.airVersion===1&&dto.timeline.airCoordinates.length===4&&dto.timeline.airCoordinates.every(x=>x.length===10)&&!JSON.stringify(dto).match(/raw|seed|header|SPC/i));
 const catalogResponse=await context.request.get(new URL('/catalog.json',base).href),catalog=await catalogResponse.json(),chartIds=catalog.songs.flatMap(s=>s.charts.map(c=>c.chartId)).filter(x=>typeof x==='string'&&x);assert.ok(catalogResponse.ok()&&chartIds.length>=2);const legacyId=chartIds[0],v2Id=chartIds.find(x=>x!==legacyId);assert.ok(v2Id);
 const old={...structuredClone(dto),chartId:legacyId,timeline:Object.fromEntries(Object.entries(dto.timeline).filter(([k])=>!['airVersion','airCoordinates'].includes(k)))};
 const oldBundle={format:'infalsus-private-timelines-v1',charts:[old]};await page.locator('.spc-cloud input[type=file]').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(oldBundle))});await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('已验证 1 条'));
 check('legacy v1 bundle identity is a catalog chart without fabricated air',posts.length===1&&await page.evaluate(()=>document.querySelector('.spc-cloud')?.textContent.includes('已验证 1 条')));await page.locator('.spc-cloud button').filter({hasText:'开始批量导入'}).click();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('批量导入完成 1/1'));
 await page.locator('.spc-cloud .saved-chart').filter({hasText:legacyId}).locator('button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>{const text=document.querySelector('.preview-readout')?.textContent||'';return text.includes('未保存空轨坐标 4')&&!text.includes('空轨坐标已解析')});
 check('legacy v1 imported chart opens with dashed-air fallback',await page.locator('.preview-readout').innerText().then(x=>x.includes('未保存空轨坐标 4')&&!x.includes('空轨坐标已解析')));
 const imported={...structuredClone(dto),chartId:v2Id},v2Bundle={format:'infalsus-private-timelines-v2',charts:[imported]};await page.locator('.spc-cloud input[type=file]').setInputFiles({name:'air-v2.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(v2Bundle))});await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('已验证 1 条'));
 await page.locator('.spc-cloud button').filter({hasText:'开始批量导入'}).click();await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('批量导入完成 1/1'));
 await page.locator('.spc-cloud .saved-chart').filter({hasText:v2Id}).locator('button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>document.querySelector('.preview-readout')?.textContent.includes('空轨坐标已解析 3/4'));
 check('explicit v2 batch import opens catalog chart with air coordinates',await page.locator('.preview-readout').innerText().then(x=>x.includes('空轨坐标已解析 3/4')));
 const beforeInvalid=posts.length,duplicate={format:'infalsus-private-timelines-v2',charts:[imported,imported]},raw={format:'infalsus-private-timelines-v2',charts:[{...imported,rawSpc:'forbidden'}]};for(const [name,bundle] of [['duplicate.json',duplicate],['raw.json',raw]]){await page.locator('.spc-cloud input[type=file]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('批量文件无效或超出限制；未上传。'))}
 check('duplicate v2 chart IDs and raw SPC fields reject without POST',posts.length===beforeInvalid);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.spc-cloud'));await page.evaluate(()=>document.querySelectorAll('details').forEach(node=>{node.open=true}));await page.waitForFunction(()=>document.querySelector('.spc-cloud .saved-chart'));
 const ownSynthetic=page.locator('.spc-cloud .saved-chart').filter({hasText:'已保存谱面'});await ownSynthetic.locator('button').filter({hasText:'打开'}).click();await page.waitForFunction(()=>document.querySelector('.preview-readout')?.textContent.includes('空轨坐标已解析 3/4'));
 check('reload opens owned synthetic v2 coordinates',await page.locator('.preview-readout').innerText().then(x=>x.includes('空轨坐标已解析 3/4')));
 const play=page.locator('.spc-preview button[aria-label="播放"]');await play.click();check('play/pause remains responsive',await page.locator('.spc-preview button[aria-label="暂停"]').count()===1);await page.locator('.spc-preview button[aria-label="暂停"]').click();
 const seek=page.locator('.spc-preview input[aria-label="谱面时间位置"]');await seek.evaluate(el=>{el.value='115';el.dispatchEvent(new Event('input',{bubbles:true}))});check('seek preserves numeric value and formats human time',await seek.inputValue()==='115'&&(await page.locator('.preview-readout').innerText()).includes('0:00.1'));
 await mkdir(output,{recursive:true});await page.screenshot({path:`${output}/air-1440.png`,fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/air-390.png`,fullPage:true});check('mobile preview has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const bob=await browser.newPage();await bob.goto(`${base}signin-with-chatgpt?user=bob`);await bob.waitForLoadState('domcontentloaded');await bob.waitForFunction(()=>document.querySelector('.spc-cloud')?.textContent.includes('登录状态已确认'));check('other owner cannot see saved synthetic chart',await bob.locator('.spc-cloud .saved-chart').count()===0);await bob.close();await context.close();
}finally{await browser.close()}
