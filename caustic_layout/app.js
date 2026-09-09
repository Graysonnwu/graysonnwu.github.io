import * as T from "./vendor/three.module.min.js";
import { initializeI18n, language } from "./i18n.js";
import { installImageEditor } from "./image-editor.js";
import { defaultAdjustments } from "./image-adjustments.js";
import {
  PRESETS,
  SHAPES,
  defaultState,
  applyPreset,
  setReflection,
  clone,
  metrics,
  makePacket,
  readPacket,
  validateState,
  migrateState,
  syncLensDimensions,
  relativeSetup,
  aimRotation,
} from "./optics.js";
import {
  canvas,
  demoTarget,
  decodeImage,
  cropMask,
  padSquare,
  maskContours,
  sourceCanvas,
  targetCanvas,
  clipTargetCanvas,
  imageAsset,
} from "./images.js";
import { OpticalScene } from "./scene.js";
import { solidShadow } from "./solid-shadow.js";
import {
  surfaceTiltEstimate,
  surfaceThicknessWarning,
} from "./relief-estimate.js";
import { reliefInput } from "./relief-input.js";
import { alignEntrance } from "./mesh-io.js";
import { triangleMask } from "./mesh-raster.js";
import {
  moduleBlock,
  initializeLayout,
  revealInspector,
  icon,
  closeMobilePanels,
  resetLayout,
} from "./ui-layout.js";
import {
  projectFilename,
  canShareProject,
  shareProject,
} from "./project-delivery.js";
import {
  makeProjectPackage,
  readProjectPackage,
  saveOriginals,
  loadOriginals,
  imageFingerprint,
  MAX_PROJECT_BYTES,
} from "./project-package.js";
import {
  apertureLayout,
  shadowLayout,
  matchTargetToShadow,
  constrainedScale,
  lightPivotPose,
  modelIntersectsReceiver,
  worldPoint,
  quaternion,
  degrees,
} from "./layout-geometry.js";

const $ = (id) => document.getElementById(id),
  STORAGE = "caustic-optical-path-v1",
  TEST_MODE = new URLSearchParams(location.search).has("test");
let state = defaultState(),
  sourceOriginal = null,
  sourceUpload = null,
  targetUpload = null,
  targetOriginal = demoTarget(),
  sourceName = "",
  targetName = "示例 · 光",
  source,
  target,
  revision = 0;
let selectionActive = false;
let projectEpoch = 0;
let solidKey = "",
  solidData = null;
let artwork = null, artworkOriginal = null, artworkKey = "";
let selected = "target",
  scene,
  model = null,
  traceResult = null,
  traceWorker,
  modelWorker,
  workerReady = false,
  busy = false,
  traceID = 0,
  importID = 0,
  saveTimer,
  toastTimer,
  dragModelScale = 1,
  lastValidDrag,
  intersectionKey = "",
  intersection = false,
  sourceThumbRevision = -1,
  targetThumbRevision = -1,
  inspectorRenderedAt = 0;
let reliefKey = "",
  reliefResult = null,
  reliefStatus = "pending",
  reliefWorker,
  reliefTimer,
  reliefTimeout,
  reliefID = 0;
function requestRelief() {
  const key = JSON.stringify([
    state.reflect,
    source?.revision,
    target?.revision,
    state.lens.position,
    state.lens.rotation,
    state.lens.n,
    state.light.type,
    state.light.position,
    state.light.rotation,
    state.target.position,
    state.target.rotation,
    state.target.width,
    state.target.height,
    Boolean(model),
  ]);
  if (key === reliefKey) return;
  reliefKey = key;
  const id = ++reliefID;
  clearTimeout(reliefTimer);
  clearTimeout(reliefTimeout);
  reliefWorker?.terminate();
  reliefWorker = null;
  reliefResult = null;
  scene?.setRelief(null);
  reliefStatus = model ? "model" : !target?.energy ? "empty" : "pending";
  if (reliefStatus !== "pending") return;
  reliefTimer = setTimeout(() => {
    try {
      reliefWorker = new Worker(
        new URL("./relief-worker.js", import.meta.url),
        { type: "module" },
      );
      const finish = (result) => {
        if (id !== reliefID) return;
        clearTimeout(reliefTimeout);
        reliefWorker?.terminate();
        reliefWorker = null;
        reliefResult = { ...result, id };
        reliefStatus = result.valid ? "ready" : "unavailable";
        scene?.setRelief(reliefResult);
        render();
      };
      reliefWorker.onmessage = ({ data }) => {
        if (data.id === id) finish(data.result);
      };
      reliefWorker.onerror = () => finish({ valid: false, reason: "worker" });
      reliefTimeout = setTimeout(
        () => finish({ valid: false, reason: "timeout" }),
        12000,
      );
      reliefWorker.postMessage({
        id,
        input: reliefInput(state, source.reliefSamples, target.reliefSamples),
      });
    } catch (error) {
      reliefResult = { valid: false, reason: "worker" };
      reliefStatus = "unavailable";
      render();
    }
  }, 350);
}
const undoStack = [],
  redoStack = [];
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 4200);
}
function error(e) {
  console.error(e);
  toast(e.message || String(e));
}
function snapshot() {
  return {
    state: clone(state),
    sourceOriginal,
    targetOriginal,
    sourceName,
    targetName,
    sourceUpload,
    targetUpload,
    model,
  };
}
function remember() {
  undoStack.push(snapshot());
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
}
function invalidate() {
  traceID++;
  traceWorker?.postMessage({ type: "cancel", id: traceID });
  busy = false;
  traceResult = null;
  scene?.setTrace(null);
  state.view.display = "target";
  $("traceProgress").hidden = true;
  $("cancelTrace").hidden = true;
  $("trace").hidden = false;
  $("traceStatus").textContent = model
    ? "布局已改变，点击追迹更新结果。"
    : "导入后，检查实际曲面在当前光路下的投影。";
}
function bakeSource() {
  if (state.lens.shape === "custom" && sourceOriginal && !state.lens.contours)
    state.lens.contours = maskContours(sourceOriginal);
  source = sourceCanvas(state, sourceOriginal, 384);
  source.revision = ++revision;
}
function getSolidShadow() {
  const t = state.target;
  const key = JSON.stringify([
    state.lens,
    state.reflect,
    state.light,
    t.position,
    t.rotation,
    t.width,
    t.height,
    t.boardFactor,
    model?.revision,
    model?.scale,
  ]);
  if (key !== solidKey) {
    solidData = solidShadow(state, model);
    solidKey = key;
  }
  return solidData;
}
function getPatternBoundary() {
  return state.reflect ? shadowLayout(state) : getSolidShadow();
}
function bakeTarget(size = 700) {
  const key = JSON.stringify([state.target.corners, state.target.imageRotation, state.target.invert, state.target.imageAdjustments]);
  if (artworkOriginal !== targetOriginal || artworkKey !== key) {
    artwork = targetCanvas(targetOriginal, {...state.target, clipToShadow: false});
    artwork.revision = ++revision;
    artworkOriginal = targetOriginal;
    artworkKey = key;
  }
  target = state.target.clipToShadow ? clipTargetCanvas(
    artwork,
    state.target,
    getPatternBoundary(),
    size,
  ) : artwork;
  target.revision = ++revision;
}
function bake() {
  bakeSource();
  bakeTarget();
}
function change(fn, { images = false, optical = true, history = true } = {}) {
  const before = snapshot();
  try {
    if (history) remember();
    fn();
    if (!model) syncLensDimensions(state);
    validateState(state);
    if (images) bake();
    else if (optical) {
      if (state.lens.outlineSpace === "shadow") bakeSource();
      if (state.target.clipToShadow) bakeTarget();
    }
    if (optical) invalidate();
    render();
    scheduleSave();
    return true;
  } catch (e) {
    Object.assign(state, before.state);
    sourceOriginal = before.sourceOriginal;
    targetOriginal = before.targetOriginal;
    sourceName = before.sourceName;
    targetName = before.targetName;
    sourceUpload = before.sourceUpload;
    targetUpload = before.targetUpload;
    model = before.model;
    if (history) undoStack.pop();
    bake();
    render();
    error(e);
    return false;
  }
}
function restore(entry) {
  state = entry.state;
  sourceOriginal = entry.sourceOriginal;
  targetOriginal = entry.targetOriginal;
  sourceName = entry.sourceName;
  targetName = entry.targetName;
  sourceUpload = entry.sourceUpload;
  targetUpload = entry.targetUpload;
  const changedModel = model !== entry.model;
  model = entry.model;
  bake();
  invalidate();
  scene.setModel(model);
  if (changedModel) syncMesh();
  render();
  if (entry.camera) scene.restoreCamera(entry.camera);
  if (entry.traceQuality) $("traceQuality").value = entry.traceQuality;
  scheduleSave();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}
