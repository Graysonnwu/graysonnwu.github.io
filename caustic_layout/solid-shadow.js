import { apertureGeometry } from "./lens-geometry.js";
import {
  direction,
  localPoint,
  matrix,
  vec,
  worldPoint,
} from "./layout-geometry.js";

// Project the complete closed solid, including its back and side walls. The
// entrance-only shadow in layout-geometry remains the inverse-design reference.
// Keep the projected triangle union, retaining holes and side-wall occlusion
// without a convex-hull approximation.
export function solidShadow(state, model = null) {
  const geometry = model ? null : apertureGeometry(state);
  const positions = model?.positions || geometry.attributes.position.array;
  const indices = model ? model.indices : geometry.index?.array;
  const scale = model?.scale || 1;
  const transform = matrix(state.target).invert().multiply(matrix(state.lens));
  const e = transform.elements,
    points = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * scale,
      y = positions[i + 1] * scale,
      z = positions[i + 2] * scale;
    points[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    points[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    points[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  geometry?.dispose();
  const point = state.light.type === "point";
  const light = localPoint(state.target, vec(state.light.position));
  const d = direction(state).transformDirection(matrix(state.target).invert());
  if (point ? Math.abs(light.z) < 1e-7 : Math.abs(d.z) < 1e-8) return null;
  const sign = point ? Math.sign(light.z) : -Math.sign(d.z);
  const near = point ? Math.max(1e-7, Math.abs(light.z) * 1e-8) : 0;
  const halfX = (state.target.height * state.target.boardFactor) / 2;
  const halfY = (state.target.width * state.target.boardFactor) / 2;
  if (model) {
    const indexed = projectIndexed(points, indices, point, light, d, sign, near, halfX, halfY, state.target);
    if (indexed) return indexed;
  }
  const result = [],
    min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  let clipped = false;
  const get = (i) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
  for (
    let i = 0, n = indices ? indices.length : points.length / 3;
    i < n;
    i += 3
  ) {
    let face = [
      get(indices ? indices[i] : i),
      get(indices ? indices[i + 1] : i + 1),
      get(indices ? indices[i + 2] : i + 2),
    ];
    // Only geometry between the source and receiver blocks the receiver. This
    // also keeps projections finite if a solid straddles a plane or the source.
    face = clipPolygon(face, (p) => p[2] * sign);
    if (point)
      face = clipPolygon(face, (p) => Math.abs(light.z) - near - p[2] * sign);
    face = face.map(([x, y, z]) =>
      point
        ? [
            (light.z * x - z * light.x) / (light.z - z),
            (light.z * y - z * light.y) / (light.z - z),
          ]
        : [x - (z * d.x) / d.z, y - (z * d.y) / d.z],
    );
    const area = face.reduce((sum, a, j) => {
      const b = face[(j + 1) % face.length];
      return sum + a[0] * b[1] - a[1] * b[0];
    }, 0);
    if (Math.abs(area) < 1e-10) continue;
    // Keep the full plane bounds for the matching shortcut, even if the current
    // receiving board entirely misses the shadow. Only rendered triangles clip.
    for (const p of face)
      for (let k = 0; k < 2; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    if (
      face.some(
        ([x, y]) => Math.abs(x) > halfX + 1e-5 || Math.abs(y) > halfY + 1e-5,
      )
    )
      clipped = true;
    for (const [axis, half] of [
      [0, halfX],
      [1, halfY],
    ])
      for (const s of [-1, 1])
        face = clipPolygon(face, (p) => half - s * p[axis]);
    for (let j = 1; j + 1 < face.length; j++) {
      const a = face[0],
        b = face[j],
        c = face[j + 1];
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) < 1e-10) continue;
      for (const p of cross > 0 ? [a, b, c] : [a, c, b]) {
        result.push(p[0], p[1], 0);
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  const center = min.map((v, i) => (v + max[i]) / 2);
  return {
    positions: new Float32Array(result),
    min,
    max,
    center,
    height: max[0] - min[0],
    width: max[1] - min[1],
    centerWorld: worldPoint(state.target, center),
    clipped,
    actualModel: Boolean(model),
  };
}

// In a valid optical layout every vertex is between the source and receiver.
// Project each shared vertex once and retain the complete triangle index.
// The GPU and rasterizer clip to the board; crossing solids use polygon clipping above.
function projectIndexed(points, indices, point, light, d, sign, near, halfX, halfY, target) {
  const positions = new Float32Array(points.length);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    const z = points[i + 2];
    if (z * sign < 0 || (point && z * sign > Math.abs(light.z) - near)) return null;
    const x = point ? (light.z * points[i] - z * light.x) / (light.z - z) : points[i] - z * d.x / d.z;
    const y = point ? (light.z * points[i+1] - z * light.y) / (light.z - z) : points[i+1] - z * d.y / d.z;
    positions[i] = x;
    positions[i + 1] = y;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
  }
  if (!Number.isFinite(min[0])) return null;
  const center = min.map((v, i) => (v + max[i]) / 2);
  return {
    positions, indices, min, max, center,
    height: max[0] - min[0], width: max[1] - min[1],
    centerWorld: worldPoint(target, center),
    boardHalf: [halfX, halfY],
    clipped: min[0] < -halfX-1e-5 || max[0] > halfX+1e-5 || min[1] < -halfY-1e-5 || max[1] > halfY+1e-5,
    actualModel: true,
  };
}

function clipPolygon(points, distance) {
  if (!points.length) return points;
  const ds = points.map(distance);
  if (ds.every((d) => d >= 0)) return points;
  if (ds.every((d) => d < 0)) return [];
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + points.length - 1) % points.length,
      a = points[j],
      b = points[i];
    if (ds[i] >= 0 !== ds[j] >= 0) {
      const t = ds[j] / (ds[j] - ds[i]);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
    if (ds[i] >= 0) out.push(b);
  }
  return out;
}

export function shadowContains(shadow, x, y) {
  const p = shadow?.positions;
  if (!p) return false;
  if (shadow.boardHalf && (Math.abs(x) > shadow.boardHalf[0] || Math.abs(y) > shadow.boardHalf[1])) return false;
  const indices = shadow.indices;
  for (let i = 0, n = indices?.length || p.length / 3; i < n; i += 3) {
    const a = (indices ? indices[i] : i) * 3,
      b = (indices ? indices[i+1] : i+1) * 3,
      c = (indices ? indices[i+2] : i+2) * 3;
    const area = (p[b]-p[a]) * (p[c+1]-p[a+1]) - (p[b+1]-p[a+1]) * (p[c]-p[a]);
    if (Math.abs(area) < 1e-10) continue;
    let positive = false, negative = false;
    for (let k = 0; k < 3; k++) {
      const a = (indices ? indices[i+k] : i+k) * 3,
        b = (indices ? indices[i+(k+1)%3] : i+(k+1)%3) * 3;
      const cross = (p[b]-p[a]) * (y-p[a+1]) - (p[b+1]-p[a+1]) * (x-p[a]);
      positive ||= cross > 1e-6;
      negative ||= cross < -1e-6;
      if (positive && negative) break;
    }
    if (!(positive && negative)) return true;
  }
  return false;
}
