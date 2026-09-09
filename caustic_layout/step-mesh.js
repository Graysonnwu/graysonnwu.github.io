// The caustic STEP reader shared in origin with assets/CausticStepLoader.js.
// Evaluate the actual spline knots, then close the trimmed surface with its
// planar entrance and side walls. Other CAD geometries use the OCCT fallback.
const STEP_ASSIGNMENT_RE = /#(\d+)\s*=\s*/g;
const STEP_REF_RE = /#(\d+)/g;

const DEFAULT_MAX_GRID_SIDE = 720;

export function parseCausticStepMeshData(payload, options = {}) {
  const text = decodeStepText(payload);
  const parsed = parseStepEntities(text);
  const opticalSurface = selectOpticalSurface(parsed.surfaces);
  const sideSurfaces = selectSideSurfaces(parsed.surfaces, opticalSurface);
  const sideInfo = extractSideLoops(sideSurfaces, parsed.points);
  // otmap writes canonical circles as two analytic half-cylinders instead of
  // the ruled B-spline side wall used by its other aperture shapes.
  const polygons = sideInfo.polygons.length
    ? sideInfo.polygons
    : extractCircularLoops(parsed.cylinders, parsed.axes, parsed.points, opticalSurface);
  const frontZ = inferFrontZ(sideInfo, parsed, opticalSurface);
  if (!polygons.length || parsed.planes.length !== 1) {
    throw new Error('STEP is not a trimmed planar-entrance caustic solid');
  }

  return buildTrimmedGridMesh(opticalSurface, parsed.points, polygons, frontZ, options);
}

function decodeStepText(payload) {
  if (typeof payload === 'string') return payload;
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return new TextDecoder().decode(bytes);
}

function parseStepEntities(text) {
  const points = new Map();
  const surfaces = [];
  const planes = [];
  const cylinders = [];
  const axes = new Map();
  let match;

  STEP_ASSIGNMENT_RE.lastIndex = 0;
  while ((match = STEP_ASSIGNMENT_RE.exec(text))) {
    const id = Number(match[1]);
    const bodyStart = STEP_ASSIGNMENT_RE.lastIndex;
    const bodyEnd = findEntityEnd(text, bodyStart);
    const body = text.slice(bodyStart, bodyEnd).trim();
    STEP_ASSIGNMENT_RE.lastIndex = bodyEnd + 1;

    if (body.startsWith('CARTESIAN_POINT')) {
      const point = parseCartesianPoint(body);
      if (point) points.set(id, point);
    } else if (body.startsWith('B_SPLINE_SURFACE_WITH_KNOTS')) {
      const surface = parseBSplineSurface(id, body);
      if (surface) surfaces.push(surface);
    } else if (body.startsWith('AXIS2_PLACEMENT_3D')) {
      const refs = parseStepRefs(body);
      if (refs.length) axes.set(id, refs[0]);
    } else if (body.startsWith('PLANE')) {
      const refs = parseStepRefs(body);
      if (refs.length) planes.push({ id, axisId: refs[0] });
    } else if (body.startsWith('CYLINDRICAL_SURFACE')) {
      const cylinder = parseCylindricalSurface(id, body);
      if (cylinder) cylinders.push(cylinder);
    }
  }

  return { points, surfaces, planes, cylinders, axes };
}

function findEntityEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      if (inString && text[i + 1] === "'") {
        i += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      } else if (char === ';' && depth === 0) {
        return i;
      }
    }
  }
  return text.length;
}

function parseCartesianPoint(body) {
  // Restrict parsing to the coordinate tuple; point names may contain numbers.
  const coordinates = body.match(/,\s*\(([^()]*)\)\s*\)$/);
  if (!coordinates) return null;
  const tokens = coordinates[1].split(',').map((value) => value.trim());
  if (tokens.length !== 2 && tokens.length !== 3) return null;
  const values = tokens.map((value) => value ? Number(value) : NaN);
  if (!values.every(Number.isFinite)) return null;
  return [values[0], values[1], values[2] ?? 0];
}

