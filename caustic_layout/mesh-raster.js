// Rasterize a triangle union at pixel centres. A single Canvas path containing
// hundreds of thousands of adjoining triangles can spend minutes in fill().
// Scanline spans have bounded memory and retain holes without simplifying faces.
export function triangleMask(positions, indices, width, height, spanX, spanY) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rows = new Uint32Array(pixels.buffer);
  const sx = width / spanY, sy = height / spanX;
  const count = indices ? indices.length : positions.length / 3;
  for (let i = 0; i < count; i += 3) {
    const a = (indices ? indices[i] : i) * 3;
    const b = (indices ? indices[i + 1] : i + 1) * 3;
    const c = (indices ? indices[i + 2] : i + 2) * 3;
    const ax = positions[a + 1] * sx + width / 2, ay = positions[a] * sy + height / 2;
    const bx = positions[b + 1] * sx + width / 2, by = positions[b] * sy + height / 2;
    const cx = positions[c + 1] * sx + width / 2, cy = positions[c] * sy + height / 2;
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 1e-12) continue;
    const first = Math.max(0, Math.ceil(Math.min(ay, by, cy) - .5));
    const last = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - .5));
    for (let row = first; row <= last; row++) {
      const y = row + .5;
      let lo = Infinity, hi = -Infinity;
      if (ay !== by && y >= Math.min(ay, by) && y <= Math.max(ay, by)) {
        const x = ax + (y - ay) * (bx - ax) / (by - ay);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      if (by !== cy && y >= Math.min(by, cy) && y <= Math.max(by, cy)) {
        const x = bx + (y - by) * (cx - bx) / (cy - by);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      if (cy !== ay && y >= Math.min(cy, ay) && y <= Math.max(cy, ay)) {
        const x = cx + (y - cy) * (ax - cx) / (ay - cy);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      const left = Math.max(0, Math.ceil(lo - .50000001));
      const right = Math.min(width - 1, Math.floor(hi - .49999999));
      if (left <= right) rows.fill(0xffffffff, row * width + left, row * width + right + 1);
    }
  }
  return pixels;
}
