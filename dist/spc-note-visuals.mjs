// Internal note-only Canvas renderer. Browser globals are used only by callers.
export const NOTE_ASSETS = Object.freeze({
  tapSpan: 'note-floor-span.png', tapFloor: 'note-floor-tap.png', tapLeft: 'note-side-left-tap.png', tapRight: 'note-side-right-tap.png',
  holdLeft: 'note-side-left-hold.png', holdRight: 'note-side-right-hold.png', flickLeft: 'note-flick-left.png',
  flickRight: 'note-flick-right.png', holdFloor: 'note-floor-hold.png', catchArch: 'note-catch-arch.png',
  catchDots: 'note-catch-dots.png'
});

const SPECS = {
  span: { asset: 'tapSpan', mesh: 546, projection: 'xy' },
  tap: { asset: 'tapFloor', mesh: 546, projection: 'xy' },
  long: { asset: 'holdFloor', mesh: 589, projection: 'xz', headMesh: 587, tailMesh: 588 },
  sideTapLeft: { asset: 'tapLeft', mesh: 546, projection: 'xy' },
  sideTapRight: { asset: 'tapRight', mesh: 546, projection: 'xy' },
  sideLongLeft: { asset: 'holdLeft', mesh: 589, projection: 'xz', headMesh: 587, tailMesh: 588 },
  sideLongRight: { asset: 'holdRight', mesh: 589, projection: 'xz', headMesh: 587, tailMesh: 588 },
  flickLeft: { asset: 'flickLeft', mesh: 584, projection: 'xy' },
  flickRight: { asset: 'flickRight', mesh: 584, projection: 'xy' }
};

export function mapNoteVisual(type, side = 'center', direction = 'left') {
  if (type === 'catch') return { asset: 'catchArch', overlay: 'catchDots', nativeColor: '#c3acff' };
  if (type === 'flick') return {
    asset: direction === 'right' ? 'flickRight' : 'flickLeft', mesh: 584, projection: 'xy',
    nativeColor: direction === 'right' ? '#24d957' : '#ffe500'
  };
  const key = type === 'span' && side === 'center' ? 'span' : type === 'long'
    ? (side === 'left' ? 'sideLongLeft' : side === 'right' ? 'sideLongRight' : 'long')
    : (side === 'left' ? 'sideTapLeft' : side === 'right' ? 'sideTapRight' : 'tap');
  return { ...SPECS[key], nativeColor: side === 'left' ? '#a474ff' : side === 'right' ? '#ff9bd8' : '#8ee7f2' };
}

export function loadNoteAssets({ baseUrl = './note-assets/', ImageClass = globalThis.Image, fetcher = globalThis.fetch } = {}) {
  const images = new Map(), meshes = {}, cache = new Map(), pending = new Set();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let disposed = false, rejectDisposal;
  const base = () => new URL(baseUrl, globalThis.location?.href || 'http://localhost/');
  const clear = () => {
    for (const image of pending) { image.onload = null; image.onerror = null; image.src = ''; }
    pending.clear();
    for (const image of images.values()) { image.onload = null; image.onerror = null; image.src = ''; }
    images.clear(); cache.clear();
    for (const key of Object.keys(meshes)) delete meshes[key];
  };
  const disposal = new Promise((_, reject) => { rejectDisposal = reject; });
  disposal.catch(() => {});
  const imagePromise = ImageClass
    ? Promise.all(Object.values(NOTE_ASSETS).map(name => new Promise((resolve, reject) => {
      if (disposed) { reject(Error('disposed')); return; }
      const image = new ImageClass();
      pending.add(image);
      image.onload = () => {
        if (disposed) { image.src = ''; reject(Error('disposed')); }
        else resolve([name, image]);
      };
      image.onerror = () => reject(Error(`note texture failed: ${name}`));
      image.src = new URL(name, base()).href;
    }))).then(rows => {
      if (disposed) { for (const [, image] of rows) image.src = ''; throw Error('disposed'); }
      for (const row of rows) images.set(...row);
      return images;
    })
    : Promise.reject(Error('Image unavailable'));
  const meshPromise = ImageClass && typeof fetcher === 'function'
    ? fetcher(new URL('meshes.json', base()).href, { credentials: 'same-origin', signal: controller?.signal }).then(response => {
      if (!response.ok) throw Error('note mesh metadata unavailable');
      return response.json();
    })
    : Promise.resolve({});
  const work = Promise.all([imagePromise, meshPromise]).then(([, data]) => {
    if (disposed) throw Error('disposed');
    Object.assign(meshes, data);
    for (const image of pending) { image.onload = null; image.onerror = null; }
    pending.clear();
    return images;
  });
  const ready = Promise.race([work, disposal]).catch(error => { clear(); throw error; });
  ready.catch(() => {});
  return {
    images, meshes, cache, ready,
    dispose() {
      if (disposed) return;
      disposed = true; rejectDisposal(Error('disposed')); controller?.abort(); clear();
    }
  };
}

function triangles(mesh) { return mesh?.triangles?.flat(1) || []; }

function affine(ctx, image, uv, points) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const source = uv.map(([u, v]) => [u * width, (1 - v) * height]);
  const [[u0, v0], [u1, v1], [u2, v2]] = source;
  const [[x0, y0], [x1, y1], [x2, y2]] = points;
  const det = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-7) return;
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / det;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / det;
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / det;
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / det;
  const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / det;
  const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / det;
  if (![a, b, c, d, e, f].every(Number.isFinite) || Math.abs(a * d - b * c) < 1e-10) return;
  ctx.save(); ctx.beginPath(); ctx.moveTo(...points[0]); ctx.lineTo(...points[1]); ctx.lineTo(...points[2]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, d, e, f); ctx.drawImage(image, 0, 0); ctx.restore();
}

