# 本地依赖

运行时仅请求本目录中的文件。版本固定，不使用 CDN；文件散列见 `docs/vendor-sha256.json`。

| 依赖 | 版本 / 来源 | 本地文件与改动 | 许可证 |
| --- | --- | --- | --- |
| Three.js | r164 / [官方源码](https://github.com/mrdoob/three.js/tree/r164) | `three.module.min.js` 复用当前仓库版本；`OrbitControls.js`、`TransformControls.js` 的 bare import 改为同目录模块 | `vendor/three.LICENSE.txt`，MIT |
| three-mesh-bvh | 0.7.6 / [npm 发布包](https://www.npmjs.com/package/three-mesh-bvh/v/0.7.6) / [源码](https://github.com/gkjohnson/three-mesh-bvh) | `mesh-bvh.js` 来自 `build/index.module.js`；Three.js import 改为同目录模块 | `vendor/mesh-bvh.LICENSE`，MIT |
| occt-import-js | 0.0.23 / [npm 发布包](https://www.npmjs.com/package/occt-import-js/v/0.0.23) / [源码与构建方法](https://github.com/kovacsv/occt-import-js) | 发布包 JS 与 WASM；JS 末尾增加 `export default occtimportjs;`，WASM 未改动 | `vendor/occt.LICENSE`，LGPL 2.1；另附上游 README |

`occt-import-js` 在 Worker 内加载独立 WASM。可以用同名文件替换为自行构建的版本；接口见上游仓库和随附 `vendor/occt.README.md`。发布网站时保留这些许可证与来源说明。

项目自己实现 OBJ 解析，保留双精度顶点以计算真实几何法线。Three.js 材质平滑法线仅用于显示，不参与 Snell 追迹。
