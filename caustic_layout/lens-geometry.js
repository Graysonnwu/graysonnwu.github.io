import * as T from "./vendor/three.module.min.js";
import { apertureLayout, signedArea, insideLoop } from "./layout-geometry.js";

export function shapesFromLoops(loops) {
  const largest = loops.reduce(
    (a, b) => (Math.abs(signedArea(a)) > Math.abs(signedArea(b)) ? a : b),
    loops[0],
  );
  if (largest && signedArea(largest) < 0)
    loops = loops.map((loop) => loop.slice().reverse());
  const outers = loops.filter((p) => signedArea(p) > 0),
    holes = loops.filter((p) => signedArea(p) < 0);
  const shapes = outers.map(
    (loop) => new T.Shape(loop.map(([x, y]) => new T.Vector2(x, y))),
  );
  for (const hole of holes) {
    const containers = outers
      .map((loop, i) => ({ loop, i }))
      .filter(({ loop }) => insideLoop(hole[0], loop))
      .sort((a, b) => signedArea(a.loop) - signedArea(b.loop));
    if (containers.length)
      shapes[containers[0].i].holes.push(
        new T.Path(hole.map(([x, y]) => new T.Vector2(x, y))),
      );
  }
  return shapes;
}
export function apertureGeometry(state, mask) {
  const lens = state.lens || state,
    aperture = apertureLayout(state);
  const g = new T.ExtrudeGeometry(shapesFromLoops(aperture.loops), {
    depth: lens.thickness,
    bevelEnabled: false,
    curveSegments: 32,
  });
  g.translate(0, 0, -lens.thickness);
  return g;
}
