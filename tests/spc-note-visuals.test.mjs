import test from 'node:test';
import assert from 'node:assert/strict';
import { mapNoteVisual, drawNote, loadNoteAssets, NOTE_ASSETS } from '../dist/spc-note-visuals.mjs';

function context() {
  const calls = [];
  return {
    calls, save() {}, restore() {}, beginPath() {}, rect(...args) { calls.push(['clip', ...args]); },
    moveTo(...args) { calls.push(['move', ...args]); }, lineTo(...args) { calls.push(['line', ...args]); },
    closePath() {}, clip() {}, transform(...args) { calls.push(['transform', ...args]); },
    drawImage(...args) { calls.push(['image', ...args]); }, fillRect(...args) { calls.push(['fillRect', ...args]); },
    strokeRect() { calls.push(['strokeRect']); }, stroke() { calls.push(['stroke']); }, fill() { calls.push(['fill']); }
  };
}

const mesh = { vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], uv: [[0, 0], [1, 0], [.5, 1]], triangles: [[[0, 1, 2]]] };

test('native visual mapping keeps lane textures and explicitly directed Flick colors', () => {
  assert.equal(mapNoteVisual('tap', 'left').asset, 'tapLeft');
  assert.equal(mapNoteVisual('tap', 'right').asset, 'tapRight');
  assert.equal(mapNoteVisual('long', 'left').asset, 'holdLeft');
  assert.equal(mapNoteVisual('long', 'right').asset, 'holdRight');
  assert.equal(mapNoteVisual('flick', 'left', 'right').asset, 'flickRight');
  assert.equal(mapNoteVisual('flick', 'left', 'right').nativeColor, '#24d957');
  assert.equal(mapNoteVisual('flick', 'left', 'left').nativeColor, '#ffe500');
  assert.deepEqual([mapNoteVisual('catch').asset, mapNoteVisual('catch').overlay], ['catchArch', 'catchDots']);
});

test('Catch uses a clipped beveled polygon and Flick has directional head and tapered trail with or without assets', () => {
  for (const direction of ['left', 'right']) {
    const ctx = context(), clip = { left: 10, top: 10, width: 40, height: 40 };
    const result = drawNote({ ctx, rect: { x: 15, y: 15, width: 30, height: 24 }, type: 'catch', clip });
    assert.deepEqual(result.parts, ['catch']);
    assert.equal(ctx.calls.filter(call => call[0] === 'fill').length, 1);
    assert.equal(ctx.calls.some(call => call[0] === 'fillRect' || call[0] === 'strokeRect'), false);
    const flick = context();
    const paint = drawNote({ ctx: flick, rect: { x: 15, y: 15, width: 30, height: 24 }, type: 'flick', direction, clip });
    assert.deepEqual(paint.parts, ['trail', 'head']);
    const polygons = flick.calls.filter(call => call[0] === 'move' || call[0] === 'line').map(call => call.slice(1));
    const center = 30, back = polygons[0][0], nearHead = polygons[1][0], headTip = polygons[5][0];
    assert.equal(Math.sign(back - center), direction === 'right' ? -1 : 1);
    assert.equal(Math.sign(nearHead - center), direction === 'right' ? -1 : 1);
    assert.ok(Math.abs(back - center) > Math.abs(nearHead - center));
    assert.equal(Math.sign(headTip - center), direction === 'right' ? 1 : -1);
    assert.equal(paint.fallback, undefined);
  }
});

