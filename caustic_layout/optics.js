import * as T from "./vendor/three.module.min.js";
import { defaultAdjustments, validAdjustments } from "./image-adjustments.js";
import { newProjectIdentity, validProjectIdentity } from "./project-identity.js";
import {
  sourceBlur,
  SUN_DIAMETER_DEG,
  BLUR_WARNING_RATIO,
} from "./source-effects.js";
import {
  vec,
  quaternion,
  degrees,
  direction,
  matrix,
  axis,
  aimRotation,
  apertureLayout,
  worldPoint,
  projectToReceiver,
  localPoint,
  shadowLayout,
  patternLayout,
  regularPolygonWidth,
} from "./layout-geometry.js";
export {
  vec,
  quaternion,
  degrees,
  direction,
  matrix,
  axis,
  aimRotation,
} from "./layout-geometry.js";

export const FORMAT = "caustic-optical-path";
export const PRESETS = [
  { id: "normalParallel", name: "正射平行光", point: false, oblique: false },
  { id: "normalPoint", name: "正射点光源", point: true, oblique: false },
  { id: "obliqueParallel", name: "斜射平行光", point: false, oblique: true },
  { id: "obliquePoint", name: "斜射点光源", point: true, oblique: true },
];
export const SHAPES = {
  circle: "圆形",
  square: "正方形",
  rectangle: "长方形",
  polygon: "多边形",
  custom: "自定义轮廓",
};
export const clone = (v) => structuredClone(v);
export const num = (v) => (Math.abs(v) < 1e-10 ? 0 : Number(v.toFixed(8)));

export function migrateState(s) {
  s.project ??= newProjectIdentity();
  const l = s.lens;
  s.view.shadow = true;
  s.view.grid = true;
  s.target.clipToShadow ??= false;
  s.target.imageAdjustments ??= defaultAdjustments();
  s.light.angularDiameter ??= SUN_DIAMETER_DEG;
  // Old drafts had blur enabled without an explicit choice. Migrate that
  // default once; preserve choices made with the opt-in control thereafter.
  s.view.sourceBlurChosen ??= false;
  s.view.sourceBlur = s.view.sourceBlurChosen
    ? (s.view.sourceBlur ?? false)
    : false;
  s.view.relief ??= true;
  if (l.shape === "rounded") {
    l.shape = "rectangle";
    l.cornerRadius ??= Math.min(l.width, l.height) * 0.15;
  }
  if (l.shape === "hexagon") {
    l.shape = "polygon";
    l.sides = 6;
  }
  if (l.shape === "heart") {
    const p = new T.Shape(),
      w = l.width,
      h = l.height;
    p.moveTo(0, h * 0.29);
    p.bezierCurveTo(w * 0.55, h * 0.87, w * 0.8, h * 0.05, 0, -h * 0.5);
    p.bezierCurveTo(-w * 0.8, h * 0.05, -w * 0.55, h * 0.87, 0, h * 0.29);
    const points = p.getPoints(96),
      box = new T.Box2().setFromPoints(points),
      center = box.getCenter(new T.Vector2()),
      size = box.getSize(new T.Vector2());
    l.contours = [
      points.map((p) => [
        -(p.y - center.y) / size.y,
        (p.x - center.x) / size.x,
      ]),
    ];
    l.shape = "custom";
  }
  l.outlineSpace ??= "lens";
  l.cornerRadius ??= 0;
  l.sides ??= 6;
  l.outlineRotation ??= 0;
  l.regularPolygon ??= false;
  if (l.thickness == null) {
    l.thickness = apertureLayout(s).size * 0.1;
    l.thicknessAuto = true;
  }
  l.thicknessAuto ??=
    Math.abs(l.thickness - apertureLayout(s).size * 0.1) < 0.001;
  return s;
}

export function syncLensDimensions(s) {
  const l = s.lens;
  if (l.shape === "square") l.height = l.width;
  if (l.shape === "polygon" && l.regularPolygon)
    l.width = regularPolygonWidth(l.height, l.sides, l.cornerRadius);
  if (l.thicknessAuto)
    l.thickness = Math.max(
      0.01,
      Math.min(
        10000,
        (l.outlineSpace === "shadow"
          ? apertureLayout(s).size
          : Math.max(l.width, l.height)) * 0.1,
      ),
    );
  return s;
}

