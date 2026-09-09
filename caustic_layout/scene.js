import * as T from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { TransformControls } from "./vendor/TransformControls.js";
import { styleGizmo } from "./gizmo-style.js";
import { apertureGeometry } from "./lens-geometry.js";
import { reliefGeometry } from "./relief-geometry.js";
import { lensMeshes } from "./lens-material.js";
import {
  apertureLayout,
  shadowLayout,
  patternLayout,
  worldPoint,
  constrainedScale,
  lightPivotPose,
  illuminationGuides,
} from "./layout-geometry.js";
import { axis, clone, degrees, direction, quaternion, vec } from "./optics.js";
import { geometryFromMesh } from "./trace-core.js";
import { sourceBlur } from "./source-effects.js";
import { installSourceBlur, updateSourceBlur } from "./blur-preview.js";
import { isCompact, sceneInsets } from "./ui-layout.js";
import { SceneTap } from "./touch-input.js";

const colors = { lens: 0x7bdfc9, light: 0xe6bc76, target: 0xdfdebf };
function dispose(o) {
  o.traverse((c) => {
    c.geometry?.dispose();
    if (c.material) {
      for (const m of Array.isArray(c.material) ? c.material : [c.material])
        m.dispose();
    }
  });
  o.clear();
}
function line(points, color = 0x75c8b2, opacity = 0.4, dashed = false) {
  const g = new T.BufferGeometry().setFromPoints(
    points.map((p) => (p.isVector3 ? p : vec(p))),
  );
  const m = dashed
    ? new T.LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        dashSize: 4,
        gapSize: 4,
      })
    : new T.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new T.Line(g, m);
  if (dashed) l.computeLineDistances();
  return l;
}
function plane(height, width) {
  const g = new T.PlaneGeometry(height, width);
  const p = g.attributes.position,
    uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, p.getY(i) / width + 0.5, 0.5 - p.getX(i) / height);
  return g;
}
function corners(h, w, z = 0) {
  return [
    [-h / 2, -w / 2, z],
    [-h / 2, w / 2, z],
    [h / 2, w / 2, z],
    [h / 2, -w / 2, z],
    [-h / 2, -w / 2, z],
  ];
}