function newProject() {
  const previous = { ...snapshot(), camera: scene.captureCamera(), traceQuality: $("traceQuality").value };
  projectEpoch++;
  importID++;
  reliefID++;
  modelWorker?.terminate();
  traceWorker?.terminate();
  reliefWorker?.terminate();
  modelWorker = traceWorker = reliefWorker = null;
  clearTimeout(reliefTimer);
  clearTimeout(reliefTimeout);
  workerReady = false;
  reliefKey = "";
  reliefResult = null;
  preparedProject = null;
  preparingExport = false;
  $("uploadModel").disabled = false;
  $("modelUnit").value = "auto";
  $("traceQuality").value = "standard";
  change(() => {
    state = defaultState();
    if (language() === "en") state.title = "My project";
    sourceOriginal = sourceUpload = targetUpload = null;
    sourceName = "";
    targetOriginal = demoTarget();
    targetName = "示例 · 光";
    model = null;
    scene.setModel(null);
    scene.setRelief(null);
  }, { images: true, history: false });
  undoStack.splice(0, undoStack.length, previous);
  redoStack.length = 0;
  clearSelection();
  resetLayout();
  $("sceneAssessment").open = false;
  scene.setSpace("world");
  $("spaceToggle").textContent = "世界";
  render();
  scene.fit();
  toast("已新建项目，可撤销恢复。");
}
function scheduleSave() {
  if (TEST_MODE) return;
  clearTimeout(saveTimer);
  $("saveStatus").textContent = "正在保存…";
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({
          scene: state,
          sourceOriginal: sourceOriginal?.toDataURL("image/png"),
          targetOriginal: targetOriginal.toDataURL("image/png"),
          sourceName,
          targetName,
          modelName: model?.name,
        }),
      );
      saveOriginals({
        source: sourceUpload,
        target: targetUpload,
        sourceHash: imageFingerprint(sourceOriginal),
        targetHash: imageFingerprint(targetOriginal),
      }).catch(() => {
        $("saveStatus").textContent = "原文件尚未保存，请导出项目";
      });
      $("saveStatus").textContent = "已保存在此浏览器";
    } catch {
      $("saveStatus").textContent = "图片较大，请导出保存";
    }
  }, 600);
}
function setTool(mode) {
  if (mode && !selectionActive) return;
  scene?.setMode(mode);
  const spinOnly =
    selected === "lens" && state.lens.locked && mode === "rotate";
  $("spaceToggle").disabled = !selectionActive || spinOnly;
  $("spaceToggle").textContent = spinOnly
    ? "面内"
    : scene?.space === "local"
      ? "自身"
      : "世界";
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === mode);
    b.setAttribute("aria-pressed", String(b.dataset.tool === mode));
    b.title = selected === "light" && b.dataset.tool !== "translate"
      ? (b.dataset.tool === "rotate" ? "绕透镜中心旋转" : "调节光源距离")
      : { translate: "平移 W", rotate: "旋转 E", scale: "缩放 R" }[b.dataset.tool];
  });
}
function clearSelection() {
  selectionActive = false;
  setTool(null);
  $("rightPanel").hidden = true;
  $("rightPanel").classList.remove("mobile-open");
  if (
    document.querySelector(".workspace").dataset.mobileSection === "inspector"
  )
    delete document.querySelector(".workspace").dataset.mobileSection;
  $("spaceToggle").disabled = true;
  document.querySelector(".workspace").classList.remove("has-selection");
  document
    .querySelectorAll("[data-select]")
    .forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("[data-tool]").forEach((b) => (b.disabled = true));
  scene?.request();
  window.dispatchEvent(new Event("optical-layout-change"));
}
function selection(key) {
  selectionActive = true;
  revealInspector();
  document.querySelector(".workspace").classList.add("has-selection");
  selected = key;
  scene?.select(key);
  setTool(state[key].locked ? (key === "lens" ? "rotate" : null) : "translate");
  renderInspector();
  document
    .querySelectorAll("[data-select]")
    .forEach((b) => b.classList.toggle("active", b.dataset.select === key));
  document
    .querySelectorAll("[data-tool]")
    .forEach(
      (b) =>
        (b.disabled = key === "light" && state.light.locked),
    );
}
function escaped(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

const presetIcon = (p) => {
  const parts = p.oblique
    ? `<path d="M45 18v27M51 53h49" stroke-width="3"/><path d="${p.point ? "M17 5 81 53M17 5 55.4 53" : "M14 3 64 53M24 3 74 53"}" opacity=".65"/>${p.point ? '<circle cx="17" cy="5" r="2.4" fill="currentColor"/>' : ""}`
    : `<path d="M49 13v32M96 7v44" stroke-width="3"/><path d="${p.point ? "M14 29 49 17 95 8M14 29 49 41 95 50" : "M14 17h35l46 -9M14 41h35l46 9"}" opacity=".65"/>${p.point ? '<circle cx="14" cy="29" r="2.4" fill="currentColor"/>' : ""}`;
  return `<svg viewBox="0 0 112 58" aria-hidden="true">${parts}</svg>`;
};
const shapeIcons = {
  circle: '<circle cx="12" cy="12" r="8"/>',
  square: '<rect x="4" y="4" width="16" height="16"/>',
  rectangle: '<rect x="2" y="6" width="20" height="12"/>',
  polygon: '<path d="m7 4 10 0 5 8-5 8H7l-5-8Z"/>',
};
$("presetGrid").innerHTML = PRESETS.map(
  (p) =>
    `<button class="preset" data-preset="${p.id}" aria-pressed="false">${presetIcon(p)}<span>${p.name}</span></button>`,
).join("");
$("shapeGrid").innerHTML = Object.entries(shapeIcons)
  .map(
    ([id, path]) =>
      `<button class="shape" data-shape="${id}" title="${SHAPES[id]}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${SHAPES[id]}</span></button>`,
  )
  .join("");

function field(
  path,
  label,
  value,
  { min = -100000, max = 100000, step = 1, disabled = false } = {},
) {
  return `<label class="single-field">${label}<input data-path="${path}" type="number" min="${min}" max="${max}" step="${step}" value="${Number(value.toFixed(path === "lens.n" ? 3 : 2))}" ${disabled ? "disabled" : ""}></label>`;
}
function vectorFields(key, name, unit) {
  const o = state[selected],
    disabled = o.locked;
  const body = `<div class="vector-fields">${o[key].map((v, i) => `<label class="vector-field"><span>${"XYZ"[i]}</span><input aria-label="${name} ${"XYZ"[i]}" data-path="${selected}.${key}.${i}" type="number" min="-100000" max="100000" step="${key === "rotation" ? 1 : 5}" value="${Number(v.toFixed(2))}" ${disabled ? "disabled" : ""}></label>`).join("")}</div>`;
  return moduleBlock(`${selected}-${key}`, name, body, {
    meta: unit,
    open: !disabled,
  });
}
function lensSizeFields() {
  const l = state.lens,
    label =
      l.outlineSpace === "shadow"
        ? state.reflect
          ? "反射范围"
          : "阴影"
        : state.reflect
          ? "反射镜"
          : "透镜";
  if (l.shape === "square")
    return field("lens.width", `${label}边长 · mm`, l.width, {
      min: 0.1,
      step: 1,
    });
  if (l.shape === "polygon" && l.regularPolygon)
    return (
      field("lens.height", `${label}高 · mm`, l.height, { min: 0.1, step: 1 }) +
      `<div class="calculated-field"><span>${label}宽</span><strong>${l.width.toFixed(2)} <small>mm</small></strong><small>按正多边形计算</small></div>`
    );
  return `<div class="size-fields">${field("lens.width", `${label}宽 · mm`, l.width, { min: 0.1, step: 1 })}${field("lens.height", `${label}高 · mm`, l.height, { min: 0.1, step: 1 })}</div>`;
}
function spinFields() {
  return `<div class="spin-fields">${model ? "" : field("lens.outlineRotation", "面内旋转 · °", state.lens.outlineRotation, { step: 5 })}<div class="spin-buttons"><button data-spin="-90" title="面内旋转 −90°" aria-label="面内旋转负90度">${icon('<path d="M4 8a8 8 0 1 1 0 8M4 3v5h5"/>')}<span>−90°</span></button><button data-spin="90" title="面内旋转 +90°" aria-label="面内旋转90度">${icon('<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>')}<span>+90°</span></button></div></div>`;
}
function renderInspector() {
  $("rightPanel").hidden = !selectionActive;
  if (!selectionActive) return;
  const o = state[selected],
    locked = o.locked,
    titles = {
      lens: state.reflect ? "反射镜" : "透镜",
      target: "投影面",
      light: "光源",
    };
  $("selectedTitle").textContent = titles[selected];
  $("lockObject").innerHTML =
    icon(
      locked
        ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'
        : '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8-1M12 14v3"/>',
    ) + `<span>${locked ? "已固定" : "固定"}</span>`;
  $("lockObject").title = "固定位置和倾角；透镜仍可面内旋转及调整尺寸";
  $("lockObject").setAttribute("aria-pressed", String(locked));
  let html = "";
  if (selected === "light")
    html += moduleBlock(
      "light-type",
      "光源",
      `<select data-path="light.type" class="display-select" ${locked ? "disabled" : ""}><option value="parallel" ${o.type === "parallel" ? "selected" : ""}>平行光</option><option value="point" ${o.type === "point" ? "selected" : ""}>点光源</option></select>${
        o.type === "point"
          ? `<div class="source-examples"><button data-emitter="2" class="${o.diameter === 2 ? "active" : ""}">手机闪光灯 · 2 mm</button><button data-emitter="0" class="${o.diameter === 0 ? "active" : ""}">理想点光源</button></div>` +
            field("light.diameter", "发光面直径 · mm", o.diameter, {
              min: 0,
              max: 10000,
              step: 0.1,
            })
          : `<div class="source-examples"><button data-angular="0.53" class="${o.angularDiameter === 0.53 ? "active" : ""}">太阳光 · 0.53°</button><button data-angular="0" class="${o.angularDiameter === 0 ? "active" : ""}">理想平行光</button></div>` +
            field(
              "light.angularDiameter",
              "光源视直径 · °",
              o.angularDiameter,
              { min: 0, max: 10, step: 0.01 },
            )
      }<p class="help-text">${o.type === "point" ? "2 mm 是闪光灯发光面的示例值，可按实际光源调整。" : "视直径决定光束发散范围；旋转改变中心照射方向。"}</p>`,
    );
  html += vectorFields("position", "位置", "mm");
  if (selected === "lens" && locked)
    html += moduleBlock("lens-spin", "面内旋转", spinFields());
  else html += vectorFields("rotation", selected === "light" ? "绕透镜中心旋转" : "旋转", "°");
  if (selected === "light")
    html += `<p class="help-text">旋转绕透镜中心，缩放调节灯距。</p>`;
  if (selected === "light" && o.type === "parallel")
    html += `<div class="inspector-action"><button id="aimLight" class="quiet-button" ${locked ? "disabled" : ""}>朝向透镜中心</button></div>`;
  if (selected === "lens") {
    html += moduleBlock(
      "lens-size",
      "轮廓尺寸",
      lensSizeFields() +
        (o.shape === "square" || (o.shape === "polygon" && o.regularPolygon)
          ? ""
          : `<label class="checkbox-line"><input type="checkbox" data-path="lens.keepAspect" ${o.keepAspect || model ? "checked" : ""} ${model ? "disabled" : ""}>保持宽高比${model ? " · 模型等比缩放" : ""}</label>`),
    );
    html += moduleBlock(
      "lens-material",
      "材质与厚度",
      field("lens.n", "材料折射率", o.n, {
        min: 1.001,
        max: 2.99,
        step: 0.01,
      }) +
        field("lens.thickness", "厚度 · mm", o.thickness, {
          min: 0.01,
          max: 10000,
          step: 1,
          disabled: Boolean(model),
        }) +
        `<label class="checkbox-line"><input data-path="lens.constrainThickness" type="checkbox" ${o.constrainThickness ? "checked" : ""}>按此总厚度约束求解</label><p class="help-text">${model ? "模型保持原始曲面，整体等比缩放。" : "当前厚度用于摆放，曲面求解后再确认。"}</p>`,
      { open: false },
    );
  }
  if (selected === "target") {
    html += moduleBlock(
      "target-size",
      "投影图尺寸",
      `<div class="size-fields">${field("target.width", "宽 · mm", o.width, { min: 0.1, step: 5 })}${field("target.height", "高 · mm", o.height, { min: 0.1, step: 5 })}</div><label class="checkbox-line"><input type="checkbox" data-path="target.keepAspect" ${o.keepAspect ? "checked" : ""}>保持宽高比</label><button id="editImageInspector" class="quiet-button">调整图像</button>`,
    );
    html += moduleBlock(
      "target-receiver",
      "接收面范围",
      field("target.boardFactor", "相对图案尺寸的倍数", o.boardFactor, {
        min: 1,
        max: 10,
        step: 0.2,
      }),
      { open: false },
    );
    if (traceResult)
      html += moduleBlock(
        "target-display",
        "显示内容",
        `<select id="displayMode" class="display-select"><option value="target" ${state.view.display === "target" ? "selected" : ""}>期望投影图</option><option value="trace" ${state.view.display === "trace" ? "selected" : ""}>实际模型追迹</option><option value="compare" ${state.view.display === "compare" ? "selected" : ""}>叠加 · 目标白 / 追迹蓝</option></select><label class="exposure-field">亮度<input id="exposure" type="range" min=".1" max="4" step=".1" value="${state.view.exposure}" aria-label="追迹结果显示亮度"></label>`,
      );
  }
  $("inspector").innerHTML = html;
}
function renderOutlineFields() {
  const l = state.lens,
    shadow = l.outlineSpace === "shadow",
    a = apertureLayout(state);
  $("outlineSpace").value = shadow ? "1" : "0";
  $("outlineSpace").setAttribute(
    "aria-valuetext",
    shadow
      ? state.reflect
        ? "反射范围"
        : "阴影形状"
      : state.reflect
        ? "反射镜形状"
        : "透镜形状",
  );
  $("outlineReference").dataset.value = shadow ? "shadow" : "lens";
  document.querySelectorAll("[data-outline-space]").forEach((b) => {
    b.textContent =
      b.dataset.outlineSpace === "lens"
        ? state.reflect
          ? "反射镜形状"
          : "透镜形状"
        : state.reflect
          ? "反射范围"
          : "阴影形状";
    b.title =
      b.dataset.outlineSpace === "lens"
        ? "直接设置光学元件形状"
        : state.reflect
          ? "用入射面上的平面反射关系反算轮廓"
          : "用单个入射面的直射阴影反算透镜轮廓";
    b.classList.toggle("active", b.dataset.outlineSpace === l.outlineSpace);
    b.disabled = Boolean(model);
    b.setAttribute(
      "aria-pressed",
      String(b.dataset.outlineSpace === l.outlineSpace),
    );
  });
  $("outlineSpace").disabled = Boolean(model);
  let html = lensSizeFields();
  if (l.shape === "polygon")
    html += `<div class="polygon-options">${field("lens.sides", "边数", l.sides, { min: 3, max: 32, step: 1, disabled: Boolean(model) })}<label class="checkbox-line"><input type="checkbox" data-path="lens.regularPolygon" ${l.regularPolygon ? "checked" : ""}>正多边形</label></div>`;
  if (["square", "rectangle", "polygon"].includes(l.shape))
    html += field("lens.cornerRadius", "圆角半径 · mm", l.cornerRadius, {
      min: 0,
      max: Math.min(l.width, l.height) / 2,
      step: 1,
      disabled: Boolean(model),
    });
  html += spinFields();
  html += `<div class="thickness-field">${field("lens.thickness", "厚度 · mm", l.thickness, { min: 0.01, max: 10000, step: 1, disabled: Boolean(model) })}${model ? "" : `<label class="checkbox-line"><input type="checkbox" data-path="lens.thicknessAuto" ${l.thicknessAuto ? "checked" : ""}>自动 · 尺寸 × 0.1</label>`}</div>`;
  $("outlineFields").innerHTML = html;
  $("actualApertureInfo").textContent = shadow
    ? `实际透镜 ${a.width.toFixed(1)} × ${a.height.toFixed(1)} mm`
    : "固定摆放时，面内旋转和尺寸仍可调整。";
}

function assessment(sourceImage = source, targetImage = target) {
  const m = metrics(state);
  m.surfaceTilt = surfaceTiltEstimate(
    state,
    sourceImage?.energySamples,
    targetImage?.energyMoments,
  );
  m.notes = [
    ...m.warnings.filter(
      (w) =>
        w.level !== "error" &&
        !["finite-source", "short-focus", "long-focus"].includes(w.code),
    ),
    ...m.surfaceTilt.warnings,
  ];
  m.warnings = m.warnings.filter(
    (w) =>
      w.level === "error" ||
      ["finite-source", "short-focus", "long-focus"].includes(w.code),
  );
  const thicknessWarning = surfaceThicknessWarning(state, reliefResult);
  if (thicknessWarning) m.warnings.push(thicknessWarning);
  if (reliefStatus === "unavailable")
    m.notes.push({
      code: "surface-relief-unavailable",
      level: "warning",
      text: "曲面暂无法可靠估计，当前显示设置厚度的外形。",
    });
  const shadow = getSolidShadow();
  if (shadow?.clipped && !m.notes.some((w) => w.code === "shadow-clipped"))
    m.notes.push({
      code: "solid-shadow-clipped",
      level: "warning",
      text: "透镜实体的阴影超出接收面，可在投影面参数中增大接收面范围。",
    });
  if (state.target.clipToShadow && !targetImage?.energy)
    m.warnings.push({
      code: "empty-shadow-crop",
      level: "error",
      text: `裁剪后没有亮区。请将图案移进${state.reflect ? "反射范围" : "阴影"}，或取消裁剪。`,
    });
  if (model) {
    const key = JSON.stringify([
      model.revision,
      model.scale,
      state.lens.position,
      state.lens.rotation,
      state.target.position,
      state.target.rotation,
    ]);
    if (key !== intersectionKey) {
      intersectionKey = key;
      intersection = modelIntersectsReceiver(state, model);
    }
    if (intersection)
      m.warnings.push({
        code: "actual-receiver-intersection",
        level: "error",
        text: "实际模型穿过接收平面，请增大间距或调整摆放后再追迹。",
      });
  }
  return m;
}

function render() {
  requestRelief();
  const stencilCrop = scene?.dragging && state.target.clipToShadow && !state.reflect && !state.view.sourceBlur;
  scene?.update(state, source, stencilCrop ? artwork : target, getSolidShadow());
  const now = performance.now();
  if (scene?.dragging && now - inspectorRenderedAt < 100) return;
  inspectorRenderedAt = now;
  renderInspector();
  renderOutlineFields();
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.disabled =
      !selectionActive ||
      (selected === "light" && state.light.locked);
  });
  for (const b of document.querySelectorAll("[data-preset]")) {
    const active = b.dataset.preset === state.preset;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  for (const b of document.querySelectorAll("[data-shape]")) {
    const active = b.dataset.shape === state.lens.shape;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  document.querySelectorAll("[data-reflect]").forEach((b) => {
    const active = (b.dataset.reflect === "true") === state.reflect;
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelector('[data-select="lens"]').lastChild.textContent =
    state.reflect ? "反射镜" : "透镜";
  $("outlineSection").querySelector("h2").textContent =
    `${state.reflect ? "反射镜" : "透镜"}轮廓与尺寸`;
  if (document.activeElement !== $("projectTitle"))
    $("projectTitle").value = state.title;
  $("sourceInfo").hidden = false;
  $("sourceName").textContent =
    sourceName ||
    `${SHAPES[state.lens.shape]}${state.lens.outlineSpace === "shadow" ? " · 反算透镜" : ""}`;
  $("sourceName").toggleAttribute(
    "data-user-content",
    Boolean(sourceName && sourceName !== "导入的轮廓"),
  );
  if (sourceThumbRevision !== source.revision) {
    sourceThumbRevision = source.revision;
    $("sourceThumb").src = source.toDataURL();
  }
  if (targetThumbRevision !== target.revision) {
    targetThumbRevision = target.revision;
    $("targetThumb").src = target.toDataURL();
  }
  const ratio = state.target.width / state.target.height;
  $("targetThumb").style.width = `${Math.min(1, ratio) * 100}%`;
  $("targetThumb").style.height = `${Math.min(1, 1 / ratio) * 100}%`;
  $("targetName").textContent = targetName;
  $("targetName").toggleAttribute(
    "data-user-content",
    !["示例 · 光", "导入的投影图", "已恢复图案"].includes(targetName),
  );
  $("matchShadow").disabled = !getPatternBoundary();
  $("clipShadow").disabled =
    !state.target.clipToShadow && !getPatternBoundary();
  const boundaryName = state.reflect ? "反射范围" : "阴影";
  $("matchShadow").querySelector("span").textContent =
    `居中并匹配${boundaryName}尺寸`;
  $("clipShadow").setAttribute(
    "aria-pressed",
    String(state.target.clipToShadow),
  );
  $("clipShadow").classList.toggle("active", state.target.clipToShadow);
  $("clipShadowLabel").textContent = state.target.clipToShadow
    ? `已裁剪到${boundaryName} · 取消`
    : `裁剪到${boundaryName}${state.reflect ? "" : "范围"}`;
  $("matchShadow").title = state.target.locked
    ? "投影面摆放已固定，解除固定后可对齐。"
    : `图案居中到${boundaryName}，方形边长匹配包围框长边。`;
  $("clipShadow").title = state.reflect
    ? "按入射面的平面反射范围裁剪；实际曲面效果需导入模型追迹。再次点击取消。"
    : "按整个透镜实体的阴影裁剪，随光路更新。再次点击取消，原图保留。";
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  const m = assessment(),
    fmt = (v) =>
      v >= 10000 ? Math.round(v).toLocaleString() : v.toFixed(v < 10 ? 1 : 0);
  const lensSize = scene?.lensSizeMM || {
    widthMM: state.lens.width,
    heightMM: state.lens.height,
    thicknessMM: state.lens.thickness,
  };
  const focalWarning = m.warnings.some((w) =>
      ["short-focus", "long-focus"].includes(w.code),
    ),
    focalText = `${fmt(m.f)}<small>mm</small> · ${m.relativeF.toFixed(focalWarning ? 2 : 1)}<small>×</small>`;
  const metric = (label, value, extra = "") =>
    `<div class="metric ${extra}"><span class="label">${label}</span><strong>${value}</strong></div>`;
  $("metrics").innerHTML =
    metric(
      "透镜尺寸",
      `${lensSize.widthMM.toFixed(1)} × ${lensSize.heightMM.toFixed(1)} × ${lensSize.thicknessMM.toFixed(1)}<small>mm</small>`,
    ) +
    metric(
      "投影尺寸",
      `${fmt(state.target.width)} × ${fmt(state.target.height)}<small>mm</small>`,
    ) +
    metric(
      "等效焦距 ≈",
      focalText,
      `focal-metric ${focalWarning ? "alert" : ""}`,
    ) +
    metric("投影距离", `${fmt(m.u)}<small>mm</small>`) +
    metric(
      state.light.type === "point" ? "灯距" : "入射角",
      `${state.light.type === "point" ? fmt(m.v) : m.incidence.toFixed(1)}<small>${state.light.type === "point" ? "mm" : "°"}</small>`,
    ) +
    (state.view.sourceBlur
      ? `<button class="metric blur-metric ${m.blurEstimate.warning ? "alert" : ""}" id="blurDetails" title="查看光源模糊数据"><span class="label">模糊占比</span><strong>${(m.blurEstimate.ratio * 100).toFixed(1)}<small>%</small></strong></button>`
      : "");
  $("mobileFocal").innerHTML =
    `<span>等效焦距 ≈</span><strong>${focalText}</strong>`;
  $("mobileFocal").classList.toggle("alert", focalWarning);
  const blur = m.blurEstimate,
    cells = (v) =>
      v === null
        ? "∞"
        : v >= 10000
          ? ">1万"
          : Math.max(1, Math.round(v)).toLocaleString(),
    resolutionText =
      blur.ratio === 0
        ? "此项不限制"
        : `${cells(blur.resolution.width)} × ${cells(blur.resolution.height)}`,
    sameSpot = Math.abs(blur.widthMM - blur.heightMM) < 0.01,
    blurText = `${blur.widthMM.toFixed(2)}${sameSpot ? "" : ` × ${blur.heightMM.toFixed(2)}`} mm`;
  // Preserve only panels the user opened. A new warning never opens a popup.
  const opened = new Set(
    [...$("warnings").querySelectorAll("details[open]")].map(
      (d) => d.dataset.detail,
    ),
  );
  const detail = (id, title, body, className = "estimate-details") =>
    `<details class="${className}" data-detail="${id}" ${opened.has(id) ? "open" : ""}><summary>${title}</summary>${body}</details>`;
  const warningTitles = {
    "short-focus": `焦距 ${m.relativeF.toFixed(2)}× < 1.0×`,
    "long-focus": `焦距 ${m.relativeF.toFixed(2)}× > 6.0×`,
    "light-behind": "光源在透镜背面",
    "receiver-distance": "投影面与透镜重合",
    "receiver-intersection": "接收面穿过透镜",
    "finite-source": `模糊 ${(m.blurEstimate.ratio * 100).toFixed(1)}% > 4%`,
    "grazing-source": "入射角较大",
    "grazing-receiver": "投影面接近侧对光路",
    "target-front": "投影中心在透镜前方",
    "mirror-receiver-behind": "投影面在反射镜背面",
    "shadow-miss": "接收面未接住阴影",
    "shadow-clipped": "阴影超出接收面",
    "solid-shadow-clipped": "实体阴影超出接收面",
    "pattern-clipped": "图案超出接收面",
    "surface-tilt-limit": "亮区需要的偏折较大",
    "surface-relief": `起伏 ${reliefResult?.pvMM.toFixed(1)} > 厚度 ${state.lens.thickness.toFixed(1)} mm`,
    "surface-relief-unavailable": "曲面暂无法可靠估计",
    "empty-shadow-crop": "裁剪后没有亮区",
    "actual-receiver-intersection": "实际模型穿过接收面",
  };
  $("warningChips").innerHTML = m.warnings
    .map(
      (w) =>
        `<button class="warning-chip ${w.level}" data-warning="${w.code}" title="${escaped(w.text)}">${escaped(warningTitles[w.code] || w.text.split(/[。；]/)[0])}</button>`,
    )
    .join("");
  let assessmentHTML = m.warnings.length
    ? m.warnings
        .map((w) =>
          detail(
            w.code,
            escaped(warningTitles[w.code] || w.text.split(/[。；]/)[0]),
            `<p>${escaped(w.text)}</p>`,
            `warning ${w.level}`,
          ),
        )
        .join("")
    : '<p class="warnings-good">当前没有光路提醒。</p>';
  assessmentHTML += detail(
    "blur",
    "光源模糊数据",
    `<p>${state.view.sourceBlur ? "按当前光源设置估计。" : "当前未启用。需要时先在光源参数中设置发光面尺寸，再勾选底部的光源模糊。"}</p><dl><div><dt>参考光源</dt><dd>${blur.sourceLabel}</dd></div><div><dt>模糊斑</dt><dd>${blurText}</dd></div><div><dt>占图案宽 / 高</dt><dd>${(blur.widthRatio * 100).toFixed(2)}% / ${(blur.heightRatio * 100).toFixed(2)}%</dd></div><div><dt>粗略可分辨格数</dt><dd>${resolutionText}</dd></div></dl><p>点光源：发光面直径 × 投影距离 ÷ 灯距。平行光：2 × 投影距离 × tan(视直径 / 2)。斜面按夹角展开；未计加工误差。</p>`,
  );
  const tilt = m.surfaceTilt;
  if (tilt.valid)
    assessmentHTML += detail(
      "tilt",
      "整体倾斜数据",
      `<dl><div><dt>整体倾角 ≈</dt><dd>${tilt.tilt_degrees.toFixed(1)}°</dd></div><div><dt>倾斜高度差 ≈</dt><dd>${tilt.wedge_mm.toFixed(1)} mm</dd></div><div><dt>亮度重心偏离${state.reflect ? "反射范围" : "阴影"}</dt><dd>${tilt.energy_offset_mm === null ? "—" : `${tilt.energy_offset_mm.toFixed(1)} mm`}</dd></div></dl><p>按实际亮度重心与折射 / 反射方向估计整体坡度，不含局部起伏，不作为总厚度。</p>`,
    );
  if (reliefResult?.valid)
    assessmentHTML += detail(
      "relief",
      "曲面粗估数据",
      `<dl><div><dt>曲面起伏 ≈</dt><dd>${reliefResult.pvMM.toFixed(1)} mm</dd></div><div><dt>厚度约束</dt><dd>${state.lens.thicknessAuto ? "未指定" : `${state.lens.thickness.toFixed(1)} mm`}</dd></div></dl><p>粗估按实际比例显示，可能低估真实起伏。${reliefResult.caution ? "当前近场或斜射布局的估计误差较大。" : ""}阴影和裁剪按设置厚度；制造前需完整求解。</p>`,
    );
  if (m.notes.length)
    assessmentHTML += detail(
      "layout-notes",
      "更多布置数据",
      m.notes.map((n) => `<p>${escaped(n.text)}</p>`).join(""),
    );
  $("warnings").innerHTML = assessmentHTML;
  if ($("blurDetails"))
    $("blurDetails").onclick = () => {
      $("sceneAssessment").open = true;
      $("warnings").querySelector('[data-detail="blur"]').open = true;
    };
  $("showRelief").disabled = Boolean(model);
  $("reliefLabel").textContent =
    reliefStatus === "pending" && state.view.relief
      ? "曲面粗估…"
      : reliefStatus === "unavailable"
        ? "曲面暂无结果"
        : "曲面粗估";
  $("checkCount").textContent = m.warnings.length
    ? `${m.warnings.length} 条`
    : "已检查";
  const assessmentPanel = $("sceneAssessment");
  assessmentPanel.dataset.level = m.warnings.some((w) => w.level === "error")
    ? "error"
    : m.warnings.length
      ? "warning"
      : "good";
  assessmentPanel.querySelector("summary svg").innerHTML = m.warnings.length
    ? '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>'
    : '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>';
  const spinOnly =
    selected === "lens" && state.lens.locked && scene?.mode === "rotate";
  $("spaceToggle").disabled = !selectionActive || spinOnly;
  $("spaceToggle").textContent = spinOnly
    ? "面内"
    : scene?.space === "local"
      ? "自身"
      : "世界";
  // Saving an unfinished project must remain possible, even for invalid optics.
  $("exportSetup").disabled = preparingExport;
  $("modelUnit").disabled = Boolean(model && !model.raw);
  for (const [id, key] of [
    ["showRays", "rays"],
    ["showDimensions", "dimensions"],
    ["showSourceBlur", "sourceBlur"],
    ["showRelief", "relief"],
  ])
    $(id).checked = state.view[key];
  $("trace").disabled =
    (model && intersection) ||
    !model ||
    !workerReady ||
    busy ||
    m.warnings.some((w) => w.level === "error");
  $("modelInfo").hidden = !model;
  if (model)
    $("modelInfo").innerHTML =
      `<span data-user-content>${escaped(model.name)}</span><small>${Math.round(model.indices.length / 3).toLocaleString()} 面 · ${model.dimensions.map((n) => (n * model.scale).toFixed(1)).join(" × ")} mm</small><small>${model.unitLabel} · ${model.flipped ? "已统一朝外法线" : "原始几何法线"}</small><button id="removeModel">移除模型，返回布置</button>`;
}

function setPath(path, value) {
  const parts = path.split("."),
    key = parts.pop(),
    obj = parts.reduce((a, k) => a[k], state);
  obj[key] = value;
}
function applyField(path, value) {
  const before = clone(state),
    oldModel = model;
  const imageChange =
    path.startsWith("lens.") &&
    [
      "width",
      "height",
      "cornerRadius",
      "sides",
      "outlineRotation",
      "regularPolygon",
    ].includes(path.split(".")[1]);
  change(
    () => {
      setPath(path, value);
      if (path.startsWith("light.rotation."))
        state.light.position = lightPivotPose(before, state.light.rotation).position;
      if (path.startsWith("light.position.") && state.light.type === "point")
        state.light.rotation = aimRotation(state.light.position, state.lens.position);
      if (path === "lens.thickness") state.lens.thicknessAuto = false;
      state.preset = "custom";
      const [obj, property] = path.split(".");
      state.lens.cornerRadius = Math.min(
        state.lens.cornerRadius,
        state.lens.width / 2,
        state.lens.height / 2,
      );
      if (
        ["width", "height"].includes(property) &&
        (state[obj].keepAspect || (obj === "lens" && model))
      ) {
        const ratio = value / before[obj][property],
          other = property === "width" ? "height" : "width";
        state[obj][other] = before[obj][other] * ratio;
        if (obj === "lens" && model) {
          state.lens.thickness = before.lens.thickness * ratio;
          model = {
            ...model,
            scale: model.scale * ratio,
            revision: ++revision,
          };
        }
      }
      if (path === "light.type" && value === "parallel")
        state.light.rotation = aimRotation(
          state.light.position,
          state.lens.position,
        );
      if (model !== oldModel) scene.setModel(model);
    },
    { images: imageChange, optical: !path.endsWith("keepAspect") },
  );
  if (model !== oldModel) syncMesh();
}

function wire() {
  const openImageEditor = installImageEditor({
    getImage: () => targetOriginal,
    getTarget: () => state.target,
    getShadow: () => getPatternBoundary(),
    onApply: edits => change(() => Object.assign(state.target, edits), {images: true}),
  });
  $("imageEdit").onclick = openImageEditor;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.select) selection(b.dataset.select);
    if (b.dataset.warning) {
      $("sceneAssessment").open = true;
      const row = [...$("warnings").querySelectorAll("details")].find(
        (d) => d.dataset.detail === b.dataset.warning,
      );
      if (row) row.open = true;
    }
    if (b.dataset.emitter !== undefined || b.dataset.angular !== undefined)
      change(() => {
        if (b.dataset.emitter !== undefined)
          state.light.diameter = Number(b.dataset.emitter);
        if (b.dataset.angular !== undefined)
          state.light.angularDiameter = Number(b.dataset.angular);
      });
    if (b.dataset.spin)
      change(
        () => {
          if (model)
            state.lens.rotation = degrees(
              quaternion(state.lens.rotation).multiply(
                quaternion([0, 0, Number(b.dataset.spin)]),
              ),
            );
          else state.lens.outlineRotation += Number(b.dataset.spin);
        },
        { images: true },
      );
    if (b.dataset.preset) {
      change(() => {
        state = applyPreset(state, b.dataset.preset);
      });
      bake();
      render();
      scene.fit();
    }
    if (b.dataset.shape) {
      if (model) {
        toast("先移除实际模型，再调整基础轮廓。");
        return;
      }
      change(
        () => {
          state.lens.shape = b.dataset.shape;
          delete state.lens.contours;
          state.lens.outlineRotation = 0;
          if (["circle", "square"].includes(b.dataset.shape))
            state.lens.height = state.lens.width;
          if (
            b.dataset.shape === "rectangle" &&
            Math.abs(state.lens.width - state.lens.height) < 0.01
          )
            state.lens.height = (state.lens.width * 2) / 3;
          if (b.dataset.shape === "polygon") state.lens.regularPolygon = true;
          sourceOriginal = null;
          sourceUpload = null;
          sourceName = "";
        },
        { images: true },
      );
    }
    if (b.dataset.tool)
      setTool(scene.mode === b.dataset.tool ? null : b.dataset.tool);
    if (b.dataset.camera) {
      scene.fit(b.dataset.camera);
      if (b.dataset.camera === "lens") $("sceneAssessment").open = false;
    }
    if (b.dataset.close) $(b.dataset.close).close();
    if (b.id === "removeModel")
      change(() => {
        model = null;
        workerReady = false;
        scene.setModel(null);
      });
    if (b.id === "aimLight")
      change(() => {
        state.light.rotation = aimRotation(
          state.light.position,
          state.lens.position,
        );
        state.preset = "custom";
      });
    if (b.id === "editImageInspector") openImageEditor();
  });
  const fieldChanged = (e) => {
    const input = e.target;
    if (input.dataset.path) {
      if (input.dataset.path === "lens.thickness" && !input.value.trim()) {
        applyField("lens.thicknessAuto", true);
        return;
      }
      let value =
        input.type === "checkbox"
          ? input.checked
          : input.tagName === "SELECT"
            ? input.value
            : Number(input.value);
      if (
        input.type === "number" &&
        (!input.value.trim() ||
          !Number.isFinite(value) ||
          value < Number(input.min) ||
          value > Number(input.max))
      ) {
        toast(`请输入 ${input.min} 到 ${input.max} 之间的数值`);
        renderInspector();
        renderOutlineFields();
        return;
      }
      applyField(input.dataset.path, value);
    } else if (input.id === "displayMode")
      change(() => (state.view.display = input.value), { optical: false });
  };
  $("inspector").addEventListener("change", fieldChanged);
  $("outlineFields").addEventListener("change", fieldChanged);
  for (const id of ["inspector", "outlineFields"])
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches('input[type="number"]')) {
        e.preventDefault();
        fieldChanged(e);
      }
    });
  $("inspector").addEventListener("input", (e) => {
    if (e.target.id === "exposure") {
      state.view.exposure = Number(e.target.value);
      scene.update(state, source, target, getSolidShadow());
      scheduleSave();
    }
  });
  $("outlineSpace").onchange = (e) => {
    const mode = e.target.value === "1" ? "shadow" : "lens";
    if (mode === state.lens.outlineSpace) return;
    change(
      () => {
        const a = apertureLayout(state),
          shadow = shadowLayout(state, a);
        if (mode === "shadow") {
          if (!shadow) throw new Error("接收面没有有效阴影，请先调整光路。");
          const f =
            Math.max(shadow.width, shadow.height) /
            Math.max(state.lens.width, state.lens.height);
          state.lens.width *= f;
          state.lens.height *= f;
          state.lens.cornerRadius *= f;
        } else {
          const f =
            Math.max(a.width, a.height) /
            Math.max(state.lens.width, state.lens.height);
          state.lens.width *= f;
          state.lens.height *= f;
          state.lens.cornerRadius *= f;
        }
        state.lens.outlineSpace = mode;
        state.preset = "custom";
      },
      { images: true },
    );
  };
  document.querySelectorAll("[data-outline-space]").forEach(
    (b) =>
      (b.onclick = () => {
        $("outlineSpace").value =
          b.dataset.outlineSpace === "shadow" ? "1" : "0";
        $("outlineSpace").dispatchEvent(new Event("change"));
      }),
  );
  $("clipShadow").onclick = () =>
    change(
      () => {
        state.target.clipToShadow = !state.target.clipToShadow;
      },
      { images: true },
    );
  $("closeInspector").onclick = clearSelection;
  window.addEventListener("optical-clear-selection", clearSelection);
  $("matchShadow").onclick = () => {
    if (state.target.locked) {
      toast("请先解除投影面的固定摆放");
      return;
    }
    change(
      () => {
        matchTargetToShadow(state, getPatternBoundary());
        state.preset = "custom";
      },
      { images: true },
    );
  };
  $("lockObject").onclick = () =>
    change(() => (state[selected].locked = !state[selected].locked), {
      optical: false,
    });
  const rename = (e) => {
    const title = e.target.value.trim() || "我的光路";
    if (title !== state.title)
      change(() => (state.title = title), { optical: false });
  };
  $("projectTitle").onchange = rename;
  $("renameProject").onclick = () => {
    $("projectTitle").focus();
    $("projectTitle").select();
  };
  $("projectTitle").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      rename(e);
      e.target.blur();
    }
  };
  document.querySelectorAll("[data-reflect]").forEach(
    (button) =>
      (button.onclick = () => {
        const enabled = button.dataset.reflect === "true";
        if (state.reflect === enabled) return;
        change(
          () => {
            setReflection(state, enabled);
          },
          { images: true },
        );
        scene.fit();
      }),
  );
  $("undo").onclick = undo;
  $("redo").onclick = redo;
  $("newProject").onclick = newProject;
  $("fit").onclick = () => scene.fit();
  $("help").onclick = () => $("helpDialog").showModal();
  document.addEventListener("pointerdown", (e) => {
    const panel = $("sceneAssessment");
    if (
      panel.open &&
      !panel.contains(e.target) &&
      !e.target.closest("#blurDetails")
    )
      panel.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("sceneAssessment").open = false;
  });
  $("spaceToggle").onclick = () => {
    const space = scene.space === "world" ? "local" : "world";
    scene.setSpace(space);
    $("spaceToggle").textContent = space === "world" ? "世界" : "自身";
  };
  for (const [id, key] of [
    ["showRays", "rays"],
    ["showDimensions", "dimensions"],
    ["showSourceBlur", "sourceBlur"],
    ["showRelief", "relief"],
  ])
    $(id).onchange = (e) =>
      change(
        () => {
          state.view[key] = e.target.checked;
          if (key === "sourceBlur") {
            state.view.sourceBlurChosen = true;
            if (model) invalidate();
          }
        },
        { optical: false },
      );
  for (const [button, input] of [
    ["uploadSource", "sourceFile"],
    ["uploadTarget", "targetFile"],
    ["uploadModel", "modelFile"],
    ["importSetup", "setupFile"],
  ])
    $(button).onclick = () => $(input).click();
  $("sourceFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await uploadSource(file);
  };
  $("targetFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await uploadTarget(file);
  };
  $("modelFile").onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importModel(file);
  };
  $("setupFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await importSetup(file);
  };
  $("resetTarget").onclick = () =>
    change(
      () => {
        targetOriginal = demoTarget();
        targetUpload = null;
        targetName = "示例 · 光";
        state.target.corners = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        state.target.imageRotation = 0;
        state.target.invert = false;
        state.target.imageAdjustments = defaultAdjustments();
      },
      { images: true },
    );
  $("exportSetup").onclick = exportProject;
  $("saveProjectFile").onclick = () => {
    if (preparedProject) download(preparedProject, preparedProject.name);
  };
  $("shareProjectFile").onclick = async () => {
    if (!preparedProject) return;
    $("shareProjectFile").disabled = true;
    const result = await shareProject(preparedProject);
    $("shareProjectFile").disabled = !canShareProject(preparedProject);
    if (result.status === "failed" || result.status === "unsupported")
      $("projectDeliveryStatus").textContent =
        "分享未完成，可先保存文件再转发。";
    else if (result.status === "shared")
      $("projectDeliveryStatus").textContent = "已打开系统分享。";
    // Cancelling the share sheet leaves the prepared file ready for another try.
  };
  $("trace").onclick = startTrace;
  $("cancelTrace").onclick = () => {
    invalidate();
    render();
    toast("已停止追迹");
  };
  $("modelUnit").onchange = () => {
    if (model?.raw) installModel(model.raw);
  };
  document.addEventListener("keydown", (e) => {
    if (
      e.target.matches("input,textarea,select") ||
      document.querySelector("dialog[open]")
    )
      return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    const tool = { w: "translate", e: "rotate", r: "scale" }[
      e.key.toLowerCase()
    ];
    if (tool) document.querySelector(`[data-tool="${tool}"]`).click();
    if (e.key.toLowerCase() === "f") scene.fit();
    if (e.key === "Escape") clearSelection();
  });
  const drop = $("viewport");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag-over");
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (/\.(obj|step|stp)$/i.test(f.name)) importModel(f);
    else if (/\.(json|zip)$/i.test(f.name)) importSetup(f);
    else uploadTarget(f);
  });
}