export function defaultState() {
  return applyPreset(
    {
      project: newProjectIdentity(),
      title: "我的光路",
      preset: "normalParallel",
      reflect: false,
      lens: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        width: 40,
        height: 40,
        thickness: 4,
        shape: "circle",
        outlineSpace: "lens",
        cornerRadius: 0,
        sides: 6,
        outlineRotation: 0,
        regularPolygon: true,
        thicknessAuto: true,
        locked: true,
        n: 1.49,
        constrainThickness: false,
      },
      light: {
        position: [0, 0, 240],
        rotation: [0, 0, 0],
        type: "point",
        diameter: 2,
        angularDiameter: SUN_DIAMETER_DEG,
        locked: false,
      },
      target: {
        position: [0, 0, -240],
        rotation: [0, 0, 0],
        width: 160,
        height: 160,
        locked: false,
        boardFactor: 2.4,
        corners: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        imageRotation: 0,
        invert: false,
        clipToShadow: false,
        imageAdjustments: defaultAdjustments(),
      },
      view: {
        rays: true,
        shadow: true,
        grid: true,
        dimensions: true,
        sourceBlur: false,
        sourceBlurChosen: false,
        relief: true,
        display: "target",
        exposure: 1,
      },
    },
    "normalParallel",
  );
}

export function applyPreset(state, id) {
  const s = clone(state),
    p = PRESETS.find((p) => p.id === id);
  if (!p) throw new Error("未知光路预设");
  const d = apertureLayout(s).size,
    q = quaternion(s.lens.rotation),
    c = vec(s.lens.position);
  const world = (v) =>
    vec(v).multiplyScalar(d).applyQuaternion(q).add(c).toArray();
  const distance = p.point ? (p.oblique ? 3 : 6) : 1,
    targetDistance = p.oblique ? 1 : p.point ? 6 : 3,
    magnification = p.point ? (p.oblique ? 4 / 3 : 2) : 1;
  // Presets start from a physical aperture. Preserve its current physical size.
  if (s.lens.outlineSpace === "shadow") {
    const a = apertureLayout(s);
    s.lens.width = a.width;
    s.lens.height = a.height;
    s.lens.outlineSpace = "lens";
  }
  s.preset = id;
  s.light.type = p.point ? "point" : "parallel";
  s.light.position = world([p.oblique ? -distance : 0, 0, distance]);
  s.light.rotation = aimRotation(s.light.position, s.lens.position);
  s.target.position = world([p.oblique ? 1 : 0, 0, -targetDistance]);
  s.target.rotation = degrees(
    q.clone().multiply(quaternion([0, p.oblique ? -90 : 0, 0])),
  );
  if (s.reflect) {
    s.reflect = false;
    setReflection(s, true);
  }
  s.target.width = s.target.height = d * magnification;
  return s;
}

export function relativeSetup(s) {
  const aperture = apertureLayout(s),
    d = aperture.size,
    q = quaternion(s.lens.rotation).invert(),
    c = worldPoint(s.lens, aperture.center);
  const relative = (p) => vec(p).sub(c).applyQuaternion(q).divideScalar(d);
  const light =
    s.light.type === "point"
      ? relative(s.light.position)
      : direction(s).negate().applyQuaternion(q);
  // Parallel magnitude has no optical meaning. This matches the App preset table.
  if (s.light.type === "parallel" && Math.abs(light.z) > 1e-12)
    light.divideScalar(Math.abs(light.z));
  return {
    d,
    center: c,
    aperture,
    light,
    target: relative(s.target.position),
    rotation: degrees(q.multiply(quaternion(s.target.rotation))),
  };
}

