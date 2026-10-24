const FORMAT = "infalsus-song-catalog-v1";
const BUILD = "25594228";
const SOURCE = Object.freeze({
  catalogSha256: "75f0944d5d15a999e06e642784962076470f695fe960cc89bc05b963e96dfb70",
  songDataSha256: "c758afa98e8f955ba0d9642ac3e3b44e91c892ab511d41c2f1ad2de673e126fb",
  packDataSha256: "08d29327f4ae933a7347b247d92d1d5f8e201ed4be81e18ecdc452c96d4d333e",
});
const FLAGS = new Set([1, 2, 4, 8]);
const fail = (code) => { throw new TypeError(`INVALID_CATALOG:${code}`); };
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const int = (v) => Number.isSafeInteger(v) && v >= 0;
const nullableText = (v) => v === null || (typeof v === "string" && v.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);

/** Validate the generated, pinned catalog; return the original object unchanged. */
export function validateCatalog(doc) {
  if (!obj(doc)) fail("shape");
  if (doc.format !== FORMAT || doc.buildId !== BUILD) fail("build");
  if (!obj(doc.source) || Object.keys(SOURCE).some((k) => doc.source[k] !== SOURCE[k])) fail("source");
  const dlc = doc.dlcSource !== undefined;
  if (dlc && (!obj(doc.dlcSource) || Object.keys(doc.dlcSource).sort().join(',') !== 'metadataSha256,packId' || doc.dlcSource.packId !== 8 || doc.dlcSource.metadataSha256 !== '050a098bf0e0c286864f7454900d7b8ae599906d5dedb893e42f8985a024a4c5')) fail("dlc-source");
  const extra = dlc ? 20 : 0;
  if (!Array.isArray(doc.songs) || doc.songs.length !== 78 + extra/4 || !Array.isArray(doc.packs) || doc.packs.length !== (dlc ? 8 : 7)) fail("counts");
  if (dlc) {
    const expected = new Map([[77,'disruptorarray'],[78,'kuukansouzou'],[79,'megameteor'],[80,'technopolis'],[81,'yumenohajimari']]);
    const added = doc.songs.filter(s => expected.has(s.songId));
    if (added.length !== 5 || new Set(added.map(s=>s.songId)).size !== 5 || added.some(s=>s.basename!==expected.get(s.songId)||s.packIds?.join(',')!=='8'||s.charts?.map(c=>c.chartId).join(',')!==[0,1,2,3].map(n=>s.basename+n).join(',')||s.charts.some(c=>!c.available||(doc.spcSchema!==undefined&&c.spc?.status!=='ok'))) || doc.songs.some(s=>!expected.has(s.songId)&&s.packIds?.includes(8)) || doc.packs.find(p=>p.packId===8)?.slug!=='dlc-chunithm-0') fail("dlc-coverage");
  }
  const songs = new Map();
  const basenames = new Set();
  const packIds = new Set();
  const packSlugs = new Set();
  for (const pack of doc.packs) {
    if (!obj(pack) || !int(pack.packId) || packIds.has(pack.packId) || typeof pack.slug !== "string" || !/^[a-z0-9-]+$/u.test(pack.slug) || packSlugs.has(pack.slug) || !nullableText(pack.label)) fail("pack");
    packIds.add(pack.packId);
    packSlugs.add(pack.slug);
  }
  if ([...packIds].sort((a, b) => a - b).join(",") !== (dlc ? "1,2,3,4,5,6,7,8" : "1,2,3,4,5,6,7")) fail("pack-ids");
  const chartIds = new Set();
  let available = 0;
  let jacketBytes = 0;
  let packedSongs = 0;
  for (const song of doc.songs) {
    if (!obj(song) || !int(song.songId) || song.songId === 0 || songs.has(song.songId)) fail("song-id");
    if (typeof song.basename !== "string" || song.basename.length === 0 || /[\/\\\u0000-\u001f\u007f]/u.test(song.basename) || basenames.has(song.basename)) fail("basename");
    if (!nullableText(song.title) || !nullableText(song.artist) || !(song.bpm === null || (typeof song.bpm === "number" && Number.isFinite(song.bpm) && song.bpm > 0)) || !(song.chapterId === null || int(song.chapterId))) fail("metadata");
    if (!Array.isArray(song.packIds) || new Set(song.packIds).size !== song.packIds.length || song.packIds.length > 1 || song.packIds.some((id) => !packIds.has(id))) fail("pack-reference");
    if (song.packIds.length) packedSongs++;
    if (!Array.isArray(song.charts)) fail("charts");
    const flags = new Set();
    for (const chart of song.charts) {
      if (!obj(chart) || typeof chart.chartId !== "string" || !chart.chartId || chartIds.has(chart.chartId) || !FLAGS.has(chart.flag) || flags.has(chart.flag)) fail("chart-identity");
      const tier = ({ 1: "MIN", 2: "EVO", 4: "ULT", 8: "FBD" })[chart.flag];
      if (chart.tier !== tier || !Number.isSafeInteger(chart.rating) || chart.rating < 0 || typeof chart.levelLabel !== "string" || chart.levelLabel.length > 16 || /[\u0000-\u001f\u007f-\u009f]/u.test(chart.levelLabel) || typeof chart.available !== "boolean" || (chart.designer !== undefined && !nullableText(chart.designer))) fail("chart-data");
      if (chart.available) available++;
      chartIds.add(chart.chartId);
      flags.add(chart.flag);
    }
    const jacket = song.jacket;
    if (jacket !== null && (!obj(jacket) || jacket.mime !== "image/png" || !hex(jacket.sha256) || !int(jacket.width) || jacket.width < 1 || jacket.width > 2048 || !int(jacket.height) || jacket.height < 1 || jacket.height > 2048)) fail("jacket");
    if (jacket !== null) jacketBytes += jacket.width * jacket.height * 4;
    if (jacketBytes > 64 * 1024 * 1024) fail("jacket");
    songs.set(song.songId, song);
    basenames.add(song.basename);
  }
  if (chartIds.size !== 303 + extra) fail("chart-count");
  if (available !== 300 + extra) fail("available-count");
  if (packedSongs !== 75 + extra/4) fail("packed-song-count");
  if (doc.spcSchema !== undefined) {
    if (doc.spcSchema !== "infalsus-spc-aggregate-v1" || !obj(doc.spcSource) || doc.spcSource.chartCount !== 303 || doc.spcSource.availableCount !== 300 || doc.spcSource.decoderSha256 !== "182f3bec94078b9b50982f126468f845f71a97d711970c67cbbe856c4a0a0f9b" || doc.spcSource.checkpointSha256 !== "59e034acebbb12b293a39a6ebc6c2d7f92ed530963c48b50d8830194446c2b36" || !obj(doc.spcSource.mappingSha256) || !obj(doc.spcSource.nativeSha256) || Object.keys(doc.spcSource.mappingSha256).sort().join(",")!=="a6bc5e6da2a8628fdf4641890acf6c5e.bundle,fdf16516ca412329f8ce3e458b87a389.bundle" || Object.keys(doc.spcSource.nativeSha256).sort().join(",")!=="GameAssembly.dll,infalsus_Data/il2cpp_data/Metadata/global-metadata.dat" || doc.spcSource.mappingSha256["fdf16516ca412329f8ce3e458b87a389.bundle"]!=="58cc0cb66c88bba6d22ccec94f417b71ba5d2d1b3538c029919e158d019d42d0" || doc.spcSource.mappingSha256["a6bc5e6da2a8628fdf4641890acf6c5e.bundle"]!=="8ab911e0d9149a550fa67f5948ce767eb928c4d55afef583c3a5da2d0760e24f" || doc.spcSource.nativeSha256["GameAssembly.dll"]!=="0d4d339b050188cbd53922ee0204105ca71305abfb73bcfdb994affe1b33e70c" || doc.spcSource.nativeSha256["infalsus_Data/il2cpp_data/Metadata/global-metadata.dat"]!=="b3fccad7cb85f61e1e01cac8ff22e9878a0276b7349c42881caeb567c767ef83" || Object.values(doc.spcSource.mappingSha256).some(v=>!hex(v)) || Object.values(doc.spcSource.nativeSha256).some(v=>!hex(v))) fail("spc-source");
    let seen=0;
    for (const song of doc.songs) for (const chart of song.charts) {
      seen++; const x=chart.spc;
      if (!obj(x) || !["ok","error","unsupported"].includes(x.status)) fail("spc-status");
      if (x.status !== "ok") {
        if (typeof x.errorCode !== "string" || !x.errorCode || [x.lookupPath,x.fileSha256,x.bpm,x.noteCount,x.kindCounts,x.time,x.tracks].some(v=>v!==null)) fail("spc-failure-shape");
        if (chart.available && x.status === "unsupported") fail("spc-available-unsupported");
        if (!chart.available && (x.status !== "unsupported" || x.errorCode !== "chart-unavailable")) fail("spc-tutorial");
        continue;
      }
      if (!chart.available || x.errorCode!==null || typeof x.lookupPath!=="string" || x.lookupPath.length>512 || /[\u0000-\u001f\u007f-\u009f]/u.test(x.lookupPath) || x.lookupPath.startsWith("/") || x.lookupPath.includes(":") || x.lookupPath.replaceAll("\\","/").split("/").some(p=>!p||p==="."||p==="..") || !hex(x.fileSha256) || !obj(x.bpm) || !(Number.isFinite(x.bpm.base)&&x.bpm.base>0) || !Array.isArray(x.bpm.changes) || x.bpm.changes.length>10000 || !int(x.noteCount) || !obj(x.kindCounts) || !obj(x.time) || !obj(x.tracks)) fail("spc-success-shape");
      let sum=0; for(const [k,n] of Object.entries(x.kindCounts)){if(!/^(0|[1-9][0-9]{0,2})$/u.test(k)||Number(k)>255||!int(n))fail("spc-kind-count");sum+=n;} if(sum!==x.noteCount)fail("spc-kind-sum");
      let prev=null; for(const e of x.bpm.changes){if(!obj(e)||!int(e.eventIndex)||!Number.isSafeInteger(e.timeMs)||!Number.isInteger(e.kind)||![1,2].includes(e.kind)||!Number.isFinite(e.bpm)||e.bpm<=0)fail("spc-tempo");const key=[e.timeMs,e.eventIndex];if(prev&&(key[0]<prev[0]||(key[0]===prev[0]&&key[1]<=prev[1])))fail("spc-tempo-order");prev=key;}
      if(x.time.status!=="verified"||x.time.unit!=="ms"||x.time.meaning!=="note-extent"||!(x.time.startMs===null||Number.isSafeInteger(x.time.startMs))||!(x.time.endMs===null||Number.isSafeInteger(x.time.endMs))||!(x.time.spanMs===null||Number.isSafeInteger(x.time.spanMs))||(x.noteCount===0?(x.time.startMs!==null||x.time.endMs!==null||x.time.spanMs!==null):(x.time.startMs===null||x.time.endMs<x.time.startMs||x.time.spanMs!==x.time.endMs-x.time.startMs)))fail("spc-time");
      if(!["partial","verified"].includes(x.tracks.status)||!Array.isArray(x.tracks.items)||!int(x.tracks.unknownPositionCount)||x.tracks.unknownPositionCount>x.noteCount||(x.noteCount===0&&x.tracks.items.length!==0)||x.tracks.items.some((n,i)=>!Number.isInteger(n)||n<0||n>5||(i&&n<=x.tracks.items[i-1]))||(x.tracks.status==="verified"&&x.tracks.unknownPositionCount!==0)||(x.tracks.status==="partial"&&x.tracks.unknownPositionCount===0))fail("spc-tracks");
    }
    if(seen!==303+extra)fail("spc-chart-count");
  }
  return doc;
}