async function uploadSource(file) {
  const epoch = projectEpoch;
  try {
    if (model) throw new Error("请先移除实际模型，再更换轮廓");
    const image = cropMask(await decodeImage(file)),
      contours = maskContours(image);
    if (epoch !== projectEpoch) return;
    change(
      () => {
        sourceOriginal = image;
        sourceUpload = { name: file.name, type: file.type, blob: file };
        sourceName = file.name;
        state.lens.shape = "custom";
        state.lens.contours = contours;
        state.lens.outlineRotation = 0;
        const long = Math.max(state.lens.width, state.lens.height);
        state.lens.width =
          (long * image.width) / Math.max(image.width, image.height);
        state.lens.height =
          (long * image.height) / Math.max(image.width, image.height);
      },
      { images: true },
    );
    toast("轮廓已更新");
  } catch (e) {
    if (epoch === projectEpoch) error(e);
  }
}
async function uploadTarget(file) {
  const epoch = projectEpoch;
  try {
    const image = padSquare(await decodeImage(file));
    if (epoch !== projectEpoch) return;
    change(
      () => {
        targetOriginal = image;
        targetUpload = { name: file.name, type: file.type, blob: file };
        targetName = file.name;
        state.target.corners = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        state.target.imageRotation = 0;
        state.target.invert = false;
        state.target.imageAdjustments = defaultAdjustments();
        const long = Math.max(state.target.width, state.target.height);
        state.target.width = state.target.height = long;
      },
      { images: true },
    );
    toast("投影图已更新，可拖动四角调整形状");
  } catch (e) {
    if (epoch === projectEpoch) error(e);
  }
}
function download(blob, name) {
  document
    .querySelectorAll(".download-receipt")
    .forEach((link) => link.remove());
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.className = "download-receipt";
  const filename = document.createElement("span");
  filename.setAttribute("data-user-content", "");
  filename.textContent = name;
  a.append(filename, " · 未下载？点此保存");
  a.title = "如果浏览器没有自动下载，点击这里保存已准备好的文件";
  // A modal makes the rest of the document inert, including synthetic links.
  // Keep the save link inside the active dialog so mobile browsers can use it.
  (document.querySelector("dialog[open]") || document.body).append(a);
  a.click();
  a.addEventListener("click", () => setTimeout(() => a.remove(), 5000));
  setTimeout(() => a.remove(), 20000);
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 120000);
}
function exportPacket({ project = false } = {}) {
  const sourceOut = sourceCanvas(
      state,
      sourceOriginal,
      Math.max(700, sourceOriginal?.width || 0, sourceOriginal?.height || 0),
    ),
    targetOut = targetCanvas(
      targetOriginal,
      state.target,
      Math.max(700, targetOriginal.width, targetOriginal.height),
      state.target.clipToShadow ? getPatternBoundary() : null,
    );
  if (!targetOut.energy && !project)
    throw new Error("投影图没有亮区，请更换图片或调整四角");
  const assets = {
    source: imageAsset(sourceOut, "source.png"),
    target: imageAsset(targetOut, "target.png"),
    target_original: imageAsset(targetOriginal, targetName),
  };
  if (sourceOriginal)
    assets.source_original = imageAsset(sourceOriginal, sourceName);
  const packet = makePacket(state, assets, { allowInvalidLayout: project });
  const assessed = assessment(sourceOut, targetOut);
  packet.warnings = assessed.warnings;
  packet.estimates.surface_tilt = assessed.surfaceTilt;
  packet.estimates.surface_relief = reliefResult?.valid
    ? {
        method: reliefResult.method,
        pv_mm: reliefResult.pvMM,
        integration_residual: reliefResult.integrationResidual,
        mass_l1: reliefResult.massL1,
        caution: reliefResult.caution,
        manufacturing_model: false,
        approximation:
          "Fixed entrance-plane coarse OT plus Snell normal integration. Not coupled GJE; may underestimate relief. Does not change geometry parameters or target pixels.",
      }
    : { status: reliefStatus, manufacturing_model: false };
  if (model)
    packet.model_reference = { name: model.name, geometry_included: false };
  return packet;
}
let preparedProject = null,
  preparingExport = false;
