import { apertureLayout } from "./layout-geometry.js";
import { canonicalJSON } from "./project-identity.js";

// No DOM, downloads, account state or order-system API calls. A future client
// can use the same contract with its own archive, digest and delivery adapters.
export async function makeHandoff(packet, manifest, workspace, files, digest) {
  const s = packet.scene, l = s.lens, aperture = apertureLayout(s);
  const unlocked = ({locked, ...value}) => value;
  const model = workspace.model;
  const design = {
    version: 1, units: "mm", reflect: s.reflect,
    lens: unlocked(l), light: unlocked(s.light), target: unlocked(s.target),
    source_blur_enabled: s.view.sourceBlur,
    images: Object.fromEntries(["source", "target"].map(role =>
      [role, files[manifest.prepared[role]].sha256])),
    model: model ? {
      positions: model.positions.sha256, indices: model.indices.sha256,
      scale: model.scale, flipped: model.flipped,
    } : null,
  };
  const reference = role => ({
    ...files[manifest.prepared[role]], path: manifest.prepared[role],
    original_path: manifest.originals[role]?.path || null,
  });
  const issues = packet.warnings.map(({code, level}) => ({code, severity: level}));
  return {
    format: "caustic-layout-handoff", version: 1, units: "mm",
    project: {
      ...s.project, title: s.title,
      design_revision: `sha256:${await digest(canonicalJSON(design))}`,
      revision_algorithm: "layout-design-v1",
      exported_at: packet.created_at,
    },
    configuration: manifest.configuration,
    images: {source: reference("source"), target: reference("target")},
    lens: {
      element: s.reflect ? "mirror" : "refractive_lens",
      outline: {
        preset: l.shape, reference: l.outlineSpace,
        reference_width_mm: l.width, reference_height_mm: l.height,
        corner_radius_mm: l.cornerRadius, rotation_deg: l.outlineRotation,
        polygon: l.shape === "polygon" ? {sides: l.sides, regular: l.regularPolygon} : null,
      },
      aperture: {
        width_mm: aperture.width, height_mm: aperture.height,
        long_side_mm: aperture.size,
        // Actual entrance footprint, after inverse shadow projection. Coordinates
        // use the same local row/column axes as the configuration packet.
        contours_mm: aperture.loops,
      },
      thickness: {
        value_mm: model ? model.dimensions[2] * model.scale : l.thickness,
        basis: model ? "imported_model" : l.thicknessAuto ? "automatic_preview" : "user_specified",
        requested_mm: !model && !l.thicknessAuto ? l.thickness : null,
      },
      refractive_index: s.reflect ? null : l.n,
    },
    projection: {
      width_mm: s.target.width, height_mm: s.target.height,
      clipped_to_shadow: s.target.clipToShadow,
    },
    optics: {
      light_type: s.light.type,
      configuration: packet.configuration,
      source_blur_enabled: s.view.sourceBlur,
    },
    model: model ? {
      name: model.name,
      width_mm: model.dimensions[1] * model.scale,
      height_mm: model.dimensions[0] * model.scale,
      thickness_mm: model.dimensions[2] * model.scale,
      positions: model.positions.path, indices: model.indices.path,
      workspace: manifest.workspace,
    } : null,
    review: {
      status: "unreviewed", human_review_required: true,
      issues,
      surface_relief_estimate_mm: packet.estimates.surface_relief?.pv_mm ?? null,
      model_trace: workspace.trace ? {status: "preview_only", stats: workspace.trace.stats} : {status: "not_run"},
    },
    files,
  };
}
