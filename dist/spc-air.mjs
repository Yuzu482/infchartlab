const f32=value=>{const result=Math.fround(value);return Object.is(result,-0)?0:result};
const empty={center:null,width:null,left:null,right:null,x:null};
const rank={'subtype-unsupported':0,'zero-denominator':1,'nonfinite-geometry':2,'negative-width':3};
export function deriveAirCoordinates(rawI32,pairs){
 const kind=rawI32[2]&255;if(kind!==4)return null;
 const subtype=(rawI32[2]>>>8)&255,type=subtype===5?'catch':subtype===4?'flick':'unknown',flags=rawI32[3];
 const direction=type==='flick'?(flags&0x400?'right':'left'):null;
 const curveModes={left:flags&8?1:flags&16?2:0,right:flags&64?1:flags&128?2:0};
 const out={status:'unresolved',frame:'native-normalized',precision:'float32-operations',type,direction,reason:null,curveModes,start:{...empty},end:{...empty}};
 if(type==='unknown'){out.reason='subtype-unsupported';return out}
 const points=[];let reason=null;const choose=candidate=>{if(reason===null||rank[candidate]<rank[reason])reason=candidate};
 for(const [centerIndex,widthIndex] of [[0,2],[1,3]]){
  const [cn,cd]=pairs[centerIndex],[wn,wd]=pairs[widthIndex];
  if(cd===0||wd===0){choose('zero-denominator');points.push(null);continue}
  const cnum=f32(cn),cden=f32(cd),wnum=f32(wn),wden=f32(wd);
  const center=f32(cnum/cden),width=f32(wnum/wden),half=f32(width/2),left=f32(center-half),right=f32(center+half);
  if(![cnum,cden,wnum,wden,center,width,half,left,right].every(Number.isFinite)){choose('nonfinite-geometry');points.push(null)}
  else if(width<0){choose('negative-width');points.push(null)}
  else points.push({center,width,left,right,x:type==='catch'?null:(direction==='right'?right:left)});
 }
 if(reason){out.reason=reason;return out}
 out.status='resolved';out.start=points[0];out.end=points[1];return out;
}
export function summarizeAirCoordinates(values){const result={count:0,resolvedCount:0,unresolvedCount:0,catchCount:0,flickCount:0,unknownSubtypeCount:0,flickDirectionCounts:{left:0,right:0},frame:'native-normalized',precision:'float32-operations'};for(const value of values){if(!value)continue;result.count++;result[value.status==='resolved'?'resolvedCount':'unresolvedCount']++;result[value.type==='catch'?'catchCount':value.type==='flick'?'flickCount':'unknownSubtypeCount']++;if(value.direction)result.flickDirectionCounts[value.direction]++}return result}
const tupleKinds=new Set(['catch','flick','unknown']);
const reasons=new Set(['subtype-unsupported','zero-denominator','nonfinite-geometry','negative-width']);
const f32value=x=>Number.isFinite(x)&&Math.fround(x)===x&&!Object.is(x,-0);
export function packAirCoordinate(index,air){return[index,air.type,air.direction,air.status==='resolved'?air.start.center:null,air.status==='resolved'?air.start.width:null,air.status==='resolved'?air.end.center:null,air.status==='resolved'?air.end.width:null,air.curveModes.left,air.curveModes.right,air.reason]}
export function unpackAirCoordinate(tuple){const[index,type,direction,c0,w0,c1,w1,leftMode,rightMode,reason]=tuple;const unresolved=reason!==null;const point=(center,width)=>{if(unresolved)return{...empty};const half=f32(width/2),left=f32(center-half),right=f32(center+half);return{center,width,left,right,x:type==='catch'?null:direction==='right'?right:left}};return{status:unresolved?'unresolved':'resolved',frame:'native-normalized',precision:'float32-operations',type,direction,reason,curveModes:{left:leftMode,right:rightMode},start:point(c0,w0),end:point(c1,w1)}}
export function validateAirTimeline(t){
 const base=['startMs','endMs','kind','laneStart','laneEnd'];if(!t||typeof t!=='object'||Array.isArray(t))return null;
 const keys=Object.keys(t),legacy=keys.length===5&&base.every(k=>Object.hasOwn(t,k));if(legacy)return base.every(k=>Array.isArray(t[k]))&&base.every(k=>t[k].length===t.kind.length)?{}:null;
 const expected=[...base,'airVersion','airCoordinates'];if(keys.length!==7||!expected.every(k=>Object.hasOwn(t,k))||t.airVersion!==1||!Array.isArray(t.airCoordinates)||!base.every(k=>Array.isArray(t[k]))||!base.every(k=>t[k].length===t.kind.length))return null;
 const coords=t.airCoordinates,n=t.kind.length;if(coords.length!==t.kind.filter(k=>k===4).length)return null;let prev=-1;
 for(const tuple of coords){if(!Array.isArray(tuple)||tuple.length!==10)return null;const[i,type,direction,c0,w0,c1,w1,lm,rm,reason]=tuple;if(!Number.isInteger(i)||i<=prev||i>=n||t.kind[i]!==4||!tupleKinds.has(type)||!Number.isInteger(lm)||lm<0||lm>2||!Number.isInteger(rm)||rm<0||rm>2)return null;prev=i;
  if(type==='catch'?(direction!==null):(type==='flick'?!(direction==='left'||direction==='right'):direction!==null))return null;
  if(reason!==null&&!reasons.has(reason))return null;
  if(reason==='subtype-unsupported'&&type!=='unknown'||type==='unknown'&&reason!=='subtype-unsupported')return null;
  if(reason!==null){if(![c0,w0,c1,w1].every(x=>x===null)||type==='unknown'&&reason!=='subtype-unsupported')return null;continue}
  if(type==='unknown'||![c0,w0,c1,w1].every(f32value)||w0<0||w1<0)return null;
  for(const [c,w] of [[c0,w0],[c1,w1]]){const half=f32(w/2);if(![half,f32(c-half),f32(c+half)].every(Number.isFinite))return null}
 }
 return{airVersion:1,airCoordinates:coords.map(x=>[...x])};
}