// Fold/unfold the receiver through the entrance plane, preserving every image
// coordinate and the user's distances, sizes and warp. Works for custom layouts.
export function setReflection(s, enabled) {
  if (s.reflect === enabled) return false;
  const n = axis(s.lens, 2),
    center = vec(s.lens.position),
    target = vec(s.target.position),
    side = target.clone().sub(center).dot(n);
  let moved = false;
  if ((enabled && side < 0) || (!enabled && side > 0)) {
    s.target.position = target.addScaledVector(n, -2 * side).toArray();
    const x = axis(s.target, 0).reflect(n),
      // Mirror the receiving plane, then reverse its horizontal axis so the
      // artwork's front stays on the illuminated side. This orientation is
      // exported too; a display-only texture flip would give OTMap wrong UVs.
      y = axis(s.target, 1).reflect(n).negate(),
      z = x.clone().cross(y).normalize();
    s.target.rotation = degrees(
      new T.Quaternion().setFromRotationMatrix(
        new T.Matrix4().makeBasis(x, y, z),
      ),
    );
    moved = true;
  }
  s.reflect = enabled;
  return moved;
}

export function metrics(s) {
  const setup = relativeSetup(s),
    physicalSize =
      s.lens.outlineSpace === "shadow"
        ? setup.d
        : Math.max(s.lens.width, s.lens.height),
    delta = vec(s.target.position).sub(setup.center),
    u = delta.length();
  const v = vec(s.light.position).distanceTo(setup.center),
    point = s.light.type === "point";
  const f = point ? (u * v) / (u + v) : u,
    relativeF = f / physicalSize;
  const incidence =
    (Math.acos(
      T.MathUtils.clamp(
        (point
          ? vec(s.light.position).sub(setup.center).normalize()
          : direction(s).negate()
        ).dot(axis(s.lens, 2)),
        -1,
        1,
      ),
    ) *
      180) /
    Math.PI;
  const cosReceiver = Math.abs(
    delta.clone().normalize().dot(axis(s.target, 2)),
  );
  const blurEstimate = sourceBlur(s),
    blur = blurEstimate.diameterMM;
  const warnings = [];
  if (relativeF < 1 - 1e-9)
    warnings.push({
      code: "short-focus",
      level: "warning",
      text: "等效焦距小于口径的 1.0 倍，曲面可能较陡、较厚。可增加光路距离，并结合曲面粗估检查。",
    });
  if (relativeF > 6 + 1e-9)
    warnings.push({
      code: "long-focus",
      level: "warning",
      text: "等效焦距大于口径的 6.0 倍，曲面可能过平，细节对加工精度更敏感。可缩短光路距离。",
    });
  if (setup.light.z <= 0)
    warnings.push({
      code: "light-behind",
      level: "error",
      text: "光源在透镜背面。请把光源移到入射面前方，或转动透镜。",
    });
  if (u < 0.01)
    warnings.push({
      code: "receiver-distance",
      level: "error",
      text: "投影面与透镜重合，请拉开距离。",
    });
  const normal = axis(s.target, 2),
    signs = [];
  for (const loop of setup.aperture.loops)
    for (const [x, y] of loop)
      for (const z of [-s.lens.thickness, 0])
        signs.push(
          worldPoint(s.lens, [x, y, z]).sub(vec(s.target.position)).dot(normal),
        );
  if (Math.min(...signs) < 0.001 && Math.max(...signs) > -0.001)
    warnings.push({
      code: "receiver-intersection",
      level: "error",
      text: "接收平面穿过透镜，请移动或旋转投影面。",
    });
  if (s.view.sourceBlur && blurEstimate.warning)
    warnings.push({
      code: "finite-source",
      level: "warning",
      text: `光源模糊占图案宽 ${(blurEstimate.widthRatio * 100).toFixed(2)}%、高 ${(blurEstimate.heightRatio * 100).toFixed(2)}%，超过 4%。${point ? "可减小发光面，或调整灯距、投影距离及图案尺寸。" : "可缩短投影距离，或增大图案尺寸。"}`,
    });
  if (incidence > 65)
    warnings.push({
      code: "grazing-source",
      level: "warning",
      text: "入射角较大，侧面遮挡与反射损失可能增加。",
    });
  if (cosReceiver < 0.25)
    warnings.push({
      code: "grazing-receiver",
      level: "warning",
      text: "投影面接近侧对光路，图案拉伸和亮度不均会更明显。",
    });
  if (setup.target.z > 0 && !s.reflect)
    warnings.push({
      code: "target-front",
      level: "warning",
      text: "投影中心在入射面前方，这种透射光路可能无法用单个连续曲面实现。",
    });
  if (setup.target.z < 0 && s.reflect)
    warnings.push({
      code: "mirror-receiver-behind",
      level: "warning",
      text: "接收面在反射镜背面。请移到入射面一侧，接住反射光。",
    });
  const shadow = shadowLayout(s, setup.aperture),
    board = [
      (s.target.height * s.target.boardFactor) / 2,
      (s.target.width * s.target.boardFactor) / 2,
    ];
  if (!shadow && !s.reflect)
    warnings.push({
      code: "shadow-miss",
      level: "warning",
      text: "接收面未接住完整的直射阴影，无法按阴影对齐。可调整接收面位置或朝向。",
    });
  if (
    shadow &&
    shadow.loops.some((loop) =>
      loop.some((p) => p.some((v, i) => Math.abs(v) > board[i] + 0.01)),
    )
  )
    warnings.push({
      code: "shadow-clipped",
      level: "warning",
      text: "阴影超出了接收面范围。可增大接收面，或居中并匹配阴影尺寸。",
    });
  if (
    patternLayout(s).loops[0].some((p) =>
      p.some((v, i) => Math.abs(v) > board[i] + 0.01),
    )
  )
    warnings.push({
      code: "pattern-clipped",
      level: "warning",
      text: "变形后的图案超出了接收面。请增大接收面范围或收回图案四角。",
    });
  return {
    u,
    v,
    f,
    relativeF,
    incidence,
    blur,
    blurEstimate,
    cosReceiver,
    warnings,
  };
}

