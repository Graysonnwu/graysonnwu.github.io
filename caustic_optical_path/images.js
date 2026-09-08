import { guangGlyph } from "./demo-glyph.js";
import {
  imageEnergyMoments,
  imageEnergySamples,
  apertureEnergySamples,
} from "./relief-estimate.js";
import { homography, sourceRasterMap } from "./optics.js";
import { apertureLayout, referenceContours } from "./layout-geometry.js";

export function canvas(width = 512, height = width) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export function demoTarget() {
  const c = canvas(800),
    x = c.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, 800, 800);
  x.fillStyle = "#fff";
  const [x0, y0, x1, y1] = guangGlyph.bounds,
    scale = 620 / Math.max(x1 - x0, y1 - y0);
  x.translate(400, 400);
  x.scale(scale, -scale);
  x.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  x.fill(new Path2D(guangGlyph.path));
  return c;
}
export async function decodeImage(input) {
  const blob =
    typeof input === "string" ? await (await fetch(input)).blob() : input;
  if (blob.size > 40 * 1024 * 1024) throw new Error("图片文件请小于 40 MB");
  let image, url;
  try {
    image = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // Safari can decode some photo-library formats through <img> even when
    // createImageBitmap rejects them. The browser applies EXIF orientation.
    url = URL.createObjectURL(blob);
    image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("这张图片无法读取，请从相册另存为 JPEG 或 PNG 后再选取");
    }
  }
  const release = () => {
    image.close?.();
    if (url) URL.revokeObjectURL(url);
  };
  if (image.width * image.height > 40e6) {
    release();
    throw new Error("图片像素过大，请缩小到 4000 × 4000 左右");
  }
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height)),
    c = canvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
  const x = c.getContext("2d");
  x.fillStyle = "black";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(image, 0, 0, c.width, c.height);
  release();
  return c;
}
export function cropMask(input) {
  const x = input.getContext("2d", { willReadFrequently: true }),
    { data } = x.getImageData(0, 0, input.width, input.height);
  let x0 = input.width,
    y0 = input.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < input.height; y++)
    for (let x = 0; x < input.width; x++) {
      const i = (y * input.width + x) * 4;
      if (
        ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) *
          data[i + 3]) /
          255 >
        127.5
      ) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 < 0)
    throw new Error("轮廓图没有白色区域。白色为透镜，黑色或透明为外部。");
  const c = canvas(x1 - x0 + 1, y1 - y0 + 1);
  c.getContext("2d").drawImage(
    input,
    x0,
    y0,
    c.width,
    c.height,
    0,
    0,
    c.width,
    c.height,
  );
  return c;
}
export function sourceCanvas(state, custom, size = 700) {
  const s = state.lens ? state : { lens: state },
    lens = s.lens,
    aperture = apertureLayout(s);
  const reference = canvas(size),
    ctx = reference.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);
  if (lens.shape === "custom" && custom)
    ctx.drawImage(custom, 0, 0, size, size);
  else {
    ctx.fillStyle = "white";
    ctx.beginPath();
    for (const loop of referenceContours({ ...lens, outlineRotation: 0 })) {
      loop.forEach(([x, y], i) =>
        ctx[i ? "lineTo" : "moveTo"](
          (y / lens.width + 0.5) * size,
          (x / lens.height + 0.5) * size,
        ),
      );
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  const src = ctx.getImageData(0, 0, size, size).data;
  const m = sourceRasterMap(s, aperture).elements,
    c = canvas(size),
    x = c.getContext("2d"),
    out = x.createImageData(size, size);
  for (let r = 0; r < size; r++)
    for (let col = 0; col < size; col++) {
      const u = (col + 0.5) / size,
        v = (r + 0.5) / size,
        z = m[2] * u + m[5] * v + m[8],
        a = (m[0] * u + m[3] * v + m[6]) / z,
        b = (m[1] * u + m[4] * v + m[7]) / z;
      let val = 0;
      if (a >= 0 && a < 1 && b >= 0 && b < 1) {
        const i = (Math.floor(b * size) * size + Math.floor(a * size)) * 4;
        val =
          0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2] > 127.5
            ? 255
            : 0;
      }
      const i = (r * size + col) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = val;
      out.data[i + 3] = 255;
    }
  x.putImageData(out, 0, 0);
  c.pixels = out.data;
  c.aperture = aperture;
  c.energySamples = apertureEnergySamples(out.data, size, size);
  c.reliefSamples = apertureEnergySamples(out.data, size, size, 16);
  return c;
}