function projectMesh(mesh, projection, rect) {
  const vertices = mesh.vertices || [], axis = projection === 'xz' ? 2 : 1;
  const xs = vertices.map(vertex => vertex[0]), ys = vertices.map(vertex => vertex[axis]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (!(maxX > minX && maxY > minY)) return [];
  return vertices.map(vertex => [
    rect.x + (vertex[0] - minX) / (maxX - minX) * rect.width,
    rect.y + (maxY - vertex[axis]) / (maxY - minY) * rect.height
  ]);
}

export function drawNote({ ctx, rect: r, type, side = 'center', direction = 'left', capVisible = true, clip,
  assets, meshes, continuation = false, showHead = capVisible, showTail = true, cache, polygon, flickTrailLength } = {}) {
  const visual = mapNoteVisual(type, side, direction);
  const bounds = {
    left: clip?.left ?? r.x, right: (clip?.left ?? r.x) + (clip?.width ?? r.width),
    top: clip?.top ?? r.y, bottom: (clip?.top ?? r.y) + (clip?.height ?? r.height)
  };
  const top = Math.max(r.y, bounds.top), bottom = Math.min(r.y + r.height, bounds.bottom);
  if (!ctx || !r || bottom <= top || r.width <= 0) return { drawn: false, visual, parts: [] };
  ctx.save(); ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); ctx.clip();
  const parts = [];
  if (type === 'catch') {
    const shape = Array.isArray(polygon) && polygon.length >= 3
      && polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
      ? polygon
      : [[r.x + r.width * .16, r.y], [r.x + r.width * .84, r.y], [r.x + r.width, r.y + r.height * .5],
        [r.x + r.width * .84, r.y + r.height], [r.x + r.width * .16, r.y + r.height], [r.x, r.y + r.height * .5]];
    ctx.beginPath(); ctx.moveTo(...shape[0]);
    for (const point of shape.slice(1)) ctx.lineTo(...point);
    ctx.closePath(); ctx.fillStyle = 'rgba(164,116,255,.32)'; ctx.fill(); ctx.strokeStyle = '#c3acff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    return { drawn: true, visual, parts: ['catch'] };
  }

  const image = assets?.get(NOTE_ASSETS[visual.asset]);
  const hasImage = image && (image.naturalWidth || image.width) && (image.naturalHeight || image.height);
  const paintMesh = (id, box, label) => {
    const part = meshes?.[id], partUvs = part?.uv || [], partTriangles = triangles(part);
    const points = part && projectMesh(part, visual.projection, box);
    if (!hasImage || !part || !partTriangles.length) return false;
    let painted = false;
    for (const triangle of partTriangles) {
      if (triangle.length !== 3 || triangle.some(index => !points[index] || !partUvs[index] || partUvs[index].length < 2)) continue;
      affine(ctx, image, triangle.map(index => partUvs[index]), triangle.map(index => points[index])); painted = true;
    }
    if (painted) parts.push(label);
    return painted;
  };

  if (type === 'flick') {
    const right = direction === 'right', sign = right ? 1 : -1;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const headBox = { x: cx - r.width * .28, y: cy - r.height * .38, width: r.width * .56, height: r.height * .76 };
    const tailLength = Number.isFinite(flickTrailLength) && flickTrailLength >= 0 ? flickTrailLength : r.width * .48;
    const tailWidth = r.height * .18, attachment = Math.min(tailLength, r.width * .25);
    ctx.fillStyle = visual.nativeColor;
    ctx.beginPath();
    if (tailLength > 0) {
      ctx.moveTo(cx - sign * tailLength, cy - tailWidth * .2);
      ctx.lineTo(cx - sign * attachment, cy - tailWidth / 2);
      ctx.lineTo(cx - sign * attachment, cy + tailWidth / 2);
      ctx.lineTo(cx - sign * tailLength, cy + tailWidth * .2);
      ctx.closePath(); ctx.fill(); parts.push('trail');
    }
    if (!paintMesh(visual.mesh, headBox, 'head')) {
      ctx.beginPath();
      ctx.moveTo(cx - sign * r.width * .14, cy - r.height * .38);
      ctx.lineTo(cx + sign * r.width * .28, cy);
      ctx.lineTo(cx - sign * r.width * .14, cy + r.height * .38);
      ctx.closePath(); ctx.fill(); parts.push('head');
    }
    ctx.restore();
    return { drawn: true, visual, parts };
  }

  if (!hasImage) {
    ctx.fillStyle = visual.nativeColor; ctx.fillRect(r.x, top, r.width, Math.max(3, bottom - top)); ctx.restore();
    return { drawn: true, fallback: true, visual, parts: ['fallback'] };
  }

  if (type === 'long') {
    const capH = Math.min(8, Math.max(0, r.height / 3)), head = showHead && r.height > 0, tail = showTail && r.height > 0;
    const tailH = Math.min(6, Math.max(0, r.height / 3));
    const bodyTop = r.y + (tail ? tailH : 0), bodyBottom = r.y + r.height - (head ? capH : 0);
    if (bodyBottom > bodyTop) paintMesh(visual.mesh, { ...r, y: bodyTop, height: bodyBottom - bodyTop }, 'body');
    if (head) paintMesh(visual.headMesh, { ...r, y: r.y + r.height - capH, height: capH }, 'head');
    if (tail) paintMesh(visual.tailMesh, { ...r, y: r.y, height: tailH }, 'tail');
  } else if (!paintMesh(visual.mesh, r, 'body')) {
    ctx.fillStyle = visual.nativeColor; ctx.fillRect(r.x, top, r.width, Math.max(3, bottom - top)); parts.push('fallback');
  }
  ctx.restore();
  return { drawn: true, visual, parts };
}

export function drawNoteSegment(args) { return drawNote(args); }