export function configuration(s) {
  const a = relativeSetup(s),
    m = metrics(s),
    out = {
      in_src: "source.png",
      in_trg: "target.png",
      out_obj: "lens.obj",
      point_light: s.light.type === "point",
      reflect: s.reflect,
      collimated_external: true,
      front_z: "0",
      refractive_index: String(s.lens.n),
      thick: String(num(s.lens.thickness / a.d)),
      focal: String(num(m.f / a.d)),
      step_size: String(num(a.d)),
      step_thick: String(num(s.lens.thickness)),
      thick_ref: "full",
      gje_match_thickness: s.lens.constrainThickness,
      rotate_target_180: false,
      allow_crease_terrace: false,
      align_ot_creases: s.light.type !== "point",
      use_curved_front_surface: false,
      ts_x: String(num(s.target.height / a.d)),
      ts_y: String(num(s.target.width / a.d)),
      ts_z: "1",
    };
  for (const [prefix, values] of [
    ["lp", a.light.toArray()],
    ["tp", a.target.toArray()],
    ["tr", a.rotation],
  ])
    values.forEach(
      (value, i) => (out[`${prefix}_${"xyz"[i]}`] = String(num(value))),
    );
  return out;
}

export function validateState(s) {
  if (s.project != null && !validProjectIdentity(s.project))
    throw new Error("项目标识无效");
  if (!s || typeof s !== "object") throw new Error("缺少场景数据");
  if (
    typeof s.title !== "string" ||
    s.title.length > 200 ||
    typeof s.reflect !== "boolean"
  )
    throw new Error("光路名称或模式无效");
  if (
    !s.view ||
    !["target", "trace", "compare"].includes(s.view.display) ||
    !Number.isFinite(s.view.exposure) ||
    s.view.exposure < 0.1 ||
    s.view.exposure > 4
  )
    throw new Error("显示设置无效");
  for (const key of ["lens", "light", "target"]) {
    const o = s[key];
    if (!o) throw new Error(`缺少 ${key}`);
    for (const key of ["position", "rotation"])
      if (
        !Array.isArray(o[key]) ||
        o[key].length !== 3 ||
        !o[key].every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
        )
      )
        throw new Error("位置或旋转数值无效");
  }
  for (const o of [s.lens, s.target])
    for (const key of ["width", "height"])
      if (!(Number.isFinite(o[key]) && o[key] >= 0.1 && o[key] <= 100000))
        throw new Error("尺寸应为 0.1–100000 mm");
  if (
    !(
      Number.isFinite(s.lens.thickness) &&
      s.lens.thickness >= 0.01 &&
      s.lens.thickness <= 10000
    )
  )
    throw new Error("厚度数值无效");
  if (!(Number.isFinite(s.lens.n) && s.lens.n > 1 && s.lens.n < 3))
    throw new Error("折射率应在 1–3 之间");
  if (!["point", "parallel"].includes(s.light.type) || !SHAPES[s.lens.shape])
    throw new Error("未知的光源或轮廓类型");
  if (
    !(
      Number.isFinite(s.light.diameter) &&
      s.light.diameter >= 0 &&
      s.light.diameter <= 10000
    )
  )
    throw new Error("发光面尺寸无效");
  if (
    !Number.isFinite(s.light.angularDiameter ?? SUN_DIAMETER_DEG) ||
    (s.light.angularDiameter ?? SUN_DIAMETER_DEG) < 0 ||
    (s.light.angularDiameter ?? SUN_DIAMETER_DEG) > 10
  )
    throw new Error("光源视直径应为 0–10°");
  if (typeof (s.view.sourceBlur ?? false) !== "boolean")
    throw new Error("光源模糊预览设置无效");
  if (typeof (s.view.relief ?? true) !== "boolean")
    throw new Error("曲面预览设置无效");
  if (
    !(
      Number.isFinite(s.target.boardFactor) &&
      s.target.boardFactor >= 1 &&
      s.target.boardFactor <= 10
    )
  )
    throw new Error("接收面范围无效");
  if (!validQuad(s.target.corners)) throw new Error("图像四角不能交叉或重叠");
  if (!Number.isFinite(s.target.imageRotation)) throw new Error("图像旋转无效");
  if (s.target.imageAdjustments && !validAdjustments(s.target.imageAdjustments))
    throw new Error("图像调整参数无效");
  if (typeof (s.target.clipToShadow ?? false) !== "boolean")
    throw new Error("阴影裁剪设置无效");
  if (!Number.isFinite(s.lens.outlineRotation ?? 0))
    throw new Error("轮廓面内旋转角无效");
  if (!["lens", "shadow"].includes(s.lens.outlineSpace || "lens"))
    throw new Error("轮廓参考面无效");
  if (
    !Number.isFinite(s.lens.cornerRadius ?? 0) ||
    (s.lens.cornerRadius ?? 0) < 0
  )
    throw new Error("圆角半径不能为负数");
  if (
    !Number.isInteger(s.lens.sides ?? 6) ||
    (s.lens.sides ?? 6) < 3 ||
    (s.lens.sides ?? 6) > 32
  )
    throw new Error("多边形边数应为 3–32");
  if (
    s.lens.contours &&
    (!Array.isArray(s.lens.contours) ||
      s.lens.contours.length > 4096 ||
      s.lens.contours.flat().length > 100000 ||
      !s.lens.contours.every(
        (loop) =>
          Array.isArray(loop) &&
          loop.length >= 3 &&
          loop.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              p.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.501),
          ),
      ))
  )
    throw new Error("自定义轮廓数据无效");
  apertureLayout(s);
  return s;
}

