export function fitCrop(width, height, ratio) {
  const w = Math.min(width, height * ratio);
  const h = w / ratio;
  return { x: Math.max(0, (width - w) / 2), y: Math.max(0, (height - h) / 2), w, h };
}

export function resizeCrop(start, dx, dy, width, height, ratio, minimum = 60) {
  // Project pointer movement onto the fixed aspect-ratio diagonal.
  const movement = (dx + dy / ratio) / (1 + 1 / (ratio * ratio));
  const maxWidth = Math.max(0, Math.min(width - start.x, (height - start.y) * ratio));
  const w = Math.max(Math.min(minimum, maxWidth), Math.min(maxWidth, start.w + movement));
  return { ...start, w, h: w / ratio };
}

export function moveCrop(start, dx, dy, width, height) {
  return { ...start, x: Math.max(0, Math.min(width - start.w, start.x + dx)),
    y: Math.max(0, Math.min(height - start.h, start.y + dy)) };
}

export function scaleCrop(start, oldWidth, oldHeight, width, height, ratio) {
  if (!oldWidth || !oldHeight || !width || !height) return fitCrop(width, height, ratio);
  const w = Math.min(start.w * width / oldWidth, width, height * ratio);
  const h = w / ratio;
  return { w, h, x: Math.max(0, Math.min(width - w, start.x * width / oldWidth)),
    y: Math.max(0, Math.min(height - h, start.y * height / oldHeight)) };
}
