import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewClock,createTimelineIndex,queryTimeline,createOverviewLayout,overviewSeek,createFlowLayout,flowTimeToY,flowOverviewSeek,singleVisualRow,singleSegmentAtRow,evaluateCatchCurveEdge,sampleCatchEdges} from '../dist/spc-preview.mjs';

test('Catch native edge easing covers all modes, boundaries, independent edges, and unclamped coordinates',()=>{
 const f=(a,b,u,m)=>evaluateCatchCurveEdge(a,b,m,u);for(const mode of [0,1,2]){assert.equal(f(.2,.8,0,mode),.2);assert.equal(f(.2,.8,1,mode),.8)}
 assert.ok(Math.abs(f(0,1,.5,1)-Math.sin(Math.PI/4))<2e-7);assert.ok(Math.abs(f(0,1,.5,2)-(1-Math.sin(3*Math.PI/4)))<2e-7);
 for(const u of [.25,.5,.75])for(const mode of [0,1,2]){const expected=mode===0?u:mode===1?Math.sin(u*Math.PI/2):1-Math.cos(u*Math.PI/2);assert.ok(Math.abs(f(0,1,u,mode)-expected)<2e-7)}
 assert.equal(evaluateCatchCurveEdge(NaN,1,1,.5),null);assert.equal(evaluateCatchCurveEdge(0,Infinity,1,.5),null);
 for(let left=0;left<=2;left++)for(let right=0;right<=2;right++){const s={left:.2,right:.4},e={left:.5,right:.9},m={left,right},copy=structuredClone([s,e,m]),points=sampleCatchEdges(s,e,m,0,1,16);assert.equal(points.length,17);assert.deepEqual([s,e,m],copy);assert.deepEqual(points[0],[0,.2,.4]);assert.deepEqual(points.at(-1),[1,.5,.9]);assert.equal(points[8][0],.5);assert.ok(Math.abs(points[8][1]-f(.2,.5,.5,left))<1e-7);assert.ok(Math.abs(points[8][2]-f(.4,.9,.5,right))<1e-7)}
 assert.ok(f(.2,.5,-.5,0)<.2);assert.ok(Math.abs(f(.2,.5,2,0)-.8)<1e-7);assert.equal(evaluateCatchCurveEdge(0,1,9,.5),null);assert.equal(sampleCatchEdges({left:0,right:0},{left:1,right:1},{left:0,right:8}),null);
 const adjacent=sampleCatchEdges({left:0,right:0},{left:1,right:1},{left:1,right:2},0,.5,16),next=sampleCatchEdges({left:0,right:0},{left:1,right:1},{left:1,right:2},.5,1,16);assert.deepEqual(adjacent.at(-1),next[0]);
 const zero={left:.3,right:.6};assert.ok(sampleCatchEdges(zero,zero,{left:0,right:0}).every(([u,l,r])=>Math.abs(l-.3)<1e-7&&Math.abs(r-.6)<1e-7));assert.equal(sampleCatchEdges(zero,zero,{left:0,right:0},1,0),null);assert.equal(sampleCatchEdges(zero,zero,{left:0,right:0},0,1,10000).length,257);
});

test('preview clock preserves absolute range and anchors across seek, pause, resume and speed changes',()=>{
 let time=0;const c=createPreviewClock({startMs:-2500,endMs:12000,speed:1,now:()=>time});assert.equal(c.position,-2500);c.play();time=1200;assert.equal(c.position,-1300);c.setSpeed(2);time=2200;assert.equal(c.position,700);assert.equal(c.seek(11000),11000);time=2400;assert.equal(c.position,11400);assert.equal(c.pause(),11400);time=5000;assert.equal(c.position,11400);c.play();time=6000;assert.equal(c.advance(time),12000);assert.equal(c.playing,false);assert.equal(c.seek(-9000),-2500);
});

test('interval tree matches overlap oracle with nonmonotonic and overlapping ranges',()=>{
 const timeline={startMs:[0,-5,9,-40,8,200,1],endMs:[30,-1,20,500,15,205,4]},index=createTimelineIndex(timeline,2);for(const [lo,hi] of [[-20,0],[0,10],[18,25],[300,400],[201,210]]){const expected=timeline.startMs.map((s,i)=>s<=hi&&timeline.endMs[i]>=lo?i:-1).filter(i=>i>=0).sort((a,b)=>timeline.startMs[a]-timeline.startMs[b]||a-b);assert.deepEqual(queryTimeline(index,timeline,lo,hi).items,expected)}
});

test('overview geometry reverses bottom-to-top time, handles signed axes and final partial segments',()=>{
 const layout=createOverviewLayout(-500,12500,5000,900);assert.equal(layout.start,-500);assert.equal(layout.segments,3);assert.equal(overviewSeek(layout,0,layout.tileHeight),-500);assert.equal(overviewSeek(layout,0,0),4500);assert.equal(overviewSeek(layout,2,0),12500);assert.equal(overviewSeek(layout,2,layout.tileHeight),9500);
});

