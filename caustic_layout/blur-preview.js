import * as T from "./vendor/three.module.min.js";

// Uniform disk integration in linear light, with an affine map to the receiver
// ellipse. The artwork texture itself stays sharp for export and original view.
const samples = 64;
const kernel = Array.from({ length: samples }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / samples),
    a = i * 2.399963229728653;
  return new T.Vector2(r * Math.cos(a), r * Math.sin(a));
});
export function installSourceBlur(material) {
  const uniforms = {
    sourceBlurU: { value: new T.Vector2() },
    sourceBlurV: { value: new T.Vector2() },
    sourceDisk: { value: kernel },
  };
  material.userData.sourceBlur = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      `uniform vec2 sourceBlurU, sourceBlurV;
uniform vec2 sourceDisk[${samples}];\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = vec4(0.0);
        if (length(sourceBlurU) + length(sourceBlurV) < 0.0000001) {
          if (all(greaterThanEqual(vMapUv, vec2(0.0))) && all(lessThanEqual(vMapUv, vec2(1.0))))
            sampledDiffuseColor = texture2D(map, vMapUv);
        } else {
          for (int i = 0; i < ${samples}; i++) {
            vec2 uv = vMapUv + sourceDisk[i].x * sourceBlurU + sourceDisk[i].y * sourceBlurV;
            if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))))
              sampledDiffuseColor += texture2D(map, uv) / float(${samples});
          }
        }
        sampledDiffuseColor.a = 1.0;
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => "source-disk-preview-v1";
  return material;
}
export function updateSourceBlur(material, estimate, target, enabled) {
  const u = material?.userData.sourceBlur;
  if (!u) return;
  for (const [i, key] of ["sourceBlurU", "sourceBlurV"].entries()) {
    const v = estimate.vectors[i];
    u[key].value.set(
      enabled ? v[0] / target.width / 2 : 0,
      enabled ? -v[1] / target.height / 2 : 0,
    );
  }
}
