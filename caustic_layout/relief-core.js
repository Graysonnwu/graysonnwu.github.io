// Small transport solve for preparation previews. This fixed-entrance cost is
// not OTMap's thickness-coupled GJE and cannot certify manufacturing thickness.
export function sampleRelief(result, x, y) {
  const { points, heights, gradients, domain, grid, lookup } = result;
  const row = ((x - domain.center[0]) / domain.size) * grid + grid / 2 - 0.5,
    col = ((y - domain.center[1]) / domain.size) * grid + grid / 2 - 0.5;
  let sum = 0,
    weight = 0;
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      const r = Math.max(0, Math.min(grid - 1, Math.floor(row) + dr)),
        c = Math.max(0, Math.min(grid - 1, Math.floor(col) + dc)),
        i = lookup[r * grid + c];
      if (i < 0) continue;
      const w =
        (dr ? row - Math.floor(row) : 1 - row + Math.floor(row)) *
        (dc ? col - Math.floor(col) : 1 - col + Math.floor(col));
      sum +=
        w *
        (heights[i] +
          gradients[2 * i] * (x - points[2 * i]) +
          gradients[2 * i + 1] * (y - points[2 * i + 1]));
      weight += w;
    }
  if (weight > 1e-10) return sum / weight;
  let best = 0,
    distance = Infinity;
  for (let i = 0; i < heights.length; i++) {
    const d = (x - points[2 * i]) ** 2 + (y - points[2 * i + 1]) ** 2;
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return (
    heights[best] +
    gradients[2 * best] * (x - points[2 * best]) +
    gradients[2 * best + 1] * (y - points[2 * best + 1])
  );
}
const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
const norm = (v) => {
  const d = Math.hypot(...v);
  return v.map((x) => x / d);
};