test('overview adapts columns responsively and bounds extreme signed ranges',()=>{
 const narrow=createOverviewLayout(-100,30000,5000,390),wide=createOverviewLayout(-100,30000,5000,1440);assert.equal(narrow.columns,1);assert.equal(wide.columns,4);const huge=createOverviewLayout(-2147483648,2147483647,5000,900);assert.ok(huge.segments<=2048);assert.ok(huge.segmentMs>5000);assert.equal(overviewSeek(huge,huge.segments-1,0),huge.end);
});

test('interval query includes long overlaps across segment boundaries irrespective of stored order',()=>{
 const timeline={startMs:[80,-50,30],endMs:[240,5,150]},index=createTimelineIndex(timeline,1);for(const [lo,hi,expected] of [[0,20,[1]],[100,110,[2,0]],[200,220,[0]]])assert.deepEqual(queryTimeline(index,timeline,lo,hi,Infinity).items,expected);
});

test('zero-duration overview preserves its actual extent',()=>{
 const layout=createOverviewLayout(0,0);assert.equal(layout.end,0);assert.equal(layout.segments,1);assert.equal(overviewSeek(layout,0,0),0);
});

test('flow scales native time coordinates uniformly, including short final columns, independent of BPM',()=>{
 const one=createFlowLayout(0,12500,{flow:1}),two=createFlowLayout(0,12500,{flow:2}),half=createFlowLayout(0,12500,{flow:0.5});assert.equal(one.segmentMs,10000);assert.equal(two.segmentMs,5000);assert.equal(half.segmentMs,20000);
 const gap=(layout,start,delta)=>flowTimeToY(start+delta,start,layout.segmentMs)-flowTimeToY(start,start,layout.segmentMs);
 assert.equal(gap(two,0,500),gap(one,0,1000));assert.equal(gap(half,0,2000),gap(one,0,1000));assert.equal(gap(two,5000,500),gap(one,10000,1000));assert.equal(flowTimeToY(1500,0,one.segmentMs),28+404*(1-1500/10000));
 assert.equal(flowOverviewSeek(two,2,28),12500);assert.equal(flowOverviewSeek(two,2,432),10000);assert.equal(flowOverviewSeek(two,2,230),12500);assert.equal(flowOverviewSeek(two,2,331),11250);
});

test('single-column rows reverse segment order while preserving continuous time and bounded layout',()=>{
 const layout=createFlowLayout(-500,12000,{flow:1,width:390});assert.ok(layout.segments<=2048);for(let segment=0;segment<layout.segments;segment++){const row=singleVisualRow(segment,layout.segments);assert.equal(singleSegmentAtRow(row,layout.segments),segment)}assert.equal(singleVisualRow(0,3),2);assert.equal(singleVisualRow(2,3),0);
 const last=layout.segments-1,partial=Math.min(layout.segmentMs,layout.end-(layout.start+last*layout.segmentMs));assert.equal(flowTimeToY(layout.start,layout.start,layout.segmentMs,0,404),404);assert.equal(flowTimeToY(layout.start+layout.segmentMs,layout.start,layout.segmentMs,0,404),0);assert.equal(flowTimeToY(layout.end,layout.start+last*layout.segmentMs,layout.segmentMs,0,404),404*(1-partial/layout.segmentMs));assert.equal(flowTimeToY(layout.start+last*layout.segmentMs,layout.start+last*layout.segmentMs,partial,0,404),404);assert.equal(layout.tileHeight-36,404);
 const capped=createFlowLayout(-2147483648,2147483647,{flow:1});assert.ok(capped.capped);assert.ok(capped.segments<=2048);assert.equal(singleSegmentAtRow(singleVisualRow(capped.segments-1,capped.segments),capped.segments),capped.segments-1);assert.equal(flowTimeToY(capped.end,capped.start+(capped.segments-1)*capped.segmentMs,capped.segmentMs,0,404),404*(1-(capped.end-(capped.start+(capped.segments-1)*capped.segmentMs))/capped.segmentMs));
});

test('flow layout validates values, preserves signed axes, zero durations, and bounded extreme ranges',()=>{
 for(const value of [0,-1,NaN,Infinity,21])assert.throws(()=>createFlowLayout(-50,50,{flow:value}),RangeError);
 const signed=createFlowLayout(-2147483648,2147483647,{flow:1});assert.ok(signed.segments<=2048);assert.equal(flowOverviewSeek(signed,signed.segments-1,28),signed.end);
 const zero=createFlowLayout(0,0,{flow:1});assert.equal(zero.segments,1);assert.equal(flowOverviewSeek(zero,0,28),0);
});

test('interval query stops at the density cap and reports clipping',()=>{
 const n=20000,timeline={startMs:Int32Array.from({length:n},(_,i)=>i),endMs:Int32Array.from({length:n},(_,i)=>i+100000)},index=createTimelineIndex(timeline,128),result=queryTimeline(index,timeline,0,n,5000);assert.equal(result.items.length,5001);assert.equal(result.clipped,true);assert.equal(result.items[0],0);assert.equal(result.items.at(-1),5000);
});