function parseBSplineSurface(id, body) {
  const header = body.match(/^B_SPLINE_SURFACE_WITH_KNOTS\s*\([^,]*,\s*(\d+)\s*,\s*(\d+)\s*,/);
  if (!header) return null;

  let poleStart = header[0].length;
  while (/\s/.test(body[poleStart])) poleStart += 1;
  if (body[poleStart] !== '(') return null;

  const poleBlock = readBalancedContent(body, poleStart);
  const rows = parseSurfacePoleRows(poleBlock.content);
  if (!rows.length || !rows[0].length) return null;
  if (!rows.every((row) => row.length === rows[0].length)) throw new Error('STEP surface has inconsistent pole rows');
  const knotLists = Array.from(body.slice(poleBlock.end + 1).matchAll(/\(([^()]*)\)/g), (match) => (
    match[1].split(',').map((value) => value.trim() ? Number(value) : NaN)
  ));
  if (knotLists.length !== 4) throw new Error('STEP surface is missing its knot vectors');
  const uDegree = Number(header[1]);
  const vDegree = Number(header[2]);

  return {
    id,
    uDegree,
    vDegree,
    uKnots: expandSurfaceKnots(knotLists[2], knotLists[0], rows.length, uDegree),
    vKnots: expandSurfaceKnots(knotLists[3], knotLists[1], rows[0].length, vDegree),
    rows,
    rowCount: rows.length,
    columnCount: rows[0].length
  };
}

function expandSurfaceKnots(values, multiplicities, poleCount, degree) {
  if (values.length !== multiplicities.length || values.length < 2) throw new Error('Invalid STEP knot vector');
  const knots = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const count = multiplicities[i];
    if (!Number.isFinite(value) || (i > 0 && value <= values[i - 1]) ||
        !Number.isInteger(count) || count < 1 || count > degree + 1) {
      throw new Error('Invalid STEP knot value or multiplicity');
    }
    for (let j = 0; j < count; j += 1) knots.push(value);
  }
  if (knots.length !== poleCount + degree + 1 || !(knots[poleCount] > knots[degree])) {
    throw new Error('STEP knot vector does not match its control points');
  }
  return knots;
}

function makeSplineBasisSamples(knots, degree, poleCount, sampleCount) {
  const samples = [];
  const start = knots[degree];
  const end = knots[poleCount];
  let span = degree;
  for (let i = 0; i < sampleCount; i += 1) {
    const parameter = start + (end - start) * i / (sampleCount - 1);
    while (span < poleCount - 1 && parameter >= knots[span + 1]) span += 1;
    const weights = new Float64Array(degree + 1);
    const left = new Float64Array(degree + 1);
    const right = new Float64Array(degree + 1);
    weights[0] = 1;
    for (let j = 1; j <= degree; j += 1) {
      left[j] = parameter - knots[span + 1 - j];
      right[j] = knots[span + j] - parameter;
      let saved = 0;
      for (let r = 0; r < j; r += 1) {
        const denominator = right[r + 1] + left[j - r];
        const value = denominator > 0 ? weights[r] / denominator : 0;
        weights[r] = saved + right[r + 1] * value;
        saved = left[j - r] * value;
      }
      weights[j] = saved;
    }
    samples.push({ first: span - degree, weights });
  }
  return samples;
}