async function exportProject() {
  if (preparingExport) return;
  const epoch = projectEpoch;
  try {
    preparingExport = true;
    preparedProject = null;
    $("saveProjectFile").disabled = $("shareProjectFile").disabled = true;
    $("projectFileInfo").removeAttribute("data-user-content");
    $("projectFileInfo").textContent = "正在整理项目…";
    $("projectDeliveryStatus").textContent = "";
    closeMobilePanels();
    $("exportDialog").showModal();
    const packet = exportPacket({ project: true });
    scheduleSave();
    if (model) packet.model_reference.geometry_included = true;
    const exportTitle = state.title,
      blob = await makeProjectPackage(
        packet,
        {
          source: sourceUpload,
          target: targetUpload,
        },
        {
          camera: scene.captureCamera(),
          model,
          trace: traceResult,
          traceQuality: $("traceQuality").value,
        },
      );
    if (epoch !== projectEpoch) return;
    preparedProject = new File([blob], projectFilename(exportTitle), {
      type: "application/zip",
    });
    $("projectFileInfo").setAttribute("data-user-content", "");
    $("projectFileInfo").textContent =
      `${preparedProject.name} · ${blob.size < 1024 * 1024 ? `${Math.ceil(blob.size / 1024)} KB` : `${(blob.size / 1024 / 1024).toFixed(1)} MB`}`;
    $("saveProjectFile").disabled = false;
    const shareable = canShareProject(preparedProject);
    $("shareProjectFile").disabled = !shareable;
    $("projectDeliveryStatus").textContent = shareable
      ? "可在系统分享菜单中选择微信等应用。"
      : "此浏览器不支持文件分享，请先保存再转发。";
  } catch (e) {
    if (epoch !== projectEpoch) return;
    $("projectFileInfo").removeAttribute("data-user-content");
    $("projectFileInfo").textContent = "项目未能生成";
    $("projectDeliveryStatus").textContent = e.message;
    error(e);
  } finally {
    if (epoch === projectEpoch) {
      preparingExport = false;
      render();
    }
  }
}

