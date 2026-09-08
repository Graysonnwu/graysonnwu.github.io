const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const MAX_PROJECT_BYTES = 256 * 1024 * 1024;
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function dataURLBytes(url) {
  const raw = atob(url.split(",")[1]);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const safeName = (n) =>
  n.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+/, "") || "image";
const bytes = async (data) =>
  typeof data === "string"
    ? encoder.encode(data)
    : data instanceof Uint8Array
      ? data
      : new Uint8Array(await data.arrayBuffer());
export async function writeZip(entries) {
  const local = [],
    central = [];
  let offset = 0,
    centralSize = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name),
      data = await bytes(entry.data),
      crc = crc32(data);
    const header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 33, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    const c = new Uint8Array(46 + name.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    local.push(header, data);
    central.push(c);
    offset += header.length + data.length;
    centralSize += c.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: "application/zip" });
}
export async function readZip(file) {
  const input = await bytes(file);
  if (input.length > MAX_PROJECT_BYTES) throw new Error("项目包请小于 256 MB");
  const v = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--)
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === input.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ZIP 文件不完整");
  const count = v.getUint16(end + 10, true);
  let cursor = v.getUint32(end + 16, true),
    total = 0;
  const result = new Map();
  if (count > 32) throw new Error("项目包文件数量过多");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || v.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("ZIP 目录无效");
    const flags = v.getUint16(cursor + 8, true),
      method = v.getUint16(cursor + 10, true),
      crc = v.getUint32(cursor + 16, true),
      size = v.getUint32(cursor + 20, true),
      unpacked = v.getUint32(cursor + 24, true),
      n = v.getUint16(cursor + 28, true),
      extra = v.getUint16(cursor + 30, true),
      comment = v.getUint16(cursor + 32, true),
      at = v.getUint32(cursor + 42, true);
    total += unpacked;
    if (total > MAX_PROJECT_BYTES || unpacked > 220 * 1024 * 1024)
      throw new Error("项目包展开后过大");
    const name = decoder.decode(input.subarray(cursor + 46, cursor + 46 + n));
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      result.has(name)
    )
      throw new Error("项目包含无效文件路径");
    if (flags & 1 || ![0, 8].includes(method))
      throw new Error("不支持加密或此压缩方式的 ZIP");
    if (at + 30 > input.length || v.getUint32(at, true) !== 0x04034b50)
      throw new Error("ZIP 文件头无效");
    const start =
      at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    if (start + size > input.length) throw new Error("ZIP 文件被截断");
    let data = input.slice(start, start + size);
    if (method === 8) {
      const reader = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      const parts = [];
      let length = 0;
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.length;
        if (length > unpacked) {
          await reader.cancel();
          throw new Error("ZIP 展开大小不符");
        }
        parts.push(item.value);
      }
      data = new Uint8Array(await new Blob(parts).arrayBuffer());
    }
    if (data.length !== unpacked || crc32(data) !== crc)
      throw new Error("ZIP 文件校验失败");
    result.set(name, data);
    cursor += 46 + n + extra + comment;
  }
  return result;
}
async function sha256(data) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function makeProjectPackage(packet, uploads = {}, workspace = {}) {
  const entries = [
      { name: "optical-path.json", data: JSON.stringify(packet, null, 2) },
    ],
    manifest = {
      format: "caustic-optical-project",
      version: 2,
      configuration: "optical-path.json",
      prepared: {
        source: "prepared/source.png",
        target: "prepared/target.png",
      },
      originals: {},
    };
  for (const kind of ["source", "target"]) {
    entries.push({
      name: `prepared/${kind}.png`,
      data: dataURLBytes(packet.assets[kind].data_url),
    });
    const upload = uploads[kind],
      edit = packet.assets[`${kind}_original`];
    if (upload) {
      const data = await bytes(upload.blob),
        path = `originals/${kind}-${safeName(upload.name)}`;
      entries.push({ name: path, data });
      manifest.originals[kind] = {
        path,
        name: upload.name,
        mime: upload.type || "application/octet-stream",
        original_bytes: true,
        sha256: await sha256(data),
      };
    } else if (edit) {
      const data = dataURLBytes(edit.data_url),
        path = `originals/${kind}-browser-copy.png`;
      entries.push({ name: path, data });
      manifest.originals[kind] = {
        path,
        name: edit.name,
        mime: "image/png",
        original_bytes: false,
        sha256: await sha256(data),
        note: "网页解码后的图像副本，可能已缩小或裁边；未取得上传文件原始字节。",
      };
    }
  }
  // Editable image copies remain inside the OTMap-compatible JSON. Geometry and
  // preview buffers stay binary so a phone need not parse millions of numbers.
  const saved = {
    camera: workspace.camera || null,
    traceQuality: workspace.traceQuality || "standard",
  };
  async function binary(path, data) {
    entries.push({ name: path, data });
    return { path, sha256: await sha256(data) };
  }
  if (workspace.model) {
    const model = workspace.model;
    saved.model = {
      name: model.name,
      scale: model.scale,
      dimensions: model.dimensions,
      unitLabel: model.unitLabel,
      flipped: Boolean(model.flipped),
      positions: await binary(
        "model/positions.f64",
        encodeNumbers(model.positions, "f64"),
      ),
      indices: await binary(
        "model/indices.u32",
        encodeNumbers(model.indices, "u32"),
      ),
    };
    if (model.upload) {
      const file = model.upload;
      saved.model.original = {
        ...(await binary(
          `model/${safeName(file.name)}`,
          await bytes(file.blob),
        )),
        name: file.name,
        mime: file.type || "application/octet-stream",
      };
    }
  }
  if (workspace.trace && workspace.model) {
    const trace = workspace.trace;
    saved.trace = {
      size: trace.size,
      stats: trace.stats,
      raster: await binary(
        "model/trace.f32",
        encodeNumbers(trace.raster, "f32"),
      ),
    };
  }
  entries.push({ name: "workspace.json", data: JSON.stringify(saved) });
  manifest.workspace = "workspace.json";
  entries.push({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });
  const zip = await writeZip(entries);
  if (zip.size > MAX_PROJECT_BYTES)
    throw new Error("项目超过 256 MB，请降低模型网格分辨率后导出");
  return zip;
}
export async function readProjectPackage(file) {
  const entries = await readZip(file),
    m = JSON.parse(
      decoder.decode(entries.get("manifest.json") || new Uint8Array()),
    );
  if (
    m.format !== "caustic-optical-project" ||
    ![1, 2].includes(m.version) ||
    m.configuration !== "optical-path.json"
  )
    throw new Error("请选择本页面导出的光路项目包");
  const packet = JSON.parse(decoder.decode(entries.get(m.configuration))),
    uploads = {};
  for (const kind of ["source", "target"]) {
    const info = m.originals?.[kind];
    if (!info?.original_bytes) continue;
    const data = entries.get(info.path);
    if (!data || (await sha256(data)) !== info.sha256)
      throw new Error("项目包原图校验失败");
    uploads[kind] = {
      name: info.name,
      type: info.mime,
      blob: new Blob([data], { type: info.mime }),
    };
  }
  const workspace = m.workspace
    ? JSON.parse(decoder.decode(entries.get(m.workspace)))
    : {};
  validateCamera(workspace.camera);
  if (
    workspace.traceQuality &&
    !["quick", "standard", "fine"].includes(workspace.traceQuality)
  )
    throw new Error("项目中的追迹设置无效");
  async function binary(info, type) {
    const data = entries.get(info?.path);
    if (!data || (await sha256(data)) !== info.sha256)
      throw new Error("项目模型或追迹数据校验失败");
    return type ? decodeNumbers(data, type) : data;
  }
  if (workspace.model) {
    const meta = workspace.model,
      positions = await binary(meta.positions, "f64"),
      indices = await binary(meta.indices, "u32");
    if (
      !positions.length ||
      positions.length % 3 ||
      !indices.length ||
      indices.length % 3 ||
      indices.length / 3 > 2500000 ||
      !positions.every(Number.isFinite) ||
      !indices.every((i) => i < positions.length / 3) ||
      !(meta.scale > 0 && meta.scale < 1e7) ||
      !Array.isArray(meta.dimensions) ||
      meta.dimensions.length !== 3 ||
      !meta.dimensions.every((n) => Number.isFinite(n) && n > 0)
    )
      throw new Error("项目中的模型几何无效");
    workspace.model = { ...meta, positions, indices };
    if (meta.original)
      workspace.model.upload = {
        name: meta.original.name,
        type: meta.original.mime,
        blob: new Blob([await binary(meta.original)], {
          type: meta.original.mime,
        }),
      };
  }
  if (workspace.trace) {
    const trace = workspace.trace;
    if (
      !workspace.model ||
      !Number.isInteger(trace.size) ||
      trace.size < 1 ||
      trace.size > 2048
    )
      throw new Error("项目中的追迹预览尺寸无效");
    trace.raster = await binary(trace.raster, "f32");
    if (
      trace.raster.length !== trace.size ** 2 ||
      !trace.raster.every((n) => Number.isFinite(n) && n >= 0) ||
      !trace.stats ||
      !Object.values(trace.stats).every(Number.isFinite)
    )
      throw new Error("项目中的追迹预览无效");
  }
  return { packet, uploads, workspace };
}

