import {
  apertureLayout,
  quaternion,
  direction,
  localPoint,
  worldPoint,
  vec,
} from "./layout-geometry.js";
export function reliefInput(state, sourceSamples, targetSamples) {
  const aperture = apertureLayout(state);
  return {
    grid: 16,
    domain: { center: aperture.center, size: aperture.size },
    contours: aperture.loops,
    source: sourceSamples.map(([row, col, area, cell]) => [
      aperture.center[0] + row * aperture.size,
      aperture.center[1] + col * aperture.size,
      area,
      cell,
    ]),
    target: targetSamples.map(([row, col, w]) => [
      ...localPoint(
        state.lens,
        worldPoint(state.target, [
          row * state.target.height,
          col * state.target.width,
        ]),
      ).toArray(),
      w,
    ]),
    targetSpan: Math.max(state.target.width, state.target.height),
    reflect: state.reflect,
    index: state.lens.n,
    light: {
      point: state.light.type === "point",
      position: localPoint(state.lens, vec(state.light.position)).toArray(),
      direction: direction(state)
        .applyQuaternion(quaternion(state.lens.rotation).invert())
        .toArray(),
    },
  };
}
