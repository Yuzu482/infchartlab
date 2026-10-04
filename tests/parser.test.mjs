import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SIZE, Invalid, canonicalJSON, parseSave } from "../dist/parser.mjs";

const LIMIT = 101000000n;
const U64_MAX = (1n << 64n) - 1n;

function record({ songId = 1, difficulty = 1, score = 0n, timestamp = 0n,
  lamp = 1, clear = 4, judgments = null, ignored = 0 } = {}) {
  const b = Buffer.alloc(96);
  b.writeUInt16LE(songId, 0);
  b[2] = difficulty; b[3] = lamp; b[4] = clear;
  b[5] = 0xa5; b.writeUInt16LE(123, 6); b.writeInt16LE(-7, 8);
  for (let g = 0; g < 4; g++) {
    for (let j = 0; j < 7; j++) b.writeUInt16LE(judgments?.[g]?.[j] ?? j + 1, 10 + g * 16 + j * 2);
    b.writeUInt16LE(ignored, 24 + g * 16);
  }
  b.fill(ignored, 74, 80);
  b.writeBigUInt64LE(BigInt(score), 80);
  b.writeBigUInt64LE(BigInt(timestamp), 88);
  return b;
}

function entry(name, songId, difficulty, value = record({ songId, difficulty })) {
  const bytes = Buffer.from(name, "utf8");
  const key = Buffer.alloc(9 + bytes.length + 3);
  key[0] = 3;
  key.writeInt32LE(~bytes.length, 1);
  key.writeInt32LE(name.length, 5);
  bytes.copy(key, 9);
  key.writeUInt16LE(songId, 9 + bytes.length);
  key[11 + bytes.length] = difficulty;
  return Buffer.concat([key, value]);
}

function fixture({ entries = [entry("alpha", 1, 1)], history = [], capacity = Math.max(1, history.length), prefix = Buffer.from("noise") } = {}) {
  const best = Buffer.concat(entries);
  const header = Buffer.alloc(5);
  header[0] = 4; header.writeInt32LE(entries.length, 1);
  const histHeader = Buffer.alloc(5);
  histHeader[0] = 2; histHeader.writeInt32LE(capacity, 1);
  const slots = Buffer.concat([...history, Buffer.alloc((capacity - history.length) * 96)]);
  const count = Buffer.alloc(4); count.writeInt32LE(history.length);
  return Buffer.concat([Buffer.from([9]), prefix, header, best, histHeader, slots, count, Buffer.from("trailing")]);
}

async function errorCode(bytes, code) {
  await assert.rejects(parseSave(bytes), error => error instanceof Invalid && error.code === code);
}

test("observed profile, counts, comparisons, basename ambiguity, and judgments", async () => {
  const bytes = fixture({
    entries: [
      entry("same", 1, 1, record({ songId: 1, difficulty: 1, score: 98_000_000n })),
      entry("same", 1, 2, record({ songId: 1, difficulty: 2, score: 90n })),
      entry("other", 2, 4, record({ songId: 2, difficulty: 4, judgments: [[8, 0, 0, 0, 0, 0, 0]] }))
    ],
    history: [
      record({ songId: 1, difficulty: 1, score: 0n }),
      record({ songId: 1, difficulty: 1, score: 98_000_000n }),
      record({ songId: 7, difficulty: 8, score: 5n })
    ], capacity: 5
  });
  const out = await parseSave(bytes, true);
  assert.equal(out.status, "ok");
  assert.equal(out.wholeSaveValidated, false);
  assert.equal(out.bestCount, 3); assert.equal(out.historyCount, 3);
  assert.equal(out.historyCapacity, 5); assert.equal(out.zeroUnusedSlots, 2);
  assert.equal(out.distinctSongs, 3);
  assert.deepEqual(out.bestCountsByDifficulty, { MIN: 1, EVO: 1, ULT: 1, FBD: 0 });
  assert.equal(out.bestHistoryComparisons[0].historyMaxScore, 98_000_000n);
  assert.equal(out.bestHistoryComparisons[0].matches, true);
  assert.equal(out.bestHistoryComparisons[1].historyMaxScore, null);
  assert.equal(out.bestHistoryComparisons[1].matches, null);
  assert.equal(out.bestRecords[2].judgments.tap.none, 8);
  assert.equal(out.bestRecords[2].judgments.tap.miss, 0);
  assert.equal(out.historyRecords[2].basename, null);
  assert.equal(out.historyRecords[0].basename, "same");
  assert.equal(out.limitations.length, 5);
});