test('Flick trail spans decoded width across viewport scales and safely handles zero, short and invalid spans', () => {
  for (const direction of ['left', 'right']) {
    const sign = direction === 'right' ? 1 : -1;
    for (const viewport of [300, 600]) for (const width of [1 / 3, 1]) for (const headWidth of [20, 40]) {
      const center = (.5 + sign * width / 2) * viewport;
      const ctx = context(), clip = { left: 7, top: 8, width: viewport, height: 90 };
      drawNote({ ctx, rect: { x: center - headWidth / 2, y: 0, width: headWidth, height: 20 }, type: 'flick', direction, clip, flickTrailLength: width * viewport });
      const points = ctx.calls.filter(call => call[0] === 'move' || call[0] === 'line').slice(0, 4);
      assert.ok(Math.abs(points[0][1] - (.5 - sign * width / 2) * viewport) < 1e-9);
      assert.equal(points[1][1], center - sign * Math.min(width * viewport, headWidth * .25));
      assert.ok((points[1][1] - points[0][1]) * sign >= 0);
      assert.ok(ctx.calls.some(call => call[0] === 'clip' && call[1] === clip.left && call[2] === clip.top && call[3] === clip.width && call[4] === clip.height));
    }
    const zero = context();
    assert.deepEqual(drawNote({ ctx: zero, rect: { x: 90, y: 0, width: 20, height: 20 }, type: 'flick', direction, flickTrailLength: 0 }).parts, ['head']);
    const short = context();
    drawNote({ ctx: short, rect: { x: 90, y: 0, width: 20, height: 20 }, type: 'flick', direction, flickTrailLength: 2 });
    const shortPoints = short.calls.filter(call => call[0] === 'move' || call[0] === 'line').slice(0, 4);
    assert.equal(shortPoints[0][1], 100 - sign * 2);
    assert.equal(shortPoints[1][1], shortPoints[0][1]);
    assert.ok((shortPoints[1][1] - shortPoints[0][1]) * sign >= 0);
    for (const invalid of [undefined, -1, NaN, Infinity]) {
      const fallback = context();
      drawNote({ ctx: fallback, rect: { x: 0, y: 0, width: 100, height: 20 }, type: 'flick', direction, flickTrailLength: invalid });
      assert.equal(fallback.calls.filter(call => call[0] === 'move')[0][1], direction === 'right' ? 2 : 98);
      assert.ok(fallback.calls.filter(call => call[0] === 'move' || call[0] === 'line').flatMap(call => call.slice(1)).every(Number.isFinite));
    }
  }
});

test('Flick paints native mesh 584 inside the head box and retains a visible fallback without mesh', () => {
  const ctx = context(), image = { naturalWidth: 100, naturalHeight: 100 };
  const result = drawNote({ ctx, rect: { x: 10, y: 20, width: 100, height: 40 }, type: 'flick', direction: 'right',
    assets: new Map([[NOTE_ASSETS.flickRight, image]]), meshes: { 584: mesh } });
  assert.deepEqual(result.parts, ['trail', 'head']);
  assert.equal(ctx.calls.filter(call => call[0] === 'image').length, 1);
  assert.ok(ctx.calls.some(call => call[0] === 'transform'));
  const fallback = context();
  const fallbackResult = drawNote({ ctx: fallback, rect: { x: 10, y: 20, width: 100, height: 40 }, type: 'flick', direction: 'left',
    assets: new Map([[NOTE_ASSETS.flickLeft, image]]), meshes: {} });
  assert.deepEqual(fallbackResult.parts, ['trail', 'head']);
  assert.ok(fallback.calls.some(call => call[0] === 'fill'));
});

test('Catch honors a valid supplied quad and defaults to finite beveled geometry', () => {
  const supplied = [[1, 2], [8, 2], [7, 9], [2, 9]], providedCtx = context();
  drawNote({ ctx: providedCtx, rect: { x: 0, y: 0, width: 10, height: 10 }, type: 'catch', polygon: supplied });
  assert.deepEqual(providedCtx.calls.filter(call => call[0] === 'move' || call[0] === 'line').map(call => call.slice(1)), supplied);
  const defaultCtx = context();
  drawNote({ ctx: defaultCtx, rect: { x: 0, y: 0, width: 10, height: 10 }, type: 'catch' });
  assert.ok(defaultCtx.calls.filter(call => call[0] === 'move' || call[0] === 'line').every(call => call.slice(1).every(Number.isFinite)));
  assert.equal(defaultCtx.calls.some(call => call[0] === 'fillRect' || call[0] === 'strokeRect'), false);
});

