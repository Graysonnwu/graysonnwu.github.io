import * as T from "./vendor/three.module.min.js";
import { MeshBVH } from "./vendor/mesh-bvh.js";
import { axis, direction, quaternion, vec } from "./optics.js";
import { SUN_DIAMETER_DEG } from "./source-effects.js";

export function refract(incident, normal, eta) {
  const n = normal.clone();
  if (incident.dot(n) > 0) n.negate();
  const cos = -incident.dot(n),
    k = 1 - eta * eta * (1 - cos * cos);
  if (k < 0) return null;
  return incident
    .clone()
    .multiplyScalar(eta)
    .addScaledVector(n, eta * cos - Math.sqrt(k))
    .normalize();
}
export function geometryFromMesh(mesh) {
  const g = new T.BufferGeometry();
  g.setAttribute(
    "position",
    new T.BufferAttribute(new Float32Array(mesh.positions), 3),
  );
  if (mesh.indices)
    g.setIndex(new T.BufferAttribute(new Uint32Array(mesh.indices), 1));
  if (mesh.scale && mesh.scale !== 1)
    g.scale(mesh.scale, mesh.scale, mesh.scale);
  g.computeBoundingBox();
  return g;
}
export function prepareMesh(mesh) {
  const geometry = geometryFromMesh(mesh),
    bvh = new MeshBVH(geometry, { maxLeafTris: 8, indirect: true });
  const p = mesh.positions,
    indices = mesh.indices,
    faceCount = (indices?.length || p.length / 3) / 3,
    normals = new Float64Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const a = (indices ? indices[f * 3] : f * 3) * 3,
      b = (indices ? indices[f * 3 + 1] : f * 3 + 1) * 3,
      c = (indices ? indices[f * 3 + 2] : f * 3 + 2) * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2],
      vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      len = Math.hypot(nx, ny, nz) || 1;
    normals[f * 3] = nx / len;
    normals[f * 3 + 1] = ny / len;
    normals[f * 3 + 2] = nz / len;
  }
  return { geometry, bvh, normals, bounds: geometry.boundingBox.clone() };
}
const halton = (n, b) => {
  let f = 1,
    r = 0;
  while (n > 0) {
    f /= b;
    r += f * (n % b);
    n = Math.floor(n / b);
  }
  return r;
};
const hash = (n) => {
  n = n ^ 61 ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
};

