import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseSave,canonicalJSON} from './dist/parser.mjs';
import {loadSpcPreview} from './tests/fixtures/spc-preview.mjs';

// Authored fixtures only. This driver never discovers or opens real save/art files.
function record({id=2,flag=1,score=0n,utc=0n,lamp=0}={}){
  const bytes=Buffer.alloc(96);bytes.writeUInt16LE(id,0);bytes[2]=flag;bytes[3]=lamp;
  bytes.writeBigUInt64LE(score,80);bytes.writeBigUInt64LE(utc,88);return bytes;
}
function entry(row){
  const name=Buffer.from(row.name??'alamode'),key=Buffer.alloc(12+name.length);
  key[0]=3;key.writeInt32LE(~name.length,1);key.writeInt32LE((row.name??'alamode').length,5);
  name.copy(key,9);key.writeUInt16LE(row.id??2,9+name.length);key[11+name.length]=row.flag??1;
  return Buffer.concat([key,record(row)]);
}
function syntheticSave(best=[{}],history=[{score:4n,utc:9n}],capacity=Math.max(1,history.length)){
  const header=Buffer.alloc(5),hh=Buffer.alloc(5),count=Buffer.alloc(4);
  header[0]=4;header.writeInt32LE(best.length,1);hh[0]=2;hh.writeInt32LE(capacity,1);
  count.writeInt32LE(history.length);
  return Buffer.concat([Buffer.from([9]),header,...best.map(entry),hh,...history.map(record),
    Buffer.alloc((capacity-history.length)*96),count]);
}
const matrixSave=()=>syntheticSave([1,2,4,8].map((flag,i)=>({flag,score:BigInt(i),lamp:i%3})),
  [{flag:8,score:0n,utc:(1n<<64n)-1n},{flag:1,score:7n,utc:3n},{flag:1,score:0n,utc:2n}],5);
const historyOnlySave=()=>syntheticSave([{id:3,name:'alterededge'}],[{id:2,score:0n}],3);
const unmappedSave=()=>syntheticSave([{id:65000,name:'synthetic-unknown'},{id:2,name:'wrong'}],[],1);
function syntheticSpc(){const p=Buffer.alloc(28);p.write('ICP1');p.writeUInt16LE(1,4);p.writeUInt16LE(28,6);p.writeUInt16LE(80,8);p.writeUInt16LE(32,10);p.writeFloatLE(123,20);const k=[240,22,40,75,125,158,195,165];return Buffer.from(p.map((v,i)=>v^k[i&7]));}
async function fixtureCheck(){
  const simple=await parseSave(syntheticSave(),true),matrix=await parseSave(matrixSave(),true);
  assert.equal(simple.status,'ok');assert.equal(simple.bestRecords[0].playerScore,0n);
  assert.equal(simple.historyRecords[0].secondsSinceEpochUtc,9n);
  assert.deepEqual(matrix.bestRecords.map(r=>r.difficultyFlag),[1,2,4,8]);
  assert.deepEqual(matrix.historyRecords.map(r=>r.playerScore),[0n,7n,0n]);
  assert.equal(matrix.historyRecords[0].secondsSinceEpochUtc,(1n<<64n)-1n);
  assert.equal(matrix.zeroUnusedSlots,2);assert.equal(matrix.bestRecords[0].lamp,0);
  assert.equal(canonicalJSON(matrix),canonicalJSON(await parseSave(matrixSave(),true)));
  const historyOnly=await parseSave(historyOnlySave(),true);
  assert.equal(historyOnly.historyRecords[0].basename,null);
  assert.equal(historyOnly.historyRecords[0].playerScore,0n);
  assert.equal((await parseSave(unmappedSave(),true)).bestCount,2);
}
if(process.argv.includes('--fixture-check')){
  try{await fixtureCheck();console.log('synthetic-fixture-check: passed (four flags, zero, order, u64, unused slots, unmapped)');}
  catch{console.error('synthetic-fixture-check: failed');process.exitCode=1;}
  process.exit(process.exitCode||0);
}