export function validQuad(c) {
  if (
    !Array.isArray(c) ||
    c.length !== 4 ||
    !c.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((x) => Number.isFinite(x) && x >= -2 && x <= 3),
    )
  )
    return false;
  const cross = c.map((a, i) => {
    const b = c[(i + 1) % 4],
      d = c[(i + 2) % 4];
    return (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
  });
  return cross.every((v) => v > 0.0001);
}

export function makePacket(s, assets, { allowInvalidLayout = false } = {}) {
  s.project ??= newProjectIdentity();
  validateState(s);
  const m = metrics(s),
    errors = m.warnings.filter((w) => w.level === "error");
  if (errors.length && !allowInvalidLayout)
    throw new Error(errors.map((e) => e.text).join("\n"));
  return {
    format: FORMAT,
    version: 1,
    units: "mm",
    created_at: new Date().toISOString(),
    scene: clone(s),
    configuration: configuration(s),
    assets,
    estimates: {
      equivalent_focal_mm: m.f,
      focal_over_aperture: m.relativeF,
      source_blur_mm: m.blur,
      source_blur: m.blurEstimate,
      source_blur_warning_ratio: BLUR_WARNING_RATIO,
      approximation:
        "Paraxial center-distance and extended-source estimate; resolution is pattern span / blur diameter, not measured MTF. Preview blur is not baked into solver target PNG. Thickness warnings compare coarse surface relief against explicitly set thickness.",
    },
    coordinate_system: {
      reference:
        "Actual entrance aperture bounding-box center; inverse lens rigid transform; one unit = actual source domain long side.",
      image:
        "X = image rows top to bottom; Y = columns left to right; +Z = entrance side.",
      rotation: "Rz(z) Ry(y) Rx(x), degrees",
      domain_size_mm: apertureLayout(s).size,
      source_center_world_mm: relativeSetup(s).center.toArray(),
      outline_reference: s.lens.outlineSpace || "lens",
      target_mapping:
        "Image is baked in receiver-plane UV; receiver position, rotation and physical scale place each pixel in 3D. Do not apply a second keystone warp.",
      target_shadow_clip: s.target.clipToShadow
        ? s.reflect
          ? "Target PNG is masked to the nominal entrance-plane specular footprint; original artwork is retained separately."
          : "Target PNG is masked to the full solid shadow, including back and side walls; original artwork is retained separately."
        : "none",
    },
    warnings: m.warnings,
  };
}

