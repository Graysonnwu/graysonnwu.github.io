import * as T from "./vendor/three.module.min.js";

export const vec = (v) => new T.Vector3().fromArray(v);
// scipy's extrinsic xyz rotation is Rz Ry Rx.
export const quaternion = (angles) =>
  new T.Quaternion().setFromEuler(
    new T.Euler(...angles.map(T.MathUtils.degToRad), "ZYX"),
  );
export const degrees = (q) =>
  new T.Euler()
    .setFromQuaternion(q, "ZYX")
    .toArray()
    .slice(0, 3)
    .map(T.MathUtils.radToDeg);
export const direction = (s) =>
  vec([0, 0, -1]).applyQuaternion(quaternion(s.light.rotation)).normalize();
export const matrix = (p) =>
  new T.Matrix4().compose(
    vec(p.position),
    quaternion(p.rotation),
    vec([1, 1, 1]),
  );
export const axis = (p, i) =>
  vec(i === 0 ? [1, 0, 0] : i === 1 ? [0, 1, 0] : [0, 0, 1]).applyQuaternion(
    quaternion(p.rotation),
  );
export const aimRotation = (from, to) =>
  degrees(
    new T.Quaternion().setFromUnitVectors(
      vec([0, 0, -1]),
      vec(to).sub(vec(from)).normalize(),
    ),
  );
export const worldPoint = (pose, p) =>
  vec([p[0], p[1], p[2] || 0])
    .applyQuaternion(quaternion(pose.rotation))
    .add(vec(pose.position));
export const localPoint = (pose, p) =>
  p
    .clone()
    .sub(vec(pose.position))
    .applyQuaternion(quaternion(pose.rotation).invert());
