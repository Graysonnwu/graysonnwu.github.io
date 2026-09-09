import {
  apertureLayout,
  direction,
  localPoint,
  patternLayout,
  projectToReceiver,
  quaternion,
  vec,
  worldPoint,
} from "./layout-geometry.js";

// Only an explicit user thickness is a constraint. The default stock thickness
// and aperture ratios are placement aids, not reasons to raise a warning.
export function surfaceThicknessWarning(state, result) {
  if (
    state.lens.thicknessAuto !== false ||
    !result?.valid ||
    !Number.isFinite(result.pvMM) ||
    result.pvMM <= state.lens.thickness
  )
    return null;
  return {
    code: "surface-relief",
    level: "warning",
    text: `曲面起伏约 ${result.pvMM.toFixed(1)} mm，超过设置厚度 ${state.lens.thickness.toFixed(1)} mm。`,
  };
}
const luminance = (data, i) =>
  (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) *
  (data[i + 3] / 255);

export function imageEnergyMoments(data, width, height) {
  let energy = 0,
    row = 0,
    column = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const w = luminance(data, (y * width + x) * 4);
      energy += w;
      row += w * ((y + 0.5) / height - 0.5);
      column += w * ((x + 0.5) / width - 0.5);
    }
  return energy > 0
    ? { energy, row: row / energy, column: column / energy }
    : null;
}

export function apertureEnergySamples(data, width, height, grid = 32) {
  // Aggregate every illuminated pixel: small islands cannot disappear between
  // sample points. Point-source irradiance is evaluated at each bin's centroid.
  const bins = Array.from({ length: grid * grid }, () => [0, 0, 0]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (luminance(data, (y * width + x) * 4) <= 127.5) continue;
      const bin =
        bins[
          Math.floor((y * grid) / height) * grid +
            Math.floor((x * grid) / width)
        ];
      bin[0] += (y + 0.5) / height - 0.5;
      bin[1] += (x + 0.5) / width - 0.5;
      bin[2]++;
    }
  return bins
    .map((bin, index) => [...bin, index])
    .filter((b) => b[2])
    .map(([x, y, area, index]) => [
      x / area,
      y / area,
      area / (width * height),
      index,
    ]);
}

export function imageEnergySamples(data, width, height, grid = 16) {
  const bins = Array.from({ length: grid * grid }, () => [0, 0, 0]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const w = luminance(data, (y * width + x) * 4),
        bin =
          bins[
            Math.floor((y * grid) / height) * grid +
              Math.floor((x * grid) / width)
          ];
      bin[0] += w * ((y + 0.5) / height - 0.5);
      bin[1] += w * ((x + 0.5) / width - 0.5);
      bin[2] += w;
    }
  return bins
    .filter((b) => b[2] > 0)
    .map(([row, col, w]) => [row / w, col / w, w]);
}

/** Equivalent chief-ray prism, NOT full freeform sag or a lower thickness bound.
 * All geometry is in mm. The target moments must come from the final SHARP
 * raster, after rotation, warp, inversion and clipping, before preview blur.
 * Entrance refraction and the exit physical branch follow OTMap gje_optics.py.
 */