test("ambiguous basenames stay unmapped and judgment groups remain isolated", async () => {
  const ambiguous = await parseSave(fixture({
    entries: [entry("first", 1, 1), entry("second", 1, 1)],
    history: [record({ songId: 1, difficulty: 1 })]
  }), true);
  assert.equal(ambiguous.historyRecords[0].basename, null);

  const judgments = [[1, 2, 3, 4, 5, 6, 7], [11, 12, 13, 14, 15, 16, 17],
    [21, 22, 23, 24, 25, 26, 27], [31, 32, 33, 34, 35, 36, 37]];
  const grouped = await parseSave(fixture({ entries: [entry("groups", 1, 1, record({ judgments }))] }), true);
  for (const [g, base] of [["tap", 1], ["hold", 11], ["skyArea", 21], ["flick", 31]]) {
    assert.deepEqual(grouped.bestJudgmentTotals[g], { none: base, miss: base + 1, nearEarly: base + 2, nearLate: base + 3, perfectEarly: base + 4, perfectLate: base + 5, shiny: base + 6 });
  }
});

test("history zero maximum is distinct from absent history", async () => {
  const out = await parseSave(fixture({
    entries: [entry("zero", 1, 1)], history: [record({ songId: 1, difficulty: 1, score: 0n })]
  }));
  assert.equal(out.bestHistoryComparisons[0].historyMaxScore, 0n);
  assert.equal(out.bestHistoryComparisons[0].matches, true);
});

test("u64 scores and timestamps retain precision", async () => {
  for (const timestamp of [0n, (1n << 53n) + 1n, U64_MAX]) {
    const out = await parseSave(fixture({ entries: [entry("u64", 1, 1, record({ score: LIMIT, timestamp }))] }), true);
    assert.equal(out.bestRecords[0].secondsSinceEpochUtc, timestamp);
    assert.equal(out.bestRecords[0].playerScore, LIMIT);
  }
});

test("canonical JSON sorts keys and escapes non-ASCII as lowercase UTF-16 escapes", () => {
  assert.equal(canonicalJSON({ z: "\uFEFF😀\u0085\u2028\"", a: 1n }),
    '{"a":1,"z":"\\ufeff\\ud83d\\ude00\\u0085\\u2028\\\""}');
  assert.equal(canonicalJSON("\u007f"), '"\\u007f"');
});

test("valid UTF-8 names preserve BOM, non-BMP and C1; UTF-16 length is checked", async () => {
  for (const name of ["\uFEFFx", "😀", "\u0085", "line\u2028quote\""]) {
    const out = await parseSave(fixture({ entries: [entry(name, 1, 1)] }), true);
    assert.equal(out.bestRecords[0].basename, name);
  }
  const badUnits = entry("😀", 1, 1); badUnits.writeInt32LE(1, 5);
  await errorCode(fixture({ entries: [badUnits] }), "unsupported_or_invalid");
});

