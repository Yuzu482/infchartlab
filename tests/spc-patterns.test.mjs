import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeKeyPatterns as analyze,appendKeyPatternStats as mount} from '../dist/spc-patterns.mjs';
import {createSpcPreview} from '../dist/spc-preview.mjs';
const t=rows=>Object.fromEntries(['startMs','endMs','kind','laneStart','laneEnd'].map((k,i)=>[k,rows.map(r=>r[i])]));
const tap=(s,l,e=s)=>[s,e,l===0?2:l===5?3:1,l,l];
const check=(rows,expected)=>{const s=analyze(t(rows));for(const [k,v] of Object.entries(expected))assert.equal(s[k],v,k)};
const run=(lanes,expected)=>check(lanes.map((l,i)=>tap(i*100,l)),expected);
test('chord heads',()=>{
 check([tap(20,0),tap(10,1),tap(10,1),tap(10,5),[31,31,1,1,2],tap(40,1),tap(40,2),tap(40,3)],{doubleGroups:1,tripleGroups:1,eligibleHeads:2});
 check([tap(0,1),tap(0,2,500)],{doubleGroups:1});
});
test('maximal two-lane patterns',()=>{
 run([1,1,1,2,1,2],{repeatRuns:1,repeatLongest:3,alternatingRuns:1,alternatingLongest:4});
 run([1,2,3,4],{alternatingRuns:0});run([1,2,1,3,1],{alternatingRuns:2});
 run(Array(20).fill(1),{repeatRuns:1,repeatLongest:20});run([1,2,1,2,1,2],{alternatingRuns:1});
});
test('gap boundaries and restart',()=>{
 for(const [g,n] of [[180,1],[181,0]])check([tap(0,1),tap(g,1),tap(g*2,1)],{repeatRuns:n});
 check([tap(0,1),tap(181,2),tap(281,2),tap(381,2)],{repeatRuns:1});
 check([tap(0,1),tap(10,1),tap(20,1),tap(201,1)],{repeatRuns:1});
});
test('barriers and ignored air',()=>{
 for(const b of [[150,150,99,-1,-1],tap(150,2,250)])check([tap(0,1),tap(100,1),b,tap(200,1)],{repeatRuns:0});
 check([tap(0,1),tap(100,1),tap(100,2),tap(200,1)],{repeatRuns:0});
 check([tap(0,1),tap(0,2),[0,0,99,-1,-1]],{doubleGroups:0});
 check([tap(0,1),[50,100,4,-1,-1],tap(100,1),tap(200,1)],{repeatRuns:1});
});
test('beat thresholds scale with BPM across ground patterns',()=>{
 const model=base=>({base,changes:[]}),result=(rows,bpm)=>analyze(t(rows),{bpm});
 for(const [base,gap,want] of [[120,250,1],[120,251,0],[240,125,1],[240,126,0],[120,200,1],[240,200,0]]){
  assert.equal(result([0,gap,gap*2].map(s=>tap(s,1)),model(base)).repeatRuns,1);
  assert.equal(result([tap(0,1),tap(gap,2),tap(gap*2,1)],model(base)).alternatingRuns,want);
  assert.equal(result([tap(0,0),tap(gap,5)],model(base)).travelTransitions,want);
 }
 assert.equal(result([tap(0,1),[100,200,4,-1,-1],tap(250,1),tap(500,1)],model(120)).repeatRuns,1);
 assert.throws(()=>analyze(t([]),{maxGapBeats:0}),RangeError);
});
test('piecewise BPM, negative times and duplicate events are deterministic',()=>{
 const result=(times,bpm)=>analyze(t(times.map(s=>tap(s,1))),{bpm,repeatMaxGapBeats:0.5}).repeatRuns;
 assert.equal(result([0,200,300],{base:120,changes:[{timeMs:100,bpm:240}]}),0); // first gap is .6 beats
 assert.equal(result([0,250,375],{base:120,changes:[{timeMs:250,bpm:240}]}),1);
 assert.equal(result([-500,-250,0],{base:120,changes:[{timeMs:100,bpm:240}]}),1);
 const bpm={base:120,changes:[{timeMs:100,bpm:120,eventIndex:2},{timeMs:-100,bpm:240,eventIndex:0},{timeMs:100,bpm:240,eventIndex:1}]},copy=structuredClone(bpm);
 assert.equal(result([-100,0,200],bpm),0);assert.equal(result([100,350,600],bpm),1);assert.deepEqual(bpm,copy);
 for(const bad of [undefined,{base:0,changes:[]},{base:120},{base:120,changes:[{timeMs:NaN,bpm:120}]},{base:120,changes:[{timeMs:0,bpm:-1}]}]){
  const s=analyze(t([tap(0,1),tap(200,1),tap(400,1)]),{bpm:bad});assert.equal(s.rules.timingMode,'milliseconds');assert.equal(s.repeatRuns,0);
 }
});
test('alternating subdivisions use tempo-integrated gaps without changing run counts',()=>{
 const rows=times=>times.map((s,i)=>tap(s,i%2?2:1)),stats=(times,bpm)=>analyze(t(rows(times)),{bpm});
 for(const [bpm,gaps,type] of [[120,[125,125],'16'],[120,[83,84],'24'],[180,[83,84],'16'],[180,[55,56],'24']]){
  const times=[0,...gaps.reduce((a,g)=>[...a,a.at(-1)+g],[0]).slice(1)],s=stats(times,{base:bpm,changes:[]});
  assert.equal(s.alternatingRuns,1);assert.deepEqual(s.subdivisionStats.map(x=>x.type),[type]);assert.equal(s.subdivisionStats[0].count,s.alternatingRuns);
  assert.ok(Math.abs(s.subdivisionStats[0].calculatedMinMs-60000*4/(bpm*Number(type)))<1e-9);
 }
 const changed=stats([0,125,250,333,416],{base:120,changes:[{timeMs:250,bpm:180}]});
 assert.equal(changed.alternatingSegments.length,2);assert.deepEqual(changed.alternatingSegments.map(x=>[x.startMs,x.endMs,x.noteCount]),[[0,250,3],[250,416,3]]);
 const crossTempo=stats([0,87.5,150],{base:120,changes:[{timeMs:50,bpm:240}]});assert.equal(crossTempo.alternatingRuns,0);
 const mixed=stats([0,125,208,333],{base:120,changes:[]});assert.equal(mixed.alternatingRuns,0);assert.deepEqual(mixed.subdivisionStats,[]);
 assert.equal(stats([0,125,208],{base:120,changes:[]}).alternatingRuns,0);
 assert.equal(analyze(t(rows([0,125,208])),{}).alternatingRuns,0);
 const offGrid=stats([0,100,200],{base:120,changes:[]});assert.equal(offGrid.subdivisionStats[0].type,'unclassified');
 const fallback=analyze(t(rows([0,100,200])),{}).subdivisionStats[0];assert.equal(fallback.type,'unclassified');assert.equal(fallback.actualMinMs,100);assert.equal('calculatedMinMs' in fallback,false);
 const barrier=analyze(t([tap(0,1),tap(100,2),tap(200,1),[250,250,4,-1,-1],tap(300,2),tap(400,1),tap(500,2)]),{bpm:{base:120,changes:[]}});
 assert.equal(barrier.alternatingRuns,1);assert.equal(barrier.subdivisionStats[0].count,1);
 const shared=analyze(t([tap(0,1),tap(125,2),tap(250,1),tap(375,3),tap(500,1)]),{bpm:{base:120,changes:[]}});
 assert.equal(shared.alternatingRuns,2);assert.equal(shared.subdivisionStats.find(x=>x.type==='16').count,2);
 for(const interrupt of [[250,250,99,-1,-1],tap(250,2,300),[250,250,1,2,2]]){
  const result=analyze(t([tap(0,1),tap(100,2),tap(200,1),interrupt,tap(250,2),tap(250,2),tap(300,2),tap(400,1),tap(500,2)]),{bpm:{base:120,changes:[]}});
  assert.equal(result.alternatingRuns,2);assert.equal(result.subdivisionStats.reduce((n,x)=>n+x.count,0),2);
 }
});
test('uniform real-time alternating gaps split at local boundaries',()=>{
 const bpm={base:120,changes:[]},stats=times=>analyze(t(times.map((s,i)=>tap(s,i%2?2:1))),{bpm});
 const split=stats([0,125,250,350,450]);assert.deepEqual(split.alternatingSegments.map(x=>[x.startMs,x.endMs,x.noteCount]),[[0,250,3],[250,450,3]]);
 assert.equal(stats([0,125,250,375]).alternatingRuns,1);
 assert.equal(stats([0,83,167]).alternatingRuns,1);
 assert.equal(stats([0,125,225]).alternatingRuns,0);
 assert.equal(stats([0,50,150,200]).alternatingRuns,0);
 assert.equal(stats([0,125,208]).alternatingRuns,0);
 const drift=stats([0,125,252,381,512]);assert.ok(drift.alternatingSegments.every(x=>x.noteCount<5));
 assert.equal(stats([0,2,6]).alternatingRuns,0);
 const wide=times=>analyze(t(times.map((s,i)=>[s,s,1,i%2?3:1,i%2?4:2])),{bpm});
 assert.equal(wide([0,125,250]).alternatingRuns,1);assert.equal(wide([0,125,225]).alternatingRuns,0);
});
test('continuous staircase reversals are not alternating runs',()=>{
 const rows=lanes=>lanes.map((v,i)=>Array.isArray(v)?[i*70,i*70,1,v[0],v[1]]:tap(i*70,v)),bpm={base:120,changes:[]};
 for(const lanes of [[1,2,3,2,1],[1,2,3,4,3,2,1],[5,4,3,4,5],[1,2,3,4,3,2,1,2,3,4]])assert.equal(analyze(t(rows(lanes)),{bpm}).alternatingRuns,0);
 for(const lanes of [[1,2,1],[1,2,1,2],[1,2,1,3,1],[2,3,[1,2],[2,3],[3,4]]])assert.ok(analyze(t(rows(lanes)),{bpm}).alternatingRuns>0);
 const actual=[[25674,25674,1,1,1],[25744,25744,1,2,2],[25814,25814,1,3,3],[25953,25953,1,1,2],[26023,26023,1,2,3],[26093,26093,1,3,4]],stats=analyze(t(actual),{bpm:{base:215,changes:[]}});
 assert.equal(stats.alternatingRuns,0);assert.deepEqual(stats.alternatingSegments,[]);assert.deepEqual(stats.subdivisionStats,[]);
 const folded=analyze(t([tap(0,1),tap(70,2),tap(140,3),tap(210,2),tap(280,1)]),{bpm});assert.equal(folded.alternatingRuns,0);assert.equal(folded.alternatingSegments.length,0);
 const mirror=analyze(t([[0,0,1,4,4],[70,70,1,3,3],[140,140,1,2,2],[210,210,1,3,3],[280,280,1,4,4]]),{bpm});assert.equal(mirror.alternatingRuns,0);
 const trill=analyze(t([tap(0,1),tap(70,2),tap(140,1),tap(210,3),tap(280,1)]),{bpm});assert.equal(trill.alternatingRuns,2);assert.equal(trill.alternatingSegments.length,2);
});
test('alternating segment positions, lane spans, shared boundaries and sorted input',()=>{
 const rows=[tap(0,1),tap(125,2),tap(250,1),tap(375,3),tap(500,1)];const result=analyze(t(rows),{bpm:{base:120,changes:[]}});assert.equal(result.alternatingRuns,2);assert.equal(result.alternatingSegments.length,2);assert.deepEqual(result.alternatingSegments.map(({id,type,startMs,endMs,laneStart,laneEnd,noteCount})=>({id,type,startMs,endMs,laneStart,laneEnd,noteCount})),[{id:0,type:'16',startMs:0,endMs:250,laneStart:1,laneEnd:2,noteCount:3},{id:1,type:'16',startMs:250,endMs:500,laneStart:1,laneEnd:3,noteCount:3}]);
 const wide=analyze(t([[0,0,1,1,2],[100,100,1,3,4],[200,200,1,1,2]]),{bpm:{base:120,changes:[]}});assert.deepEqual(wide.alternatingSegments.map(r=>[r.startMs,r.endMs,r.laneStart,r.laneEnd,r.noteCount]),[[0,200,1,4,3]]);
 const reversed=t([tap(400,1),tap(200,1),tap(300,2),tap(100,2),tap(0,1)]),copy=structuredClone(reversed);const sorted=analyze(reversed,{bpm:{base:120,changes:[]}});assert.equal(sorted.alternatingSegments[0].startMs,0);assert.deepEqual(reversed,copy);assert.equal(analyze(t([])).alternatingSegments.length,0);assert.equal(analyze({...reversed,endMs:[]}).alternatingSegments.length,0);
});

