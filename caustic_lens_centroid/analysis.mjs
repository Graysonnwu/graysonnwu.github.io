// Pixel centres use edge-based coordinates: a uniform W × H image centres at W/2, H/2.
const linear = value => {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function analysePixels(rgba, width, height, mode = 'encoded') {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error('图片尺寸或像素数据无效');
  }
  const values = new Float64Array(width * height);
  let mass = 0, momentX = 0, momentY = 0;
  for (let i = 0; i < values.length; i++) {
    const p = i * 4;
    const alpha = rgba[p + 3] / 255;
    const value = alpha * (mode === 'linear'
      ? 255 * (0.2126 * linear(rgba[p]) + 0.7152 * linear(rgba[p + 1]) + 0.0722 * linear(rgba[p + 2]))
      : 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    values[i] = value;
    mass += value;
    momentX += (i % width + 0.5) * value;
    momentY += (Math.floor(i / width) + 0.5) * value;
  }
  if (!(mass > 0)) throw new Error('图片没有可见亮度，请导入非全黑、非全透明的图片');
  return { values, mass, x: momentX / mass, y: momentY / mass };
}

export function splitMass(values, width, p1, p2) {
  let dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (Math.hypot(dx, dy) < 1e-8) dy = -1;
  let a = 0, b = 0;
  const tolerance = Math.hypot(dx, dy) * 1e-8;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const cross = (i % width + 0.5 - p1.x) * dy - (Math.floor(i / width) + 0.5 - p1.y) * dx;
    if (Math.abs(cross) <= tolerance) { a += value / 2; b += value / 2; }
    else if (cross < 0) a += value;
    else b += value;
  }
  return { a, b, dx, dy };
}

export function analysisSize(width, height, maxDimension = 900) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
