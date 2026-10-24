function beatClock(bpm){
 if(!bpm||!Number.isFinite(bpm.base)||bpm.base<=0||!Array.isArray(bpm.changes)||!bpm.changes.every(c=>c&&Number.isFinite(c.timeMs)&&Number.isFinite(c.bpm)&&c.bpm>0))return null;
 const changes=bpm.changes.map((c,i)=>({time:c.timeMs,bpm:c.bpm,order:Number.isInteger(c.eventIndex)?c.eventIndex:i,index:i})).sort((a,b)=>a.time-b.time||a.order-b.order||a.index-b.index);
 // A finite origin supports negative chart times and base tempo before the first event.
 const origin=changes[0]?.time??0,points=[{time:origin,bpm:bpm.base,beats:0}];
 for(const c of changes){const p=points.at(-1),beats=p.beats+(c.time-p.time)*p.bpm/60000;if(!Number.isFinite(beats))return null;points.push({...c,beats})}
 return time=>{
  let lo=0,hi=points.length;while(lo<hi){const m=(lo+hi)>>1;if(points[m].time<=time)lo=m+1;else hi=m}
  const p=points[Math.max(0,lo-1)];return p.beats+(time-p.time)*p.bpm/60000;
 };
}
export function analyzeKeyPatterns(timeline,{bpm,maxGapBeats=0.5,repeatMaxGapBeats=1,maxGapMs=180,minRunNotes=3,minTravelLanes=3}={}){
 if(!Number.isFinite(maxGapBeats)||maxGapBeats<=0||!Number.isFinite(repeatMaxGapBeats)||repeatMaxGapBeats<=0||!Number.isFinite(maxGapMs)||maxGapMs<=0||!Number.isInteger(minRunNotes)||minRunNotes<3||!Number.isInteger(minTravelLanes)||minTravelLanes<1||minTravelLanes>5)throw new RangeError('invalid pattern thresholds');
 const beatAt=beatClock(bpm),rules={timingMode:beatAt?'beats':'milliseconds',maxGapBeats,repeatMaxGapBeats,maxGapMs,minRunNotes,minTravelLanes};
 const out={available:false,doubleGroups:0,tripleGroups:0,repeatRuns:0,repeatLongest:0,alternatingRuns:0,alternatingLongest:0,alternatingSegments:[],subdivisionStats:[],travelTransitions:0,maxLaneGap:0,eligibleHeads:0,excludedHeads:0,smallHeads:0,wideHeads:0,rules};
 const keys=['startMs','endMs','kind','laneStart','laneEnd'];
 if(!timeline||keys.some(k=>!Array.isArray(timeline[k])&&!ArrayBuffer.isView(timeline[k])))return out;
 const n=timeline.startMs.length;
 if(!Number.isInteger(n)||n>1_000_000||keys.some(k=>timeline[k].length!==n))return out;
 for(let i=0;i<n;i++)if(keys.some(k=>!Number.isFinite(timeline[k][i])))return out;
 const groups=new Map(),seen=new Set();
 for(let i=0;i<n;i++){
  const start=timeline.startMs[i],end=timeline.endMs[i],kind=timeline.kind[i],ls=timeline.laneStart[i],le=timeline.laneEnd[i];
  if(kind===4)continue;
  const id=[kind,start,end,ls,le].join(':');if(seen.has(id))continue;seen.add(id);
  if(!groups.has(start))groups.set(start,{start,heads:[],unknown:0});const g=groups.get(start);
  const valid=end>=start&&((kind===1&&Number.isInteger(ls)&&Number.isInteger(le)&&ls>=0&&ls<=le&&le<=5)||(kind===2&&ls===0&&le===0)||(kind===3&&ls===5&&le===5));
  if(!valid){g.unknown++;continue}if(le>ls)out.wideHeads++;else out.smallHeads++;g.heads.push({start,ls,le,eligible:end===start});
 }
 const denominators=[8,12,16,24,32,48,64],subdivisionBuckets=new Map(),newRunGaps=()=>({matched:Array.from({length:denominators.length},()=>({count:0,actualMin:Infinity,actualMax:0,calculatedMin:Infinity,calculatedMax:0} )),unmatched:false,actualMin:Infinity,actualMax:0,referenceGap:null});
 let runGaps=newRunGaps(),prev=null,repeat=0,alternate=0,repeatZone=null,altA=null,altB=null,runStart=0,runEnd=0,laneMin=5,laneMax=0;
 const runHead=(h,first=false)=>{if(first){runStart=h.start;laneMin=h.ls;laneMax=h.le}runEnd=h.start;laneMin=Math.min(laneMin,h.ls);laneMax=Math.max(laneMax,h.le)};
 const addRunGap=(a,b)=>{const ms=b.start-a.start;if(runGaps.referenceGap===null)runGaps.referenceGap=ms;runGaps.actualMin=Math.min(runGaps.actualMin,ms);runGaps.actualMax=Math.max(runGaps.actualMax,ms);if(!beatAt){runGaps.unmatched=true;return}const beats=beatAt(b.start)-beatAt(a.start),rounding=Math.abs(beatAt(b.start)-beatAt(b.start-1));let match=-1,best=Infinity;for(let i=0;i<denominators.length;i++){const target=4/denominators[i],error=Math.abs(beats-target);if(error<=Math.max(target*.03,rounding)&&error<best){best=error;match=i}}if(match<0){runGaps.unmatched=true;return}const x=runGaps.matched[match],calculated=ms*(4/denominators[match])/beats;x.count++;x.actualMin=Math.min(x.actualMin,ms);x.actualMax=Math.max(x.actualMax,ms);x.calculatedMin=Math.min(x.calculatedMin,calculated);x.calculatedMax=Math.max(x.calculatedMax,calculated)};
 const commitRun=()=>{if(alternate<minRunNotes)return;const used=runGaps.matched.filter(x=>x.count),type=runGaps.unmatched||!beatAt?'unclassified':used.length>1?'mixed':used.length===1?String(denominators[runGaps.matched.indexOf(used[0])]):'unclassified';let bucket=subdivisionBuckets.get(type);if(!bucket){bucket={type,count:0,longest:0,actualMinMs:Infinity,actualMaxMs:0,calculatedMinMs:Infinity,calculatedMaxMs:0};subdivisionBuckets.set(type,bucket)}bucket.count++;bucket.longest=Math.max(bucket.longest,alternate);bucket.actualMinMs=Math.min(bucket.actualMinMs,runGaps.actualMin);bucket.actualMaxMs=Math.max(bucket.actualMaxMs,runGaps.actualMax);for(const x of used){if(type!=='mixed'&&type!=='unclassified'){ bucket.calculatedMinMs=Math.min(bucket.calculatedMinMs,x.calculatedMin);bucket.calculatedMaxMs=Math.max(bucket.calculatedMaxMs,x.calculatedMax)}}out.alternatingSegments.push({id:out.alternatingSegments.length,type,startMs:runStart,endMs:runEnd,laneStart:laneMin,laneEnd:laneMax,noteCount:alternate})};
 const clearRunGaps=()=>{runGaps=newRunGaps()};
 const intersection=(a,b)=>{const ls=Math.max(a.ls,b.ls),le=Math.min(a.le,b.le);return ls<=le?{ls,le}:null};
 const recordRepeat=()=>{if(repeat>=minRunNotes){out.repeatRuns++;out.repeatLongest=Math.max(out.repeatLongest,repeat)}};
 const ordered=[...groups.values()].sort((a,b)=>a.start-b.start),orderedIndex=new Map(ordered.map((g,i)=>[g.start,i]));
 const isStairTurn=nextIndex=>{
  if(alternate!==3||nextIndex<0)return false;
  const at=orderedIndex.get(runStart);
  if(at===undefined||at<1||at+4>ordered.length||at+3!==nextIndex)return false;
  const gs=ordered.slice(at-1,at+4);
  if(gs.some(g=>g.unknown||g.heads.length!==1||!g.heads[0].eligible))return false;
  const [c,a,b,d,e]=gs.map(g=>g.heads[0]);
  const beatGap=(p,q)=>beatAt?beatAt(q.start)-beatAt(p.start):q.start-p.start;
  const max=beatAt?maxGapBeats:maxGapMs;
  if([[c,a],[a,b],[b,d],[d,e]].some(([p,q])=>{const gap=beatGap(p,q);return !Number.isFinite(gap)||gap<=0||gap>max+1e-10}))return false;
  const dir=(x,y)=>Math.sign((y.ls+y.le)-(x.ls+x.le)),x=dir(c,a),y=dir(a,b),z=dir(b,d),w=dir(d,e),disjoint=(p,q)=>p.le<q.ls||q.le<p.ls;
  const monotonic=(p,q,v)=>v>0?q.ls>=p.ls&&q.le>=p.le:q.ls<=p.ls&&q.le<=p.le;
  const folded=w===-x&&disjoint(d,e);
  const wrapped=w===x&&(a.ls!==d.ls||a.le!==d.le)&&monotonic(d,e,w);
  return x!==0&&x===y&&z===-x&&disjoint(c,a)&&(folded||wrapped);
 };
 const recordAlternate=(nextIndex=-1)=>{if(alternate>=minRunNotes&&!isStairTurn(nextIndex)){out.alternatingRuns++;out.alternatingLongest=Math.max(out.alternatingLongest,alternate);commitRun()}};
 const reset=()=>{recordRepeat();recordAlternate();prev=null;repeat=alternate=0;repeatZone=altA=altB=null;clearRunGaps()};
 for(let gi=0;gi<ordered.length;gi++){
  const g=ordered[gi];
  if(!g.unknown){if(g.heads.length===2)out.doubleGroups++;else if(g.heads.length>=3)out.tripleGroups++}
  if(g.unknown||g.heads.length!==1||!g.heads[0].eligible){out.excludedHeads+=g.heads.length+g.unknown;reset();continue}
  const h=g.heads[0];out.eligibleHeads++;
  const gap=prev?(beatAt?beatAt(h.start)-beatAt(prev.start):h.start-prev.start):0,limit=beatAt?maxGapBeats:maxGapMs;
  if(!prev||h.start-prev.start<=0||!Number.isFinite(gap)){reset();prev=h;repeatZone=altA=h;repeat=alternate=1;runHead(h,true);continue}
  // Rounded chart timestamps may exceed a beat boundary by at most 1 ms.
  const repeatAllowed=beatAt?beatAt(h.start-1)-beatAt(prev.start)<=repeatMaxGapBeats+1e-10:gap<=maxGapMs;
  const common=repeatAllowed?intersection(repeatZone,h):null;
  if(common){repeat++;repeatZone=common}else{recordRepeat();repeat=1;repeatZone=h}
  if(gap>limit+(beatAt?1e-10:0)){recordAlternate(gi);clearRunGaps();alternate=1;altA=h;altB=null;runHead(h,true);prev=h;continue}
  const distance=Math.max(0,h.ls-prev.le,prev.ls-h.le);
  if(distance>=minTravelLanes){out.travelTransitions++;out.maxLaneGap=Math.max(out.maxLaneGap,distance)}
  if(!intersection(h,prev)){
   const zone=alternate>=2?intersection(alternate%2===0?altA:altB,h):null;
   if(zone&&Math.max(runGaps.actualMax,h.start-prev.start)-Math.min(runGaps.actualMin,h.start-prev.start)<=Math.max(1,runGaps.referenceGap*.03)+1e-10){if(alternate%2===0)altA=zone;else altB=zone;alternate++;runHead(h);addRunGap(prev,h)}
   else{recordAlternate(gi);clearRunGaps();alternate=2;altA=prev;altB=h;runHead(prev,true);runHead(h);addRunGap(prev,h)}
  }else{recordAlternate(gi);clearRunGaps();alternate=1;altA=h;altB=null;runHead(h,true)}
  prev=h;
 }
 reset();out.subdivisionStats=[...subdivisionBuckets.values()].sort((a,b)=>{const ai=denominators.indexOf(Number(a.type)),bi=denominators.indexOf(Number(b.type));return (ai<0?denominators.length:ai)-(bi<0?denominators.length:bi)}).map(x=>({type:x.type,count:x.count,longest:x.longest,actualMinMs:x.actualMinMs,actualMaxMs:x.actualMaxMs,...(x.type==='mixed'||x.type==='unclassified'?{}:{calculatedMinMs:x.calculatedMinMs,calculatedMaxMs:x.calculatedMaxMs})}));out.available=true;return out;
}
export function appendKeyPatternStats(parent,timeline,bpm,options={}){
 const s=analyzeKeyPatterns(timeline,{bpm}),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n},section=el('section');
 section.className='spc-key-patterns';section.setAttribute('aria-label','键型统计（单手 6K）');section.append(el('h3','键型统计（单手 6K）'));
 const grid=el('div');grid.className='spc-metrics';
 const cards=[['♢','双押',`${s.doubleGroups} 组`],['✦','多押',`${s.tripleGroups} 组`],['↔','交互',`${s.alternatingRuns} 段 · 最长 ${s.alternatingLongest} 音`],['≋','子弹',`${s.repeatRuns} 段 · 最长 ${s.repeatLongest} 音`],['⇢','出张（估计）',`${s.travelTransitions} 次 · 最大 ${s.maxLaneGap} 轨间隔`]];
 const selected=new Set(),expanded=new Set(),listeners=[],menus=new Map(),headers=new Map(),types=s.subdivisionStats.map(x=>String(x.type));let disposed=false,activeId=null;
 const listen=(node,type,fn)=>{node.addEventListener?.(type,fn);listeners.push(()=>node.removeEventListener?.(type,fn))};
 const time=ms=>{const n=Math.floor(Math.abs(ms)),m=Math.floor(n/60000),sec=Math.floor(n/1000)%60;return (ms<0?'-':'')+m+':'+String(sec).padStart(2,'0')+'.'+String(n%1000).padStart(3,'0')},labelType=type=>type==='mixed'?'混合节拍':type==='unclassified'?'未分类':({8:'八分',12:'十二分',16:'十六分',24:'二十四分',32:'三十二分',48:'四十八分',64:'六十四分'}[type]||type+'分');
 const sync=()=>{for(const [key,b] of headers){b.setAttribute('aria-pressed',String(key==='all'?types.length>0&&types.every(t=>selected.has(t)):selected.has(key)));b.setAttribute('aria-expanded',String(expanded.has(key)))}for(const menu of menus.values())for(const b of menu.querySelectorAll?.('.spc-pattern-run')||[]){const active=Number(b.getAttribute('data-run-id'))===activeId;b.setAttribute('aria-pressed',String(active));b.classList?.toggle('is-active',active)}};
 const notify=()=>{if(disposed)return;sync();options.onSelect?.(s.alternatingSegments.filter(r=>selected.has(String(r.type))))};
 const menuFor=(key,runs)=>{const menu=el('div');menu.className='spc-pattern-run-list';menu.hidden=true;let rendered=0;const more=el('button','加载更多');more.type='button';more.className='spc-pattern-more';
  const addPage=()=>{const limit=Math.min(runs.length,rendered+100);more.remove?.();for(;rendered<limit;rendered++){const run=runs[rendered],b=el('button',time(run.startMs)+'–'+time(run.endMs)+' · '+run.noteCount+' 音');b.type='button';b.className='spc-pattern-run';b.setAttribute('data-run-id',String(run.id));b.setAttribute('aria-label',labelType(run.type)+'，'+time(run.startMs)+' 至 '+time(run.endMs));listen(b,'click',e=>{e.stopPropagation?.();if(disposed)return;selected.add(String(run.type));activeId=run.id;notify();options.onFocus?.(run)});menu.append(b)}if(rendered<runs.length)menu.append(more);sync()};listen(more,'click',()=>{if(!disposed)addPage()});menu._expand=()=>{if(!rendered)addPage()};menus.set(key,menu);return menu};
 const toggle=key=>{if(disposed)return;const was=key==='all'?types.every(t=>selected.has(t)):selected.has(key);for(const t of key==='all'?types:[key])was?selected.delete(t):selected.add(t);if(was)expanded.delete(key);else expanded.add(key);const menu=menus.get(key);menu.hidden=was;if(!was)menu._expand();if(activeId!==null&&!s.alternatingSegments.some(r=>r.id===activeId&&selected.has(String(r.type))))activeId=null;notify()};
 const bind=(button,key)=>{headers.set(key,button);button.disabled=!types.length;button.setAttribute('aria-pressed','false');button.setAttribute('aria-expanded','false');listen(button,'click',()=>toggle(key))};
 for(const [icon,label,value] of cards){const card=el('div');card.className='spc-metric';const glyph=el('i',icon);glyph.setAttribute('aria-hidden','true');const title=el('span',label),strong=el('strong',s.available?value:'不可用');if(label==='交互'){const b=el('button');b.type='button';b.className='spc-pattern-select';b.setAttribute('aria-label','交互：选择所有交互段');b.setAttribute('aria-pressed','false');b.setAttribute('aria-expanded','false');b.append(glyph,title,strong);bind(b,'all');menuFor('all',s.alternatingSegments);card.append(b)}else card.append(glyph,title,strong);grid.append(card)}grid.append(menus.get('all'));section.append(grid);
 if(s.subdivisionStats.length){
  section.append(el('h4','交互类型'));
  const subdivisions=el('div');subdivisions.className='spc-subdivision-grid';
  const subdivisionLabel=type=>type==='mixed'?'混合节拍':type==='unclassified'?'未分类':({8:'八分',12:'十二分',16:'十六分',24:'二十四分',32:'三十二分',48:'四十八分',64:'六十四分'}[type]||`${type}分`);
  const range=(min,max)=>`${Math.round(min)}${Math.round(max)!==Math.round(min)?`–${Math.round(max)}`:''}ms`;
  for(const x of s.subdivisionStats){
   const card=el('div');card.className='spc-subdivision-card';const pick=el('button');pick.type='button';pick.className='spc-pattern-select';pick.setAttribute('aria-label',`${subdivisionLabel(x.type)}：选择交互段`);pick.setAttribute('aria-pressed','false');pick.setAttribute('aria-expanded','false');const heading=el('div');heading.className='spc-subdivision-heading';const glyph=el('i','↔');glyph.setAttribute('aria-hidden','true');heading.append(glyph,el('strong',subdivisionLabel(x.type)),el('span',x.type==='mixed'||x.type==='unclassified'?'—':`1/${x.type}`));pick.append(heading);bind(pick,String(x.type));card.append(pick,menuFor(String(x.type),s.alternatingSegments.filter(r=>String(r.type)===String(x.type))));
   const count=el('small',`${x.count} 段${x.longest>0?` · 最长 ${x.longest} 音`:''}`);card.append(count);
   const metrics=el('div');metrics.className='spc-subdivision-metrics';
   const calculated=x.calculatedMinMs===undefined?'—':range(x.calculatedMinMs,x.calculatedMaxMs);
   for(const [label,value] of [['节拍间隔',calculated],['实测间隔',range(x.actualMinMs,x.actualMaxMs)]]){const metric=el('div');metric.append(el('span',label),el('strong',value));metrics.append(metric)}
   pick.append(count,metrics);subdivisions.append(card);
  }
  section.append(subdivisions);
 }
 section.append(el('small',`地键 · 小键 ${s.smallHeads} · 宽键 ${s.wideHeads}`));
 const beats=s.rules.timingMode==='beats',gapLabel=beats?'½拍':'180 ms',repeatLabel=beats?'1拍':'180 ms';
 section.append(el('small',beats?'按节拍识别 · 子弹 ≤1拍 · 交互／出张 ≤½拍':'BPM 不可用 · 相邻 ≤180 ms'));
 const details=el('details');details.append(el('summary','识别规则'),el('p',`双押／多押：同刻 2／≥3 个键头；宽音符不拆分，长条只计头。交互是两个不重叠区域等间隔交替（实测间隔差 ≤本段首个间隔的 3% 或 1 ms，取较大者；相邻 ≤${gapLabel}）；子弹是在共同可按区域内连打（相邻 ≤${repeatLabel}）：至少 3 音。每段计一次，可共享边界音。长条头、多押及未知键音打断序列，Catch／Flick 不参与。出张按短键最近可按轨道跨 ≥3 个间隔且 ≤${gapLabel} 逐次估计；这不是实测手部动作，轨道物理间距并不均匀。${beats?'跨变速点按各段 BPM 累计拍数；子弹容许 1 ms 时间取整误差。细分音符按最接近的八分至六十四分拍间隔分类，容差为目标拍间隔 3% 或端点 1 ms 对应拍差中的较大者；计算间隔按该对音符实际累计拍数换算。分类非官方标准，也不代表实际按键速度。':''}`));section.append(details);
 if(!s.available)section.append(el('p','谱面位置数据无效，统计不可用。'));else if(s.excludedHeads)section.append(el('small',`${s.excludedHeads} 个键头未计入连续键型。`));
 parent.append(section);return {dispose(){if(disposed)return;disposed=true;for(const off of listeners)off();section.remove?.()},clearSelection(){if(disposed)return;selected.clear();expanded.clear();activeId=null;for(const menu of menus.values())menu.hidden=true;notify()}};
}