const unmapped = (kind, record, reason) => ({ kind, record, reason });
const isRecord = (r) => obj(r) && Number.isSafeInteger(r.songId) && r.songId >= 0 && (r.basename === null || typeof r.basename === "string") && typeof r.playerScore === "bigint";

/** Join parser output without changing records, BigInts, or source ordering. */
export function buildSongModel(report, catalog) {
  validateCatalog(catalog);
  if (!obj(report) || !Array.isArray(report.bestRecords) || !Array.isArray(report.historyRecords)) throw new TypeError("INVALID_REPORT:shape");
  const songs = catalog.songs.map((song) => ({ song, best: new Map(), history: new Map(), historyMax: new Map(), hasSaved: false }));
  const byId = new Map(songs.map((entry) => [entry.song.songId, entry]));
  const best = report.bestRecords;
  const history = report.historyRecords;
  const invalidIds = new Set();
  for (const r of [...best, ...history]) if (!isRecord(r)) throw new TypeError("INVALID_REPORT:record");
  for (const r of best) {
    const entry = byId.get(r.songId);
    if (entry && r.basename !== null && r.basename !== entry.song.basename) invalidIds.add(r.songId);
  }
  const duplicateBest = new Set();
  const bestGroups = new Map();
  for (const r of best) {
    const key = `${r.songId}:${r.difficultyFlag}`;
    const group = bestGroups.get(key) ?? [];
    group.push(r);
    bestGroups.set(key, group);
  }
  for (const [key, group] of bestGroups) if (group.length > 1) duplicateBest.add(key);
  const unmappedRows = [];
  const reasonFor = (r, kind) => {
    if (!byId.has(r.songId)) return "unknown-song";
    if (invalidIds.has(r.songId)) return "basename-conflict";
    if (kind === "best" && r.basename === null) return "missing-basename";
    if (r.basename !== null && r.basename !== byId.get(r.songId).song.basename) return "basename-mismatch";
    if (!FLAGS.has(r.difficultyFlag)) return "unknown-flag";
    const chart = byId.get(r.songId).song.charts.find((c) => c.flag === r.difficultyFlag);
    if (!chart) return "unknown-chart";
    if (kind === "best" && duplicateBest.has(`${r.songId}:${r.difficultyFlag}`)) return "duplicate-best";
    return null;
  };
  for (const r of best) {
    const reason = reasonFor(r, "best");
    if (reason) { unmappedRows.push(unmapped("best", r, reason)); continue; }
    const entry = byId.get(r.songId);
    entry.best.set(r.difficultyFlag, r);
    entry.hasSaved = true;
  }
  for (const r of history) {
    const reason = reasonFor(r, "history");
    if (reason) { unmappedRows.push(unmapped("history", r, reason)); continue; }
    const entry = byId.get(r.songId);
    const rows = entry.history.get(r.difficultyFlag) ?? [];
    rows.push(r);
    entry.history.set(r.difficultyFlag, rows);
    const score = r.playerScore;
    if (typeof score === "bigint") {
      const prior = entry.historyMax.get(r.difficultyFlag);
      if (prior === undefined || score > prior) entry.historyMax.set(r.difficultyFlag, score);
    }
    entry.hasSaved = true;
  }
  return { songs, packs: catalog.packs, unmapped: unmappedRows };
}

