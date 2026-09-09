import * as T from "./vendor/three.module.min.js";
import { apertureGeometry } from "./lens-geometry.js";
import { sampleRelief } from "./relief-core.js";

// Visualization only. The exact aperture and its holes come from the existing
// stock mesh; adaptive subdivision adds interior surface samples without
// changing exported source/target or producing a manufacturing mesh.
export function reliefGeometry(state, result) {
  const stock = apertureGeometry(state),
    p = stock.attributes.position,
    n = stock.attributes.normal,
    positions = [],
    heights = [],
    normals = [],
    step = result.domain.size / 22,
    epsilon = result.domain.size * 0.001;
  let minimum = Infinity,
    maximum = -Infinity;
  function vertex(v, normal) {
    const [x, y, z] = v,
      h = sampleRelief(result, x, y),
      t = Math.max(0, Math.min(1, -z / state.lens.thickness));
    positions.push(x, y, z);
    heights.push(h);
    minimum = Math.min(minimum, h);
    maximum = Math.max(maximum, h);
    if (Math.abs(normal[2]) > 0.99) {
      const optical = state.reflect ? t < 0.5 : t > 0.5;
      const dx = optical
          ? (sampleRelief(result, x + epsilon, y) -
              sampleRelief(result, x - epsilon, y)) /
            (2 * epsilon)
          : 0,
        dy = optical
          ? (sampleRelief(result, x, y + epsilon) -
              sampleRelief(result, x, y - epsilon)) /
            (2 * epsilon)
          : 0;
      const sign = normal[2] > 0 ? 1 : -1,
        d = Math.hypot(dx, dy, 1);
      normals.push((-dx / d) * sign, (-dy / d) * sign, sign / d);
    } else normals.push(...normal);
  }
  function triangle(a, b, c, normal, level = 0) {
    const distance = (u, v) => (u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2,
      ab = distance(a, b),
      bc = distance(b, c),
      ca = distance(c, a);
    if (
      level < 9 &&
      positions.length < 360000 &&
      Math.max(ab, bc, ca) > step * step
    ) {
      if (bc >= ab && bc >= ca) [a, b, c] = [b, c, a];
      else if (ca >= ab && ca >= bc) [a, b, c] = [c, a, b];
      const midpoint = a.map((v, i) => (v + b[i]) / 2);
      triangle(a, midpoint, c, normal, level + 1);
      triangle(midpoint, b, c, normal, level + 1);
      return;
    }
    vertex(a, normal);
    vertex(b, normal);
    vertex(c, normal);
  }
  for (let i = 0; i < p.count; i += 3)
    triangle(
      [p.getX(i), p.getY(i), p.getZ(i)],
      [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
      [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)],
      [n.getX(i), n.getY(i), n.getZ(i)],
    );
  stock.dispose();
  // Subdivision can sample slightly beyond the coarse grid's extrema. Anchor
  // the actual rendered surface so a user-specified total thickness stays exact
  // whenever it fits. Only the height gauge/backing changes, never the relief.
  const pv = maximum - minimum,
    remaining = state.lens.thickness - pv,
    backing =
      state.lens.thicknessAuto === false && remaining >= 0
        ? remaining
        : Math.max(result.domain.size * 0.01, remaining),
    depth = pv + backing;
  for (let i = 0; i < heights.length; i++) {
    const t = Math.max(
      0,
      Math.min(1, -positions[i * 3 + 2] / state.lens.thickness),
    );
    positions[i * 3 + 2] = state.reflect
      ? (1 - t) * (heights[i] - maximum) - t * depth
      : t * (heights[i] - maximum - backing);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.userData.previewDepthMM = depth;
  geometry.userData.reliefMM = pv;
  return geometry;
}