async function importSetup(file) {
  const epoch = projectEpoch;
  try {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const zipped =
      /\.zip$/i.test(file.name) || (signature[0] === 80 && signature[1] === 75);
    if (file.size > (zipped ? MAX_PROJECT_BYTES : 40 * 1024 * 1024))
      throw new Error(`项目文件请小于 ${zipped ? 256 : 40} MB`);
    const bundle = zipped ? await readProjectPackage(file) : null;
    const packet = bundle?.packet || JSON.parse(await file.text()),
      parsed = readPacket(packet),
      assets = parsed.assets;
    const original = await decodeImage(
        (assets.target_original || assets.target).data_url,
      ),
      mask = assets.source_original
        ? await decodeImage(assets.source_original.data_url)
        : cropMask(await decodeImage(assets.source.data_url));
    if (epoch !== projectEpoch) return;
    // A pending mesh import must not overwrite the scene from this JSON.
    importID++;
    modelWorker?.terminate();
    modelWorker = null;
    $("uploadModel").disabled = false;
    const display = parsed.state.view.display;
    const restored = change(
      () => {
        state = parsed.state;
        targetOriginal = original;
        sourceOriginal =
          assets.source_original ||
          (parsed.state.lens.shape === "custom" && !parsed.state.lens.contours)
            ? mask
            : null;
        sourceUpload = bundle?.uploads.source || null;
        targetUpload = bundle?.uploads.target || null;
        targetName = assets.target_original?.name || "导入的投影图";
        sourceName =
          state.lens.shape === "custom"
            ? assets.source_original?.name || "导入的轮廓"
            : "";
        if (!assets.target_original) {
          state.target.corners = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ];
          state.target.imageRotation = 0;
          state.target.invert = false;
          state.target.imageAdjustments = defaultAdjustments();
        }
        model = bundle?.workspace.model
          ? { ...bundle.workspace.model, revision: ++revision }
          : null;
        workerReady = false;
        scene.setModel(model);
      },
      { images: true },
    );
    if (!restored) return;
    if (bundle?.workspace.traceQuality)
      $("traceQuality").value = bundle.workspace.traceQuality;
    clearSelection();
    closeMobilePanels();
    syncMesh();
    traceResult = bundle?.workspace.trace || null;
    scene.setTrace(traceResult);
    state.view.display = traceResult ? display : "target";
    if (bundle?.workspace.camera) scene.restoreCamera(bundle.workspace.camera);
    else scene.fit();
    render();
    scheduleSave();
    toast("项目已恢复，图片与摆放参数均已载入");
  } catch (e) {
    if (epoch === projectEpoch) error(e);
  }
}