function sampleSplineSurface(surface, points, width, height) {
  const uSamples = makeSplineBasisSamples(surface.uKnots, surface.uDegree, surface.rowCount, height);
  const vSamples = makeSplineBasisSamples(surface.vKnots, surface.vDegree, surface.columnCount, width);
  const result = new Float64Array(width * height * 3);
  const rowPositions = new Float64Array(surface.columnCount * 3);
  const poleRows = new Map();
  // Evaluate the tensor product in two passes and reuse each intermediate row.
  for (let y = 0; y < height; y += 1) {
    const u = uSamples[y];
    rowPositions.fill(0);
    for (const index of poleRows.keys()) if (index < u.first) poleRows.delete(index);
    for (let k = 0; k < u.weights.length; k += 1) {
      const rowIndex = u.first + k;
      let row = poleRows.get(rowIndex);
      if (!row) {
        row = new Float64Array(surface.columnCount * 3);
        const refs = surface.rows[rowIndex];
        for (let column = 0; column < surface.columnCount; column += 1) {
          const point = points.get(refs[column]);
          if (!point) throw new Error('STEP surface references a missing point');
          row.set(point, column * 3);
        }
        poleRows.set(rowIndex, row);
      }
      for (let i = 0; i < row.length; i += 1) {
        rowPositions[i] += u.weights[k] * row[i];
      }
    }
    for (let x = 0; x < width; x += 1) {
      const v = vSamples[x];
      const offset = (y * width + x) * 3;
      for (let k = 0; k < v.weights.length; k += 1) {
        const source = (v.first + k) * 3;
        result[offset] += v.weights[k] * rowPositions[source];
        result[offset + 1] += v.weights[k] * rowPositions[source + 1];
        result[offset + 2] += v.weights[k] * rowPositions[source + 2];
      }
    }
  }
  return result;
}

function parseCylindricalSurface(id, body) {
  const match = body.match(
    /^CYLINDRICAL_SURFACE\s*\([^,]*,\s*#(\d+)\s*,\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)\s*\)/
  );
  if (!match) return null;
  const radius = Number(match[2]);
  if (!(radius > 0)) return null;
  return { id, axisId: Number(match[1]), radius };
}

function readBalancedContent(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      if (inString && text[i + 1] === "'") {
        i += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          return { content: text.slice(openIndex + 1, i), end: i };
        }
      }
    }
  }
  throw new Error('STEP surface pole list is not closed');
}

function parseSurfacePoleRows(poleText) {
  const rows = [];
  for (let i = 0; i < poleText.length; i += 1) {
    if (poleText[i] !== '(') continue;
    const row = readBalancedContent(poleText, i);
    const refs = parseStepRefs(row.content);
    if (refs.length) rows.push(refs);
    i = row.end;
  }
  return rows;
}

function parseStepRefs(text) {
  const refs = [];
  let match;
  STEP_REF_RE.lastIndex = 0;
  while ((match = STEP_REF_RE.exec(text))) refs.push(Number(match[1]));
  return refs;
}

function selectOpticalSurface(surfaces) {
  const candidates = surfaces.filter((surface) => (
    surface.uDegree === 3 &&
    surface.vDegree === 3 &&
    surface.rowCount >= 4 &&
    surface.columnCount >= 4
  ));
  if (!candidates.length) {
    throw new Error('STEP file does not contain the expected caustic B-spline surface');
  }
  if (candidates.length !== 1) throw new Error('STEP contains multiple optical surfaces');
  return candidates.reduce((best, surface) => (
    surface.rowCount * surface.columnCount > best.rowCount * best.columnCount ? surface : best
  ));
}

function selectSideSurfaces(surfaces, opticalSurface) {
  return surfaces.filter((surface) => (
    surface !== opticalSurface &&
    surface.rowCount >= 4 &&
    surface.columnCount === 2 &&
    surface.vDegree === 1
  ));
}