/** AND-combine query, pack, chart and saved-record constraints in catalog order. */
export function filterSongs(model, options = {}) {
  if (!obj(model) || !Array.isArray(model.songs) || !obj(options)) throw new TypeError("INVALID_FILTER:shape");
  const query = options.query ?? "";
  const packId = options.packId ?? "";
  const difficulty = options.difficulty ?? "";
  const savedOnly = options.savedOnly ?? true;
  if (typeof query !== "string" || typeof packId !== "string" || typeof savedOnly !== "boolean") throw new TypeError("INVALID_FILTER:type");
  if (difficulty !== "" && (!FLAGS.has(difficulty) || typeof difficulty !== "number")) return [];
  if (packId !== "" && (!/^[1-9][0-9]*$/u.test(packId) || !Number.isSafeInteger(Number(packId)) || !Array.isArray(model.packs) || !model.packs.some((p) => p.packId === Number(packId)))) return [];
  const needle = query.trim().toLocaleLowerCase("en");
  return model.songs.filter((entry) => {
    const song = entry.song;
    if (savedOnly && !entry.hasSaved) return false;
    if (needle && ![song.title, song.artist, song.basename].some((s) => typeof s === "string" && s.toLocaleLowerCase("en").includes(needle))) return false;
    if (packId && !song.packIds.includes(Number(packId))) return false;
    if (difficulty !== "") {
      const chart = song.charts.find((c) => c.flag === difficulty);
      if (!chart || (savedOnly && !entry.best.has(difficulty) && !entry.history.has(difficulty))) return false;
    }
    return true;
  });
}
