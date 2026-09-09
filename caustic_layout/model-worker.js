import { parseOBJ, alignEntrance } from "./mesh-io.js";
import { triangleMask } from "./mesh-raster.js";
import { parseCausticStepMeshData } from "./step-mesh.js";
let occtPromise;
self.onmessage = async ({ data }) => {
  const { name, bytes, id } = data;
  try {
    let chunks = [];
    if (/\.obj$/i.test(name)) {
      const parsed = parseOBJ(new TextDecoder().decode(bytes));
      chunks = [{ positions: parsed.positions, index: parsed.indices }];
    } else {
      self.postMessage({ id, type: "progress", text: "正在读取 STEP 曲面…" });
      try {
        const parsed = parseCausticStepMeshData(bytes);
        chunks = [{ positions: parsed.positions, index: parsed.indices }];
      } catch {
        // General CAD remains supported; the optical height-field reader above
        // avoids OCCT dropping the very large spline face in lens exports.
      }
      if (!chunks.length) {
        occtPromise ??= import("./vendor/occt-import-js.js").then(
          ({ default: init }) =>
            init({
              locateFile: (file) =>
                new URL(`./vendor/${file}`, import.meta.url).href,
            }),
        );
        const occt = await occtPromise;
        const result = occt.ReadStepFile(new Uint8Array(bytes), {
          linearUnit: "millimeter",
          linearDeflectionType: "bounding_box_ratio",
          linearDeflection: 0.0003,
          angularDeflection: 0.15,
        });
        if (!result.success || !result.meshes?.length)
          throw new Error("无法解析 STEP 实体");
        if (result.meshes.some((m) => m.brep_faces?.some((f) => f.last < f.first)))
          throw new Error("STEP 中有曲面未能转换，请重新导出 STEP，或改用 OBJ。");
        chunks = result.meshes.map((m) => ({
          positions: m.attributes.position.array,
          index: m.index.array,
        }));
      }
    }
    let vertexCount = 0,
      indexCount = 0;
    for (const chunk of chunks) {
      vertexCount += chunk.positions.length / 3;
      indexCount += chunk.index?.length ?? chunk.positions.length / 3;
    }
    if (!indexCount || indexCount % 3)
      throw new Error("文件中没有有效的三角网格");
    if (indexCount / 3 > 2500000)
      throw new Error("模型超过 250 万个三角面，请降低导出网格分辨率");
    const positions = new Float64Array(vertexCount * 3),
      indices = new Uint32Array(indexCount);
    let v = 0,
      k = 0;
    for (const c of chunks) {
      positions.set(c.positions, v * 3);
      if (c.index) for (const n of c.index) indices[k++] = v + n;
      else
        for (let j = 0; j < c.positions.length / 3; j++) indices[k++] = v + j;
      v += c.positions.length / 3;
    }
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      volume +=
        positions[a] *
          (positions[b + 1] * positions[c + 2] -
            positions[b + 2] * positions[c + 1]) +
        positions[a + 1] *
          (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
        positions[a + 2] *
          (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
    }
    if (!positions.every(Number.isFinite))
      throw new Error("模型坐标含无效数值");
    if (volume < 0)
      for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    self.postMessage({ id, type: "progress", text: "正在准备轮廓…" });
    const aligned = alignEntrance(positions, indices, 1);
    const longest = Math.max(aligned.width, aligned.height);
    const width = Math.max(1, Math.round(700 * aligned.width / longest));
    const height = Math.max(1, Math.round(700 * aligned.height / longest));
    const mask = triangleMask(
      aligned.positions, aligned.cap, width, height, aligned.height, aligned.width,
    );
    self.postMessage(
      { type: "result", id, name, positions, indices, mask,
        maskWidth: width, maskHeight: height, flipped: volume < 0 },
      [positions.buffer, indices.buffer, mask.buffer],
    );
  } catch (error) {
    self.postMessage({ type: "error", id, message: error.message });
  }
};