function extractSideLoops(sideSurfaces, points) {
  const polygons = [];
  const topZValues = [];

  for (const surface of sideSurfaces) {
    const averages = averageSideColumnZ(surface, points);
    if (!averages) continue;
    const bottomColumn = averages[0] <= averages[1] ? 0 : 1;
    const topColumn = bottomColumn === 0 ? 1 : 0;
    const polygon = [];

    for (const row of surface.rows) {
      const bottom = points.get(row[bottomColumn]);
      const top = points.get(row[topColumn]);
      if (!bottom || !top || Math.hypot(bottom[0]-top[0], bottom[1]-top[1]) > 1e-7 * Math.max(1, Math.abs(top[2]-bottom[2]))) {
        throw new Error('STEP side wall is not a straight XY extrusion');
      }
      if (bottom) polygon.push([bottom[0], bottom[1]]);
      if (top && Number.isFinite(top[2])) topZValues.push(top[2]);
    }

    const cleaned = removeDuplicatePolygonPoints(polygon);
    if (cleaned.length >= 4) polygons.push(cleaned);
  }

  const rectangle = extractAxisAlignedRectangle(polygons);
  return {
    polygons: rectangle ? [rectangle] : polygons,
    frontZ: topZValues.length ? average(topZValues) : NaN
  };
}

function extractAxisAlignedRectangle(curves) {
  if (curves.length !== 4) return null;

  // Rectangle side surfaces retain the full optical isocurve; the ADVANCED_FACE
  // trims it to the intended edge. Its constant coordinate is therefore the
  // reliable rectangle boundary, while its first/last poles can lie outside it.
  const horizontals = [];
  const verticals = [];
  for (const curve of curves) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;
    for (const point of curve) {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
      sumX += point[0];
      sumY += point[1];
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const tolerance = Math.max(spanX, spanY, 1) * 1e-7;
    if (spanX > tolerance && spanY <= tolerance) {
      horizontals.push(sumY / curve.length);
    } else if (spanY > tolerance && spanX <= tolerance) {
      verticals.push(sumX / curve.length);
    } else {
      return null;
    }
  }

  if (horizontals.length !== 2 || verticals.length !== 2) return null;
  const [minY, maxY] = horizontals.sort((a, b) => a - b);
  const [minX, maxX] = verticals.sort((a, b) => a - b);
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY]
  ];
}

function extractCircularLoops(cylinders, axes, points, opticalSurface) {
  const circles = [];
  for (const cylinder of cylinders) {
    const centerId = axes.get(cylinder.axisId);
    const center = points.get(centerId);
    if (!center) continue;
    const duplicate = circles.some((circle) => {
      const scale = Math.max(circle.radius, cylinder.radius, 1);
      const tolerance = scale * 1e-7;
      return Math.abs(circle.radius - cylinder.radius) <= tolerance &&
        squaredDistance2(circle.center, center) <= tolerance * tolerance;
    });
    if (!duplicate) circles.push({ center: [center[0], center[1]], radius: cylinder.radius });
  }

  const sampleCount = Math.min(
    1024,
    Math.max(96, 2 * Math.max(opticalSurface.rowCount, opticalSurface.columnCount))
  );
  return circles.map((circle) => Array.from({ length: sampleCount }, (_, index) => {
    const angle = 2 * Math.PI * index / sampleCount;
    return [
      circle.center[0] + circle.radius * Math.cos(angle),
      circle.center[1] + circle.radius * Math.sin(angle)
    ];
  }));
}

function averageSideColumnZ(surface, points) {
  const sums = [0, 0];
  const counts = [0, 0];
  for (const row of surface.rows) {
    for (let column = 0; column < 2; column += 1) {
      const point = points.get(row[column]);
      if (!point || !Number.isFinite(point[2])) continue;
      sums[column] += point[2];
      counts[column] += 1;
    }
  }
  if (!counts[0] || !counts[1]) return null;
  return [sums[0] / counts[0], sums[1] / counts[1]];
}

function removeDuplicatePolygonPoints(points) {
  const cleaned = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || squaredDistance2(previous, point) > 1e-18) cleaned.push(point);
  }
  if (cleaned.length > 1 && squaredDistance2(cleaned[0], cleaned[cleaned.length - 1]) <= 1e-18) {
    cleaned.pop();
  }
  return cleaned;
}