async function importModel(file) {
  try {
    $("modelSection").open = true;
    if (file.size > 220 * 1024 * 1024) throw new Error("模型文件请小于 220 MB");
    if (!/\.(obj|step|stp)$/i.test(file.name))
      throw new Error("请选择 OBJ 或 STEP 文件");
    $("traceStatus").textContent = "正在读取模型…";
    $("uploadModel").disabled = true;
    modelWorker?.terminate();
    modelWorker = new Worker(new URL("./model-worker.js", import.meta.url), {
      type: "module",
    });
    const id = ++importID;
    modelWorker.onmessage = ({ data }) => {
      if (data.id !== importID) return;
      if (data.type === "progress") {
        $("traceStatus").textContent = data.text;
        return;
      }
      $("uploadModel").disabled = false;
      if (data.type === "error") {
        error(new Error(data.message));
        $("traceStatus").textContent = "模型读取失败，可重新选择。";
        return;
      }
      data.upload = { name: file.name, type: file.type, blob: file };
      installModel(data);
    };
    modelWorker.onerror = (e) => {
      $("uploadModel").disabled = false;
      error(new Error("模型解析失败：" + e.message));
    };
    const bytes = await file.arrayBuffer();
    if (id !== importID) return;
    modelWorker.postMessage({ id, name: file.name, bytes }, [bytes]);
  } catch (e) {
    $("uploadModel").disabled = false;
    error(e);
  }
}
function installModel(raw) {
  try {
    const lo = [Infinity, Infinity],
      hi = [-Infinity, -Infinity];
    for (let i = 0; i < raw.positions.length; i += 3)
      for (let j = 0; j < 2; j++) {
        lo[j] = Math.min(lo[j], raw.positions[i + j]);
        hi[j] = Math.max(hi[j], raw.positions[i + j]);
      }
    raw.alignment ??= {
      origin: relativeSetup(state).center.toArray(),
      rotation: state.lens.rotation.slice(),
      size: apertureLayout(state).size,
    };
    const mode = $("modelUnit").value,
      normalized =
        mode === "normalized" ||
        (mode === "auto" && Math.max(hi[0] - lo[0], hi[1] - lo[1]) < 10);
    const factor = normalized ? raw.alignment.size : 1,
      aligned = alignEntrance(raw.positions, raw.indices, factor);
    if (aligned.dimensions.some((n) => !(n > 0)))
      throw new Error("模型需要具有非零厚度的完整实体");
    const size = 700,
      mask = canvas(
        Math.max(
          1,
          Math.round(
            (size * aligned.width) / Math.max(aligned.width, aligned.height),
          ),
        ),
        Math.max(
          1,
          Math.round(
            (size * aligned.height) / Math.max(aligned.width, aligned.height),
          ),
        ),
      ),
      ctx = mask.getContext("2d");
    ctx.putImageData(new ImageData(
      raw.maskWidth === mask.width && raw.maskHeight === mask.height
        ? raw.mask
        : triangleMask(aligned.positions, aligned.cap, mask.width, mask.height, aligned.height, aligned.width),
      mask.width, mask.height,
    ), 0, 0);
    const contours = maskContours(mask),
      origin = worldPoint(
        { position: raw.alignment.origin, rotation: raw.alignment.rotation },
        aligned.centerOffset,
      );
    change(
      () => {
        model = {
          positions: aligned.positions,
          indices: raw.indices,
          scale: 1,
          dimensions: aligned.dimensions,
          name: raw.name,
          flipped: raw.flipped,
          unitLabel: normalized
            ? `1 单位 = ${factor.toFixed(1)} mm`
            : "原文件毫米",
          revision: ++revision,
          raw,
          upload: raw.upload,
        };
        state.lens.position = origin.toArray();
        state.lens.rotation = raw.alignment.rotation.slice();
        state.lens.width = aligned.width;
        state.lens.height = aligned.height;
        state.lens.thickness = aligned.dimensions[2];
        state.lens.thicknessAuto = false;
        state.lens.outlineRotation = 0;
        state.lens.outlineSpace = "lens";
        state.lens.shape = "custom";
        state.lens.contours = contours;
        sourceOriginal = mask;
        sourceUpload = null;
        sourceName = raw.name;
        scene.setModel(model);
      },
      { images: true },
    );
    $("traceStatus").textContent = "正在建立模型追迹索引…";
    syncMesh();
    toast("模型已载入，曲面保持原始比例");
  } catch (e) {
    error(e);
    $("traceStatus").textContent = "模型读取失败，请检查入射面和单位。";
  }
}
function syncMesh() {
  workerReady = false;
  traceWorker?.terminate();
  if (!model) {
    render();
    return;
  }
  traceWorker = new Worker(new URL("./trace-worker.js", import.meta.url), {
    type: "module",
  });
  const id = ++traceID;
  traceWorker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      workerReady = true;
      $("traceStatus").textContent = traceResult
        ? "已恢复项目中的追迹预览，可以继续查看或重新追迹。"
        : "模型已就绪，可以追迹当前光路。";
      render();
      return;
    }
    if (data.id !== traceID) return;
    if (data.type === "error") {
      busy = false;
      $("trace").hidden = false;
      $("cancelTrace").hidden = true;
      $("traceProgress").hidden = true;
      error(new Error(data.message));
      $("traceStatus").textContent = "追迹未完成，请检查模型与光路。";
      render();
      return;
    }
    if (data.type === "progress") {
      $("traceProgress").value = data.progress;
      $("traceStatus").textContent =
        `正在追迹 · ${Math.round(data.progress * 100)}%`;
      return;
    }
    if (data.type === "result") {
      busy = false;
      traceResult = data;
      scene.setTrace(data);
      state.view.display = "trace";
      $("traceProgress").hidden = true;
      $("trace").hidden = false;
      $("cancelTrace").hidden = true;
      const m = data.stats;
      $("traceStatus").textContent = m.entered
        ? `命中透镜 ${m.entered.toLocaleString()} 束 · 图案范围内 ${(m.imageFraction * 100).toFixed(1)}% · ${m.seconds.toFixed(1)} s`
        : "光线未命中模型，请检查位置和朝向。";
      render();
      selection("target");
    }
  };
  traceWorker.onerror = (e) => {
    busy = false;
    workerReady = false;
    error(new Error("追迹线程出错：" + e.message));
    render();
  };
  traceWorker.postMessage({
    type: "mesh",
    id,
    mesh: {
      positions: model.positions,
      indices: model.indices,
      scale: model.scale,
    },
  });
  render();
}
function startTrace() {
  try {
    const errors = assessment().warnings.filter(
      (w) => w.level === "error" || w.code === "actual-receiver-intersection",
    );
    if (errors.length) throw new Error(errors[0].text);
    if (!workerReady) throw new Error("模型索引仍在准备");
    const quality = {
      quick: [50000, 320],
      standard: [200000, 512],
      fine: [1000000, 768],
    }[$("traceQuality").value];
    const id = ++traceID;
    busy = true;
    $("traceProgress").value = 0;
    $("traceProgress").hidden = false;
    $("trace").hidden = true;
    $("cancelTrace").hidden = false;
    $("traceStatus").textContent = "正在追迹…";
    traceWorker.postMessage({
      type: "trace",
      id,
      state: clone(state),
      options: {
        samples: quality[0],
        size: quality[1],
        finiteSource: state.view.sourceBlur,
      },
    });
  } catch (e) {
    error(e);
  }
}