test('native UV affine maps source pixel corners to the three destination mesh vertices', () => {
  const ctx = context(), image = { naturalWidth: 2048, naturalHeight: 2048 };
  const assets = new Map([[NOTE_ASSETS.tapFloor, image]]);
  const smallMesh = { ...mesh, vertices: [[-.1925, -.18, 0], [.1925, -.18, 0], [0, 0, 0]] };
  drawNote({ ctx, rect: { x: 10, y: 20, width: 100, height: 40 }, type: 'tap', assets, meshes: { 546: smallMesh } });
  const transform = ctx.calls.find(call => call[0] === 'transform').slice(1);
  const apply = (x, y) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
  const sourceCorners = [[0, 2048], [2048, 2048], [1024, 0]], expected = [[10, 60], [110, 60], [60, 20]];
  for (let index = 0; index < sourceCorners.length; index++) {
    const actual = apply(...sourceCorners[index]);
    assert.ok(Math.abs(actual[0] - expected[index][0]) < 1e-9 && Math.abs(actual[1] - expected[index][1]) < 1e-9, `corner ${index}: ${actual}`);
  }
  const destinations = ctx.calls.filter(call => call[0] === 'move' || call[0] === 'line').slice(0, 3).map(call => call.slice(1));
  for (let index = 0; index < destinations.length; index++) {
    assert.ok(Math.abs(destinations[index][0] - expected[index][0]) < 1e-9 && Math.abs(destinations[index][1] - expected[index][1]) < 1e-9, `vertex ${index}: ${destinations[index]}`);
  }
  assert.equal(ctx.calls.filter(call => call[0] === 'image').length, 1);
});

test('long renderer reports genuine endpoint caps only when endpoints are present and clips continuation bodies', () => {
  const ctx = context(), assets = new Map([[NOTE_ASSETS.holdFloor, { naturalWidth: 512, naturalHeight: 2048 }]]);
  const holdMesh = { ...mesh, vertices: [[-1, 0, -1], [1, 0, -1], [0, 0, 1]] };
  const args = { ctx, rect: { x: 10, y: 5, width: 30, height: 90 }, type: 'long', assets,
    meshes: { 587: holdMesh, 588: holdMesh, 589: holdMesh }, clip: { left: 0, top: 20, width: 100, height: 60 } };
  assert.deepEqual(drawNote(args).parts, ['body', 'head', 'tail']);
  assert.ok(ctx.calls.some(call => call[0] === 'clip' && call[1] === 0 && call[2] === 20));
  assert.deepEqual(drawNote({ ...args, continuation: true, showHead: false, showTail: false }).parts, ['body']);
  assert.deepEqual(drawNote({ ...args, continuation: true, showHead: false, showTail: true }).parts, ['body', 'tail']);
  const before = ctx.calls.length;
  assert.equal(drawNote({ ...args, rect: { x: 0, y: 0, width: 10, height: 2 }, clip: { left: 0, top: 9, width: 10, height: 2 } }).drawn, false);
  assert.equal(ctx.calls.length, before);
});

test('asset loader rejects failures and disposal drains pending images and cache', async () => {
  class Broken { set src(value) { if (value) this.onerror?.(); } }
  const failed = loadNoteAssets({ ImageClass: Broken, fetcher: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(failed.ready, /texture failed/);
  failed.dispose();
  assert.equal(failed.images.size, 0);
  const pending = [];
  class Delayed { constructor() { pending.push(this); } set src(value) { if (value) this.fire = () => this.onload?.(); } }
  const late = loadNoteAssets({ ImageClass: Delayed, fetcher: async () => ({ ok: true, json: async () => ({}) }) });
  late.cache.set('x', {}); late.dispose();
  for (const image of pending) image.fire?.();
  await assert.rejects(late.ready);
  assert.equal(late.images.size, 0);
  assert.equal(late.cache.size, 0);
  assert.ok(pending.every(image => image.onload === null && image.onerror === null));
});