function squaredDistance2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function inferFrontZ(sideInfo, parsed, opticalSurface) {
  if (Number.isFinite(sideInfo.frontZ)) return sideInfo.frontZ;

  for (const plane of parsed.planes) {
    const pointId = parsed.axes.get(plane.axisId);
    const point = parsed.points.get(pointId);
    if (point && Number.isFinite(point[2])) return point[2];
  }

  let minZ = Infinity;
  let maxZ = -Infinity;
  forEachSurfacePoint(opticalSurface, parsed.points, (point) => {
    minZ = Math.min(minZ, point[2]);
    maxZ = Math.max(maxZ, point[2]);
  });
  const span = Number.isFinite(maxZ - minZ) ? maxZ - minZ : 1;
  return maxZ + Math.max(span * 0.12, 1e-3);
}

function forEachSurfacePoint(surface, points, callback) {
  for (const row of surface.rows) {
    for (const ref of row) {
      const point = points.get(ref);
      if (point) callback(point);
    }
  }
}

function buildTrimmedGridMesh(surface, points, polygons, frontZ, options) {
  const maxGridSide = Math.max(16, Math.floor(options.maxGridSide || DEFAULT_MAX_GRID_SIDE));
  const width = Math.min(maxGridSide, Math.max(17, surface.columnCount));
  const height = Math.min(maxGridSide, Math.max(17, surface.rowCount));
  const total = width * height;
  const sampledPoints = sampleSplineSurface(surface, points, width, height);
  const { rowsAreX } = detectGridAxes(sampledPoints, width, height);
  const tolerance = Math.max(1, Math.abs(sampledPoints.at(-3) - sampledPoints[0]),
    Math.abs(sampledPoints.at(-2) - sampledPoints[1])) * 1e-6;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const a = (rowsAreX ? y * width : x) * 3;
    const b = (rowsAreX ? x : y * width) * 3;
    if (Math.abs(sampledPoints[i] - sampledPoints[a]) > tolerance ||
        Math.abs(sampledPoints[i + 1] - sampledPoints[b + 1]) > tolerance) {
      throw new Error('STEP optical surface is not a planar XY height field');
    }
  }
  const mask = polygons.length
    ? buildScanlineMask(sampledPoints, width, height, polygons)
    : new Uint8Array(total).fill(1);

  const triangles = [];
  const used = new Uint8Array(total);
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const a = y * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      if (mask[a] && mask[b] && mask[c]) {
        triangles.push(a, b, c);
        used[a] = used[b] = used[c] = 1;
      }
      if (mask[c] && mask[b] && mask[d]) {
        triangles.push(c, b, d);
        used[c] = used[b] = used[d] = 1;
      }
    }
  }

  if (!triangles.length) {
    throw new Error('STEP trim boundary removed the entire surface');
  }

  const oldToNew = new Int32Array(total);
  oldToNew.fill(-1);
  const newToOld = [];
  for (let i = 0; i < total; i += 1) {
    if (used[i]) {
      oldToNew[i] = newToOld.length;
      newToOld.push(i);
    }
  }

  const vertexCount = newToOld.length;
  const positions = [];
  for (const oldIndex of newToOld) {
    const offset = oldIndex * 3;
    positions.push(sampledPoints[offset], sampledPoints[offset + 1], sampledPoints[offset + 2]);
  }
  for (const oldIndex of newToOld) {
    const offset = oldIndex * 3;
    positions.push(sampledPoints[offset], sampledPoints[offset + 1], frontZ);
  }

  const indices = [];
  const edgeCounts = new Map();
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i];
    let b = triangles[i + 1];
    let c = triangles[i + 2];
    const ax = sampledPoints[a * 3];
    const ay = sampledPoints[a * 3 + 1];
    const normalZ = (sampledPoints[b * 3] - ax) * (sampledPoints[c * 3 + 1] - ay) -
      (sampledPoints[b * 3 + 1] - ay) * (sampledPoints[c * 3] - ax);
    const toFront = frontZ - (sampledPoints[a * 3 + 2] + sampledPoints[b * 3 + 2] + sampledPoints[c * 3 + 2]) / 3;
    if (normalZ * toFront > 0) [b, c] = [c, b];
    const na = oldToNew[a];
    const nb = oldToNew[b];
    const nc = oldToNew[c];
    indices.push(na, nb, nc);
    indices.push(na + vertexCount, nc + vertexCount, nb + vertexCount);
    addBoundaryEdge(edgeCounts, a, b);
    addBoundaryEdge(edgeCounts, b, c);
    addBoundaryEdge(edgeCounts, c, a);
  }

  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    const a = oldToNew[edge.a];
    const b = oldToNew[edge.b];
    if (a < 0 || b < 0) continue;
    const capA = a + vertexCount;
    const capB = b + vertexCount;
    indices.push(capA, b, a, capA, capB, b);
  }

  return {
    positions: new Float64Array(positions),
    indices: makeIndexArray(indices, vertexCount * 2),
    sourceGrid: `${surface.columnCount}x${surface.rowCount}`,
    sampleGrid: `${width}x${height}`
  };
}

