import {
  axis,
  apertureLayout,
  patternLayout,
  vec,
  worldPoint,
} from "./layout-geometry.js";

export const SUN_DIAMETER_DEG = 0.53;
export const BLUR_WARNING_RATIO = 0.04;

// Geometric, paraxial sensitivity to source extent. A solved freeform surface can
// have a spatially varying response; this is a preparation estimate, not an MTF.
// A circular emitter (or angular solar disk) becomes an ellipse on a tilted board.
export function sourceBlur(s) {
  const aperture = apertureLayout(s),
    origin = worldPoint(s.lens, aperture.center),
    pattern = patternLayout(s),
    outgoing = pattern.centerWorld.clone().sub(origin),
    distance = outgoing.length(),
    sourceDistance = vec(s.light.position).distanceTo(origin);
  outgoing.normalize();
  const point = s.light.type === "point",
    angle = s.light.angularDiameter ?? SUN_DIAMETER_DEG,
    diameter = point
      ? (s.light.diameter * distance) / Math.max(sourceDistance, 1e-9)
      : 2 * distance * Math.tan((angle * Math.PI) / 360),
    normal = axis(s.target, 2),
    den = outgoing.dot(normal),
    tangentU = vec(Math.abs(outgoing.x) < 0.9 ? [1, 0, 0] : [0, 1, 0])
      .cross(outgoing)
      .normalize(),
    tangentV = outgoing.clone().cross(tangentU),
    row = axis(s.target, 0),
    col = axis(s.target, 1);
  // Limit the grazing singularity for a bounded preview; the geometry warning
  // remains active. Each vector is a full diameter, in receiver column/row mm.
  const denominator = Math.abs(den) < 0.02 ? (Math.sign(den) || 1) * 0.02 : den;
  const vectors = [tangentU, tangentV].map((tangent) => {
    const p = tangent
      .clone()
      .addScaledVector(outgoing, -normal.dot(tangent) / denominator);
    return [p.dot(col) * diameter, p.dot(row) * diameter];
  });
  const widthMM = Math.hypot(vectors[0][0], vectors[1][0]),
    heightMM = Math.hypot(vectors[0][1], vectors[1][1]),
    widthRatio = widthMM / Math.max(pattern.width, 1e-9),
    heightRatio = heightMM / Math.max(pattern.height, 1e-9);
  return {
    kind: point ? "disk-emitter" : "angular-disk",
    diameterMM: diameter / Math.max(Math.abs(den), 0.02),
    widthMM,
    heightMM,
    vectors,
    widthRatio,
    heightRatio,
    ratio: Math.max(widthRatio, heightRatio),
    resolution: {
      width: widthRatio > 0 ? 1 / widthRatio : null,
      height: heightRatio > 0 ? 1 / heightRatio : null,
    },
    warning: Math.max(widthRatio, heightRatio) > BLUR_WARNING_RATIO + 1e-10,
    sourceLabel: point
      ? `${s.light.diameter.toFixed(1)} mm 发光面`
      : angle === 0
        ? "理想平行光"
        : Math.abs(angle - SUN_DIAMETER_DEG) < 1e-6
          ? "太阳光 · 0.53°"
          : `${angle.toFixed(2)}° 视直径`,
  };
}