export function estimateRelief(input) {
  const started = performance.now(),
    { source, target, grid, domain, light, reflect, index, contours } = input;
  if (!source.length || !target.length)
    return { valid: false, reason: "empty" };
  const N = source.length,
    M = target.length,
    points = new Float64Array(N * 2),
    a = new Float64Array(N),
    b = new Float64Array(M),
    rays = [];
  const lookup = new Int32Array(grid * grid).fill(-1);
  for (let i = 0; i < N; i++) {
    const [x, y, area, cell] = source[i];
    points[2 * i] = x;
    points[2 * i + 1] = y;
    lookup[cell] = i;
    const ext = light.point
      ? norm([x - light.position[0], y - light.position[1], -light.position[2]])
      : light.direction;
    const d = light.point
      ? Math.hypot(
          x - light.position[0],
          y - light.position[1],
          light.position[2],
        )
      : 1;
    a[i] = (area * Math.max(0, -ext[2])) / (d * d);
    rays.push(
      reflect
        ? ext
        : [
            ext[0] / index,
            ext[1] / index,
            -Math.sqrt(1 - (ext[0] ** 2 + ext[1] ** 2) / (index * index)),
          ],
    );
  }
  const total = a.reduce((x, y) => x + y, 0),
    energy = target.reduce((v, p) => v + p[3], 0);
  if (!(total > 0 && energy > 0) || a.some((v) => !(v > 0)))
    return { valid: false, reason: "unlit" };
  for (let i = 0; i < N; i++) a[i] /= total;
  for (let j = 0; j < M; j++) b[j] = target[j][3] / energy;
  const cost = new Float64Array(N * M),
    rowMin = new Float64Array(N).fill(Infinity),
    colMin = new Float64Array(M).fill(Infinity);
  let distance = 0;
  for (let j = 0; j < M; j++)
    distance +=
      b[j] *
      Math.hypot(
        target[j][0] - domain.center[0],
        target[j][1] - domain.center[1],
        target[j][2],
      );
  const scale =
    (domain.size * input.targetSpan) / Math.max(domain.size * 0.05, distance);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const d = Math.hypot(
        points[2 * i] - target[j][0],
        points[2 * i + 1] - target[j][1],
        target[j][2],
      );
      cost[i * M + j] = d;
      colMin[j] = Math.min(colMin[j], d);
    }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      cost[i * M + j] -= colMin[j];
      rowMin[i] = Math.min(rowMin[i], cost[i * M + j]);
    }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++)
      cost[i * M + j] = (cost[i * M + j] - rowMin[i]) / scale;
  const f = new Float64Array(N),
    g = new Float64Array(M),
    loga = a.map(Math.log),
    logb = b.map(Math.log);
  const epsilons = [0.15, 0.05, 0.015, 0.005, 0.002];
  for (const eps of epsilons)
    for (let iteration = 0; iteration < 160; iteration++) {
      for (let i = 0; i < N; i++) {
        let max = -Infinity;
        for (let j = 0; j < M; j++)
          max = Math.max(max, (g[j] - cost[i * M + j]) / eps);
        let sum = 0;
        for (let j = 0; j < M; j++)
          sum += Math.exp((g[j] - cost[i * M + j]) / eps - max);
        f[i] = eps * (loga[i] - Math.log(sum) - max);
      }
      for (let j = 0; j < M; j++) {
        let max = -Infinity;
        for (let i = 0; i < N; i++)
          max = Math.max(max, (f[i] - cost[i * M + j]) / eps);
        let sum = 0;
        for (let i = 0; i < N; i++)
          sum += Math.exp((f[i] - cost[i * M + j]) / eps - max);
        g[j] = eps * (logb[j] - Math.log(sum) - max);
      }
    }
  let massL1 = 0,
    nonphysical = 0;
  const gradients = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    let mass = 0;
    const y = [0, 0, 0];
    for (let j = 0; j < M; j++) {
      const p = Math.exp((f[i] + g[j] - cost[i * M + j]) / 0.002);
      mass += p;
      for (let axis = 0; axis < 3; axis++) y[axis] += p * target[j][axis];
    }
    massL1 += Math.abs(mass - a[i]);
    const u = norm([
      y[0] / mass - points[2 * i],
      y[1] / mass - points[2 * i + 1],
      y[2] / mass,
    ]);
    const normal = rays[i].map((s, k) => (reflect ? 1 : index) * s - u[k]);
    if (
      (!reflect && dot(rays[i], u) < 1 / index) ||
      Math.abs(normal[2]) / Math.hypot(...normal) < 0.02
    )
      nonphysical += a[i];
    gradients[2 * i] = -normal[0] / normal[2];
    gradients[2 * i + 1] = -normal[1] / normal[2];
  }
  if (massL1 > 0.02 || nonphysical > 1e-4 || !gradients.every(Number.isFinite))
    return {
      valid: false,
      reason: nonphysical ? "optical-branch" : "transport",
      massL1,
      nonphysical,
    };
  const edges = [],
    rhs = new Float64Array(N),
    neighbors = Array.from({ length: N }, () => []);
  for (let cell = 0; cell < lookup.length; cell++) {
    const i = lookup[cell];
    if (i < 0) continue;
    for (const next of [
      cell % grid < grid - 1 ? cell + 1 : -1,
      cell + grid < lookup.length ? cell + grid : -1,
    ]) {
      const j = next < 0 ? -1 : lookup[next];
      if (j < 0) continue;
      const d =
        ((gradients[2 * i] + gradients[2 * j]) *
          (points[2 * j] - points[2 * i]) +
          (gradients[2 * i + 1] + gradients[2 * j + 1]) *
            (points[2 * j + 1] - points[2 * i + 1])) /
        2;
      edges.push([i, j, d]);
      rhs[i] -= d;
      rhs[j] += d;
      neighbors[i].push(j);
      neighbors[j].push(i);
    }
  }
  const visited = new Set([0]),
    queue = [0];
  for (let k = 0; k < queue.length; k++)
    for (const j of neighbors[queue[k]])
      if (!visited.has(j)) {
        visited.add(j);
        queue.push(j);
      }
  if (visited.size !== N)
    return { valid: false, reason: "disconnected", massL1 };
  const heights = new Float64Array(N),
    r = rhs.slice(),
    p = r.slice(),
    ap = new Float64Array(N);
  let rr = dot(r, r),
    initial = rr;
  for (
    let iteration = 0;
    iteration < N * 3 && rr > Math.max(1e-20, initial * 1e-16);
    iteration++
  ) {
    ap.fill(0);
    for (const [i, j] of edges) {
      const d = p[i] - p[j];
      ap[i] += d;
      ap[j] -= d;
    }
    const den = dot(p, ap);
    if (!(den > 0)) break;
    const alpha = rr / den;
    for (let i = 0; i < N; i++) {
      heights[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
    }
    const next = dot(r, r),
      beta = next / rr;
    for (let i = 0; i < N; i++) p[i] = r[i] + beta * p[i];
    rr = next;
  }
  let error = 0,
    power = 0;
  for (const [i, j, d] of edges) {
    error += (heights[j] - heights[i] - d) ** 2;
    power += d * d;
  }
  const integrationResidual = Math.sqrt(error / Math.max(power, 1e-20));
  if (
    !heights.every(Number.isFinite) ||
    rr > Math.max(1e-12, initial * 1e-8) ||
    integrationResidual > 0.2
  )
    return { valid: false, reason: "integration", massL1, integrationResidual };
  const result = {
    valid: true,
    method: "coarse-ot-snell-integration-v1",
    grid,
    domain,
    lookup,
    points,
    heights,
    gradients,
    massL1,
    integrationResidual,
    nonphysical,
  };
  let min = Math.min(...heights),
    max = Math.max(...heights);
  for (const loop of contours)
    for (const [x, y] of loop) {
      const h = sampleRelief(result, x, y);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  Object.assign(result, {
    min,
    max,
    pvMM: max - min,
    depthRatio: (max - min) / distance,
    caution: integrationResidual > 0.05 || (max - min) / distance > 0.1,
    seconds: (performance.now() - started) / 1000,
  });
  return result;
}
