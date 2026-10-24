import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { importDesigners } from "../tools/import-chart-designers.mjs";
import { validateCatalog } from "../dist/catalog.mjs";
import { createSongSurface } from "../dist/surface.mjs";

const catalog = JSON.parse(await readFile(new URL("../dist/catalog.json", import.meta.url), "utf8"));
const sourceCheckpoint = (rows) => ({ records: { SongData: { fields: { allSongInfo: [{ ChartInfos: rows }] } } } });
const row = (Id, DisplayChartDesigner) => ({ Id, DisplayChartDesigner });
const allIds = () => catalog.songs.flatMap((song) => song.charts.map((chart) => chart.chartId));

test("per-chart source joins keep difficulty-specific names and unresolved placeholders null", () => {
  const ids = allIds();
  const values = ids.map((id) => row(id, id === "alamode0" ? "Dex" : id === "alamode3" ? "sorae" : " verified "));
  values[4] = row(ids[4], "ChartDesigner12");
  values[5] = row(ids[5], "   ");
  const result = importDesigners(catalog, sourceCheckpoint(values));
  const alamode = result.songs.find((song) => song.basename === "alamode");
  assert.equal(alamode.charts.find((chart) => chart.flag === 1).designer, "Dex");
  assert.equal(alamode.charts.find((chart) => chart.flag === 8).designer, "sorae");
  assert.equal(alamode.charts.find((chart) => chart.flag === 2).designer, " verified ");
  assert.equal(result.songs.flatMap((song) => song.charts).find((chart) => chart.chartId === ids[4]).designer, null);
  assert.equal(result.songs.flatMap((song) => song.charts).find((chart) => chart.chartId === ids[5]).designer, null);
  const original = structuredClone(catalog);
  for (const song of original.songs) for (const chart of song.charts) delete chart.designer;
  const cleanResult = importDesigners(original, sourceCheckpoint(values));
  assert.equal(original.songs.find((song) => song.basename === "alamode").charts[0].designer, undefined);
  assert.equal(cleanResult.songs.find((song) => song.basename === "alamode").charts[0].designer, "Dex");
  assert.equal(validateCatalog(result), result);
});

test("empty IDs are ignored but duplicate, missing and extra non-empty IDs fail", () => {
  const ids = allIds();
  const complete = ids.map((id) => row(id, "name"));
  assert.equal(importDesigners(catalog, sourceCheckpoint([...complete, row("", ""), row("", "")])).songs.length, catalog.songs.length);
  assert.throws(() => importDesigners(catalog, sourceCheckpoint([...complete, row(ids[0], "again")])), /duplicate-id/u);
  assert.throws(() => importDesigners(catalog, sourceCheckpoint(complete.slice(1))), /missing-id/u);
  assert.throws(() => importDesigners(catalog, sourceCheckpoint([...complete, row("extra", "name")])), /unknown-id/u);
});

test("designer values must be strings, at most 128 characters, and control-free", () => {
  const ids = allIds();
  for (const value of [null, 7, "x".repeat(129), "name\ncredit", "x\u0085y"]) {
    const rows = ids.map((id, index) => row(id, index ? "ok" : value));
    assert.throws(() => importDesigners(catalog, sourceCheckpoint(rows)), /INVALID_DESIGNERS:/u);
  }
});

test("output is deterministic and catalogs without the optional field remain valid", () => {
  const ids = allIds(), checkpoint = sourceCheckpoint(ids.map((id) => row(id, " literal ")));
  const a = importDesigners(catalog, checkpoint), b = importDesigners(catalog, checkpoint);
  assert.deepEqual(a, b);
  assert.equal(a.songs[0].charts[0].designer, " literal ");
  const older = structuredClone(catalog);
  for (const song of older.songs) for (const chart of song.charts) delete chart.designer;
  assert.equal(validateCatalog(older), older);
});

class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ""; this.textContent = ""; this.className = ""; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  focus() {}
  dispatch(key) { this.listeners[key]?.(); }
  find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find?.(predicate); if (found) return found; } return null; }
}

test("selected difficulty designer is displayed and missing credit is unknown", () => {
  const oldDocument = globalThis.document, oldAdd = globalThis.addEventListener;
  globalThis.document = { createElement: (tag) => new FakeNode(tag) };
  globalThis.addEventListener = () => {};
  try {
    const fixture = structuredClone(catalog), song = fixture.songs.find((entry) => entry.basename === "alamode");
    song.charts.find((chart) => chart.flag === 1).designer = "Dex";
    song.charts.find((chart) => chart.flag === 8).designer = "sorae";
    const root = new FakeNode("main"); createSongSurface(root, fixture);
    const surface = root.children[0], designer = () => surface.find((node) => node.className === "song-designer");
    const tiers = () => { const found = []; const walk = (node) => { if (node.className?.includes("tier-button")) found.push(node); for (const child of node.children) walk(child); }; walk(surface); return found; };
    assert.equal(designer().textContent, "谱师：Dex");
    tiers()[3].dispatch("click"); assert.equal(designer().textContent, "谱师：sorae");
    tiers()[0].dispatch("click"); assert.equal(designer().textContent, "谱师：Dex");
    delete song.charts.find((chart) => chart.flag === 1).designer;
    tiers()[0].dispatch("click"); assert.equal(designer().textContent, "谱师：未知");
  } finally { globalThis.document = oldDocument; globalThis.addEventListener = oldAdd; }
});

test("CLI rejects an unpinned checkpoint without creating output or temp artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chart-designers-"));
  try {
    const checkpoint = join(directory, "checkpoint.json"), input = join(directory, "catalog.json"), output = join(directory, "output.json");
    await writeFile(checkpoint, JSON.stringify(sourceCheckpoint([])));
    await writeFile(input, JSON.stringify(catalog));
    const script = new URL("../tools/import-chart-designers.mjs", import.meta.url);
    const scriptPath = (await import("node:url")).fileURLToPath(script);
    const result = spawnSync(process.execPath, [scriptPath, "--checkpoint", checkpoint, "--catalog", input, "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /checkpoint-pin/u);
    assert.deepEqual((await readdir(directory)).sort(), ["catalog.json", "checkpoint.json"]);
    const missing = spawnSync(process.execPath, [scriptPath, "--checkpoint", checkpoint], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /INVALID_DESIGNERS:arguments/u);
    const unknown = spawnSync(process.execPath, [scriptPath, "--wat"], { encoding: "utf8" });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /INVALID_DESIGNERS:arguments/u);
    const duplicate = spawnSync(process.execPath, [scriptPath, "--checkpoint", join(directory, "missing-one"), "--checkpoint", join(directory, "missing-two"), "--catalog", input, "--output", output], { encoding: "utf8" });
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stderr, /INVALID_DESIGNERS:arguments/u);
    assert.deepEqual((await readdir(directory)).sort(), ["catalog.json", "checkpoint.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("catalog validator rejects invalid nullable designer content", () => {
  for (const value of [4, "x".repeat(129), "bad\u0000name", "bad\u009fname"]) {
    const changed = structuredClone(catalog);
    changed.songs[0].charts[0].designer = value;
    assert.throws(() => validateCatalog(changed), /INVALID_CATALOG:chart-data/u);
  }
  const valid = structuredClone(catalog);
  valid.songs[0].charts[0].designer = null;
  assert.equal(validateCatalog(valid), valid);
});
