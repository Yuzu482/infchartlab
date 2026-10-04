import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateCatalog, buildSongModel, filterSongs } from "../dist/catalog.mjs";

const catalog = JSON.parse(await readFile(new URL("../dist/catalog.json", import.meta.url), "utf8"));
const copy = () => structuredClone(catalog);
const record = (songId, basename, difficultyFlag = 1, playerScore = 0n) => ({ songId, basename, difficulty: "MIN", difficultyFlag, playerScore, maxCombo: 0, calculatedPaceValue: 0, lamp: 0, calculatedResultClear: 0, secondsSinceEpochUtc: 0n, judgments: {} });
const empty = (bestRecords = [], historyRecords = []) => buildSongModel({ bestRecords, historyRecords }, catalog);
const byId = (model, id) => model.songs.find((s) => s.song.songId === id);

test("validates pinned catalog facts and actual chart counts", () => {
  assert.equal(validateCatalog(catalog), catalog);
  assert.equal(catalog.songs.length, 78);
  assert.equal(catalog.packs.length, 7);
  assert.equal(catalog.songs.flatMap((s) => s.charts).filter((c) => c.available).length, 300);
});
test("known alamode ratings and flags are preserved", () => {
  const s = catalog.songs.find((x) => x.songId === 2);
  assert.deepEqual(s.charts.map((c) => [c.flag, c.rating, c.levelLabel]), [[1,1,"1"],[2,5,"5"],[4,9,"9"],[8,11,"11"]]);
});
test("known alterededge ratings are preserved", () => {
  const s = catalog.songs.find((x) => x.songId === 3);
  assert.deepEqual(s.charts.map((c) => c.rating), [2,5,9,11]);
});
test("pack membership does not turn pack 1 into global all", () => {
  const all = catalog.packs.find((p) => p.packId === 1);
  assert.equal(all.slug, "all");
  assert.ok(catalog.songs.find((s) => s.songId === 2).packIds.includes(1));
  assert.ok(!catalog.songs.find((s) => s.songId === 3).packIds.includes(1));
});
test("act-1 membership follows song IDs rather than inferred ordering", () => {
  assert.ok(catalog.songs.find((s) => s.songId === 3).packIds.includes(2));
  assert.ok(!catalog.songs.find((s) => s.songId === 2).packIds.includes(2));
});
test("DLC pack contains the five verified IDs", () => {
  const ids = catalog.songs.filter((s) => s.packIds.includes(7)).map((s) => s.songId).sort((a,b) => a-b);
  assert.deepEqual(ids, [84,86,87,88,89]);
});
test("unplayed songs remain in the model and saved-only filtering defaults on", () => {
  const model = empty();
  assert.equal(model.songs.length, 78);
  assert.equal(model.songs.filter((s) => !s.hasSaved).length, 78);
  assert.deepEqual(filterSongs(model), []);
  assert.equal(filterSongs(model, { savedOnly: false }).length, 78);
});
test("matching requires known ID and exact non-null basename", () => {
  const model = empty([record(2, "alamode")]);
  assert.equal(byId(model, 2).best.get(1).playerScore, 0n);
  assert.equal(model.unmapped.length, 0);
  const wrong = empty([record(2, "ALAMODE")]);
  assert.equal(byId(wrong, 2).hasSaved, false);
  assert.equal(wrong.unmapped[0].reason, "basename-conflict");
});
test("a conflicting best basename blocks every record for that song", () => {
  const model = empty([record(2, "wrong")], [record(2, null)]);
  assert.equal(byId(model, 2).hasSaved, false);
  assert.deepEqual(model.unmapped.map((x) => x.reason), ["basename-conflict", "basename-conflict"]);
});
test("history null basename can join by ID when best evidence is not conflicting", () => {
  const model = empty([], [record(2, null, 1, 0n)]);
  assert.equal(byId(model, 2).history.get(1).length, 1);
  assert.equal(byId(model, 2).historyMax.get(1), 0n);
});
test("unknown ID and flag do not join; known unavailable charts do", () => {
  const song = catalog.songs.find((s) => s.songId === 74);
  const model = empty([], [record(999, null), record(2, "alamode", 16), record(74, song.basename, 2)]);
  assert.deepEqual(model.unmapped.map((x) => x.reason), ["unknown-song", "unknown-flag"]);
  assert.equal(byId(model, 74).history.get(2).length, 1);
  assert.equal(byId(model, 74).song.charts.find((c) => c.flag === 2).available, false);
});
test("duplicate best rows for the same song and flag are rejected", () => {
  const model = empty([record(2, "alamode"), record(2, "alamode", 1, 99n)]);
  assert.equal(byId(model, 2).best.has(1), false);
  assert.deepEqual(model.unmapped.map((x) => x.reason), ["duplicate-best", "duplicate-best"]);
});
test("history preserves order and BigInt maxima distinguish zero from absent", () => {
  const a = record(2, "alamode", 1, 0n), b = record(2, "alamode", 1, 9n);
  const model = empty([], [a, b]);
  assert.deepEqual(byId(model, 2).history.get(1), [a, b]);
  assert.equal(byId(model, 2).historyMax.get(1), 9n);
  assert.equal(byId(model, 2).historyMax.has(2), false);
});
test("composable saved, difficulty, and text filters intersect", () => {
  const model = empty([record(2, "alamode", 2)]);
  assert.deepEqual(filterSongs(model, { difficulty: 2 }).map((x) => x.song.songId), [2]);
  assert.deepEqual(filterSongs(model, { difficulty: 1 }), []);
  assert.deepEqual(filterSongs(model, { query: "  ALAMODE ", difficulty: 2 }).map((x) => x.song.songId), [2]);
  assert.deepEqual(filterSongs(model, { query: "not-a-song", savedOnly: false }), []);
});
test("numeric pack filters compose with text, difficulty, and saved state", () => {
  const model = empty([record(2, "alamode", 2)]);
  for (const id of ["1", "2", "7"]) {
    const expected = catalog.songs.filter((s) => s.packIds.includes(Number(id))).map((s) => s.songId);
    assert.deepEqual(filterSongs(model, { packId: id, savedOnly: false }).map((s) => s.song.songId), expected);
  }
  assert.deepEqual(filterSongs(model, { packId: "1", query: "alamode", difficulty: 2 }).map((s) => s.song.songId), [2]);
  assert.deepEqual(filterSongs(model, { packId: "2", query: "alamode", savedOnly: false }), []);
});
test("invalid difficulty and pack filters fail closed", () => {
  const model = empty([record(2, "alamode")]);
  assert.deepEqual(filterSongs(model, { difficulty: 16 }), []);
  assert.deepEqual(filterSongs(model, { packId: "not-real" }), []);
  assert.deepEqual(filterSongs(model, { packId: "01" }), []);
  assert.deepEqual(filterSongs(model, { packId: "999" }), []);
});
test("SPC aggregate validator rejects malformed metrics, paths and provenance", () => {
  const first=copy().songs.flatMap(s=>s.charts).find(c=>c.spc?.status==='ok'&&c.spc.bpm.changes.length>=2);
  for(const mutate of [c=>{c.spc.kindCounts['1']+=1},c=>{c.spc.time.endMs++},c=>{c.spc.bpm.changes.reverse()},c=>{c.spc.tracks.unknownPositionCount=c.spc.noteCount+1}]){
    const doc=copy(),chart=doc.songs.flatMap(s=>s.charts).find(c=>c.chartId===first.chartId);mutate(chart);assert.throws(()=>validateCatalog(doc),/INVALID_CATALOG:/u);
  }
  const failure=copy().songs.flatMap(s=>s.charts).find(c=>c.spc.status==='error');
  const badFailure=copy(),failed=badFailure.songs.flatMap(s=>s.charts).find(c=>c.chartId===failure.chartId);failed.spc.noteCount=0;assert.throws(()=>validateCatalog(badFailure),/INVALID_CATALOG:spc-failure-shape/u);
  const badPath=copy(),pathChart=badPath.songs.flatMap(s=>s.charts).find(c=>c.chartId===first.chartId);pathChart.spc.lookupPath='..\\outside.spc';assert.throws(()=>validateCatalog(badPath),/INVALID_CATALOG:spc-success-shape/u);
  for(const change of [d=>{d.spcSource.availableCount++},d=>{d.spcSource.decoderSha256='0'.repeat(64)}]){const doc=copy();change(doc);assert.throws(()=>validateCatalog(doc),/INVALID_CATALOG:spc-source/u)}
});
test("malformed pins, duplicate identities, references, and art budgets fail validation", () => {
  const badPin = copy(); badPin.buildId = "other";
  assert.throws(() => validateCatalog(badPin), /INVALID_CATALOG:build/u);
  const duplicate = copy(); duplicate.songs[1].songId = duplicate.songs[0].songId;
  assert.throws(() => validateCatalog(duplicate), /INVALID_CATALOG:song-id/u);
  const ref = copy(); ref.songs[0].packIds = [999];
  assert.throws(() => validateCatalog(ref), /INVALID_CATALOG:pack-reference/u);
  const art = copy(); art.songs[0].jacket = { mime: "image/png", sha256: "a".repeat(64), width: 2048, height: 2048 };
  assert.equal(validateCatalog(art), art);
  const overBudget = copy();
  for (const song of overBudget.songs.slice(0, 5)) song.jacket = { mime: "image/png", sha256: "a".repeat(64), width: 2048, height: 2048 };
  assert.throws(() => validateCatalog(overBudget), /INVALID_CATALOG:jacket/u);
});