export class OpticalScene {
  constructor(host, labelHost, callbacks) {
    this.host = host;
    this.labelHost = labelHost;
    this.callbacks = callbacks;
    this.state = null;
    this.model = null;
    this.selected = "target";
    this.mode = null;
    this.space = "world";
    this.pending = false;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x11171d);
    this.camera = new T.PerspectiveCamera(37, 1, 0.1, 100000);
    this.camera.up.set(-1, 0, 0);
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      stencil: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, isCompact() ? 1.5 : 2),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      callbacks.error("三维画面暂时中断，场景已保留。请刷新页面恢复。");
    });
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 200000;
    this.orbit.touches.ONE = T.TOUCH.ROTATE;
    this.orbit.touches.TWO = T.TOUCH.DOLLY_PAN;
    this.orbit.addEventListener("start", () => {
      this.cameraMode = "custom";
    });
    this.orbit.addEventListener("change", () => this.request());
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    styleGizmo(this.gizmo);
    if (isCompact()) this.gizmo.setSize(1.0);
    this.lensSpin = new T.Group();
    this.scene.add(this.lensSpin);
    this.lightPivot = new T.Group();
    this.scene.add(this.lightPivot);
    this.scene.add(this.gizmo);
    this.gizmo.addEventListener("change", () => this.request());
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.dragging = e.value;
      this.orbit.enabled = !e.value;
      if (e.value) {
        this.dragBase = clone(this.state);
        callbacks.start();
      } else callbacks.end();
    });
    this.gizmo.addEventListener("objectChange", () => {
      if (this.gizmo.object === this.lightPivot) {
        const scale = constrainedScale(this.lightPivot.scale.toArray(), this.gizmo.axis, false, true)[0];
        this.lightPivot.scale.setScalar(scale);
        callbacks.transform("light", lightPivotPose(this.dragBase, degrees(this.lightPivot.quaternion), scale), this.dragBase);
        return;
      }
      if (this.gizmo.object === this.lensSpin) {
        const delta = quaternion(this.state.lens.rotation)
          .invert()
          .multiply(this.lensSpin.quaternion);
        callbacks.transform(
          "lens",
          {
            position: this.state.lens.position,
            rotation: this.state.lens.rotation,
            scale: [1, 1, 1],
            outlineRotation: T.MathUtils.radToDeg(
              2 * Math.atan2(delta.z, delta.w),
            ),
            handle: "Z",
          },
          this.dragBase,
        );
        return;
      }
      const o = this.objects[this.selected];
      if (this.mode === "scale")
        o.scale.fromArray(
          constrainedScale(
            o.scale.toArray(),
            this.gizmo.axis,
            this.state[this.selected].keepAspect,
            this.selected === "lens" && Boolean(this.model),
          ),
        );
      callbacks.transform(
        this.selected,
        {
          position: o.position.toArray(),
          rotation: degrees(o.quaternion),
          scale: o.scale.toArray(),
          handle: this.gizmo.axis,
        },
        this.dragBase,
      );
    });
    this.objects = {};
    for (const name of ["lens", "target", "light"]) {
      const g = new T.Group();
      g.userData.select = name;
      this.objects[name] = g;
      this.scene.add(g);
    }
    this.rays = new T.Group();
    this.dimensions = new T.Group();
    this.lensDimensions = new T.Group();
    this.shadow = new T.Group();
    this.scene.add(
      this.rays,
      this.dimensions,
      this.lensDimensions,
      this.shadow,
    );
    this.scene.add(new T.HemisphereLight(0xc9e0eb, 0x232c2d, 2.0));
    const rim = new T.DirectionalLight(0x82b4c4, 2);
    rim.position.set(-300, 400, -100);
    this.scene.add(rim);
    this.parallel = new T.DirectionalLight(0xffefd0, 2.5);
    this.point = new T.PointLight(0xffefd0, 2.5, 0, 0);
    for (const light of [this.parallel, this.point]) {
      light.castShadow = true;
      const resolution = isCompact() ? 1024 : 2048;
      light.shadow.mapSize.set(resolution, resolution);
      light.shadow.bias = -0.00015;
      light.shadow.normalBias = 0.015;
      light.shadow.camera.near = 0.1;
      light.shadow.camera.far = 10000;
      this.scene.add(light);
    }
    this.parallel.shadow.camera.left = this.parallel.shadow.camera.bottom =
      -700;
    this.parallel.shadow.camera.right = this.parallel.shadow.camera.top = 700;
    this.scene.add(this.parallel.target);
    this.ground = new T.Mesh(
      new T.PlaneGeometry(4000, 4000),
      new T.MeshStandardMaterial({
        color: 0x182128,
        roughness: 1,
        metalness: 0,
      }),
    );
    this.ground.rotation.y = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new T.GridHelper(2400, 60, 0x43515a, 0x2e3d47);
    this.grid.rotation.z = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.42;
    this.scene.add(this.grid);
    this.labels = {};
    for (const [key, label] of [
      ["distance", ""],
      ["lampDistance", ""],
      ["lensHeight", ""],
      ["lensWidth", ""],
      ["lensThickness", ""],
    ]) {
      const e = document.createElement("span");
      e.className = `scene-label dimension${key.startsWith("lens") ? " lens-measure" : ""}`;
      e.dataset.measure = key;
      e.textContent = label;
      if (e.tagName === "BUTTON") e.onclick = () => callbacks.select(key);
      labelHost.append(e);
      this.labels[key] = e;
    }
    const tap = new SceneTap();
    host.addEventListener("pointerdown", (e) => {
      tap.start(e, Boolean(this.gizmo.axis || this.dragging));
    });
    host.addEventListener("pointermove", (e) => tap.move(e));
    host.addEventListener("pointercancel", (e) => tap.cancel(e));
    host.addEventListener("pointerup", (e) => {
      if (!tap.end(e) || this.gizmo.axis || this.dragging) return;
      const r = host.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = ray
        .intersectObjects(Object.values(this.objects), true)
        .find((h) => h.object.isMesh && !h.object.userData.ignoreSelect);
      if (hit) {
        let o = hit.object;
        while (o && !o.userData.select) o = o.parent;
        if (o) callbacks.select(o.userData.select);
      } else callbacks.clearTool();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    window.addEventListener("optical-layout-change", () => this.resize());
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    const insets = sceneInsets(this.host);
    if (isCompact())
      this.camera.setViewOffset(
        width,
        height,
        insets.right / 2,
        (insets.bottom - insets.top) / 2,
        width,
        height,
      );
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.request();
  }
  captureCamera() {
    return {
      position: this.camera.position.toArray(),
      target: this.orbit.target.toArray(),
      up: this.camera.up.toArray(),
      mode: this.lensFocus
        ? "lens"
        : this.receiverFocus
          ? "target"
          : this.cameraMode || "perspective",
    };
  }
  restoreCamera(saved) {
    this.camera.position.fromArray(saved.position);
    this.camera.up.fromArray(saved.up);
    this.orbit.target.fromArray(saved.target);
    this.cameraMode = saved.mode;
    this.lensFocus = saved.mode === "lens";
    this.receiverFocus = saved.mode === "target";
    this.camera.far = Math.max(
      10000,
      this.camera.position.distanceTo(this.orbit.target) * 20,
    );
    document
      .querySelectorAll("[data-camera]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.camera === saved.mode),
      );
    this.orbit.update();
    this.attach();
    this.resize();
  }
  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }
  render() {
    if (!this.state) return;
    const near = Math.max(
      0.01,
      this.camera.position.distanceTo(this.orbit.target) / 100,
    );
    if (Math.abs(this.camera.near - near) > 1e-5) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    const focused = this.receiverFocus;
    // The artwork inspection view looks along its defined UV normal, including
    // receivers illuminated on their reverse side in a reflected layout.
    if (this.targetBoard) this.targetBoard.material.depthWrite = !focused;
    this.objects.light.visible = !focused && !this.lensFocus;
    this.objects.target.visible = !this.lensFocus;
    this.shadow.visible = !this.lensFocus && this.state.view.shadow;
    this.objects.lens.traverse((o) => {
      if (o.isMesh) {
        o.material.colorWrite = !focused && !o.userData.depthOnly;
        o.material.depthWrite =
          !focused && (o.userData.depthOnly || !o.material.transparent);
      } else if (o.isLine) o.visible = !focused;
    });
    this.rays.visible = !focused && !this.lensFocus && this.state.view.rays;
    this.dimensions.visible =
      !focused && !this.lensFocus && this.state.view.dimensions;
    this.lensDimensions.visible = this.lensFocus && this.state.view.dimensions;
    this.grid.visible = this.ground.visible = !focused && this.state.view.grid;
    if (focused && this.selected !== "target") this.gizmo.visible = false;
    if (this.lensFocus && this.selected !== "lens") this.gizmo.visible = false;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }
  select(key) {
    this.selected = key;
    if (
      (this.receiverFocus && key !== "target") ||
      (this.lensFocus && key !== "lens")
    )
      this.fit();
    this.attach();
    this.request();
  }
  attach() {
    const s = this.state;
    if (!s) return;
    const lightPivot = this.selected === "light" && this.mode !== "translate";
    const spinOnly =
      this.selected === "lens" && s.lens.locked && this.mode === "rotate";
    if (
      !this.mode ||
      (s[this.selected].locked && (this.mode !== "scale" || this.selected === "light") && !spinOnly)
    )
      this.gizmo.detach();
    else
      this.gizmo.attach(
        lightPivot ? this.lightPivot : spinOnly && !this.model ? this.lensSpin : this.objects[this.selected],
      );
    if (this.mode) this.gizmo.setMode(this.mode);
    this.gizmo.setSpace(spinOnly ? "local" : this.space);
    this.gizmo.showX = this.gizmo.showY = !spinOnly;
    this.gizmo.showZ = lightPivot || this.mode !== "scale";
    this.host.dataset.gizmoMode = this.mode || "";
    this.host.dataset.gizmoAxes = spinOnly
      ? "Z"
      : this.mode === "scale" && !lightPivot
        ? "XY"
        : "XYZ";
    this.host.dataset.gizmoPivot = lightPivot ? "lens" : this.selected;
  }
  setMode(mode) {
    this.mode = mode;
    this.attach();
    this.request();
  }
  setSpace(space) {
    this.space = space;
    this.attach();
    this.request();
  }
  setModel(mesh) {
    this.model = mesh;
    this.lensKey = "";
  }
  setTrace(result) {
    if (this.trace === result) return;
    this.trace = result;
    this.traceTexture?.dispose();
    this.traceTexture = null;
    this.targetKey = "";
  }
  setRelief(result) {
    this.relief = result;
  }
  update(state, source, target, solid) {
    this.state = clone(state);
    this.source = source;
    this.target = target;
    this.aperture = apertureLayout(state);
    this.shadowData = shadowLayout(state, this.aperture);
    this.solidShadowData = solid;
    if (!this.dragging) {
      this.lightPivot.position.fromArray(state.lens.position);
      this.lightPivot.quaternion.copy(quaternion(state.light.rotation));
      this.lightPivot.scale.setScalar(1);
      this.lensSpin.position.fromArray(state.lens.position);
      this.lensSpin.quaternion
        .copy(quaternion(state.lens.rotation))
        .multiply(quaternion([0, 0, state.lens.outlineRotation || 0]));
    }
    for (const [key, o] of Object.entries(this.objects)) {
      if (this.dragging && key === this.selected && this.gizmo.object !== this.lightPivot) continue;
      o.position.fromArray(state[key].position);
      o.quaternion.copy(quaternion(state[key].rotation));
      o.scale.set(1, 1, 1);
    }
    const l = state.lens,
      t = state.target,
      light = state.light;
    const receiverSide =
      Math.sign(
        worldPoint(l, this.aperture.center)
          .sub(vec(t.position))
          .dot(axis(t, 2)),
      ) || 1;
    const lensKey = this.model ? JSON.stringify([this.model.revision, state.reflect, l.n]) : JSON.stringify([
      state.reflect,
      l.shape,
      l.width,
      l.height,
      l.thickness,
      source?.revision,
      l.cornerRadius,
      l.sides,
      l.outlineSpace,
      this.model?.revision,
      state.view.relief && this.relief?.valid ? this.relief.id : null,
    ]);
    if (
      lensKey !== this.lensKey &&
      !(
        this.dragging &&
        this.selected === "lens" &&
        l.outlineSpace !== "shadow" &&
        this.gizmo.object !== this.lensSpin
      )
    ) {
      this.lensKey = lensKey;
      if (l.outlineSpace === "shadow") this.objects.lens.scale.set(1, 1, 1);
      dispose(this.objects.lens);
      const useRelief = !this.model && state.view.relief && this.relief?.valid;
      const geometry = this.model
        ? geometryFromMesh(this.model)
        : useRelief
          ? reliefGeometry(state, this.relief)
          : apertureGeometry(state, source);
      if (!useRelief) geometry.computeVertexNormals();
      const meshes = lensMeshes(geometry, l, state.reflect),
        material = meshes.find((m) => m.userData.lensSurface).material;
      this.objects.lens.add(...meshes);
      this.host.dataset.opticalElement = state.reflect ? "mirror" : "lens";
      // Cap boundary is readable without drawing hundreds of thousands of optical facets.
      if (!this.model && !useRelief) {
        const edges = new T.LineSegments(
          new T.EdgesGeometry(geometry, 28),
          new T.LineBasicMaterial({
            color: state.reflect ? 0xc7d9ed : 0x90e8d1,
            transparent: true,
            opacity: 0.4,
          }),
        );
        this.objects.lens.add(edges);
      }
      this.host.dataset.reliefPreview = JSON.stringify({
        visible: Boolean(useRelief),
        pvMM: useRelief ? this.relief.pvMM : null,
        previewDepthMM: geometry.userData.previewDepthMM ?? null,
        opacity: material.opacity,
        transparent: material.transparent,
        heatmap: material.vertexColors,
        transparencyPass: state.reflect
          ? "opaque-mirror"
          : "nearest-depth-then-alpha",
        transmission: material.transmission,
      });
    }
    const targetKey = JSON.stringify([
      receiverSide,
      t.width,
      t.height,
      t.boardFactor,
      target?.revision,
      t.corners,
      state.view.display,
      state.view.exposure,
      Boolean(this.trace),
    ]);
    if (
      targetKey !== this.targetKey &&
      !(this.dragging && this.selected === "target")
    ) {
      this.targetKey = targetKey;
      dispose(this.objects.target);
      this.targetTexture?.dispose();
      this.targetImage = null;
      this.traceImage = null;
      const board = new T.Mesh(
        plane(t.height * t.boardFactor, t.width * t.boardFactor),
        new T.MeshStandardMaterial({
          color: 0x35423f,
          roughness: 1,
          metalness: 0,
          side: T.DoubleSide,
        }),
      );
      // The full-solid projected mesh below supplies a hard geometric shadow.
      board.receiveShadow = false;
      this.targetBoard = board;
      this.objects.target.add(board);
      this.objects.target.add(
        line(
          corners(
            t.height * t.boardFactor,
            t.width * t.boardFactor,
            receiverSide * 0.04,
          ),
          0x778980,
          0.25,
        ),
      );
      this.objects.target.add(
        line(
          [
            ...patternLayout(state).loops[0],
            patternLayout(state).loops[0][0],
          ].map(([x, y]) => [x, y, receiverSide * 0.08]),
          0xe9c67b,
          0.8,
          true,
        ),
      );
      const display = state.view.display;
      if (display !== "trace" || !this.trace) {
        this.targetTexture = new T.CanvasTexture(target);
        this.targetTexture.colorSpace = T.SRGBColorSpace;
        const geometry = plane(
            t.height * t.boardFactor,
            t.width * t.boardFactor,
          ),
          uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++)
          uv.setXY(
            i,
            (uv.getX(i) - 0.5) * t.boardFactor + 0.5,
            (uv.getY(i) - 0.5) * t.boardFactor + 0.5,
          );
        const image = new T.Mesh(
          geometry,
          installSourceBlur(
            new T.MeshBasicMaterial({
              map: this.targetTexture,
              color: 0xffffff,
              transparent: true,
              opacity: display === "compare" ? 0.3 : 0.85,
              blending: T.AdditiveBlending,
              depthWrite: false,
              side: T.DoubleSide,
              toneMapped: false,
            }),
          ),
        );
        image.position.z = receiverSide * 0.12;
        image.userData.ignoreSelect = true;
        this.targetImage = image;
        this.objects.target.add(image);
      }
      if (this.trace && display !== "target") {
        const rgba = this.tracePixels(state.view.exposure);
        this.traceTexture?.dispose();
        this.traceTexture = new T.DataTexture(
          rgba,
          this.trace.size,
          this.trace.size,
          T.RGBAFormat,
        );
        this.traceTexture.colorSpace = T.SRGBColorSpace;
        this.traceTexture.flipY = true;
        this.traceTexture.needsUpdate = true;
        const image = new T.Mesh(
          plane(t.height * t.boardFactor, t.width * t.boardFactor),
          new T.MeshBasicMaterial({
            map: this.traceTexture,
            color: display === "compare" ? 0x7de0fc : 0xfff4d7,
            transparent: true,
            blending: T.AdditiveBlending,
            depthWrite: false,
            side: T.DoubleSide,
            toneMapped: false,
          }),
        );
        image.position.z = receiverSide * 0.16;
        image.userData.ignoreSelect = true;
        this.traceImage = image;
        this.objects.target.add(image);
      }
    }
    if (
      this.dragging &&
      this.selected === "target" &&
      t.clipToShadow &&
      this.targetTexture
    ) {
      this.targetTexture.image = target;
      this.targetTexture.needsUpdate = true;
    }
    const blur = sourceBlur(state);
    if (this.targetImage) {
      this.targetImage.position.z = receiverSide * 0.12;
      Object.assign(this.targetImage.material, {
        stencilWrite: Boolean(this.dragging && t.clipToShadow && !state.reflect && !state.view.sourceBlur),
        stencilRef: 1,
        stencilFunc: T.EqualStencilFunc,
        stencilWriteMask: 0,
      });
    }
    if (this.traceImage) this.traceImage.position.z = receiverSide * 0.16;
    updateSourceBlur(
      this.targetImage?.material,
      blur,
      t,
      state.view.sourceBlur,
    );
    this.host.dataset.sourceBlur = JSON.stringify({
      enabled: state.view.sourceBlur,
      widthMM: blur.widthMM,
      heightMM: blur.heightMM,
      ratio: blur.ratio,
    });
    const lightKey = JSON.stringify([light.type, l.width, l.height]);
    if (lightKey !== this.lightKey) {
      this.lightKey = lightKey;
      dispose(this.objects.light);
      const radius = Math.max(3, Math.max(l.width, l.height) * 0.045);
      const core = new T.Mesh(
        new T.SphereGeometry(radius, 24, 16),
        new T.MeshBasicMaterial({ color: 0xffd59a }),
      );
      this.objects.light.add(core);
      for (let i = 0; i < (light.type === "point" ? 3 : 1); i++) {
        const ring = new T.Mesh(
          new T.TorusGeometry(
            radius * (light.type === "point" ? 1.8 : 4),
            radius * 0.035,
            6,
            64,
          ),
          new T.MeshBasicMaterial({
            color: 0xa68553,
            transparent: true,
            opacity: 0.6,
          }),
        );
        if (i === 1) ring.rotation.x = Math.PI / 2;
        if (i === 2) ring.rotation.y = Math.PI / 2;
        this.objects.light.add(ring);
      }
      if (light.type === "parallel") {
        const arrow = new T.ArrowHelper(
          vec([0, 0, -1]),
          vec([0, 0, -radius * 2]),
          radius * 7,
          0xdfb874,
          radius,
          radius * 0.55,
        );
        this.objects.light.add(arrow);
      }
    }
    const point = light.type === "point";
    this.parallel.visible = !point;
    this.point.visible = point;
    this.parallel.castShadow = this.point.castShadow = state.view.shadow;
    this.point.position.fromArray(light.position);
    const c = vec(l.position),
      d = direction(state);
    this.parallel.position
      .copy(c)
      .addScaledVector(d, -Math.max(500, Math.max(l.width, l.height) * 6));
    this.parallel.target.position.copy(c);
    const camera = this.parallel.shadow.camera,
      range = Math.max(t.height, t.width, l.width, l.height) * 2;
    camera.left = camera.bottom = -range;
    camera.right = camera.top = range;
    camera.far = Math.max(10000, range * 10);
    camera.updateProjectionMatrix();
    const castKey = JSON.stringify([
      lensKey, l.position, l.rotation, l.width, l.height, l.thickness,
      light.type, light.position, light.rotation, range,
    ]);
    if (castKey !== this.castKey) {
      this.castKey = castKey;
      this.renderer.shadowMap.needsUpdate = true;
    }
    const boardCorners = corners(
      t.height * t.boardFactor,
      t.width * t.boardFactor,
    ).map((p) =>
      vec(p).applyQuaternion(quaternion(t.rotation)).add(vec(t.position)),
    );
    const floor =
      Math.max(l.position[0] + l.height / 2, ...boardCorners.map((p) => p.x)) +
      12;
    this.ground.position.x = floor;
    this.grid.position.x = floor - 0.03;
    this.grid.visible = this.ground.visible = state.view.grid;
    this.updateShadow();
    this.updateRays();
    this.updateDimensions();
    this.attach();
    this.request();
  }
  tracePixels(exposure) {
    const t = this.trace,
      pixels = new Uint8Array(t.size * t.size * 4),
      positive = Array.from(t.raster)
        .filter((v) => v > 0)
        .sort((a, b) => a - b),
      p99 = positive[Math.floor(positive.length * 0.985)] || 1,
      scale = (255 * exposure) / p99;
    for (let i = 0; i < t.raster.length; i++) {
      const v = Math.min(255, t.raster[i] * scale);
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    }
    return pixels;
  }
  updateShadow() {
    this.shadow.visible = this.state.view.shadow;
    const data = this.solidShadowData;
    // Selection, exposure and camera controls do not change the solid shadow.
    // Keep its GPU buffer instead of uploading millions of vertices again.
    if (this.renderedShadow === data) return;
    this.renderedShadow = data;
    this.host.dataset.shadowSurface = data?.actualModel
      ? "model-solid"
      : "extruded-solid";
    this.host.dataset.shadowTriangles = String(
      data?.indices ? data.indices.length / 3 : (data?.positions.length || 0) / 9,
    );
    this.host.dataset.shadowBounds = data
      ? JSON.stringify([data.min, data.max])
      : "";
    if (!data?.positions.length) {
      dispose(this.shadow);
      return;
    }
    const t = this.state.target,
      clip = [axis(t, 0), axis(t, 1)];
    const clippingPlanes = [];
    for (let i = 0; i < 2; i++)
      for (const sign of [-1, 1]) {
        const normal = clip[i].clone().multiplyScalar(sign),
          half = ((i === 0 ? t.height : t.width) * t.boardFactor) / 2;
        clippingPlanes.push(
          new T.Plane(normal, half - normal.dot(vec(t.position))),
        );
      }
    this.renderer.localClippingEnabled = true;
    let mesh = this.shadow.children[0];
    if (mesh?.geometry.index?.array === data.indices &&
        mesh?.geometry.attributes.position.array.length === data.positions.length) {
      mesh.geometry.attributes.position.array = data.positions;
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.material.clippingPlanes = clippingPlanes;
    } else {
      dispose(this.shadow);
      const material = new T.MeshBasicMaterial({
        color: 0x050809, side: T.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, clippingPlanes,
        stencilWrite: true, stencilRef: 1, stencilFunc: T.AlwaysStencilFunc,
        stencilZPass: T.ReplaceStencilOp,
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(data.positions, 3).setUsage(T.DynamicDrawUsage));
      if (data.indices) geometry.setIndex(new T.BufferAttribute(data.indices, 1));
      mesh = new T.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.shadow.add(mesh);
    }
    const shadowSide =
      Math.sign(
        (this.state.light.type === "point"
          ? vec(this.state.light.position).sub(vec(t.position))
          : direction(this.state).negate()
        ).dot(axis(t, 2)),
      ) || 1;
    mesh.position.copy(worldPoint(t, [0, 0, shadowSide * 0.035]));
    mesh.quaternion.copy(quaternion(t.rotation));
  }
  updateRays() {
    dispose(this.rays);
    const s = this.state;
    this.rays.visible = s.view.rays;
    if (!s.view.rays) return;
    const guides = illuminationGuides(s, this.shadowData);
    for (const guide of guides)
      this.rays.add(
        line(
          [guide.origin, guide.aperture, guide.end].filter(Boolean),
          0xe3e9eb,
          0.42,
        ),
      );
    if (s.reflect && this.shadowData) {
      const normal = axis(s.target, 2),
        side =
          Math.sign(
            vec(s.lens.position).sub(vec(s.target.position)).dot(normal),
          ) || 1;
      for (const loop of this.shadowData.worldLoops)
        this.rays.add(
          line(
            [...loop, loop[0]].map((p) =>
              p.clone().addScaledVector(normal, side * 0.05),
            ),
            0xb5c9e3,
            0.6,
          ),
        );
    }
    this.rays.add(
      line(
        [
          worldPoint(s.lens, this.aperture.center),
          patternLayout(s).centerWorld,
        ],
        0xf1c574,
        0.85,
      ),
    );
    this.host.dataset.shadowRays = String(guides.filter((g) => g.end).length);
    this.host.dataset.incidentRays = String(guides.length);
    this.host.dataset.targetRays = "1";
    this.host.dataset.rayPath = s.reflect
      ? "specular-reflection"
      : "straight-shadow";
  }
  updateLensDimensions() {
    const object = this.objects.lens,
      mesh = object.children.find((o) => o.isMesh);
    if (!mesh) return;
    this.lensDimensions.position.copy(object.position);
    this.lensDimensions.quaternion.copy(object.quaternion);
    this.lensDimensions.scale.copy(object.scale);
    const key = `${mesh.geometry.id}:${object.scale.toArray()}`;
    if (this.lensDimensionKey === key) return;
    this.lensDimensionKey = key;
    dispose(this.lensDimensions);
    this.lensMeasureAnchors = {};
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    const { min, max } = box,
      center = box.getCenter(new T.Vector3()),
      size = box.getSize(new T.Vector3()),
      gap = Math.max(size.x, size.y, size.z) * 0.075;
    this.lensDimensions.position.copy(object.position);
    this.lensDimensions.quaternion.copy(object.quaternion);
    this.lensDimensions.scale.copy(object.scale);
    const rail = (points, opacity = 0.55) => {
      const l = line(points, 0xb6c9c5, opacity);
      l.material.depthTest = false;
      l.material.depthWrite = false;
      l.renderOrder = 41;
      this.lensDimensions.add(l);
    };
    // Fixed local edges, following the main viewer's Inspect dimensions.
    // Orbiting the camera changes only their projection, never their anchors.
    const h = [
        [min.x, min.y - gap, min.z - gap],
        [max.x, min.y - gap, min.z - gap],
      ],
      w = [
        [min.x - gap, min.y, min.z - gap],
        [min.x - gap, max.y, min.z - gap],
      ],
      t = [
        [min.x - gap, min.y - gap, min.z],
        [min.x - gap, min.y - gap, max.z],
      ];
    for (const pair of [h, w, t]) rail(pair);
    for (const x of [min.x, max.x])
      rail(
        [
          [x, min.y, min.z],
          [x, min.y - gap * 1.4, min.z - gap],
        ],
        0.25,
      );
    for (const y of [min.y, max.y])
      rail(
        [
          [min.x, y, min.z],
          [min.x - gap * 1.4, y, min.z - gap],
        ],
        0.25,
      );
    for (const z of [min.z, max.z])
      rail(
        [
          [min.x, min.y, z],
          [min.x - gap * 1.4, min.y - gap, z],
        ],
        0.25,
      );
    for (const z of [min.z, max.z])
      rail(
        [
          [min.x, min.y, z],
          [max.x, min.y, z],
          [max.x, max.y, z],
          [min.x, max.y, z],
          [min.x, min.y, z],
        ],
        0.15,
      );
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        rail(
          [
            [x, y, min.z],
            [x, y, max.z],
          ],
          0.15,
        );
    this.lensMeasureAnchors = {
      lensHeight: vec([center.x, min.y - gap, min.z - gap]),
      lensWidth: vec([min.x - gap, center.y, min.z - gap]),
      lensThickness: vec([min.x - gap, min.y - gap, center.z]),
    };
    const mm = (v) => Number(v.toFixed(1)).toLocaleString(),
      pv =
        !this.model && this.state.view.relief && this.relief?.valid
          ? this.relief.pvMM
          : null,
      measured = size.clone().multiply(object.scale);
    this.labels.lensHeight.textContent = `高 ${mm(measured.x)} mm`;
    this.labels.lensWidth.textContent = `宽 ${mm(measured.y)} mm`;
    this.labels.lensThickness.innerHTML = `厚 ${mm(measured.z)} mm${pv === null ? "" : `<small>（起伏 ≈ ${mm(pv)} mm）</small>`}`;
    this.lensSizeMM = {
      heightMM: measured.x,
      widthMM: measured.y,
      thicknessMM: measured.z,
      reliefMM: pv,
    };
    this.host.dataset.lensDimensions = JSON.stringify({
      heightMM: measured.x,
      widthMM: measured.y,
      thicknessMM: measured.z,
      reliefMM: pv,
    });
  }
  updateDimensions() {
    this.updateLensDimensions();
    dispose(this.dimensions);
    const s = this.state;
    this.dimensions.visible = s.view.dimensions && !this.receiverFocus;
    if (!this.dimensions.visible) return;
    const l = worldPoint(s.lens, this.aperture.center),
      t = vec(s.target.position),
      offset = axis(s.lens, 1).multiplyScalar(
        Math.max(s.lens.width, s.target.width) * 0.7,
      );
    // Fixed on the lens's right side. Camera orbit must never move this rail.
    this.measurePoints = [l.clone().add(offset), t.clone().add(offset)];
    this.dimensions.add(
      line(this.measurePoints, 0x71978f, 0.5, true),
      line([l, this.measurePoints[0]], 0x66877f, 0.2),
      line([t, this.measurePoints[1]], 0x66877f, 0.2),
    );
    this.lampMeasure = [
      l.clone().add(offset),
      vec(s.light.position).add(offset),
    ];
    this.host.dataset.dimensionAnchors = JSON.stringify(
      [...this.measurePoints, ...this.lampMeasure].map((p) => p.toArray()),
    );
    if (s.light.type === "point")
      this.dimensions.add(line(this.lampMeasure, 0x94866b, 0.4, true));
  }
  updateLabels() {
    const s = this.state;
    if (!s) return;
    const anchors = {
      distance: this.measurePoints?.[0]
        .clone()
        .lerp(this.measurePoints[1], 0.5),
      lampDistance: this.lampMeasure?.[0]
        .clone()
        .lerp(this.lampMeasure[1], 0.5),
    };
    this.labels.distance.textContent = `${worldPoint(s.lens, this.aperture.center).distanceTo(vec(s.target.position)).toFixed(0)} mm`;
    this.labels.lampDistance.textContent = `${worldPoint(s.lens, this.aperture.center).distanceTo(vec(s.light.position)).toFixed(0)} mm`;
    for (const [key, p] of Object.entries(this.lensMeasureAnchors || {}))
      anchors[key] = p.clone().applyMatrix4(this.lensDimensions.matrixWorld);
    for (const [key, p] of Object.entries(anchors)) {
      const e = this.labels[key];
      if (!p) {
        e.hidden = true;
        continue;
      }
      const v = p.project(this.camera);
      e.hidden =
        this.receiverFocus ||
        (this.lensFocus && !key.startsWith("lens")) ||
        (!this.lensFocus && key.startsWith("lens")) ||
        !s.view.dimensions ||
        v.z > 1 ||
        v.z < -1 ||
        Math.abs(v.x) > 1 ||
        Math.abs(v.y) > 1 ||
        (key === "lampDistance" &&
          this.measurePoints?.[1].distanceTo(this.lampMeasure?.[1]) < 0.01) ||
        (key.includes("istance") &&
          (!s.view.dimensions ||
            (key === "lampDistance" && s.light.type !== "point")));
      e.style.left = `${(v.x * 0.5 + 0.5) * this.host.clientWidth}px`;
      e.style.top = `${(-v.y * 0.5 + 0.5) * this.host.clientHeight}px`;
    }
  }
  fit(mode = "perspective") {
    if (!this.state) return;
    this.receiverFocus = mode === "target";
    this.lensFocus = mode === "lens";
    this.cameraMode = mode;
    this.attach();
    document
      .querySelectorAll("[data-camera]")
      .forEach((b) => b.classList.toggle("active", b.dataset.camera === mode));
    const s = this.state,
      t = s.target;
    this.camera.up.set(-1, 0, 0);
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight;
    let center = vec(s.lens.position).lerp(vec(s.target.position), 0.45),
      distance,
      d;
    if (mode === "lens") {
      center = worldPoint(s.lens, [
        ...this.aperture.center,
        -s.lens.thickness * 0.5,
      ]);
      d = vec([-0.38, -0.55, s.reflect ? 0.74 : -0.74])
        .normalize()
        .applyQuaternion(quaternion(s.lens.rotation));
      this.camera.up.copy(axis(s.lens, 0).negate());
      distance = (this.aperture.size * 2.65) / Math.min(1, this.camera.aspect);
    } else if (mode === "target") {
      center = vec(t.position);
      d = axis(t, 2);
      this.camera.up.copy(axis(t, 0).negate());
      distance =
        ((Math.max(t.width / this.camera.aspect, t.height) * t.boardFactor) /
          (2 * Math.tan((this.camera.fov * Math.PI) / 360))) *
        1.35;
    } else {
      d =
        mode === "side"
          ? vec([0, -1, 0.06]).normalize()
          : vec(
              s.reflect ? [-0.38, -0.9, -0.55] : [-0.38, -0.6, 0.71],
            ).normalize();
      const points = corners(
        t.height * t.boardFactor,
        t.width * t.boardFactor,
      ).map((p) =>
        vec(p).applyQuaternion(quaternion(t.rotation)).add(vec(t.position)),
      );
      points.push(vec(s.light.position));
      points.push(
        ...this.aperture.loops
          .flat()
          .map(([x, y]) => [x, y, 0])
          .map((p) =>
            vec(p)
              .applyQuaternion(quaternion(s.lens.rotation))
              .add(vec(s.lens.position)),
          ),
      );
      center = new T.Box3().setFromPoints(points).getCenter(new T.Vector3());
      const right = new T.Vector3().crossVectors(this.camera.up, d).normalize(),
        up = new T.Vector3().crossVectors(d, right),
        tan = Math.tan((this.camera.fov * Math.PI) / 360),
        usableHeight = Math.max(0.46, 1 - 230 / this.host.clientHeight);
      distance =
        Math.max(
          ...points.map((point) => {
            const p = point.clone().sub(center),
              z = p.dot(d);
            return Math.max(
              Math.abs(p.dot(right)) / (tan * this.camera.aspect * 0.84) + z,
              Math.abs(p.dot(up)) / (tan * usableHeight) + z,
            );
          }),
        ) * 1.08;
    }
    this.camera.position.copy(center).addScaledVector(d, distance);
    this.orbit.target.copy(center);
    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = Math.max(10000, distance * 20);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.request();
  }
}