export const signedArea = (loop) =>
  loop.reduce((sum, a, i) => {
    const b = loop[(i + 1) % loop.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
export function bounds2(loops) {
  const min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  for (const loop of loops)
    for (const p of loop)
      for (let i = 0; i < 2; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
  return {
    min,
    max,
    center: min.map((v, i) => (v + max[i]) / 2),
    height: max[0] - min[0],
    width: max[1] - min[1],
  };
}
export function insideLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

// Convex polygon fillets. Radius is in the chosen outline plane, in mm.
function roundedPolygon(points, radius) {
  if (!(radius > 0)) return points;
  const joins = points.map((p, i) => {
    const a = new T.Vector2(
      ...points[(i + points.length - 1) % points.length],
    ).sub(new T.Vector2(...p));
    const b = new T.Vector2(...points[(i + 1) % points.length]).sub(
      new T.Vector2(...p),
    );
    const la = a.length(),
      lb = b.length();
    a.normalize();
    b.normalize();
    const half = Math.acos(T.MathUtils.clamp(a.dot(b), -1, 1)) / 2;
    return {
      p: new T.Vector2(...p),
      a,
      b,
      half,
      max: Math.min(la, lb) * 0.499 * Math.tan(half),
    };
  });
  const r = Math.min(radius, ...joins.map((j) => j.max));
  return joins.flatMap(({ p, a, b, half }) => {
    const center = p
      .clone()
      .addScaledVector(a.clone().add(b).normalize(), r / Math.sin(half));
    const start = p
      .clone()
      .addScaledVector(a, r / Math.tan(half))
      .sub(center);
    const end = p
      .clone()
      .addScaledVector(b, r / Math.tan(half))
      .sub(center);
    const first = Math.atan2(start.y, start.x);
    let sweep = Math.atan2(end.y, end.x) - first;
    while (sweep <= 0) sweep += 2 * Math.PI;
    return Array.from({ length: 13 }, (_, i) => [
      center.x + r * Math.cos(first + (sweep * i) / 12),
      center.y + r * Math.sin(first + (sweep * i) / 12),
    ]);
  });
}
export function polygonTemplate(sides = 6) {
  // Image X points down: two vertices at maximum X make a horizontal bottom edge.
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides + Math.PI / sides;
    return [Math.cos(a), Math.sin(a)];
  });
}
function regularContour(height, sides, radius = 0) {
  const template = polygonTemplate(sides),
    b = bounds2([template]);
  let scale = height / b.height,
    points;
  for (let i = 0; i < 12; i++) {
    points = roundedPolygon(
      template.map(([x, y]) => [
        (x - b.center[0]) * scale,
        (y - b.center[1]) * scale,
      ]),
      radius,
    );
    const actual = bounds2([points]);
    if (Math.abs(actual.height - height) < 1e-8) break;
    scale += (height - actual.height) / b.height;
  }
  const center = bounds2([points]).center;
  return points.map(([x, y]) => [x - center[0], y - center[1]]);
}
export function regularPolygonWidth(height, sides, radius = 0) {
  return bounds2([regularContour(height, sides, radius)]).width;
}
export function referenceContours(lens) {
  const a = T.MathUtils.degToRad(lens.outlineRotation || 0),
    c = Math.cos(a),
    s = Math.sin(a);
  return baseContours(lens).map((loop) =>
    loop.map(([x, y]) => [c * x - s * y, s * x + c * y]),
  );
}
function baseContours(lens) {
  const { width: w, height: h } = lens;
  if (lens.shape === "custom" && lens.contours?.length)
    return lens.contours.map((loop) => loop.map(([x, y]) => [x * h, y * w]));
  if (lens.shape === "circle")
    return [
      Array.from({ length: 192 }, (_, i) => [
        (h / 2) * Math.cos((i * Math.PI) / 96),
        (w / 2) * Math.sin((i * Math.PI) / 96),
      ]),
    ];
  if (
    lens.shape === "rectangle" ||
    lens.shape === "square" ||
    lens.shape === "rounded" ||
    lens.shape === "custom"
  ) {
    return [
      roundedPolygon(
        [
          [-h / 2, -w / 2],
          [h / 2, -w / 2],
          [h / 2, w / 2],
          [-h / 2, w / 2],
        ],
        lens.cornerRadius || 0,
      ),
    ];
  }
  const n = lens.sides || 6;
  if (lens.regularPolygon)
    return [regularContour(h, n, lens.cornerRadius || 0)];
  let points = polygonTemplate(n);
  const box = bounds2([points]);
  points = points.map(([x, y]) => [
    ((x - box.center[0]) * h) / box.height,
    ((y - box.center[1]) * w) / box.width,
  ]);
  return [roundedPolygon(points, lens.cornerRadius || 0)];
}

export function projectToReceiver(s, point, forwardOnly = true) {
  const ray =
    s.light.type === "point"
      ? point.clone().sub(vec(s.light.position))
      : direction(s);
  if (s.reflect) ray.reflect(axis(s.lens, 2));
  const normal = axis(s.target, 2),
    denominator = normal.dot(ray);
  if (Math.abs(denominator) < 1e-10 * ray.length()) return null;
  const t = normal.dot(vec(s.target.position).sub(point)) / denominator;
  if (!Number.isFinite(t) || (forwardOnly && t < 0)) return null;
  return point.clone().addScaledVector(ray, t);
}
export function receiverToLens(s, point) {
  const start = s.light.type === "point" ? vec(s.light.position) : point;
  const lensNormal = axis(s.lens, 2);
  if (s.reflect && s.light.type === "point")
    start.addScaledVector(
      lensNormal,
      -2 * start.clone().sub(vec(s.lens.position)).dot(lensNormal),
    );
  const ray =
    s.light.type === "point" ? point.clone().sub(start) : direction(s).negate();
  if (s.reflect && s.light.type === "parallel") ray.reflect(lensNormal);
  const normal = axis(s.lens, 2),
    denominator = normal.dot(ray);
  if (Math.abs(denominator) < 1e-10 * ray.length()) return null;
  const t = normal.dot(vec(s.lens.position).sub(start)) / denominator;
  if (
    !Number.isFinite(t) ||
    (s.light.type === "point" ? t <= 0 || t >= 1 : t <= 0)
  )
    return null;
  return start.addScaledVector(ray, t);
}

export function apertureLayout(state) {
  // The lens-only form remains useful for isolated geometry tests.
  const s = state.lens ? state : { lens: state };
  const reference = referenceContours(s.lens);
  let loops = reference,
    shadowCenter = null;
  if (s.lens.outlineSpace === "shadow") {
    shadowCenter = projectToReceiver(s, vec(s.lens.position));
    if (!shadowCenter)
      throw new Error(
        `接收面不在${s.reflect ? "反射光" : "直射阴影"}路径内，请调整光源或接收面。`,
      );
    const center = localPoint(s.target, shadowCenter);
    loops = reference.map((loop) =>
      loop.map(([x, y]) => {
        const point = receiverToLens(
          s,
          worldPoint(s.target, [x + center.x, y + center.y]),
        );
        if (!point)
          throw new Error(
            "阴影轮廓越过了投影极限，请减小轮廓、增大灯距或调整接收面。",
          );
        const local = localPoint(s.lens, point);
        return [local.x, local.y];
      }),
    );
  }
  const box = bounds2(loops),
    size = Math.max(box.width, box.height);
  if (!(size > 1e-6 && size < 1e6)) throw new Error("轮廓尺寸或投影比例无效。");
  return { loops, reference, ...box, size, shadowCenter };
}

// Cardinal extrema and four bounding-box corners, never fixed 45-degree rays.
export function contourAnchors(loops) {
  const b = bounds2(loops),
    points = loops.flat();
  const unit = (p) => [
    (p[0] - b.center[0]) / b.height,
    (p[1] - b.center[1]) / b.width,
  ];
  const sides = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].map(([x, y]) => {
    const max = Math.max(
      ...points.map((p) => {
        const a = unit(p);
        return a[0] * x + a[1] * y;
      }),
    );
    const candidates = points.filter((p) => {
      const a = unit(p);
      return Math.abs(a[0] * x + a[1] * y - max) < 1e-6;
    });
    // Midpoint of a flat extreme edge; a curved outline has one extremum.
    const bb = bounds2([candidates]);
    return bb.center;
  });
  const corners = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(([x, y]) =>
    points.reduce((best, p) => {
      const a = unit(p),
        c = unit(best);
      return a[0] * x + a[1] * y > c[0] * x + c[1] * y ? p : best;
    }, points[0]),
  );
  return [...sides, ...corners, b.center];
}
export function shadowLayout(s, aperture = apertureLayout(s)) {
  const loops = [],
    worldLoops = [];
  for (const contour of aperture.loops) {
    const world = contour.map((p) =>
      projectToReceiver(s, worldPoint(s.lens, p)),
    );
    if (world.some((p) => !p)) return null;
    worldLoops.push(world);
    loops.push(
      world.map((p) => {
        const q = localPoint(s.target, p);
        return [q.x, q.y];
      }),
    );
  }
  const bounds = bounds2(loops),
    centerWorld = worldPoint(s.target, bounds.center);
  const anchors = contourAnchors(aperture.loops).map((p) => {
    const start = worldPoint(s.lens, p);
    return {
      start,
      end: projectToReceiver(s, start),
    };
  });
  return { loops, worldLoops, ...bounds, centerWorld, anchors };
}
export function illuminationGuides(s, shadow = shadowLayout(s)) {
  const aperture = apertureLayout(s),
    anchors =
      shadow?.anchors ||
      contourAnchors(aperture.loops).map((p) => {
        const start = worldPoint(s.lens, p);
        return { start, end: projectToReceiver(s, start) };
      });
  const d = direction(s),
    light = vec(s.light.position),
    sourceDepth = Math.min(
      light.dot(d),
      ...anchors.map((a) => a.start.dot(d) - aperture.size * 0.25),
    );
  return anchors.map(({ start, end }) => {
    const length = start.dot(d) - sourceDepth;
    const origin =
      s.light.type === "point"
        ? light.clone()
        : start.clone().addScaledVector(d, -length);
    return { origin, aperture: start, end };
  });
}
export function patternLayout(s) {
  const loops = [
    s.target.corners.map(([u, v]) => [
      (v - 0.5) * s.target.height,
      (u - 0.5) * s.target.width,
    ]),
  ];
  const b = bounds2(loops);
  return { loops, ...b, centerWorld: worldPoint(s.target, b.center) };
}
export function matchTargetToShadow(s, shadow = shadowLayout(s)) {
  if (!shadow)
    throw new Error("接收面没有有效的直射阴影，请先调整位置或朝向。");
  const size = Math.max(shadow.width, shadow.height);
  s.target.position = shadow.centerWorld.toArray();
  s.target.width = s.target.height = size;
  s.target.corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  return s;
}

// Two-axis squares always scale together. Single handles may change aspect.
export function constrainedScale(
  values,
  handle,
  keepAspect = false,
  uniform = false,
) {
  const scales = values.map((v) => Math.max(0.02, Math.abs(v)));
  const active = [...(handle || "")].filter((c) => "XYZ".includes(c));
  const indices = active.map((c) => "XYZ".indexOf(c));
  const factor = (indices.length ? indices : [0, 1, 2])
    .map((i) => scales[i])
    .reduce(
      (a, b) => (Math.abs(Math.log(b)) > Math.abs(Math.log(a)) ? b : a),
      1,
    );
  if (uniform) return [factor, factor, factor];
  if (active.length > 1) for (const i of indices) scales[i] = factor;
  if (keepAspect || (active.includes("X") && active.includes("Y"))) {
    const f =
      Math.abs(Math.log(scales[0])) > Math.abs(Math.log(scales[1]))
        ? scales[0]
        : scales[1];
    scales[0] = scales[1] = f;
  }
  return scales;
}

// Orbit the source around the lens; scaling changes distance, not emitter size.
export function lightPivotPose(base, rotation, scale = 1) {
  const center = vec(base.lens.position);
  const delta = quaternion(rotation).multiply(quaternion(base.light.rotation).invert());
  return {
    position: vec(base.light.position).sub(center).applyQuaternion(delta)
      .multiplyScalar(scale).add(center).toArray(),
    rotation,
    scale: [1, 1, 1],
  };
}

export function modelIntersectsReceiver(s, model) {
  const q = quaternion(s.lens.rotation).invert(),
    normal = axis(s.target, 2).applyQuaternion(q);
  const center = localPoint(s.lens, vec(s.target.position)),
    constant = -center.dot(normal),
    p = model.positions,
    scale = model.scale || 1;
  const distance = new Float64Array(p.length / 3);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    distance[i / 3] =
      (normal.x * p[i] + normal.y * p[i + 1] + normal.z * p[i + 2]) * scale +
      constant;
    min = Math.min(min, distance[i / 3]);
    max = Math.max(max, distance[i / 3]);
  }
  if (min > 0.001 || max < -0.001) return false;
  for (let i = 0; i < model.indices.length; i += 3) {
    const a = distance[model.indices[i]],
      b = distance[model.indices[i + 1]],
      c = distance[model.indices[i + 2]],
      lo = Math.min(a, b, c),
      hi = Math.max(a, b, c);
    if (lo <= 0.001 && hi >= -0.001) return true;
  }
  return false;
}