// Trace every exposed pixel edge, retaining concavities, holes and islands.
export function maskContours(input, size = 256) {
  const c = canvas(size),
    ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(input, 0, 0, size, size);
  const p = ctx.getImageData(0, 0, size, size).data;
  const active = (r, col) =>
    r >= 0 &&
    r < size &&
    col >= 0 &&
    col < size &&
    ((0.299 * p[(r * size + col) * 4] +
      0.587 * p[(r * size + col) * 4 + 1] +
      0.114 * p[(r * size + col) * 4 + 2]) *
      p[(r * size + col) * 4 + 3]) /
      255 >
      127.5;
  const edges = [],
    starts = new Map(),
    stride = size + 1;
  const edge = (r, c, rr, cc) => {
    const a = r * stride + c,
      b = rr * stride + cc;
    const id = edges.length;
    edges.push([a, b]);
    if (!starts.has(a)) starts.set(a, []);
    starts.get(a).push(id);
  };
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (active(r, c)) {
        if (!active(r, c - 1)) edge(r, c, r + 1, c);
        if (!active(r + 1, c)) edge(r + 1, c, r + 1, c + 1);
        if (!active(r, c + 1)) edge(r + 1, c + 1, r, c + 1);
        if (!active(r - 1, c)) edge(r, c + 1, r, c);
      }
  const used = new Set(),
    loops = [];
  const point = (id) => [
    Math.floor(id / stride) / size - 0.5,
    (id % stride) / size - 0.5,
  ];
  for (let id = 0; id < edges.length; id++)
    if (!used.has(id)) {
      const loop = [],
        first = edges[id][0];
      let next = id;
      while (next !== undefined && !used.has(next)) {
        used.add(next);
        const [a, b] = edges[next];
        loop.push(point(a));
        if (b === first) break;
        const options = (starts.get(b) || []).filter((i) => !used.has(i));
        // At a diagonal pixel contact, turn left to keep each white component separate.
        const from = point(a),
          at = point(b),
          dx = at[0] - from[0],
          dy = at[1] - from[1];
        next = options.sort((ia, ib) => {
          const va = point(edges[ia][1]),
            vb = point(edges[ib][1]);
          return (
            Math.atan2(
              dx * (vb[1] - at[1]) - dy * (vb[0] - at[0]),
              dx * (vb[0] - at[0]) + dy * (vb[1] - at[1]),
            ) -
            Math.atan2(
              dx * (va[1] - at[1]) - dy * (va[0] - at[0]),
              dx * (va[0] - at[0]) + dy * (va[1] - at[1]),
            )
          );
        })[0];
      }
      const simple = loop.filter((p, i) => {
        const a = loop[(i + loop.length - 1) % loop.length],
          b = loop[(i + 1) % loop.length];
        return (
          Math.abs(
            (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]),
          ) > 1e-12
        );
      });
      if (simple.length >= 3) loops.push(simple);
    }
  return loops;
}

export function shadowMask(target, shadow, size = 700) {
  const c = canvas(size),
    x = c.getContext("2d"),
    p = shadow?.positions;
  const path = new Path2D();
  if (!p) {
    // Mirror mode uses the nominal single-face specular footprint. It is not
    // the solid's occlusion shadow, which is displayed independently.
    for (const loop of shadow?.loops || []) {
      loop.forEach(([row, col], i) =>
        path[i ? "lineTo" : "moveTo"](
          (col / target.width + 0.5) * size,
          (row / target.height + 0.5) * size,
        ),
      );
      path.closePath();
    }
    x.fillStyle = "white";
    x.fill(path, "evenodd");
    return c;
  }
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const j = i + k * 3;
      path[k ? "lineTo" : "moveTo"](
        (p[j + 1] / target.width + 0.5) * size,
        (p[j] / target.height + 0.5) * size,
      );
    }
    path.closePath();
  }
  x.fillStyle = "white";
  x.fill(path, "nonzero");
  return c;
}

export function targetCanvas(original, target, size = 700, shadow = null) {
  const turned = canvas(size),
    ctx = turned.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.rotate((target.imageRotation * Math.PI) / 180);
  ctx.drawImage(original, -size / 2, -size / 2, size, size);
  const src = ctx.getImageData(0, 0, size, size).data,
    c = canvas(size),
    x = c.getContext("2d"),
    out = x.createImageData(size, size),
    m = homography(target.corners).invert().elements;
  const clip = target.clipToShadow
    ? shadowMask(target, shadow, size)
        .getContext("2d")
        .getImageData(0, 0, size, size).data
    : null;
  let energy = 0;
  for (let y = 0; y < size; y++)
    for (let col = 0; col < size; col++) {
      const u = (col + 0.5) / size,
        v = (y + 0.5) / size,
        z = m[2] * u + m[5] * v + m[8],
        a = (m[0] * u + m[3] * v + m[6]) / z,
        b = (m[1] * u + m[4] * v + m[7]) / z,
        offset = (y * size + col) * 4;
      const rgb = [0, 0, 0];
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) {
        const sx = Math.max(0, Math.min(size - 1, a * size - 0.5)),
          sy = Math.max(0, Math.min(size - 1, b * size - 0.5)),
          ix = Math.floor(sx),
          iy = Math.floor(sy),
          fx = sx - ix,
          fy = sy - iy;
        for (const [dx, dy, weight] of [
          [0, 0, (1 - fx) * (1 - fy)],
          [1, 0, fx * (1 - fy)],
          [0, 1, (1 - fx) * fy],
          [1, 1, fx * fy],
        ]) {
          const p =
            (Math.min(size - 1, iy + dy) * size + Math.min(size - 1, ix + dx)) *
            4;
          for (let channel = 0; channel < 3; channel++)
            rgb[channel] += src[p + channel] * weight;
        }
        if (target.invert)
          for (let channel = 0; channel < 3; channel++)
            rgb[channel] = 255 - rgb[channel];
      }
      if (clip)
        for (let channel = 0; channel < 3; channel++)
          rgb[channel] *= clip[offset + 3] / 255;
      for (let channel = 0; channel < 3; channel++)
        out.data[offset + channel] = rgb[channel];
      out.data[offset + 3] = 255;
      energy += 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    }
  x.putImageData(out, 0, 0);
  c.energy = energy;
  c.energyMoments = imageEnergyMoments(out.data, size, size);
  c.reliefSamples = imageEnergySamples(out.data, size, size, 16);
  return c;
}
export function imageAsset(c, name) {
  return { name, mime_type: "image/png", data_url: c.toDataURL("image/png") };
}

export { shapesFromLoops, apertureGeometry } from "./lens-geometry.js";
