import { createHash } from "node:crypto";
import { parseArgs as parseNamedArgs } from "node:util";
import { readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { validateCatalog } from "../dist/catalog.mjs";

const CHECKPOINT_SHA256 = "59e034acebbb12b293a39a6ebc6c2d7f92ed530963c48b50d8830194446c2b36";
const MAX_BYTES = 4 * 1024 * 1024;
const invalid = (reason) => { throw new TypeError(`INVALID_DESIGNERS:${reason}`); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function boundedText(value) {
  if (typeof value !== "string") invalid("designer-type");
  if (value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) invalid("designer-text");
  return value.trim() === "" || /^chartDesigner\d+$/iu.test(value) ? null : value;
}

/** Return a cloned catalog with exactly one nullable designer per chart. */
export function importDesigners(catalog, checkpoint) {
  validateCatalog(catalog);
  if (!isObject(checkpoint) || !isObject(checkpoint.records) || !isObject(checkpoint.records.SongData) || !isObject(checkpoint.records.SongData.fields) || !Array.isArray(checkpoint.records.SongData.fields.allSongInfo)) invalid("checkpoint-shape");
  const sourceRows = checkpoint.records.SongData.fields.allSongInfo;
  const designers = new Map();
  for (const song of sourceRows) {
    if (!isObject(song) || !Array.isArray(song.ChartInfos)) invalid("song-shape");
    for (const chart of song.ChartInfos) {
      if (!isObject(chart) || typeof chart.Id !== "string") invalid("chart-id");
      if (chart.Id === "") continue;
      if (designers.has(chart.Id)) invalid("duplicate-id");
      designers.set(chart.Id, boundedText(chart.DisplayChartDesigner));
    }
  }
  const output = structuredClone(catalog);
  const consumed = new Set();
  for (const song of output.songs) for (const chart of song.charts) {
    if (!designers.has(chart.chartId)) invalid("missing-id");
    chart.designer = designers.get(chart.chartId);
    consumed.add(chart.chartId);
  }
  if (consumed.size !== designers.size) invalid("unknown-id");
  validateCatalog(output);
  return output;
}

function parseArgs(args) {
  let parsed;
  try {
    parsed = parseNamedArgs({
      args,
      options: {
        checkpoint: { type: "string" },
        catalog: { type: "string" },
        output: { type: "string" },
        overwrite: { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch { invalid("arguments"); }
  const optionNames = new Set();
  for (const token of args) {
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).split("=", 1)[0];
    if (optionNames.has(name)) invalid("arguments");
    optionNames.add(name);
  }
  const values = parsed.values;
  if (!values.checkpoint || !values.catalog || !values.output) invalid("arguments");
  return { checkpoint: values.checkpoint, catalog: values.catalog, output: values.output, overwrite: values.overwrite ?? false };
}

async function readBounded(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) invalid("file-size");
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) invalid("file-size");
  return bytes;
}

async function run(args) {
  const options = parseArgs(args);
  let checkpointBytes, catalogBytes;
  try {
    [checkpointBytes, catalogBytes] = await Promise.all([readBounded(options.checkpoint), readBounded(options.catalog)]);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("INVALID_DESIGNERS:")) throw error;
    invalid("input-read");
  }
  if (createHash("sha256").update(checkpointBytes).digest("hex") !== CHECKPOINT_SHA256) invalid("checkpoint-pin");
  let checkpoint, catalog;
  try {
    checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
    catalog = JSON.parse(catalogBytes.toString("utf8"));
  } catch { invalid("json"); }
  const output = importDesigners(catalog, checkpoint);
  const outputBytes = `${JSON.stringify(output)}\n`;
  const destination = resolve(options.output);
  if (!options.overwrite) {
    try { await stat(destination); invalid("output-exists"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const temporary = resolve(dirname(destination), `.${destination.split(/[\\/]/u).pop()}.${process.pid}.${createHash("sha256").update(outputBytes).digest("hex").slice(0, 12)}.tmp`);
  let created = false;
  try {
    await writeFile(temporary, outputBytes, { flag: "wx" });
    created = true;
    if (options.overwrite) await rename(temporary, destination);
    else {
      // Reserve the destination without clobbering a concurrently-created file.
      const { link, unlink: remove } = await import("node:fs/promises");
      await link(temporary, destination);
      await remove(temporary);
    }
    created = false;
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { await run(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "INVALID_DESIGNERS:failure"); process.exitCode = 2; }
}