const url=process.env.INFALSUS_QA_URL||'http://127.0.0.1:18080/';
if(new URL(url).hostname!=='127.0.0.1')throw new Error('QA_FAIL: disallowed QA URL');
const modulePath=process.env.INFALSUS_PLAYWRIGHT_MODULE;
if(!modulePath)throw new Error('QA_FAIL: browser module configuration missing');
let pw;
try{pw=await import(modulePath.startsWith('file:')?modulePath:pathToFileURL(modulePath).href);}
catch{throw new Error('QA_FAIL: browser module unavailable');}
const output=process.env.INFALSUS_QA_OUTPUT||join(tmpdir(),'infalsus-synthetic-qa');
const checks=[];
async function check(name,action){
  try{assert.ok(await (typeof action==='function'?action():action));checks.push(name);}
  catch{throw new Error(`QA_FAIL: ${name}`);}
}
const crc32=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function png(){
  const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;
  const raw=Buffer.from([0,255,0,0,255,0,255,0,255,0,0,0,255,255,255,255,255,255]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function instrument(){
  const qa=window.__qa={tools:[],network:[],storage:[],phase:'boot'};
  document.modelContext={registerTool(tool){qa.tools.push(tool);return Promise.resolve();}};
  function wrap(owner,name,kind){
    if(!owner||typeof owner[name]!=='function')return;
    const original=owner[name];
    owner[name]=function(...args){qa[kind].push(name==='fetch'?{name,url:String(args[0]?.url??args[0]),method:String(args[1]?.method??args[0]?.method??'GET').toUpperCase()}:name);return original.apply(this,args);};
  }
  for(const name of ['fetch','WebSocket','EventSource','openDatabase'])wrap(window,name,name==='openDatabase'?'storage':'network');
  wrap(window.XMLHttpRequest?.prototype,'send','network');wrap(navigator,'sendBeacon','network');
  for(const name of ['setItem','removeItem','clear'])wrap(window.Storage?.prototype,name,'storage');
  for(const name of ['open','deleteDatabase'])wrap(window.IDBFactory?.prototype,name,'storage');
  for(const name of ['open','delete'])wrap(window.CacheStorage?.prototype,name,'storage');
  for(const name of ['put','delete','add','addAll'])wrap(window.Cache?.prototype,name,'storage');
  wrap(window.StorageManager?.prototype,'getDirectory','storage');
  wrap(navigator.serviceWorker,'register','storage');
  for(const name of ['set','delete'])wrap(window.cookieStore,name,'storage');
  const cookie=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
  if(cookie?.set&&cookie?.get)Object.defineProperty(document,'cookie',{get(){return cookie.get.call(this);},set(value){qa.storage.push('cookie');cookie.set.call(this,value);}});
}
let browser;
try{
  browser=await pw.chromium.launch({headless:true,channel:process.env.INFALSUS_BROWSER_CHANNEL||undefined,
    executablePath:process.env.INFALSUS_BROWSER_EXECUTABLE||undefined});
}catch{throw new Error('QA_FAIL: browser launch failed');}
try{
  await fixtureCheck();
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.addInitScript(instrument);
  const requests=[];context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const actualCatalog=JSON.parse(await readFile(new URL('./dist/catalog.json',import.meta.url),'utf8'));
  const catalog=structuredClone(actualCatalog);
  delete catalog.spcSchema;delete catalog.spcSource;
  for(const song of catalog.songs){for(const chart of song.charts)delete chart.spc;song.artist=null;if(song.songId===2)song.title=null;}
  const image=png(),hash=createHash('sha256').update(image).digest('hex');
  for(const song of catalog.songs)song.jacket={mime:'image/png',sha256:hash,width:2,height:2};
  const page=await context.newPage();
  await page.route('**/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog)}));
  await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.songSurfaceReady==='true'&&document.documentElement.dataset.spcSurfaceReady==='true');await page.evaluate(()=>document.querySelectorAll('details').forEach(el=>{el.open=true}));
  await check('catalog visible before save; saved-only disabled and export disabled',async()=>await page.locator('#export').isDisabled()&&!await page.locator('#song-surface input[aria-label="仅显示有记录的曲目"]').isChecked()&&(await page.locator('#song-surface .surface-count').innerText()).includes('78 / 78'));
  const integratedSong=actualCatalog.songs.find(s=>s.charts.some(c=>c.available)),integratedChart=integratedSong.charts.find(c=>c.available),beforeBrowseRequests=requests.length;
  await page.locator('#song-surface input[type=search]').fill(integratedSong.basename);
  const tierIndex={1:0,2:1,4:2,8:3}[integratedChart.flag];
  await page.locator('#song-surface .tier-button').nth(tierIndex).click();
  await page.locator('#song-surface input[type=search]').fill('');
  await check('SPC mount is nested after song detail and selected-tier action supplies exact chart path',async()=>await page.locator('#song-surface #spc-surface-mount').count()===1&&await page.locator('#song-surface .song-detail').evaluate(el=>el.compareDocumentPosition(el.parentElement.querySelector('#spc-surface-mount'))&Node.DOCUMENT_POSITION_FOLLOWING)!==0&&await page.locator('#song-surface #spc-surface-mount').evaluate(el=>el.compareDocumentPosition(el.parentElement.querySelector('.song-history'))&Node.DOCUMENT_POSITION_FOLLOWING)!==0&&await page.locator('#song-surface button').filter({hasText:'查看此难度谱面'}).isEnabled());
  await page.locator('#song-surface button').filter({hasText:'查看此难度谱面'}).click();
  await check('browse selection does not auto-fetch private timeline or mutate',requests.slice(beforeBrowseRequests).every(r=>!new URL(r.url).pathname.startsWith('/api/private-spc')||r.method==='GET')&&!requests.slice(beforeBrowseRequests).some(r=>new URL(r.url).pathname==='/api/private-spc'&&r.method==='POST')&&await page.locator('#song-surface #spc-surface-mount select[aria-label="从曲目目录选择谱面"]').inputValue()===integratedChart.chartId&&await page.locator('#song-surface #spc-surface-mount input[aria-label="精确 Lookup Path"]').inputValue()===(integratedChart.spc?.lookupPath||`${integratedChart.chartId}.spc`));
  const metricsPage=await context.newPage();await metricsPage.route('**/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(actualCatalog)}));await metricsPage.goto(url);await metricsPage.waitForFunction(()=>document.documentElement.dataset.songSurfaceReady==='true'&&document.documentElement.dataset.spcSurfaceReady==='true');await metricsPage.evaluate(()=>document.querySelectorAll('details').forEach(el=>{el.open=true}));
  const metricSong=actualCatalog.songs.find(s=>s.charts.some(c=>c.spc?.status==='ok'));
  const metricChart=metricSong.charts.find(c=>c.spc?.status==='ok');
  await metricsPage.locator('#song-surface input[type=search]').fill(metricSong.basename);
  await metricsPage.locator('#song-surface .chart-details summary').click();
  await check('enriched catalog metrics render before save',async()=>{const card=metricsPage.locator('#song-surface .chart-card').filter({hasText:`SPC BPM ${metricChart.spc.bpm.base}`}).first(),text=await card.innerText();return text.includes(`原生谱面事件 ${metricChart.spc.noteCount}`)&&text.includes('时间范围')&&text.includes('类型计数（名称未确认）')&&requests.some(r=>new URL(r.url).pathname==='/catalog.json'&&r.method==='GET');});
  const surface=page.locator('#song-surface'),query=surface.locator('input[type=search]');
  const pack=surface.locator('select[aria-label="曲包"]'),difficulty=surface.locator('select[aria-label="难度"]');
  const saved=surface.locator('input[aria-label="仅显示有记录的曲目"]');
  const songGrid=surface.locator('.song-grid'),songCards=songGrid.locator('.song-card');
  await check('filtered cover grid precedes detail and matches count; desktop has four columns and two rows',async()=>{const dimensions=await songGrid.evaluate(el=>{const style=getComputedStyle(el),cards=[...el.children],columns=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left))).size,rows=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top))).size;return{columns,rows,order:el.compareDocumentPosition(el.parentElement.querySelector('.song-detail'))&Node.DOCUMENT_POSITION_FOLLOWING}});return await songCards.count()===Number((await surface.locator('.surface-count').innerText()).split('/')[0].trim())&&dimensions.columns>=4&&dimensions.rows>=2&&dimensions.order!==0});
  await check('cover cards label available chart levels numerically',async()=>await songGrid.locator('.song-card-levels').first().innerText().then(text=>/\b(?:MIN|EVO|ULT|FBD)\s+\d/u.test(text)));
  const firstCard=songCards.first();await firstCard.focus();await page.keyboard.press('Enter');
  await check('cover-card keyboard activation selects hero and retains focus',async()=>await firstCard.getAttribute('aria-pressed')==='true'&&await firstCard.evaluate(el=>document.activeElement===el)&&await surface.locator('.song-hero h3').innerText()===await firstCard.locator('.song-card-title').innerText());
  const nonfirstCard=songCards.nth(1);await nonfirstCard.click();
  await check('nonfirst cover-card click selects matching titled detail',async()=>await nonfirstCard.getAttribute('aria-pressed')==='true'&&await surface.locator('.song-hero h3').innerText()===await nonfirstCard.locator('.song-card-title').innerText()&&await surface.locator('.song-hero h3').innerText()!=='未知曲名');
  await nonfirstCard.focus();await page.keyboard.press('Enter');
  await check('nonfirst cover-card keyboard selection retains focus and detail',async()=>await nonfirstCard.getAttribute('aria-pressed')==='true'&&await nonfirstCard.evaluate(el=>document.activeElement===el)&&await surface.locator('.song-hero h3').innerText()===await nonfirstCard.locator('.song-card-title').innerText());
  await page.setViewportSize({width:390,height:900});
  await check('390px cover grid has two columns and no overflow',async()=>{const cols=await songGrid.evaluate(el=>new Set([...el.children].map(c=>Math.round(c.getBoundingClientRect().left))).size);return cols===2&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)});
  await page.setViewportSize({width:320,height:900});
  await check('320px page has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:390,height:900});await mkdir(output,{recursive:true});await songGrid.screenshot({path:join(output,'song-grid-390.png')});
  await page.setViewportSize({width:1440,height:1000});await songGrid.screenshot({path:join(output,'song-grid-1440.png')});
  await page.locator('#spc-surface-mount input[type=text]').fill('synthetic-chart.spc');
  await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'synthetic.spc',mimeType:'application/octet-stream',buffer:syntheticSpc()});
  await page.waitForFunction(()=>document.querySelector('#spc-surface-mount .spc-report')?.textContent.includes('BPM：123'));
  const startup=requests.length;
  const bootNetwork=await page.evaluate(()=>window.__qa.network.length);
  await page.evaluate(()=>document.querySelectorAll('#spc-surface-mount details').forEach(el=>{el.open=true}));
  await check('synthetic local SPC metrics and bounded report',async()=>{const t=await page.locator('#spc-surface-mount').innerText();return t.includes('音符数量：0')&&t.includes('已知轨道覆盖')&&!await page.locator('#spc-surface-mount button[aria-label="导出有界 SPC 报告 JSON"]').isDisabled();});
  const corrupt=syntheticSpc();corrupt[0]^=1;await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'corrupt.spc',mimeType:'application/octet-stream',buffer:corrupt});
  await page.waitForFunction(()=>{const t=document.querySelector('#spc-surface-mount [role=status]')?.textContent||'';return t.includes('无法验证')||t.includes('失败')});
  await check('corrupt synthetic SPC header rejected by real worker',await page.locator('#spc-surface-mount button').first().isDisabled());
  await mkdir(output,{recursive:true});
  const previewFixture=loadSpcPreview();
  await page.locator('#spc-surface-mount input[aria-label="精确 Lookup Path"]').fill(previewFixture.seed);
  await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'synthetic-preview.spc',mimeType:'application/octet-stream',buffer:Buffer.from(previewFixture.bytes)});
  await page.waitForFunction(()=>!!document.querySelector('#spc-surface-mount .spc-preview canvas'));
  const preview=page.locator('#spc-surface-mount .spc-preview');
  await check('synthetic preview counts, bounds, speed, and canvas',async()=>{
    const text=await preview.locator('.preview-readout').innerText(),range=preview.locator('input[aria-label="谱面时间位置"]'),speed=preview.locator('select[aria-label="播放速度"]');
    const box=await preview.locator('.overview-tile').first().evaluate(c=>({width:c.clientWidth,height:c.clientHeight}));
    return text.includes('1201 音符')&&text.includes('未知键轨位置 0')&&await range.getAttribute('min')==='-500'&&await range.getAttribute('max')==='12000'&&await speed.inputValue()==='1'&&box.width>100&&box.height>0;
  });
  const reportDownload=async()=>{const event=page.waitForEvent('download');await page.locator('#spc-surface-mount button[aria-label="导出有界 SPC 报告 JSON"]').click();const d=await event,s=await d.createReadStream(),parts=[];for await(const p of s)parts.push(p);return JSON.parse(Buffer.concat(parts).toString('utf8'));};
  const publicReport=await reportDownload();
  await check('preview JSON export remains bounded public report',publicReport.notes.count===1201&&Object.keys(publicReport).sort().join(',')==='bpm,format,header,notes,time,tracks'&&publicReport.notes.samples.length<=20&&!('timeline' in publicReport)&&!('index' in publicReport));
  const range=preview.locator('input[aria-label="谱面时间位置"]'),play=preview.locator('.preview-controls button').first(),speed=preview.locator('select[aria-label="播放速度"]'),windowSelect=preview.locator('select[aria-label="可视时间窗口"]');
  await play.click();const before=Number(await range.inputValue());await page.waitForTimeout(180);await play.click();const paused=Number(await range.inputValue());await page.waitForTimeout(120);
  await check('preview play advances and pause stabilizes',paused>before+50&&Number(await range.inputValue())===paused);
  await range.evaluate(el=>{el.value='1000';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await check('preview seek follows BPM at 1000ms', (await preview.locator('.preview-readout').innerText()).includes('BPM 150'));
  await range.evaluate(el=>{el.value='2500';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await check('preview seek follows BPM at 2500ms', (await preview.locator('.preview-readout').innerText()).includes('BPM 180'));
  await speed.selectOption('2');await range.evaluate(el=>{el.value='3000';el.dispatchEvent(new Event('input',{bubbles:true}))});await play.click();const fastBefore=Number(await range.inputValue());await page.waitForTimeout(120);await play.click();
  await check('preview 2x playback advances',Number(await range.inputValue())>fastBefore+100);
  await range.evaluate(el=>{el.value='12000';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await check('preview end stops and restarts on next play',await play.getAttribute('aria-label')==='播放'&&(await range.inputValue())==='12000');
  await play.click();await page.waitForFunction(()=>Number(document.querySelector('.spc-preview input[aria-label="谱面时间位置"]')?.value)<12000,null,{timeout:2000});await check('preview end restart occurs only on play',Number(await range.inputValue())<12000);await play.click();
  await windowSelect.selectOption('5000');await check('preview time window changes',await windowSelect.inputValue()==='5000');
  const overview=preview.locator('.overview-viewport'),scale=preview.locator('input[aria-label="分段列高度"]'),follow=preview.locator('input[aria-label="跟随播放"]'),displayMode=preview.locator('select[aria-label="显示方式"]');
  await check('complete vertical overview labels six lanes and unknown-time overlay',async()=>await follow.isChecked()&&await preview.locator('.overview-tile').count()>0&&(await preview.locator('.overview-tile').first().getAttribute('aria-label')).includes('六个键轨及未解析位置时间标记')&&await preview.locator('.preview-legend').getAttribute('aria-label')==='原生类型图例'&&(await preview.locator('.preview-summary').innerText()).includes('位置未解析'));
  await scale.evaluate(el=>{el.value='560';el.dispatchEvent(new Event('input',{bubbles:true}))});await check('overview segment scale updates',await scale.inputValue()==='560'&&await preview.locator('.overview-tile').first().evaluate(c=>c.getBoundingClientRect().height)===552);
  await windowSelect.selectOption('5000');
  await check('overview follow playback can be disabled',async()=>{await follow.uncheck();return !await follow.isChecked()});
  await range.evaluate(el=>{el.value='7000';el.dispatchEvent(new Event('input',{bubbles:true}))});const preservedPosition=await range.inputValue();await displayMode.selectOption('single');
  await check('single layout reverses virtual rows, remains bounded, and preserves seek',async()=>{const tiles=await preview.locator('.overview-tile').evaluateAll(cs=>cs.map(c=>({label:c.getAttribute('aria-label'),top:parseFloat(c.style.top)})).sort((a,b)=>a.top-b.top));return await range.inputValue()===preservedPosition&&await overview.getAttribute('data-layout')==='single'&&await preview.locator('.overview-lane-header').isVisible()&&tiles.length<=6&&tiles.length>0&&Number(tiles[0].label.match(/分段 (\d+)/)?.[1])>Number(tiles.at(-1).label.match(/分段 (\d+)/)?.[1])});
  await displayMode.selectOption('multi');await check('return to multi layout retains absolute seek and selectors',await range.inputValue()===preservedPosition&&await overview.getAttribute('data-layout')==='multi'&&await preview.locator('.overview-lane-header').isHidden());
  const firstTile=preview.locator('.overview-tile').first();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const clickMetrics=await firstTile.evaluate(c=>{const r=c.getBoundingClientRect(),p=c._playhead,event=new MouseEvent('click',{bubbles:true,clientX:r.left+20,clientY:r.top+100}),y=event.clientY-r.top-c.clientTop-p.header,metrics={expected:p.lo+(1-y/p.plotH)*(p.hi-p.lo),p:{...p},clientHeight:c.clientHeight,clientTop:c.clientTop,overlay:{width:c._overlay.width,height:c._overlay.height,cssWidth:c._overlay.clientWidth,cssHeight:c._overlay.clientHeight},expectedMarkerY:p.header+y,clickY:event.clientY};c.dispatchEvent(event);return metrics;});await check('overview segment click seeks absolute timeline and draws paused playhead',async()=>{const actual=Number(await range.inputValue()),pixel=await firstTile.evaluate(c=>{const p=c._playhead,r=c.getBoundingClientRect(),y=100-c.clientTop,ctx=c._overlay.getContext('2d'),d=window.devicePixelRatio||1;for(let dy=-2;dy<=2;dy++)for(let x=2;x<c.clientWidth-2;x+=Math.max(1,Math.floor(c.clientWidth/20))){if(ctx.getImageData(Math.round(x*d),Math.round((y+dy)*d),1,1).data[3]>0)return{alpha:true,y:y+dy}}return{alpha:false,y}});if(Math.abs(actual-clickMetrics.expected)>=2||!pixel.alpha)console.error('overview click diagnostic',JSON.stringify({...clickMetrics,event:undefined,actual,rangeValue:await range.inputValue(),pixel}));return Math.abs(actual-clickMetrics.expected)<2&&pixel.alpha});
  await page.setViewportSize({width:390,height:900});
  await page.waitForFunction(()=>{const viewport=document.querySelector('.overview-viewport'),tile=document.querySelector('.overview-tile');return !!viewport&&!!tile&&tile.clientWidth>=viewport.clientWidth-12&&viewport.scrollHeight>=1600});
  await check('overview responds to mobile resize',await preview.locator('.overview-tile').first().evaluate(c=>c.clientWidth>0));
  await overview.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForFunction(()=>document.querySelector('.overview-tile[aria-label*="9500"]')!==null&&document.querySelector('.overview-viewport')?.scrollTop>0);await check('last overview segment can be scrolled into view',async()=>await overview.evaluate(el=>el.scrollTop>0)&&await preview.locator('.overview-tile[aria-label*="9500"]').count()>0);
  await page.setViewportSize({width:1440,height:1000});
  await check('preview export unchanged after interaction',JSON.stringify(await reportDownload())===JSON.stringify(publicReport));
  await check('zero-extent first boundary note rasterizes with native type color',async()=>{
    const result=await page.evaluate(async()=>{const {createSpcPreview}=await import('./spc-preview.mjs'),parent=document.createElement('div');parent.style.width='280px';document.body.append(parent);const report={notes:{count:1,kindCounts:{'1':1}},time:{startMs:0,endMs:0,spanMs:0},bpm:{base:120,changes:[]},tracks:{unknownPositionCount:0}},timeline={startMs:Int32Array.of(0),endMs:Int32Array.of(0),kind:Int32Array.of(1),laneStart:Int32Array.of(0),laneEnd:Int32Array.of(0)};let instance;try{instance=createSpcPreview(parent,report,timeline);const deadline=performance.now()+2000;let ok=false;while(performance.now()<deadline&&!ok){await new Promise(resolve=>requestAnimationFrame(resolve));const canvas=parent.querySelector('.overview-tile');if(!canvas?.width||!canvas.height)continue;const ctx=canvas.getContext('2d'),x0=0,width=Math.max(1,Math.floor(canvas.width/6)-2),y0=Math.max(0,canvas.height-8),height=Math.min(8,canvas.height-y0),pixels=ctx.getImageData(x0,y0,width,height).data;for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];if(a>0&&r>g+20&&b>g+20&&b>100){ok=true;break}}}return{ok}}finally{instance?.dispose();parent.remove()}});return result.ok;
  });
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(output,'spc-preview-1440.png'),fullPage:true});await preview.screenshot({path:join(output,'vertical-overview-1440.png')});
  await page.setViewportSize({width:390,height:1000});await preview.screenshot({path:join(output,'vertical-overview-390.png')});await check('preview mobile no overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,'spc-preview-390.png'),fullPage:true});
  await displayMode.selectOption('single');await page.setViewportSize({width:1440,height:1000});await preview.screenshot({path:join(output,'continuous-single-1440.png')});await page.setViewportSize({width:390,height:1000});await page.waitForFunction(()=>{const v=document.querySelector('.overview-viewport');return !!v&&v.clientWidth<=560});await check('single layout remains bounded and has no mobile overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&await preview.locator('.overview-tile').count()<=6);await preview.screenshot({path:join(output,'continuous-single-390.png')});await displayMode.selectOption('multi');
  await displayMode.selectOption('single');await page.setViewportSize({width:390,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await check('single mode mobile viewport, canvas, overlay, and neighboring tile bounds',async()=>{const metrics=await page.evaluate(()=>{const v=document.querySelector('.overview-viewport'),tiles=[...document.querySelectorAll('.overview-tile')].sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top)),c=tiles[0],o=c?._overlay,r=c?.getBoundingClientRect(),n=tiles[1]?.getBoundingClientRect();return{viewportWidth:v.clientWidth,viewportScroll:v.scrollWidth,canvasWidth:c?.clientWidth,overlayWidth:o?.clientWidth,canvasLeft:r?.left,canvasBottom:r?.bottom,nextLeft:n?.left,nextTop:n?.top}});return metrics.viewportScroll<=metrics.viewportWidth&&metrics.canvasWidth===metrics.viewportWidth&&metrics.overlayWidth===metrics.canvasWidth&&(!metrics.nextLeft||(Math.abs(metrics.nextLeft-metrics.canvasLeft)<1&&Math.abs(metrics.nextTop-metrics.canvasBottom)<1))});
  const singleRange=preview.locator('input[aria-label="谱面时间位置"]');await singleRange.evaluate(el=>{el.value='7000';el.dispatchEvent(new Event('input',{bubbles:true}))});await play.click();await displayMode.selectOption('multi');await check('layout toggle preserves active playback and absolute clock',async()=>await play.getAttribute('aria-label')==='暂停'&&Number(await singleRange.inputValue())>=7000);await play.click();const clockBeforeFlow=Number(await singleRange.inputValue());
  const flowInput=preview.locator('input[aria-label="流速"]');await scale.evaluate(el=>{el.value='440';el.dispatchEvent(new Event('input',{bubbles:true}))});await flowInput.evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}))});const oneFlow=await preview.locator('.overview-tile').evaluateAll(cs=>cs.map(c=>({duration:c._playhead.hi-c._playhead.lo,height:c._playhead.plotH})).sort((a,b)=>b.duration-a.duration)[0]);await flowInput.evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}))});const twoFlow=await preview.locator('.overview-tile').evaluateAll(cs=>cs.map(c=>({duration:c._playhead.hi-c._playhead.lo,height:c._playhead.plotH})).sort((a,b)=>b.duration-a.duration)[0]);await check('flow rate doubles pixel gap and preserves paused clock',Math.abs((twoFlow.height/twoFlow.duration)/(oneFlow.height/oneFlow.duration)-2)<0.02&&Number(await singleRange.inputValue())===clockBeforeFlow);await flowInput.evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}))});await check('flow rate reset preserves clock state',Number(await singleRange.inputValue())===clockBeforeFlow&&await play.getAttribute('aria-label')==='播放');
  await page.locator('#spc-surface-mount button').last().click();
  await check('clear removes preview and animation',!await page.locator('#spc-surface-mount .spc-preview').count());
  async function loadSave(bytes){
    await page.locator('#save-file').setInputFiles({name:'synthetic.sav',mimeType:'application/octet-stream',buffer:bytes});
    await page.waitForFunction(()=>!document.querySelector('#export').disabled);
  }
  async function exportCheck(bytes,label){
    const expected=canonicalJSON(await parseSave(bytes,true))+'\n';
    const downloading=page.waitForEvent('download');await page.locator('#export').click();
    const download=await downloading,stream=await download.createReadStream();
    const parts=[];for await(const part of stream)parts.push(part);
    await check(label,Buffer.concat(parts).toString('utf8')===expected);
  }
  await loadSave(syntheticSave());
  const chartDetails=surface.locator('.chart-details');
  if(!(await chartDetails.evaluate(el=>el.open))) await chartDetails.locator('summary').click();
  await check('raw report visible',!await page.locator('#report').isHidden());
  await check('unknown metadata and true zero',async()=>{const text=await surface.innerText();return text.includes('未知曲名')&&text.includes('未知曲师')&&text.includes('BPM 未知')&&text.includes('成绩')&&text.includes('0');});
  await exportCheck(syntheticSave(),'canonical export exact before filters');
  await check('aggregate WebMCP shape and validation',await page.evaluate(()=>{
    const tools=window.__qa.tools;if(tools.map(t=>t.name).sort().join(',')!=='read_current_analysis,set_record_view')return false;
    const read=tools.find(t=>t.name==='read_current_analysis'),view=tools.find(t=>t.name==='set_record_view');
    const summary=read.execute({});return Object.keys(summary).sort().join(',')==='bestCount,contentHint,distinctSongs,historyCount,status,view'
      &&summary.bestCount===1&&summary.historyCount===1&&read.execute({extra:true}).code==='invalid_input'
      &&view.execute({view:'history'}).count===1&&view.execute({view:'bad'}).code==='invalid_input'
      &&view.execute({view:'best',extra:true}).code==='invalid_input'&&view.execute({view:'best'}).status==='ok';
  }));
  const browseNetworkStart=requests.length;
  await query.fill('alamode');await pack.selectOption('1');await difficulty.selectOption('1');
  await check('query/pack/difficulty changes do not fetch saved item content',requests.slice(browseNetworkStart).every(r=>!/^\/api\/private-spc\/.+/u.test(new URL(r.url).pathname)));
  await check('query pack difficulty saved intersection',(await surface.locator('.surface-count').innerText()).includes('1 / 78'));
  await query.fill('no-such-song');await check('empty filter results and matching zero card count',async()=>(await surface.innerText()).includes('没有符合筛选条件')&&await songCards.count()===0&&(await surface.locator('.surface-count').innerText()).startsWith('0 /'));
  await query.fill('');await pack.selectOption('');await difficulty.selectOption('');await saved.uncheck();
  await check('global catalog count',(await surface.locator('.surface-count').innerText()).includes('78 / 78'));
  await pack.selectOption('1');await check('pack one has its own membership',(await surface.locator('.surface-count').innerText()).startsWith(`${catalog.songs.filter(s=>s.packIds.includes(1)).length} /`));
  await pack.selectOption('');await query.fill('alamode');await saved.check();
  await loadSave(matrixSave());
  await surface.locator('.chart-details summary').click();
  for(const [i,flag] of [1,2,4,8].entries()){
    await difficulty.selectOption(String(flag));
    const details=surface.locator('.chart-details');
    if(!(await details.evaluate(el=>el.open))) await details.locator('summary').click();
    await check(`flag ${flag} retains its raw score`,(await surface.locator('.chart-card').nth(i).innerText()).includes(`成绩 ${i}`));
  }
  await difficulty.selectOption('');
  await check('history original order and u64',await surface.locator('section').filter({has:page.locator('h3', {hasText:'历史成绩（按存档顺序）'})}).locator('tbody tr').evaluateAll(rows=>rows.map(r=>r.children[1].textContent).join(',')==='0,7,0'&&rows[0].children[4].textContent==='18446744073709551615'));
  await exportCheck(matrixSave(),'canonical export exact after surface filters');
  await loadSave(historyOnlySave());
  if(!(await surface.locator('.chart-details').evaluate(el=>el.open))) await surface.locator('.chart-details summary').click();
  await check('history-only zero retained',(await surface.innerText()).includes('历史最高分 0')&&(await surface.innerText()).includes('仅有历史记录'));
  await query.fill('');await loadSave(unmappedSave());
  if(!(await surface.locator('.unmapped-disclosure').evaluate(el=>el.open))) await surface.locator('.unmapped-disclosure summary').click();
  await check('unknown and conflicting records remain unmapped',(await surface.locator('.unmapped').innerText()).includes('未映射记录（2）'));
  await saved.uncheck();await query.fill('tutorialevolong');
  if(!(await surface.locator('.chart-details').evaluate(el=>el.open))) await surface.locator('.chart-details summary').click();
  await check('unavailable tutorial distinguished',(await surface.innerText()).includes('谱面不可用（教程数据）'));
  await query.fill('alamode');await loadSave(syntheticSave());
  const fixtures=catalog.songs.map(s=>({songId:s.songId,basename:s.basename,mime:'image/png',sha256:hash,width:2,height:2,data:image.toString('base64')}));
  const jacketDoc=JSON.stringify({format:'infalsus-jackets-v1',buildId:'25594228',images:fixtures});
  const picker=surface.locator('input[aria-label="导入本地封面 JSON"]');
  if(!(await surface.locator('.jacket-disclosure').evaluate(el=>el.open))) await surface.locator('.jacket-disclosure summary').click();
  await picker.setInputFiles({name:'synthetic-jackets.json',mimeType:'application/json',buffer:Buffer.from(jacketDoc)});
  await page.waitForFunction(()=>document.querySelector('#song-surface .jacket-import p')?.textContent.includes('封面仅保存在'));
  await check('local jacket import uses in-memory blob',await surface.locator('.jacket-wrap img').evaluate(img=>img.src.startsWith('blob:')));
  await surface.getByRole('button',{name:'恢复内置封面'}).click();
  await check('jacket reset restores built-in cover',await surface.locator('.jacket-wrap img').evaluate(img=>new URL(img.src).pathname==='/jackets/alamode.png'));
  await picker.setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await page.waitForFunction(()=>document.querySelector('#song-surface .jacket-import p')?.textContent.includes('封面未导入'));
  await check('invalid jacket rejected without losing built-in cover',await surface.locator('.jacket-wrap img').evaluate(img=>new URL(img.src).pathname==='/jackets/alamode.png'));
  await mkdir(output,{recursive:true});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await check(`no document overflow ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await query.focus();await page.keyboard.press('Tab');
    await check(`keyboard focus visible ${width}`,await page.evaluate(()=>document.activeElement.matches('#song-surface select')&&getComputedStyle(document.activeElement).outlineStyle!=='none'));
    await check(`table scroll keyboard access ${width}`,await page.locator('[role=region][tabindex="0"]').count()>0);
    await page.screenshot({path:join(output,`synthetic-${width}.png`),fullPage:true});
  }
  await check('tool registrations unchanged',await page.evaluate(()=>window.__qa.tools.length===2));
  await check('post-startup requests are built-in jacket GETs only',requests.slice(startup).every(r=>new URL(r.url).origin===new URL(url).origin&&r.method==='GET'&&(['/note-assets/manifest.json','/note-assets/meshes.json','/note-assets/note-floor-tap.png','/note-assets/note-side-left-tap.png','/note-assets/note-side-right-tap.png','/note-assets/note-side-left-hold.png','/note-assets/note-side-right-hold.png','/note-assets/note-flick-left.png','/note-assets/note-flick-right.png','/note-assets/note-floor-hold.png','/note-assets/note-catch-arch.png','/note-assets/note-catch-dots.png','/spc-air.mjs','/spc-note-visuals.mjs','/spc.mjs','/spc-preview.mjs','/spc-worker.mjs','/spc/spc-worker.mjs','/spc/spc-preview.mjs','/api/session'].includes(new URL(r.url).pathname)||/^\/jackets\/[A-Za-z0-9._%-]+\.png$/u.test(new URL(r.url).pathname))));
  await check('same origin GET only',requests.every(r=>new URL(r.url).origin===new URL(url).origin&&r.method==='GET'));
  await check('no late transport attempts',await page.evaluate(boot=>window.__qa.network.slice(boot).every(r=>r&&typeof r==='object'&&r.name==='fetch'&&String(r.method).toUpperCase()==='GET'&&(()=>{const u=new URL(r.url,location.href);return u.origin===location.origin&&['/note-assets/manifest.json','/note-assets/meshes.json'].includes(u.pathname)})()),bootNetwork));
  await check('no storage writes or registrations attempted',await page.evaluate(()=>window.__qa.storage.length===0));
  await check('no stored data',await page.evaluate(()=>!localStorage.length&&!sessionStorage.length&&document.cookie===''));
  const failed=await context.newPage();await failed.route('**/catalog.json',route=>route.abort());await failed.goto(url);
  await failed.waitForFunction(()=>document.documentElement.dataset.songSurfaceReady==='true');
  await failed.locator('#save-file').setInputFiles({name:'synthetic.sav',mimeType:'application/octet-stream',buffer:syntheticSave()});
  await failed.waitForFunction(()=>!document.querySelector('#export').disabled);
  await check('catalog failure preserves raw report, export, and standalone SPC fallback',!await failed.locator('#report').isHidden()&&await failed.locator('#export').isEnabled()&&await failed.locator('#spc-surface-mount .spc-panel').count()===1&&!await failed.locator('#song-surface #spc-surface-mount').count());
  await check('failed catalog keeps aggregate tools',await failed.evaluate(()=>window.__qa.tools.length===2));
  await context.close();
  await writeFile(join(output,'summary.txt'),`Synthetic browser checks passed: ${checks.length}\n${checks.join('\n')}\nScreenshots require a separate visual review.\n`);
  console.log(`browser-synthetic-qa: ${checks.length} checks passed; screenshots need visual review`);
}finally{await browser.close();}