test('single-hand travel',()=>{
 check([tap(0,0),tap(180,2),tap(360,5),tap(541,0)],{travelTransitions:1,maxLaneGap:3});
 for(const rows of [[tap(0,1),tap(180,3)],[tap(0,0),tap(181,5)],[tap(0,0),tap(0,5)]])check(rows,{travelTransitions:0});
});
test('large alternating run does not expand heads as function arguments',()=>{
 const n=200000,starts=Array.from({length:n},(_,i)=>i*125),lanes=starts.map((_,i)=>1+i%2);
 const result=analyze({startMs:starts,endMs:starts,kind:Array(n).fill(1),laneStart:lanes,laneEnd:lanes},{bpm:{base:120,changes:[]}});
 assert.equal(result.alternatingRuns,1);assert.deepEqual(result.alternatingSegments,[{id:0,type:'16',startMs:0,endMs:(n-1)*125,laneStart:1,laneEnd:2,noteCount:n}]);
});
test('inputs, immutability and options',()=>{
 const input=t([tap(100,1),tap(-100,1),tap(0,1)]),copy=structuredClone(input);assert.equal(analyze(input).repeatRuns,1);assert.deepEqual(input,copy);
 assert.equal(analyze(Object.fromEntries(Object.entries(input).map(([k,v])=>[k,Int32Array.from(v)]))).repeatRuns,1);check([],{available:true});
 for(const bad of [null,{...input,endMs:[]},t([[NaN,NaN,1,1,1]])])assert.equal(analyze(bad).available,false);
 for(const opts of [{maxGapMs:0},{minRunNotes:2},{minTravelLanes:0},{minTravelLanes:6}])assert.throws(()=>analyze(input,opts),RangeError);
});
class Node{constructor(tag){this.tagName=tag;this.children=[];this.textContent=''}append(...xs){for(const x of xs){x.parent=this;this.children.push(x)}}setAttribute(){}remove(){this.parent.children=this.parent.children.filter(x=>x!==this)}}
const walk=n=>[n,...n.children.flatMap(walk)];
function dom(fn){const old=globalThis.document;try{globalThis.document={createElement:t=>new Node(t)};fn(new Node('root'))}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old}}
test('cards, rules and unknown state',()=>dom(root=>{
 mount(root,t([]));const nodes=walk(root);assert.equal(nodes.filter(n=>n.className==='spc-metric').length,5);assert.equal(nodes.filter(n=>n.tagName==='i').length,5);assert.ok(nodes.some(n=>n.tagName==='details'));
 assert.ok(nodes.some(n=>n.textContent.includes('不是实测手部动作')));mount(root,null);assert.equal(walk(root).filter(n=>n.textContent==='不可用').length,5);
}));
test('preview disposal',()=>dom(root=>{
 const p=createSpcPreview(root,{notes:{count:0}},t([]));assert.equal(root.children.length,1);assert.equal(walk(root).filter(n=>n.className==='spc-metric').length,5);p.dispose();assert.equal(root.children.length,0);
}));
test('preview subdivision cards show classified and fallback intervals',()=>dom(root=>{
 const classified=createSpcPreview(root,{notes:{count:0},bpm:{base:120,changes:[]}},t([tap(0,1),tap(125,2),tap(250,1)]));
 let cards=walk(root).filter(n=>n.className==='spc-subdivision-card');assert.equal(cards.length,1);let text=walk(cards[0]).map(n=>n.textContent).join(' ');assert.ok(text.includes('十六分'));assert.ok(text.includes('1/16'));assert.ok(text.includes('节拍间隔 125ms'));assert.ok(text.includes('实测间隔 125ms'));classified.dispose();assert.equal(root.children.length,0);
 const rounded=createSpcPreview(root,{notes:{count:0},bpm:{base:120,changes:[]}},t([tap(0,1),tap(83,2),tap(167,1)]));
 cards=walk(root).filter(n=>n.className==='spc-subdivision-card');text=walk(cards[0]).map(n=>n.textContent).join(' ');assert.ok(text.includes('二十四分'));assert.ok(text.includes('1/24'));assert.ok(text.includes('节拍间隔 83ms'));assert.ok(text.includes('实测间隔 83–84ms'));rounded.dispose();assert.equal(root.children.length,0);
 const fallback=createSpcPreview(root,{notes:{count:0}},t([tap(0,1),tap(100,2),tap(200,1)]));
 cards=walk(root).filter(n=>n.className==='spc-subdivision-card');text=walk(cards[0]).map(n=>n.textContent).join(' ');assert.ok(text.includes('未分类'));assert.ok(text.includes('节拍间隔 —'));assert.ok(text.includes('实测间隔 100ms'));fallback.dispose();assert.equal(root.children.length,0);
}));
test('preview passes BPM and UI distinguishes fallback',()=>dom(root=>{
 const p=createSpcPreview(root,{notes:{count:0},bpm:{base:120,changes:[]}},t([tap(0,1),tap(200,1),tap(400,1)]));
 assert.ok(walk(root).some(n=>n.textContent==='按节拍识别 · 子弹 ≤1拍 · 交互／出张 ≤½拍'));
 assert.ok(walk(root).some(n=>n.textContent==='1 段 · 最长 3 音'));p.dispose();
 mount(root,t([]));assert.ok(walk(root).some(n=>n.textContent==='BPM 不可用 · 相邻 ≤180 ms'));
 const invalidRows=t([tap(0,1),tap(100,2),tap(200,1)]),invalid=analyze(invalidRows,{bpm:{base:0,changes:[]}});assert.equal(invalid.subdivisionStats[0].type,'unclassified');
 mount(root,invalidRows,{base:0,changes:[]});assert.ok(walk(root).some(n=>n.textContent==='BPM 不可用 · 相邻 ≤180 ms'));assert.ok(!walk(root).some(n=>n.textContent.includes('十六分')||n.textContent.includes('二十四分')));
}));


