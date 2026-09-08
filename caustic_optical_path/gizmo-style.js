import * as T from "./vendor/three.module.min.js";

// Restyle only the visible geometry. Generous picking volumes remain easy to grab.
export function styleGizmo(control) {
  const root = control.children.find((c) => c.isTransformControlsGizmo);
  const palette = {
    X: 0xe6a29b,
    Y: 0x9dcbb1,
    Z: 0x9abde5,
    XY: 0x9abde5,
    YZ: 0xe6a29b,
    XZ: 0x9dcbb1,
    XYZ: 0xe5eee8,
    E: 0xd4dfda,
    XYZE: 0x8d9a95,
  };
  const axes = {
    X: new T.Vector3(1, 0, 0),
    Y: new T.Vector3(0, 1, 0),
    Z: new T.Vector3(0, 0, 1),
  };
  const material = (name, opacity = 0.94) =>
    new T.MeshBasicMaterial({
      color: palette[name],
      opacity,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: T.DoubleSide,
    });
  const mesh = (geometry, name, opacity) => {
    const m = new T.Mesh(geometry, material(name, opacity));
    m.name = name;
    m.renderOrder = Infinity;
    return m;
  };
  for (const mode of ["translate", "scale"]) {
    root.gizmo[mode].traverse((o) => o.geometry?.dispose());
    root.gizmo[mode].clear();
    for (const [name, axis] of Object.entries(axes)) {
      const q = new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        axis,
      );
      const stem = new T.CylinderGeometry(0.004, 0.004, 0.5, 10)
        .applyQuaternion(q)
        .translate(...axis.clone().multiplyScalar(0.25).toArray());
      const tip = (
        mode === "translate"
          ? new T.ConeGeometry(0.027, 0.09, 24).applyQuaternion(q)
          : new T.BoxGeometry(0.06, 0.06, 0.06)
      ).translate(...axis.clone().multiplyScalar(0.545).toArray());
      root.gizmo[mode].add(mesh(stem, name), mesh(tip, name));
      for (const p of [...root.picker[mode].children].filter(
        (p) => p.name === name,
      )) {
        p.geometry.computeBoundingBox();
        if (p.geometry.boundingBox.getCenter(new T.Vector3()).dot(axis) < 0)
          root.picker[mode].remove(p);
      }
    }
    for (const name of ["XY", "XZ", "YZ"]) {
      const g = new T.BoxGeometry(0.14, 0.14, 0.002).translate(0.16, 0.16, 0);
      if (name === "XZ") g.rotateX(Math.PI / 2);
      if (name === "YZ") g.rotateY(-Math.PI / 2);
      const m = mesh(g, name, 0.22),
        edge = new T.LineSegments(
          new T.EdgesGeometry(g),
          new T.LineBasicMaterial({
            color: palette[name],
            transparent: true,
            opacity: 0.7,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        );
      edge.renderOrder = Infinity;
      m.add(edge);
      root.gizmo[mode].add(m);
    }
    root.gizmo[mode].add(
      mesh(
        mode === "translate"
          ? new T.SphereGeometry(0.037, 20, 12)
          : new T.BoxGeometry(0.06, 0.06, 0.06),
        "XYZ",
        0.9,
      ),
    );
    for (const p of root.picker[mode].children.filter((p) => p.name === "XYZ"))
      p.geometry.scale(0.45, 0.45, 0.45);
  }
  for (const m of root.gizmo.rotate.children) {
    const g = new T.TorusGeometry(m.name === "E" ? 0.75 : 0.5, 0.0055, 8, 128);
    if (m.name === "X") g.rotateY(Math.PI / 2);
    if (m.name === "Y") g.rotateX(Math.PI / 2);
    m.geometry.dispose();
    m.geometry = g;
    m.material = material(m.name, m.name === "XYZE" ? 0.16 : 0.85);
  }
  for (const group of Object.values(root.helper))
    for (const h of [...group.children]) {
      if (["X", "Y", "Z", "AXIS"].includes(h.name)) group.remove(h);
      else {
        h.material = h.material.clone();
        h.material.color.set(0xc4ddd0);
        h.material.opacity = 0.4;
      }
    }
  const update = root.updateMatrixWorld.bind(root);
  root.updateMatrixWorld = function (force) {
    update(force);
    for (const m of this.gizmo[this.mode].children)
      if (
        this.axis &&
        (m.name === this.axis || this.axis.split("").includes(m.name))
      )
        m.material.color.set(0xf2e5b8);
  };
  control.setSize(0.85);
}
