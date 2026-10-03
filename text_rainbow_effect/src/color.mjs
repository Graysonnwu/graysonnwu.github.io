export function hsvColor(hue, saturation, value) {
  if (![hue, saturation, value].every(Number.isFinite)) throw new Error('颜色参数必须是有限数值');
  const s = Math.min(1, Math.max(0, saturation)), v = Math.min(1, Math.max(0, value));
  const lightness = v * (1 - s / 2);
  const hslSaturation = lightness === 0 || lightness === 1 ? 0 : (v - lightness) / Math.min(lightness, 1 - lightness);
  return `hsl(${((hue % 360) + 360) % 360}, ${hslSaturation * 100}%, ${lightness * 100}%)`;
}

export function fitScale(width, height, availableWidth, availableHeight) {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(1, Math.max(1, availableWidth - 32) / width, Math.max(1, availableHeight - 32) / height);
}

export function interpolateHue(left, right, fraction) {
  // Convex interpolation avoids overflowing right-left for large opposite endpoints.
  const hue = left * (1 - fraction) + right * fraction;
  return Number.isFinite(hue) ? hue : (left % 360) * (1 - fraction) + (right % 360) * fraction;
}
