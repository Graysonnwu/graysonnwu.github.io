// Optical normals need the original decimal vertex coordinates. OBJLoader's
// float32 positions are suitable for display, but can change tiny facet slopes.
export function parseOBJ(text) {
  const vertices = [],
    faces = [];
  for (const line of text.split(/\r?\n/)) {
    const words = line.trim().split(/\s+/),
      kind = words.shift();
    if (kind === "v") {
      const v = words.slice(0, 3).map(Number);
      if (v.length !== 3 || !v.every(Number.isFinite))
        throw new Error("OBJ 含无效顶点");
      vertices.push(...v);
    } else if (kind === "f") {
      const polygon = words
        .filter((w) => w && !w.startsWith("#"))
        .map((word) => {
          const index = Number(word.split("/")[0]),
            resolved = index < 0 ? vertices.length / 3 + index : index - 1;
          if (
            !Number.isInteger(index) ||
            !index ||
            resolved < 0 ||
            resolved >= vertices.length / 3
          )
            throw new Error("OBJ 面索引无效");
          return resolved;
        });
      for (let i = 1; i + 1 < polygon.length; i++)
        faces.push(polygon[0], polygon[i], polygon[i + 1]);
    }
  }
  if (!faces.length) throw new Error("OBJ 中没有三角网格");
  return {
    positions: new Float64Array(vertices),
    indices: new Uint32Array(faces),
  };
}
export function alignEntrance(positions, indices, factor) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  const tol = Math.max((hi[2] - lo[2]) * 1e-5, 1e-7),
    frontLo = [Infinity, Infinity],
    frontHi = [-Infinity, -Infinity],
    cap = [];
  for (let i = 0; i < indices.length; i += 3)
    if (
      [0, 1, 2].every(
        (j) => Math.abs(positions[indices[i + j] * 3 + 2] - hi[2]) < tol,
      )
    ) {
      cap.push(indices[i], indices[i + 1], indices[i + 2]);
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 2; k++) {
          const v = positions[indices[i + j] * 3 + k];
          frontLo[k] = Math.min(frontLo[k], v);
          frontHi[k] = Math.max(frontHi[k], v);
        }
    }
  if (!cap.length) {
    // A mirror need not have a flat entrance. Its XY silhouette is the aperture reference.
    for (let i = 0; i < indices.length; i++) cap.push(indices[i]);
    for (let i = 0; i < 2; i++) {
      frontLo[i] = lo[i];
      frontHi[i] = hi[i];
    }
  }
  const frontSize = frontHi.map((v, i) => (v - frontLo[i]) * factor);
  if (!cap.length || frontSize.some((v) => !Number.isFinite(v) || v <= 0))
    throw new Error(
      "模型缺少平面入射面。请将入射面放在 XY 平面，+Z 朝向光源。",
    );
  const center = frontHi.map((v, i) => (v + frontLo[i]) / 2),
    aligned = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    aligned[i] = (positions[i] - center[0]) * factor;
    aligned[i + 1] = (positions[i + 1] - center[1]) * factor;
    aligned[i + 2] = (positions[i + 2] - hi[2]) * factor;
  }
  return {
    positions: aligned,
    cap,
    width: frontSize[1],
    height: frontSize[0],
    centerOffset: center.map((v) => v * factor),
    dimensions: hi.map((v, i) => (v - lo[i]) * factor),
  };
}
