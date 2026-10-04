import assert from 'node:assert/strict';
import {access,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadSpcPreview} from './tests/fixtures/spc-preview.mjs';

const url=process.env.INFALSUS_QA_URL||'http://127.0.0.1:18083/';
let browser;
try{
 const modulePath=process.env.INFALSUS_PLAYWRIGHT_MODULE,executablePath=process.env.INFALSUS_BROWSER_EXECUTABLE,output=process.env.INFALSUS_QA_OUTPUT;
 if(!modulePath||!executablePath||!output)throw new Error('Set INFALSUS_PLAYWRIGHT_MODULE, INFALSUS_BROWSER_EXECUTABLE and INFALSUS_QA_OUTPUT.');
 const pw=await import(modulePath.startsWith('file:')?modulePath:pathToFileURL(modulePath).href);
 browser=await pw.chromium.launch({headless:true,executablePath});
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage(),bad=[],requests=[];
 page.on('request',r=>{requests.push(r.url());if(new URL(r.url()).origin!==new URL(url).origin)bad.push(r.url())});
 await page.goto(url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('.spc-template'));
 await page.evaluate(()=>{let node=document.querySelector('.spc-template');while(node){if(node instanceof HTMLDetailsElement)node.open=true;node=node.parentElement}});
 const template=page.locator('.spc-template');
 if(await template.count()!==1||await page.locator('.spc-preview').count()!==0)throw new Error('Template must appear alone before file selection.');
 const labels=await template.locator('.template-example strong').allTextContents();
 const expected=['中间四轨 · Note','中间四轨 · Long Note','左右侧键 · Note','左右侧键 · Long Note','Air · Catch','Air · Flick'];
 assert.deepEqual(labels,expected);
 if(await template.locator('.template-lane').count()!==6||await template.locator('.template-air').count()!==1||await template.locator('.template-air strong').count()!==0)throw new Error('Schematic must have six key lanes and an overlaid, non-row Air cue.');await page.waitForFunction(()=>[...document.querySelectorAll('.template-note-canvas')].some(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)));
 const assertDiagramGeometry=async()=>{
  const geometry=await template.evaluate(section=>{
   const diagram=section.querySelector('.template-diagram'),diagramRect=diagram.getBoundingClientRect(),lanes=[...diagram.querySelectorAll('.template-lane')];
   const overlay=diagram.querySelector('.template-air'),r=overlay.getBoundingClientRect();return {diagram:{top:diagramRect.top,bottom:diagramRect.bottom,left:diagramRect.left,right:diagramRect.right},lanes:lanes.map(lane=>{const x=lane.getBoundingClientRect();return {top:x.top,bottom:x.bottom,height:x.height,glyphs:[...lane.querySelectorAll('canvas')].map(g=>{const y=g.getBoundingClientRect();return {top:y.top,bottom:y.bottom}})}}),overlay:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,cues:[...overlay.children].map(c=>{const x=c.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom}})}};
  });
  if(geometry.lanes.length!==6||geometry.lanes.some(lane=>lane.height<140||lane.glyphs.some(g=>g.top<lane.top||g.bottom>lane.bottom||g.top<geometry.diagram.top||g.bottom>geometry.diagram.bottom))||geometry.overlay.top>=geometry.lanes.at(-1).bottom||geometry.overlay.cues.length!==2||geometry.overlay.cues.some(g=>g.left<geometry.diagram.left||g.right>geometry.diagram.right||g.top<geometry.diagram.top||g.bottom>geometry.diagram.bottom))throw new Error(`Diagram glyph/overlay containment failed: ${JSON.stringify(geometry)}`);
 };
 await assertDiagramGeometry();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Desktop template layout overflows the viewport.');
 const glyphs=await template.locator('.template-example').evaluateAll(items=>items.map(item=>({kind:['note','long','catch','flick'].find(k=>item.classList.contains(k)),canvas:item.querySelector('.template-glyph').tagName==='CANVAS',pixels:(()=>{const c=item.querySelector('.template-glyph'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n})()}))); 
 if(glyphs.length!==6||glyphs[3].kind!=='long'||glyphs[5].kind!=='flick'||glyphs[4].kind!=='catch'||glyphs.some(g=>!g.canvas||g.pixels<4))throw new Error(`Native canvas glyphs missing or blank: ${JSON.stringify(glyphs)}`);
 const storage=await page.evaluate(()=>[localStorage.length,sessionStorage.length]);
 const dir=resolve(output);await mkdir(dir,{recursive:true});
 for(const name of ['in-falsus-template-desktop.png','in-falsus-template-mobile.png']){try{await access(join(dir,name));throw new Error(`Refusing to overwrite ${name}`)}catch(e){if(e.code!=='ENOENT')throw e}}
 const cuePixels=await template.locator('.template-air').evaluate(el=>[...el.children].map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0,colors=new Set();for(let i=0;i<d.length;i+=4)if(d[i+3]){count++;colors.add(`${d[i]},${d[i+1]},${d[i+2]}`)}return{count,colors:colors.size}}));
 if(cuePixels.length!==2||cuePixels.some(x=>x.count<4||x.colors<2))throw new Error(`Air cues must contain native rendered pixels: ${JSON.stringify(cuePixels)}`);
 await template.screenshot({path:join(dir,'in-falsus-template-desktop.png')});
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(150);
 const mobile=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,template:document.querySelector('.spc-template').getBoundingClientRect().width,labels:[...document.querySelectorAll('.template-example strong')].map(x=>x.textContent)}));
 if(mobile.scroll>mobile.width||mobile.labels.length!==6||mobile.template<=0)throw new Error(`Mobile layout overflow/incomplete: ${JSON.stringify(mobile)}`);
 await assertDiagramGeometry();
 await template.screenshot({path:join(dir,'in-falsus-template-mobile.png')});
 const fixture=loadSpcPreview();
 await page.locator('#spc-surface-mount input[aria-label="精确 Lookup Path"]').fill(fixture.seed);
 await page.locator('#spc-surface-mount input[aria-label="选择本地 SPC 文件"]').setInputFiles({name:'synthetic-preview.spc',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
 await page.waitForFunction(()=>!!document.querySelector('#spc-surface-mount .spc-preview canvas'));
 const preview=page.locator('#spc-surface-mount .spc-preview'),readout=await preview.locator('.preview-readout').innerText();
 if(!readout.includes('1201 音符'))throw new Error(`Synthetic fixture preview missing: ${readout}`);
 const seek=preview.locator('input[aria-label="谱面时间位置"]');await seek.evaluate(el=>{el.value='2500';el.dispatchEvent(new Event('input',{bubbles:true}))});
 if(!(await preview.locator('.preview-readout').innerText()).includes('BPM 180'))throw new Error('Fixture seek did not update BPM.');
 const unknownRaster=await page.evaluate(async()=>{
  const {createSpcPreview}=await import('/spc-preview.mjs'),parent=document.createElement('div');parent.style.width='720px';document.body.append(parent);const calls={text:[],dash:[],rect:[]},proto=CanvasRenderingContext2D.prototype,original={fillText:proto.fillText,setLineDash:proto.setLineDash,strokeRect:proto.strokeRect};
  proto.fillText=function(text,...args){calls.text.push(String(text));return original.fillText.call(this,text,...args)};proto.setLineDash=function(value){if(value.length)calls.dash.push([...value]);return original.setLineDash.call(this,value)};proto.strokeRect=function(...args){calls.rect.push(args);return original.strokeRect.apply(this,args)};
  const report={notes:{count:1,kindCounts:{'77':1}},time:{startMs:0,endMs:15000,spanMs:15000},bpm:{base:120,changes:[]},tracks:{unknownPositionCount:1}},timeline={startMs:Int32Array.of(9500),endMs:Int32Array.of(10500),kind:Int32Array.of(77),laneStart:Int32Array.of(-1),laneEnd:Int32Array.of(-1)};let instance;
  try{instance=createSpcPreview(parent,report,timeline);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const canvases=[...parent.querySelectorAll('.overview-tile')],labels=calls.text.filter(x=>['L','1','2','3','4','R'].includes(x));return{segments:canvases.length,labels:[...new Set(labels)],unknownLabel:calls.text.filter(x=>x.includes('类型 77')).length,dashes:calls.dash,rects:calls.rect,width:canvases[0]?.clientWidth,height:canvases[0]?.clientHeight,summary:parent.querySelector('.preview-summary')?.textContent,aria:canvases[0]?.getAttribute('aria-label')};}
  finally{instance?.dispose();parent.remove();proto.fillText=original.fillText;proto.setLineDash=original.setLineDash;proto.strokeRect=original.strokeRect}
 });
 const uniqueRects=[...new Map(unknownRaster.rects.map(r=>[r.join(','),r])).values()],ranges=[[9500,10000],[10000,10500]];if(unknownRaster.labels.sort().join(',')!=='1,2,3,4,L,R'||uniqueRects.length!==2||ranges.some((range,i)=>{const r=uniqueRects[i],plot=unknownRaster.height-28,lo=i*10000,y0=28+plot*(1-(range[0]-lo)/10000),y1=28+plot*(1-(range[1]-lo)/10000),rawTop=Math.min(y0,y1),clippedTop=Math.max(28,Math.min(28+plot-2,rawTop)),clippedHeight=Math.min(Math.max(2,Math.abs(y1-y0)),28+plot-clippedTop),expectedY=clippedTop+1,expectedHeight=Math.max(2,clippedHeight-2);return !r||Math.abs(r[0]-2)>1||Math.abs(r[2]-(unknownRaster.width-4))>2||Math.abs(r[1]-expectedY)>1||Math.abs(r[3]-expectedHeight)>1})||!unknownRaster.summary.includes('位置未解析')||!unknownRaster.aria.includes('六个键轨'))throw new Error(`Unknown event must render both clipped time ranges across six key lanes: ${JSON.stringify(unknownRaster)}`);
 await page.locator('#spc-surface-mount button').filter({hasText:'清除'}).click();
 if(await page.locator('#spc-surface-mount .spc-preview').count()||await page.locator('.spc-template').count()!==1)throw new Error('Clear did not restore isolated template.');
 if(bad.length||!requests.length)throw new Error(`Unexpected network activity: ${bad.join(', ')}`);
 if(JSON.stringify(storage)!==JSON.stringify(await page.evaluate(()=>[localStorage.length,sessionStorage.length])))throw new Error('Browser storage changed.');
 console.log('template-browser-qa: passed (desktop/mobile six lanes and overlaid schematic cues, actual unknown-time canvas overlays, fixture preview/seek/clear, isolation, no external requests or storage writes)');
}catch(error){console.error(`template-browser-qa: ${error?.stack||error?.message||'failed'}`);process.exitCode=1}
finally{await browser?.close()}