export function validateCamera(camera) {
  if (!camera) return;
  for (const key of ["position", "target", "up"])
    if (
      !Array.isArray(camera[key]) ||
      camera[key].length !== 3 ||
      !camera[key].every((n) => Number.isFinite(n) && Math.abs(n) < 1e8)
    )
      throw new Error("项目中的视角数据无效");
  if (
    !camera.up.some((n) => Math.abs(n) > 1e-6) ||
    !camera.position.some((n, i) => Math.abs(n - camera.target[i]) > 1e-6) ||
    !["perspective", "target", "side", "lens", "custom"].includes(camera.mode)
  )
    throw new Error("项目中的视角数据无效");
}
function encodeNumbers(values, type) {
  const size = type === "f64" ? 8 : 4,
    data = new Uint8Array(values.length * size),
    view = new DataView(data.buffer),
    method =
      type === "f64"
        ? "setFloat64"
        : type === "f32"
          ? "setFloat32"
          : "setUint32";
  values.forEach((n, i) => view[method](i * size, n, true));
  return data;
}
function decodeNumbers(data, type) {
  const size = type === "f64" ? 8 : 4;
  if (data.byteLength % size) throw new Error("项目中的二进制数据长度无效");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    ArrayType =
      type === "f64"
        ? Float64Array
        : type === "f32"
          ? Float32Array
          : Uint32Array,
    method =
      type === "f64"
        ? "getFloat64"
        : type === "f32"
          ? "getFloat32"
          : "getUint32";
  return ArrayType.from({ length: data.byteLength / size }, (_, i) =>
    view[method](i * size, true),
  );
}

// Keep exact uploads outside JSON/localStorage; match them to the saved editable images.
let database;
async function db() {
  if (!database)
    database = await new Promise((resolve, reject) => {
      const r = indexedDB.open("caustic-optical-originals", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("draft");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return database;
}
export async function saveOriginals(record, key = "active") {
  const d = await db();
  await new Promise((resolve, reject) => {
    const t = d.transaction("draft", "readwrite");
    t.objectStore("draft").put(record, key);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export async function loadOriginals(key = "active") {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction("draft").objectStore("draft").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export function imageFingerprint(canvas) {
  return canvas ? crc32(encoder.encode(canvas.toDataURL())) : 0;
}
