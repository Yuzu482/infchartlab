export const MAX_SIZE = 16 * 1024 * 1024;
const MAX_CANDIDATES = 512;
export const DIFF = {1:"MIN",2:"EVO",4:"ULT",8:"FBD"};
export const GROUPS = ["tap","hold","skyArea","flick"];
export const JUDGMENTS = ["none","miss","nearEarly","nearLate","perfectEarly","perfectLate","shiny"];
export const LIMITATIONS = [
  "Only the observed savestate_V3/GameResultsV4 scores and history section is validated; the whole save, root, and build compatibility are not.",
  "The root header byte 9 is required; other bytes before the candidate section and all trailing sections are not decoded or validated.",
  "The structural scan cannot detect unrelated corruption or a new schema that coincidentally matches this observed layout.",
  "History rows may have no matching best-map basename; best/history comparisons make no chronology claim.",
  "Score limit 101000000 and zero unused history slots are provisional observed-profile checks, not universal format guarantees."
];
export class Invalid extends Error {
  constructor(code) { super(code); this.name = "Invalid"; this.code = code; }
}
export function canonicalJSON(value) {
  const quote = s => {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34) out += '\\"';
      else if (c === 92) out += '\\\\';
      else if (c === 8) out += "\\b";
      else if (c === 9) out += "\\t";
      else if (c === 10) out += "\\n";
      else if (c === 12) out += "\\f";
      else if (c === 13) out += "\\r";
      else if (c < 32 || c > 126) out += "\\u" + c.toString(16).padStart(4,"0");
      else out += s[i];
    }
    return out + '"';
  };
  const cmp = (a,b) => {
    const aa = Array.from(a, c => c.codePointAt(0)), bb = Array.from(b, c => c.codePointAt(0));
    for (let i=0; i<Math.min(aa.length,bb.length); i++) if (aa[i] !== bb[i]) return aa[i]-bb[i];
    return aa.length-bb.length;
  };
  const enc = v => {
    if (typeof v === "bigint") return v.toString();
    if (v === null) return "null";
    if (typeof v === "string") return quote(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new TypeError("non-finite number"); return JSON.stringify(v); }
    if (Array.isArray(v)) return "[" + v.map(enc).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort(cmp).map(k => quote(k)+":"+enc(v[k])).join(",") + "}";
    throw new TypeError("unsupported JSON value");
  };
  return enc(value);
}
const LIMIT = 101000000n;
function need(data, offset, size) { if (offset < 0 || size < 0 || offset + size > data.length) throw new Invalid("truncated"); }
function u16(v,o) { return v.getUint16(o,true); }
function i32(v,o) { return v.getInt32(o,true); }
function record(data,v,o) {
  need(data,o,96);
  const songId=u16(v,o), difficulty=v.getUint8(o+2), lamp=v.getUint8(o+3), clear=v.getUint8(o+4);
  if (!(difficulty in DIFF) || lamp>2 || clear>4) throw new Invalid("corrupt");
  const judgments={};
  for(let g=0;g<4;g++) { const row={}; for(let j=0;j<7;j++) row[JUDGMENTS[j]]=u16(v,o+10+g*16+j*2); judgments[GROUPS[g]]=row; }
  const score=v.getBigUint64(o+80,true), timestamp=v.getBigUint64(o+88,true);
  if(score>LIMIT) throw new Invalid("corrupt");
  return {songId,difficulty:DIFF[difficulty],difficultyFlag:difficulty,lamp,calculatedResultClear:clear,maxCombo:u16(v,o+6),calculatedPaceValue:v.getInt16(o+8,true),judgments,playerScore:score,secondsSinceEpochUtc:timestamp};
}
function parseCandidate(data,v,start) {
  let o=start+1; const count=i32(v,o); o+=4;
  if(count<1||count>2048) throw new Invalid("corrupt");
  const best=[], keys=new Set();
  for(let n=0;n<count;n++) {
    need(data,o,9); if(v.getUint8(o)!==3) throw new Invalid("corrupt");
    const raw=i32(v,o+1); if(raw>=0) throw new Invalid("corrupt");
    const byteLength=~raw, units=i32(v,o+5); o+=9;
    if(byteLength<1||byteLength>512) throw new Invalid("corrupt");
    need(data,o,byteLength+3+96);
    let name; try { name=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(data.subarray(o,o+byteLength)); } catch { throw new Invalid("corrupt"); }
    if(!name || name.length>512 || [...name].some(c=>c.codePointAt(0)<32||c.codePointAt(0)===127) || name.includes("/") || name.includes("\\") || name==="." || name==="..") throw new Invalid("corrupt");
    if(name.length!==units) throw new Invalid("corrupt");
    o+=byteLength; const songId=u16(v,o), difficulty=v.getUint8(o+2), value=record(data,v,o+3);
    if(!(difficulty in DIFF)||songId!==value.songId||difficulty!==value.difficultyFlag) throw new Invalid("corrupt");
    const key=canonicalJSON([name,songId,difficulty]); if(keys.has(key)) throw new Invalid("corrupt"); keys.add(key);
    best.push({basename:name,...value}); o+=99;
  }
  const bestEnd=o; need(data,o,5); if(v.getUint8(o)!==2) throw new Invalid("corrupt");
  const capacity=i32(v,o+1); o+=5; if(capacity<1||capacity>65536) throw new Invalid("corrupt");
  need(data,o,capacity*96+4); const arrayStart=o, countPosition=o+capacity*96, historyCount=i32(v,countPosition);
  if(historyCount<0||historyCount>capacity) throw new Invalid("corrupt");
  const history=[]; for(let n=0;n<historyCount;n++) history.push(record(data,v,o+n*96));
  for(let i=o+historyCount*96;i<countPosition;i++) if(data[i]!==0) throw new Invalid("corrupt");
  return {sectionOffset:start,bestEndOffset:bestEnd,historyArrayOffset:arrayStart,historyCountFieldOffset:countPosition,sectionEndOffset:countPosition+4,best,history,capacity};
}
function countDifficulties(rows) { return Object.fromEntries(Object.values(DIFF).map(d=>[d,rows.filter(r=>r.difficulty===d).length])); }
function judgmentTotals(rows) { return Object.fromEntries(GROUPS.map(g=>[g,Object.fromEntries(JUDGMENTS.map(j=>[j,rows.reduce((n,r)=>n+r.judgments[g][j],0)]))])); }
function findCandidates(data,v) {
  let valid=null, anchors=0, sawTruncated=false;
  for(let start=0;start<Math.max(0,data.length-5);start++) {
    if(data[start]!==4||data[start+5]!==3) continue;
    if(i32(v,start+1)<1||i32(v,start+1)>2048) continue;
    if(++anchors>MAX_CANDIDATES) throw new Invalid("candidate_limit");
    let candidate;
    try { candidate=parseCandidate(data,v,start); }
    catch(e) { if(e instanceof Invalid) sawTruncated ||= e.code==="truncated"; else if(!(e instanceof RangeError)) throw e; continue; }
    if(valid!==null) throw new Invalid("ambiguous"); valid=candidate;
  }
  if(valid===null) throw new Invalid(sawTruncated?"truncated":"unsupported_or_invalid");
  return valid;
}
async function sha256(data) {
  let subtle=globalThis.crypto?.subtle;
  if(!subtle && typeof process!=="undefined" && process.versions?.node) subtle=(await import("node:crypto")).webcrypto.subtle;
  if(!subtle) throw new Error("crypto_unavailable");
  const hash=new Uint8Array(await subtle.digest("SHA-256",data));
  return Array.from(hash,b=>b.toString(16).padStart(2,"0")).join("");
}
export async function parseSave(input,includeRecords=false) {
  const data=input instanceof Uint8Array?input:new Uint8Array(input);
  if(data.length>MAX_SIZE) throw new Invalid("oversized");
  if(!data.length) throw new Invalid("empty");
  if(data[0]!==9) throw new Invalid("unsupported");
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength), c=findCandidates(data,v), best=c.best, history=c.history;
  const namesByKey=new Map();
  for(const r of best) { const k=r.songId+":"+r.difficultyFlag, set=namesByKey.get(k)||new Set(); set.add(r.basename); namesByKey.set(k,set); }
  const historyMax=new Map();
  for(const r of history) { const k=r.songId+":"+r.difficultyFlag, old=historyMax.get(k); if(old===undefined||r.playerScore>old) historyMax.set(k,r.playerScore); }
  const comparisons=best.map(r=>{ const maximum=historyMax.get(r.songId+":"+r.difficultyFlag); return {basename:r.basename,songId:r.songId,difficulty:r.difficulty,bestScore:r.playerScore,historyMaxScore:maximum===undefined?null:maximum,matches:maximum===undefined?null:maximum===r.playerScore}; });
  const bt=best.map(r=>r.secondsSinceEpochUtc), ht=history.map(r=>r.secondsSinceEpochUtc);
  const out={profile:"observed-savestate_V3-GameResultsV4",scope:"GameResultsV4 scores/history",wholeSaveValidated:false,inputByteSize:data.length,inputSha256:await sha256(data),sectionOffset:c.sectionOffset,bestEndOffset:c.bestEndOffset,historyArrayOffset:c.historyArrayOffset,historyCountFieldOffset:c.historyCountFieldOffset,sectionEndOffset:c.sectionEndOffset,bestCount:best.length,historyCount:history.length,historyCapacity:c.capacity,zeroUnusedSlots:c.capacity-history.length,distinctSongs:new Set([...best,...history].map(r=>r.songId)).size,bestCountsByDifficulty:countDifficulties(best),historyCountsByDifficulty:countDifficulties(history),bestTimestampPresentCount:bt.filter(x=>x!==0n).length,bestTimestampZeroCount:bt.filter(x=>x===0n).length,historyTimestampPresentCount:ht.filter(x=>x!==0n).length,historyTimestampZeroCount:ht.filter(x=>x===0n).length,bestJudgmentTotals:judgmentTotals(best),historyJudgmentTotals:judgmentTotals(history),bestHistoryComparisons:comparisons,limitations:LIMITATIONS};
  if(includeRecords) { out.bestRecords=best; out.historyRecords=history.map(r=>({basename:(namesByKey.get(r.songId+":"+r.difficultyFlag)?.size===1?[...namesByKey.get(r.songId+":"+r.difficultyFlag)][0]:null),...r})); }
  out.status="ok"; return out;
}
async function readBounded(fs,path) {
  const handle=await fs.open(path,"r");
  try { const chunks=[]; let total=0; while(total<=MAX_SIZE) { const b=Buffer.alloc(Math.min(65536,MAX_SIZE+1-total)); const {bytesRead}=await handle.read(b,0,b.length,null); if(!bytesRead) break; chunks.push(b.subarray(0,bytesRead)); total+=bytesRead; } return Buffer.concat(chunks,total); }
  finally { await handle.close(); }
}
async function cli() {
  const args=process.argv.slice(2), records=args.includes("--records");
  if(args.includes("--records")) args.splice(args.indexOf("--records"),1);
  let out, code=0;
  try {
    if(args.length!==1) throw new Invalid("unreadable");
    const fs=await import("node:fs/promises"), first=await readBounded(fs,args[0]);
    if(first.length>MAX_SIZE) throw new Invalid("oversized");
    const second=await readBounded(fs,args[0]);
    if(second.length>MAX_SIZE) throw new Invalid("oversized");
    if(!first.equals(second)) throw new Invalid("input_changed");
    out=await parseSave(first,records);
  } catch(e) { out={status:"error",error:e instanceof Invalid?e.code:(e?.code==="crypto_unavailable"?"crypto_unavailable":"unreadable")}; code=2; }
  process.stdout.write(canonicalJSON(out)+"\n"); process.exitCode=code;
}
if(typeof process!=="undefined"&&process.versions?.node&&process.argv[1]) {
  const [{fileURLToPath},{resolve}]=await Promise.all([import("node:url"),import("node:path")]);
  if(import.meta.url===((await import("node:url")).pathToFileURL(resolve(process.argv[1])).href)) await cli();
}