test('wide ground notes remain single heads and support area-aware patterns',()=>{
 const w=(s,l,r,end=s)=>[s,end,1,l,r];
 check([w(0,1,2),w(100,1,2),w(200,1,2)],{repeatRuns:1,repeatLongest:3,wideHeads:3,eligibleHeads:3,doubleGroups:0});
 check([w(0,1,2),w(100,2,3),w(200,3,4)],{repeatRuns:0}); // no common lane across all three
 check([w(0,1,2),tap(100,2),w(200,1,3)],{repeatRuns:1});
 check([w(0,1,2),w(100,3,4),tap(200,1),tap(300,4)],{alternatingRuns:1,alternatingLongest:4});
 check([w(0,1,3),w(100,2,4),w(200,1,3)],{alternatingRuns:0,repeatRuns:1});
 check([w(0,1,4),tap(100,5)],{travelTransitions:0});
 check([w(0,1,2),tap(100,5)],{travelTransitions:1,maxLaneGap:3});
 check([w(0,1,2),w(0,1,2),tap(0,4)],{doubleGroups:1,wideHeads:1});
 check([w(0,1,2,300),w(100,1,2),w(200,1,2)],{repeatRuns:0,wideHeads:3,excludedHeads:1});
 const input=t([w(0,1,2),w(200,1,2),w(400,1,2)]);
 assert.equal(analyze(input,{bpm:{base:120,changes:[]}}).repeatRuns,1);
 assert.equal(analyze(input,{bpm:{base:240,changes:[]}}).repeatRuns,1);
});