function buildScanlineMask(points, width, height, polygons) {
  const mask = new Uint8Array(width * height);
  const axes = detectGridAxes(points, width, height);

  if (axes.rowsAreX) {
    const sampleXs = new Float64Array(height);
    const sampleYs = new Float64Array(width);
    for (let y = 0; y < height; y += 1) {
      sampleXs[y] = points[y * width * 3];
    }
    for (let x = 0; x < width; x += 1) {
      sampleYs[x] = points[x * 3 + 1];
    }
    for (let x = 0; x < width; x += 1) {
      const intersections = scanlineIntersections(polygons, sampleYs[x]);
      if (intersections.length < 2) continue;
      for (let y = 0; y < height; y += 1) {
        if (isXInsideIntersections(sampleXs[y], intersections)) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  for (let y = 0; y < height; y += 1) {
    const intersections = scanlineIntersections(polygons, points[y * width * 3 + 1]);
    if (intersections.length < 2) continue;

    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (isXInsideIntersections(points[(rowOffset + x) * 3], intersections)) {
        mask[rowOffset + x] = 1;
      }
    }
  }

  return mask;
}

function detectGridAxes(points, width, height) {
  const lastColumn = (width - 1) * 3;
  const lastRow = (height - 1) * width * 3;
  const rowDx = Math.abs(points[lastColumn] - points[0]);
  const rowDy = Math.abs(points[lastColumn + 1] - points[1]);
  const columnDx = Math.abs(points[lastRow] - points[0]);
  const columnDy = Math.abs(points[lastRow + 1] - points[1]);
  return { rowsAreX: columnDx > columnDy && rowDy > rowDx };
}

function scanlineIntersections(polygons, scanY) {
  const intersections = [];
  for (const polygon of polygons) appendScanlineIntersections(intersections, polygon, scanY);
  intersections.sort((a, b) => a - b);
  return intersections;
}

function isXInsideIntersections(sampleX, intersections) {
  for (let i = 0; i < intersections.length - 1; i += 2) {
    if (sampleX >= intersections[i] && sampleX <= intersections[i + 1]) return true;
  }
  return false;
}

function appendScanlineIntersections(intersections, polygon, scanY) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    const ay = a[1];
    const by = b[1];
    if ((ay > scanY) === (by > scanY)) continue;
    const t = (scanY - ay) / (by - ay);
    intersections.push(a[0] + t * (b[0] - a[0]));
  }
}

function addBoundaryEdge(edgeCounts, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const key = `${min}:${max}`;
  const edge = edgeCounts.get(key);
  if (edge) {
    edge.count += 1;
  } else {
    edgeCounts.set(key, { a, b, count: 1 });
  }
}

function makeIndexArray(indices, vertexCount) {
  return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

function average(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
