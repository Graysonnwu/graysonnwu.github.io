import * as T from "./vendor/three.module.min.js";

// A closed translucent mesh needs a nearest-surface depth pass. Otherwise
// overlapping front/back triangles blend differently as their draw order changes.
// The color pass uses alpha alone, after the artwork/guides have been drawn.
// This is a layout visualization, not a second optical ray trace.
export function lensMeshes(geometry, lens, reflect = false) {
  const material = new T.MeshPhysicalMaterial({
    color: reflect ? 0xc7d6e2 : 0xb0d8d0,
    metalness: reflect ? 0.75 : 0.02,
    roughness: reflect ? 0.13 : 0.16,
    transmission: 0,
    ior: lens.n,
    transparent: !reflect,
    opacity: reflect ? 1 : 0.56,
    depthWrite: reflect,
    side: T.DoubleSide,
    forceSinglePass: true,
  });
  const surface = new T.Mesh(geometry, material);
  surface.castShadow = true;
  surface.userData.lensSurface = true;
  if (reflect) return [surface];
  const depth = new T.Mesh(
    geometry,
    new T.MeshBasicMaterial({
      transparent: true,
      colorWrite: false,
      depthWrite: true,
      side: T.DoubleSide,
      forceSinglePass: true,
    }),
  );
  depth.userData.depthOnly = true;
  depth.userData.ignoreSelect = true;
  depth.renderOrder = 20;
  surface.renderOrder = 21;
  return [depth, surface];
}