export function traceSetup(s, bounds, options = {}) {
  const inv = quaternion(s.lens.rotation).invert(),
    lens = vec(s.lens.position);
  const local = (p) => vec(p).sub(lens).applyQuaternion(inv);
  const light = local(s.light.position),
    incoming = direction(s).applyQuaternion(inv),
    center = local(s.target.position);
  const axes = [
      axis(s.target, 0).applyQuaternion(inv),
      axis(s.target, 1).applyQuaternion(inv),
    ],
    normal = new T.Vector3().crossVectors(...axes).normalize();
  const z =
      bounds.max.z + Math.max(bounds.max.distanceTo(bounds.min) * 1e-6, 1e-6),
    point = s.light.type === "point";
  const angularDiameter =
      options.finiteSource === false
        ? 0
        : (s.light.angularDiameter ?? SUN_DIAMETER_DEG),
    angularRadius = Math.tan((angularDiameter * Math.PI) / 360),
    angularU = vec(Math.abs(incoming.x) < 0.9 ? [1, 0, 0] : [0, 1, 0])
      .cross(incoming)
      .normalize(),
    angularV = incoming.clone().cross(angularU);
  if (
    !point &&
    -incoming.z <= Math.sin((angularDiameter * Math.PI) / 360) + 1e-7
  )
    throw new Error("光源范围内有光线从背面入射，请减小视直径或入射角。");
  const lo = [Infinity, Infinity],
    hi = [-Infinity, -Infinity];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const zz of [bounds.min.z, bounds.max.z]) {
        const p = vec([x, y, zz]),
          d = point ? p.clone().sub(light).normalize() : incoming;
        if (Math.abs(d.z) < 1e-7)
          throw new Error("入射光接近与透镜平行，无法追迹");
        p.addScaledVector(d, (z - p.z) / d.z);
        lo[0] = Math.min(lo[0], p.x);
        lo[1] = Math.min(lo[1], p.y);
        hi[0] = Math.max(hi[0], p.x);
        hi[1] = Math.max(hi[1], p.y);
      }
  if (!point && angularRadius > 0) {
    // Conservative launch-plane coverage for all directions in the solar disk.
    const minCos =
        -incoming.z * Math.cos((angularDiameter * Math.PI) / 360) -
        Math.sqrt(Math.max(0, 1 - incoming.z ** 2)) *
          Math.sin((angularDiameter * Math.PI) / 360),
      margin =
        ((z - bounds.min.z) * angularRadius * 2) /
        Math.max(minCos * minCos, 1e-8);
    for (let k = 0; k < 2; k++) {
      lo[k] -= margin;
      hi[k] += margin;
    }
  }
  const sourceNormal = light.clone().normalize(),
    sourceU = new T.Vector3()
      .crossVectors(
        sourceNormal,
        Math.abs(sourceNormal.x) < 0.9 ? vec([1, 0, 0]) : vec([0, 1, 0]),
      )
      .normalize(),
    sourceV = new T.Vector3().crossVectors(sourceNormal, sourceU);
  return {
    light,
    incoming,
    center,
    axes,
    normal,
    lo,
    hi,
    z,
    point,
    sourceU,
    sourceV,
    angularDiameter,
    angularRadius,
    angularU,
    angularV,
    epsilon: Math.max(bounds.max.distanceTo(bounds.min) * 2e-7, 1e-7),
    height: s.target.height * s.target.boardFactor,
    width: s.target.width * s.target.boardFactor,
    size: options.size || 384,
    samples: options.samples || 100000,
    n: s.lens.n,
    reflect: s.reflect,
    diameter: options.finiteSource === false ? 0 : s.light.diameter,
    boardFactor: s.target.boardFactor,
  };
}

export function createTrace(prepared, s, options = {}) {
  const cfg = traceSetup(s, prepared.bounds, options);
  return {
    prepared,
    cfg,
    raster: new Float64Array(cfg.size * cfg.size),
    segments: [],
    done: 0,
    entered: 0,
    landed: 0,
    tir: 0,
    unresolved: 0,
    incidentPower: 0,
    boardPower: 0,
    imagePower: 0,
  };
}

