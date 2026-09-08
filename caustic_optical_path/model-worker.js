import { parseOBJ } from "./mesh-io.js";
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
      chunks = result.meshes.map((m) => ({
        positions: m.attributes.position.array,
        index: m.index.array,
      }));
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
    self.postMessage(
      { type: "result", id, name, positions, indices, flipped: volume < 0 },
      [positions.buffer, indices.buffer],
    );
  } catch (error) {
    self.postMessage({ type: "error", id, message: error.message });
  }
};