export function readPacket(p) {
  if (p?.format !== FORMAT || p.version !== 1 || p.units !== "mm")
    throw new Error("请选择本页面导出的光路 JSON（版本 1）");
  if (
    !["lens", "light", "target", "view"].every(
      (key) => p.scene?.[key] && typeof p.scene[key] === "object",
    )
  )
    throw new Error("项目缺少完整的光路设置");
  validateState(migrateState(p.scene));
  for (const key of [
    "source",
    "target",
    "source_original",
    "target_original",
  ]) {
    if (key.endsWith("_original") && !p.assets?.[key]) continue;
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(
        p.assets?.[key]?.data_url || "",
      )
    )
      throw new Error(`缺少有效的 ${key} 图片`);
  }
  return { state: clone(p.scene), assets: p.assets };
}

export function homography(c) {
  // Unit-square -> quadrilateral. Perspective division is essential for trapezoids.
  const [a, b, d, e] = c,
    dx1 = b[0] - d[0],
    dx2 = e[0] - d[0],
    dx3 = a[0] - b[0] + d[0] - e[0];
  const dy1 = b[1] - d[1],
    dy2 = e[1] - d[1],
    dy3 = a[1] - b[1] + d[1] - e[1],
    det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  return new T.Matrix3().set(
    b[0] - a[0] + g * b[0],
    e[0] - a[0] + h * e[0],
    a[0],
    b[1] - a[1] + g * b[1],
    e[1] - a[1] + h * e[1],
    a[1],
    g,
    h,
    1,
  );
}

// Actual square source raster UV -> authoring outline UV (in lens or receiver plane).
export function sourceRasterMap(s, aperture = apertureLayout(s)) {
  const lens = s.lens,
    center = aperture.shadowCenter
      ? localPoint(s.target, aperture.shadowCenter)
      : null;
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) => {
    let x = aperture.center[0] + (v - 0.5) * aperture.size,
      y = aperture.center[1] + (u - 0.5) * aperture.size;
    if (lens.outlineSpace === "shadow") {
      const p = projectToReceiver(s, worldPoint(lens, [x, y]), false);
      if (!p) throw new Error("轮廓跨越投影极限，请调整光路。");
      const q = localPoint(s.target, p);
      x = q.x - center.x;
      y = q.y - center.y;
    }
    const a = T.MathUtils.degToRad(lens.outlineRotation || 0),
      c = Math.cos(a),
      sn = Math.sin(a),
      rx = c * x + sn * y,
      ry = -sn * x + c * y;
    return [ry / lens.width + 0.5, rx / lens.height + 0.5];
  });
  return homography(corners);
}