async function init() {
  try {
    const saved = TEST_MODE
      ? null
      : JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!saved && language() === "en") state.title = "My project";
    if (saved) {
      validateState(migrateState(saved.scene));
      state = saved.scene;
      state.view.display = "target";
      targetOriginal =
        saved.targetName === "示例 · 光"
          ? demoTarget()
          : await decodeImage(saved.targetOriginal);
      if (saved.sourceOriginal)
        sourceOriginal = await decodeImage(saved.sourceOriginal);
      try {
        const originals = await loadOriginals();
        if (originals?.sourceHash === imageFingerprint(sourceOriginal))
          sourceUpload = originals.source;
        if (originals?.targetHash === imageFingerprint(targetOriginal))
          targetUpload = originals.target;
      } catch {}
      sourceName = saved.sourceName || "";
      targetName = saved.targetName || "已恢复图案";
      if (saved.modelName)
        setTimeout(() => toast("已恢复光路；请重新导入实际模型"), 800);
    }
  } catch {
    state = defaultState();
    sourceOriginal = null;
    targetOriginal = demoTarget();
  }
  bake();
  scene = new OpticalScene($("viewport"), $("sceneLabels"), {
    select: selection,
    clearTool: () => {
      clearSelection();
      closeMobilePanels();
    },
    error: (message) => {
      $("startupError").hidden = false;
      $("startupError").textContent = message;
    },
    start: () => {
      remember();
      dragModelScale = model?.scale || 1;
      lastValidDrag = clone(state);
    },
    transform: (key, pose, base) => {
      const o = state[key];
      o.position = pose.position;
      o.rotation = pose.rotation;
      if (key === "light" && scene.mode === "translate" && o.type === "point")
        o.rotation = aimRotation(o.position, state.lens.position);
      if (Number.isFinite(pose.outlineRotation))
        o.outlineRotation = pose.outlineRotation;
      state.preset = "custom";
      if (scene.mode === "scale") {
        const scales = constrainedScale(
          pose.scale,
          pose.handle,
          o.keepAspect,
          key === "lens" && Boolean(model),
        );
        if (key === "lens" && model) {
          const f = scales.reduce(
            (a, b) => (Math.abs(Math.log(b)) > Math.abs(Math.log(a)) ? b : a),
            1,
          );
          o.width = base.lens.width * f;
          o.height = base.lens.height * f;
          o.thickness = base.lens.thickness * f;
          model = { ...model, scale: dragModelScale * f, revision: ++revision };
          scene.objects.lens.scale.setScalar(f);
        } else if (key !== "light") {
          if (o.keepAspect) {
            const f =
              Math.abs(Math.log(scales[0])) > Math.abs(Math.log(scales[1]))
                ? scales[0]
                : scales[1];
            scales[0] = scales[1] = f;
            scene.objects[key].scale.set(f, f, key === "lens" ? scales[2] : 1);
          }
          o.height = Math.max(0.1, base[key].height * scales[0]);
          o.width = Math.max(0.1, base[key].width * scales[1]);
          if (key === "lens" && Math.abs(scales[0] - scales[1]) > 1e-6) {
            if (o.shape === "square") o.shape = "rectangle";
            if (o.shape === "polygon") o.regularPolygon = false;
          }
          if (key === "lens")
            o.thickness = Math.max(0.01, base.lens.thickness * scales[2]);
        }
      }
      try {
        if (!model) syncLensDimensions(state);
        validateState(state);
        if (
          state.lens.outlineSpace === "shadow" ||
          Number.isFinite(pose.outlineRotation)
        )
          bakeSource();
        // Direct-light crops use the complete shadow's GPU stencil during a
        // drag. Reflection/blur use a smaller texture, restored on release.
        if (state.target.clipToShadow && (state.reflect || state.view.sourceBlur)) bakeTarget(192);
        lastValidDrag = clone(state);
      } catch {
        state = clone(lastValidDrag);
        const object = scene.objects[key];
        object.position.fromArray(state[key].position);
        object.rotation.set(0, 0, 0);
        object.quaternion.setFromRotationMatrix(
          new T.Matrix4().makeRotationFromEuler(
            new T.Euler(
              ...state[key].rotation.map(T.MathUtils.degToRad),
              "ZYX",
            ),
          ),
        );
        object.scale.set(1, 1, 1);
        return;
      }
      invalidate();
      render();
    },
    end: () => {
      if (!model && scene.selected === "lens") bakeSource();
      if (state.target.clipToShadow) bakeTarget();
      if (model && model.scale !== dragModelScale) {
        scene.setModel(model);
        syncMesh();
      }
      render();
      scheduleSave();
    },
  });
  wire();
  initializeI18n();
  initializeLayout();
  render();
  clearSelection();
  scene.fit();
  // Small read-only diagnostic surface for reproducible geometry and integration checks.
  window.opticalPath = {
    getState: () => clone(state),
    getConfiguration: () =>
      makePacket(state, {
        source: imageAsset(source, "source.png"),
        target: imageAsset(target, "target.png"),
      }).configuration,
    getTrace: () => traceResult?.stats || null,
  };
}
init().catch((e) => {
  console.error(e);
  $("startupError").hidden = false;
  $("startupError").textContent =
    "页面未能载入：" + e.message + "。请刷新重试，或使用支持三维显示的浏览器。";
});