export function surfaceTiltEstimate(s, samples, moments) {
  const base = {
    method: "flux-centroid-chief-ray-snell-v1",
    warning_policy: "explicit-thickness-only",
    valid: false,
    warnings: [],
    approximation:
      "Equivalent overall prism from flux centroids at the entrance plane; not complete surface PV, a lower bound, or finished thickness. Local redistribution, exit depth and source-to-target coupling require a full solve.",
  };
  if (!moments || !samples?.length) return { ...base, reason: "empty-image" };
  const aperture = apertureLayout(s),
    inverse = quaternion(s.lens.rotation).invert(),
    light = localPoint(s.lens, vec(s.light.position)),
    incoming = direction(s).applyQuaternion(inverse),
    point = s.light.type === "point",
    sourceCenter = vec([0, 0, 0]),
    footprintCenter = vec([0, 0, 0]);
  let flux = 0,
    footprintFlux = 0;
  for (const [row, col, area] of samples) {
    const p = vec([
        aperture.center[0] + row * aperture.size,
        aperture.center[1] + col * aperture.size,
        0,
      ]),
      ray = point ? p.clone().sub(light) : incoming.clone(),
      distance = ray.length();
    if (distance < 1e-6) continue;
    const weight =
      (area * Math.max(0, -ray.z / distance)) /
      (point ? distance * distance : 1);
    sourceCenter.addScaledVector(p, weight);
    flux += weight;
    const hit = projectToReceiver(s, worldPoint(s.lens, p.toArray()));
    if (hit) {
      footprintCenter.addScaledVector(hit, weight);
      footprintFlux += weight;
    }
  }
  if (!(flux > 0)) return { ...base, reason: "unlit-aperture" };
  sourceCenter.divideScalar(flux);
  const targetCenter = worldPoint(s.target, [
      moments.row * s.target.height,
      moments.column * s.target.width,
    ]),
    targetLocal = localPoint(s.lens, targetCenter),
    outgoing = targetLocal.clone().sub(sourceCenter),
    external = point ? sourceCenter.clone().sub(light).normalize() : incoming,
    internal = external.clone();
  if (outgoing.length() < 1e-6)
    return { ...base, reason: "coincident-centroids" };
  outgoing.normalize();
  if (!s.reflect) {
    internal.x /= s.lens.n;
    internal.y /= s.lens.n;
    internal.z = -Math.sqrt(Math.max(0, 1 - internal.x ** 2 - internal.y ** 2));
  }
  const n = s.reflect ? 1 : s.lens.n,
    normal = internal.clone().multiplyScalar(n).sub(outgoing),
    margin = s.reflect
      ? 1 - internal.dot(outgoing)
      : internal.dot(outgoing) - 1 / n;
  if (
    margin < 0 ||
    normal.length() < 1e-9 ||
    Math.abs(normal.z) / normal.length() < 0.02
  )
    return {
      ...base,
      reason: "chief-ray-limit",
      warnings: [
        {
          code: "surface-tilt-limit",
          level: "warning",
          text: "亮区需要的偏折超出当前近似范围，请调整光路或用完整求解确认。",
        },
      ],
    };
  const slopes = [-normal.x / normal.z, -normal.y / normal.z],
    extent = aperture.loops.reduce(
      (range, loop) => {
        for (const [x, y] of loop) {
          const z = x * slopes[0] + y * slopes[1];
          range[0] = Math.min(range[0], z);
          range[1] = Math.max(range[1], z);
        }
        return range;
      },
      [Infinity, -Infinity],
    ),
    wedge = extent[1] - extent[0],
    ratio = wedge / aperture.size,
    angle = (Math.atan(Math.hypot(...slopes)) * 180) / Math.PI,
    pattern = patternLayout(s),
    brightnessOffset = targetCenter.distanceTo(pattern.centerWorld),
    hasFootprint = footprintFlux / flux > 0.999;
  if (hasFootprint) footprintCenter.divideScalar(footprintFlux);
  const patternOffset = hasFootprint
    ? footprintCenter.distanceTo(pattern.centerWorld)
    : null;
  return {
    ...base,
    valid: true,
    warnings: [],
    wedge_mm: wedge,
    wedge_over_aperture: ratio,
    tilt_degrees: angle,
    slope_xy: slopes,
    physical_branch_margin: margin,
    target_energy_center_world_mm: targetCenter.toArray(),
    source_energy_center_world_mm: worldPoint(
      s.lens,
      sourceCenter.toArray(),
    ).toArray(),
    entrance_footprint_energy_center_world_mm: hasFootprint
      ? footprintCenter.toArray()
      : null,
    pattern_offset_mm: patternOffset,
    brightness_offset_mm: brightnessOffset,
    energy_offset_mm: hasFootprint
      ? footprintCenter.distanceTo(targetCenter)
      : null,
  };
}