test("malformed records, duplicate keys, flags, score bound, and strict UTF-8 fail closed", async () => {
  const cases = [];
  const duplicate = entry("x", 1, 1); cases.push(fixture({ entries: [duplicate, duplicate] }));
  for (const [offset, value] of [[2, 3], [3, 3], [4, 5]]) {
    const r = record(); r[offset] = value; cases.push(fixture({ entries: [entry("x", 1, 1, r)] }));
  }
  cases.push(fixture({ entries: [entry("x", 1, 1, record({ score: LIMIT + 1n }))] }));
  const invalidUtf8 = entry("x", 1, 1); invalidUtf8[9] = 0xff; cases.push(fixture({ entries: [invalidUtf8] }));
  for (const bytes of cases) await errorCode(bytes, "unsupported_or_invalid");
});

test("record padding and ignored bytes do not affect parsed values", async () => {
  const a = record({ score: 42n });
  const b = Buffer.from(a); b.fill(0xff, 5, 6); b.fill(0xaa, 24, 26); b.fill(0xbb, 74, 80);
  const x = await parseSave(fixture({ entries: [entry("x", 1, 1, a)] }), true);
  const y = await parseSave(fixture({ entries: [entry("x", 1, 1, b)] }), true);
  assert.equal(x.bestRecords[0].playerScore, y.bestRecords[0].playerScore);
  assert.deepEqual(x.bestRecords[0].judgments, y.bestRecords[0].judgments);
});

test("shifted sections parse; root, empty, oversize and truncated inputs have distinct outcomes", async () => {
  const out = await parseSave(fixture({ prefix: Buffer.alloc(37, 0x55) }));
  assert.equal(out.sectionOffset, 38);
  await errorCode(Buffer.alloc(0), "empty");
  await errorCode(Buffer.from([8]), "unsupported");
  await errorCode(Buffer.alloc(MAX_SIZE + 1, 9), "oversized");
  await errorCode(Buffer.from([9, 1, 2, 3, 4, 4, 1, 0, 0, 0, 3]), "truncated");
});

test("candidate ambiguity and top-level invalid candidate are reported", async () => {
  const one = fixture();
  const two = Buffer.concat([one, one.subarray(1)]);
  await errorCode(two, "ambiguous");
  await errorCode(fixture({ entries: [] }), "unsupported_or_invalid");
});

test("count, name-byte, capacity, and score limits accept boundaries and reject overflow", async t => {
  const cases = [
    ["count lower", () => fixture({ entries: [entry("x", 1, 1)] }), true],
    ["count upper", () => fixture({ entries: Array.from({ length: 2048 }, (_, i) => entry(`n${i}`, i % 65536, 1)) }), true],
    ["count zero", () => fixture({ entries: [] }), false],
    ["count overflow", () => { const b = fixture(); b.writeInt32LE(2049, b.indexOf(4) + 1); return b; }, false],
    ["name byte boundary", () => fixture({ entries: [entry("a".repeat(512), 1, 1)] }), true],
    ["name byte overflow", () => fixture({ entries: [entry("a".repeat(513), 1, 1)] }), false],
    ["capacity lower", () => fixture({ capacity: 1 }), true],
    ["capacity upper", () => fixture({ capacity: 65536 }), true],
    ["capacity zero", () => fixture({ capacity: 0 }), false],
    ["capacity overflow", () => fixture({ capacity: 65537 }), false],
    ["score boundary", () => fixture({ entries: [entry("x", 1, 1, record({ score: LIMIT }))] }), true],
    ["score overflow", () => fixture({ entries: [entry("x", 1, 1, record({ score: LIMIT + 1n }))] }), false]
  ];
  for (const [name, make, valid] of cases) await t.test(name, async () => {
    if (valid) assert.equal((await parseSave(make())).status, "ok");
    else await errorCode(make(), "unsupported_or_invalid");
  });
});

test("anchor limit is enforced after in-range anchor counts", async () => {
  const noise = Buffer.alloc(513 * 6);
  for (let i = 0; i < 513; i++) {
    const o = i * 6; noise[o] = 4; noise.writeInt32LE(1, o + 1); noise[o + 5] = 3;
  }
  await errorCode(Buffer.concat([Buffer.from([9]), noise]), "candidate_limit");
});