test('actual kakushicommand FBD wide repeats at 142 BPM',()=>{
 const bpm={base:142,changes:[]};
 for(const [times,l,r] of [[[3380,3803,4225,4648],2,3],[[6761,7183,7606,8028],1,4]]){
  const rows=times.map(s=>[s,s,1,l,r]),stats=analyze(t(rows),{bpm});
  assert.equal(stats.repeatRuns,1);assert.equal(stats.repeatLongest,4);
  assert.equal(stats.wideHeads,4);assert.equal(stats.doubleGroups,0);assert.equal(stats.alternatingRuns,0);
  const air=[3500,4000,7000].map(s=>[s,s+100,4,-1,-1]);
  assert.equal(analyze(t([...rows,...air]),{bpm}).repeatRuns,1);
 }
 const times=[1690,2113,2535,2958,3380,3803,4225,4648,5070,5493,5915,6338,6761,7183,7606,8028];
 const spans=[[2,2],[3,3],[2,2],[3,3],[2,3],[2,3],[2,3],[2,3],[1,2],[3,4],[1,2],[3,4],[1,4],[1,4],[1,4],[1,4]];
 const stats=analyze(t(times.map((s,i)=>[s,s,1,...spans[i]])),{bpm});
 assert.equal(stats.repeatRuns,2);assert.equal(stats.repeatLongest,5);assert.equal(stats.alternatingRuns,0);
});