export function traceBatch(job, count = 8192) {
  const { cfg: c, prepared: p } = job,
    ray = new T.Ray(),
    end = Math.min(job.done + count, c.samples);
  for (let i = job.done; i < end; i++) {
    const seed = i + 1,
      e = vec([
        c.lo[0] + halton(seed, 2) * (c.hi[0] - c.lo[0]),
        c.lo[1] + halton(seed, 3) * (c.hi[1] - c.lo[1]),
        c.z,
      ]);
    let power = 1;
    if (c.point) {
      const r = (Math.sqrt(hash(seed * 2)) * c.diameter) / 2,
        a = hash(seed * 2 + 1) * Math.PI * 2;
      ray.origin
        .copy(c.light)
        .addScaledVector(c.sourceU, r * Math.cos(a))
        .addScaledVector(c.sourceV, r * Math.sin(a));
      ray.direction.copy(e).sub(ray.origin);
      const d2 = ray.direction.lengthSq();
      ray.direction.normalize();
      power = Math.max(0, -ray.direction.z) / d2;
    } else {
      ray.direction.copy(c.incoming);
      if (c.angularRadius > 0) {
        const r = Math.sqrt(hash(seed * 2)) * c.angularRadius,
          a = hash(seed * 2 + 1) * Math.PI * 2;
        ray.direction
          .addScaledVector(c.angularU, r * Math.cos(a))
          .addScaledVector(c.angularV, r * Math.sin(a))
          .normalize();
      }
      ray.origin.copy(e).addScaledVector(ray.direction, -c.epsilon * 4);
      power = Math.max(0, -ray.direction.z);
    }
    let hit = p.bvh.raycastFirst(ray, T.DoubleSide, c.epsilon);
    if (!hit) continue;
    job.entered++;
    job.incidentPower += power;
    const collect =
      job.segments.length < 40 &&
      i % Math.max(1, Math.floor(c.samples / 100)) === 0;
    const path = collect
      ? [ray.origin.clone().toArray(), hit.point.toArray()]
      : null;
    let inside = false,
      arrived = false;
    for (let bounce = 0; bounce < 12; bounce++) {
      const n = new T.Vector3().fromArray(p.normals, hit.faceIndex * 3),
        entering = ray.direction.dot(n) < 0;
      let outgoing;
      if (c.reflect) {
        outgoing = ray.direction.clone().reflect(n);
        inside = false;
      } else {
        outgoing = refract(ray.direction, n, entering ? 1 / c.n : c.n);
        if (!outgoing) {
          outgoing = ray.direction.clone().reflect(n);
          job.tir++;
        } else inside = entering;
      }
      ray.origin.copy(hit.point).addScaledVector(outgoing, c.epsilon * 2);
      ray.direction.copy(outgoing);
      const next = p.bvh.raycastFirst(ray, T.DoubleSide, c.epsilon);
      const den = ray.direction.dot(c.normal),
        distance =
          Math.abs(den) > 1e-12
            ? c.center.clone().sub(ray.origin).dot(c.normal) / den
            : -1;
      if (!inside && distance > 0 && (!next || distance < next.distance)) {
        const landing = ray.at(distance, new T.Vector3()),
          uv = landing.clone().sub(c.center),
          row = uv.dot(c.axes[0]) / c.height + 0.5,
          col = uv.dot(c.axes[1]) / c.width + 0.5;
        if (row >= 0 && row < 1 && col >= 0 && col < 1) {
          job.boardPower += power;
          job.landed++;
          if (
            Math.abs(row - 0.5) < 0.5 / c.boardFactor &&
            Math.abs(col - 0.5) < 0.5 / c.boardFactor
          )
            job.imagePower += power;
          const x = col * c.size - 0.5,
            y = row * c.size - 0.5,
            ix = Math.floor(x),
            iy = Math.floor(y),
            dx = x - ix,
            dy = y - iy;
          for (const [ox, oy, w] of [
            [0, 0, (1 - dx) * (1 - dy)],
            [1, 0, dx * (1 - dy)],
            [0, 1, (1 - dx) * dy],
            [1, 1, dx * dy],
          ]) {
            const xx = ix + ox,
              yy = iy + oy;
            if (xx >= 0 && xx < c.size && yy >= 0 && yy < c.size)
              job.raster[yy * c.size + xx] += power * w;
          }
        }
        if (path) {
          path.push(landing.toArray());
          job.segments.push(path);
        }
        arrived = true;
        break;
      }
      if (!next) {
        arrived = true;
        break;
      }
      hit = next;
      if (path) path.push(hit.point.toArray());
    }
    if (!arrived) job.unresolved++;
  }
  job.done = end;
  return end / c.samples;
}
export function finishTrace(job) {
  const total = Math.max(job.incidentPower, 1e-30);
  return {
    size: job.cfg.size,
    raster: Float32Array.from(job.raster, (n) => n / total),
    segments: job.segments,
    stats: {
      sampled: job.done,
      entered: job.entered,
      landed: job.landed,
      imageFraction: job.imagePower / total,
      boardFraction: job.boardPower / total,
      tirEvents: job.tir,
      unresolved: job.unresolved,
      sourceDiameterMM: job.cfg.point ? job.cfg.diameter : 0,
      sourceAngularDiameterDeg: job.cfg.point ? 0 : job.cfg.angularDiameter,
    },
  };
}
export function traceMesh(prepared, state, options = {}) {
  const job = createTrace(prepared, state, options);
  while (job.done < job.cfg.samples) traceBatch(job);
  return finishTrace(job);
}
