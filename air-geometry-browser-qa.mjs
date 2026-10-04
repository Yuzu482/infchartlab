import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const base=process.env.INFALSUS_QA_URL,mod=process.env.INFALSUS_PLAYWRIGHT_MODULE,exe=process.env.INFALSUS_BROWSER_EXECUTABLE,out=process.env.INFALSUS_QA_OUTPUT;
if(!base||!mod||!exe||!out||new URL(base).hostname!=='127.0.0.1')throw Error('Configured local browser required');
const pw=await import(pathToFileURL(mod).href),browser=await pw.chromium.launch({headless:true,executablePath:exe});
try {
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[],external=[],writes=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.url())});
 await page.goto(base,{waitUntil:'networkidle'});
 const result=await page.evaluate(async()=>{
  const {drawNote,loadNoteAssets}=await import('/spc-note-visuals.mjs');
  const native=loadNoteAssets({baseUrl:'/note-assets/'});await native.ready;
  const canvas=document.createElement('canvas');canvas.width=180;canvas.height=120;const ctx=canvas.getContext('2d'),pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
  drawNote({ctx,rect:{x:30,y:30,width:100,height:40},type:'catch'});const catchPixels={corner:pixel(30,30),center:pixel(80,50)};
  ctx.clearRect(0,0,180,120);drawNote({ctx,rect:{x:30,y:20,width:90,height:60},type:'catch',polygon:[[30,20],[120,20],[150,80],[60,80]],clip:{left:0,top:30,width:180,height:40}});const clipPixels={outside:pixel(50,22),inside:pixel(70,40)};
  const flick=[];
  for(const ready of [false,true])for(const direction of ['right','left']){
   ctx.clearRect(0,0,180,120);const x=direction==='right'?30:90;
   const result=drawNote({ctx,rect:{x,y:30,width:60,height:40},type:'flick',direction,assets:ready?native.images:undefined,meshes:ready?native.meshes:undefined});
   const head=[];for(let yy=40;yy<60;yy++)for(let xx=x+20;xx<x+42;xx++)head.push(pixel(xx,yy));
   flick.push({ready,direction,parts:result.parts,tail:pixel(direction==='right'?42:138,50),head:head.filter(p=>p[3]>0).length});
  }
  const {createSpcPreview}=await import('/spc-preview.mjs'),root=document.createElement('div');root.id='air-geometry-qa';root.style.cssText='width:min(900px,100%);margin:auto';document.body.append(root);
  const timeline={startMs:Int32Array.of(0,1500,3000,4000),endMs:Int32Array.of(12500,1500,3000,4000),kind:Int32Array.of(4,4,4,4),laneStart:Int32Array.of(-1,-1,-1,-1),laneEnd:Int32Array.of(-1,-1,-1,-1),airVersion:1,airCoordinates:[[0,'catch',null,.3,.3,.6,.3,1,0,null],[1,'catch',null,.3,.2,.3,.2,0,0,null],[2,'flick','right',.45,.12,.45,.12,0,0,null],[3,'flick','left',.75,.12,.75,.12,0,0,null]]};
  const report={notes:{count:4,kindCounts:{4:4}},time:{startMs:0,endMs:12500,spanMs:12500},bpm:{base:120,changes:[]}};
  const preview=createSpcPreview(root,report,timeline),select=root.querySelector('[aria-label="可视时间窗口"]');select.value='5000';select.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,250));
  const samples=[];
  for(const [segment,time] of [[0,2500],[1,7500]]){
   const c=root.querySelectorAll('.overview-tile')[segment],w=c.clientWidth,h=c.clientHeight,sx=c.width/w,sy=c.height/h;
   const y=28+(h-28)*(1-(time-segment*5000)/5000),u=time/12500,left=.15+.3*Math.sin(u*Math.PI/2),right=.45+.3*u,x=(left+right)/2*w,straightLeft=.15+.3*u;
   const get=(xx,yy)=>Array.from(c.getContext('2d').getImageData(Math.round(xx*sx),Math.round(yy*sy),1,1).data);
   samples.push({inside:get(x,y),outside:get((left+straightLeft)/2*w,y),header:get(x,6)});
  }
  const second=document.createElement('div');root.append(second);const secondTimeline={...timeline,airCoordinates:timeline.airCoordinates.map(a=>[...a])};secondTimeline.airCoordinates[0][7]=2;secondTimeline.airCoordinates[0][8]=1;
  const preview2=createSpcPreview(second,report,secondTimeline),select2=second.querySelector('[aria-label="可视时间窗口"]');select2.value='5000';select2.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,250));
  const curveOnly=[];for(const [segment,time] of [[0,2500],[1,7500]]){const c=second.querySelectorAll('.overview-tile')[segment],w=c.clientWidth,h=c.clientHeight,u=time/12500,y=28+(h-28)*(1-(time-segment*5000)/5000),left=.15+.3*(1-Math.cos(u*Math.PI/2)),linear=.15+.3*u;curveOnly.push(Array.from(c.getContext('2d').getImageData(Math.round((left+linear)/2*c.width),Math.round(y*c.height/h),1,1).data))}
  window.__airGeometryCleanup=()=>{preview.dispose();preview2.dispose();native.dispose();root.remove()};
  return {catchPixels,clipPixels,flick,samples,curveOnly};
 });
 const purple=p=>p[3]>0&&p[2]>p[0]+20&&p[2]>p[1]+20;
 assert.equal(result.catchPixels.corner[3],0);assert.ok(purple(result.catchPixels.center));assert.equal(result.clipPixels.outside[3],0);assert.ok(purple(result.clipPixels.inside));
 for(const f of result.flick){assert.deepEqual(f.parts,['trail','head']);assert.ok(f.head>0);assert.ok(f.tail[3]>0);assert.ok(f.direction==='right'?f.tail[1]>f.tail[0]&&f.tail[1]>f.tail[2]:f.tail[0]>200&&f.tail[1]>150&&f.tail[2]<80)}
 for(const s of result.samples){assert.ok(purple(s.inside),`Catch midpoint missing: ${s.inside}`);assert.ok(!purple(s.outside));assert.ok(!purple(s.header))}
 for(const p of result.curveOnly)assert.ok(purple(p),'Mode 2 curve must fill pixels outside the old straight boundary');
 await mkdir(resolve(out),{recursive:true});await page.locator('#air-geometry-qa').screenshot({path:join(out,'air-geometry-desktop.png')});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#air-geometry-qa').screenshot({path:join(out,'air-geometry-mobile.png')});
 await page.evaluate(()=>window.__airGeometryCleanup());assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);console.log('PASS Catch geometry across segments, native/fallback Flick head and trail, clipping, desktop/mobile, no external requests or writes');
} finally {await browser.close()}