test('repeat beat limit, rounding, independent options and tempo integration',()=>{
 for(const [base,gap,want] of [[142,423,1],[142,424,0],[120,501,1],[120,502,0],[240,251,1],[240,252,0]]){
  const rows=[0,gap,gap*2].map(s=>tap(s,1));assert.equal(analyze(t(rows),{bpm:{base,changes:[]}}).repeatRuns,want);
 }
 const rows=t([tap(0,1),tap(300,1),tap(600,1)]),bpm={base:120,changes:[]};
 assert.equal(analyze(rows,{bpm}).repeatRuns,1);
 assert.equal(analyze(rows,{bpm,repeatMaxGapBeats:0.5}).repeatRuns,0);
 assert.equal(analyze(rows,{bpm,maxGapBeats:0.25}).repeatRuns,1);
 for(const value of [0,-1,NaN,Infinity,null])assert.throws(()=>analyze(rows,{repeatMaxGapBeats:value}),RangeError);
 for(const [times,want] of [[[0,350,600],1],[[0,351,602],1],[[0,352,604],0]]){
  const tempo={base:120,changes:[{timeMs:200,bpm:240}]};
  assert.equal(analyze(t(times.map(s=>tap(s,1))),{bpm:tempo}).repeatRuns,want);
 }
 for(const b of [tap(200,1,500),[200,200,99,-1,-1]]){
  assert.equal(analyze(t([tap(0,1),b,tap(400,1)]),{bpm}).repeatRuns,0);
 }
 assert.equal(analyze(t([tap(0,1),tap(200,1),tap(200,2),tap(400,1)]),{bpm}).repeatRuns,0);
});
