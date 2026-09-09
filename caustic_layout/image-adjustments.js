export const defaultAdjustments = () => ({mode: "color", threshold: 128, curve: [[0, 0], [1, 1]]});

export function validAdjustments(a) {
  return a && ["color", "gray", "binary"].includes(a.mode) &&
    Number.isFinite(a.threshold) && a.threshold >= 0 && a.threshold <= 255 &&
    Array.isArray(a.curve) && a.curve.length >= 2 && a.curve.length <= 16 &&
    a.curve.every((p, i) => Array.isArray(p) && p.length === 2 &&
      p.every(v => Number.isFinite(v) && v >= 0 && v <= 1) &&
      (!i || p[0] > a.curve[i-1][0])) &&
    a.curve[0][0] === 0 && a.curve.at(-1)[0] === 1;
}

export function curveTable(points) {
  const n = points.length, slopes = [], tangent = [];
  for (let i = 0; i < n-1; i++)
    slopes.push((points[i+1][1]-points[i][1])/(points[i+1][0]-points[i][0]));
  tangent[0] = slopes[0]; tangent[n-1] = slopes[n-2];
  for (let i = 1; i < n-1; i++) {
    const a = slopes[i-1], b = slopes[i];
    tangent[i] = a*b <= 0 ? 0 : 2*a*b/(a+b);
  }
  const table = new Uint8ClampedArray(256);
  for (let i = 0, j = 0; i < 256; i++) {
    const x = i/255;
    while (j < n-2 && x > points[j+1][0]) j++;
    const [x0,y0] = points[j], [x1,y1] = points[j+1], h = x1-x0, t = (x-x0)/h;
    table[i] = 255*((2*t**3-3*t*t+1)*y0 + (t**3-2*t*t+t)*h*tangent[j] +
      (-2*t**3+3*t*t)*y1 + (t**3-t*t)*h*tangent[j+1]);
  }
  return table;
}

// Apply in place before the existing geometric warp. Alpha is preserved.
export function adjustPixels(pixels, settings) {
  if (!settings) return pixels;
  const {mode, threshold, curve} = settings, lut = curveTable(curve);
  if (mode === "color" && lut.every((v,i) => v === i)) return pixels;
  for (let i = 0; i < pixels.length; i += 4) {
    if (mode === "color") {
      for (let c = 0; c < 3; c++) pixels[i+c] = lut[pixels[i+c]];
    } else {
      let gray = lut[Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2])];
      if (mode === "binary") gray = gray >= threshold ? 255 : 0;
      pixels[i] = pixels[i+1] = pixels[i+2] = gray;
    }
  }
  return pixels;
}

export function grayscaleHistogram(pixels) {
  const bins = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round((.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2])*pixels[i+3]/255);
    bins[gray]++;
  }
  return bins;
}
