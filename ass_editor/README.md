# ASS Studio

这个目录可直接由静态服务器运行，无需 npm 安装或构建。

- `src/app.mjs`：可读的页面、视频预览与播放管理代码。
- `src/ass-document.mjs`：无损 ASS 解析/表格编辑/时间验证逻辑。
- `src/ass-encoding.mjs`：保留 UTF-8 / UTF-16 编码与 BOM 的文件读取/导出。
- `src/editor.css`：响应式页面样式。
- `assets/runtime.js`：从已有发布包中原样提取的 React 与 ASS.js 运行库，保留原许可证注释。
- `assets/index-BVUNoDab.js` 与原 CSS：未改动的旧发布产物，可作恢复参考；新页面不再加载它们。

原开发工程未在 Documents 或 Downloads 中找到，因此把可维护应用源码放回当前网站仓库，而不继续编辑压缩包。`index.html` 使用相对路径，可在非域名根目录预览。

运行：在网站仓库根目录执行 `python3 -m http.server 8768 --bind 127.0.0.1`，打开 `/ass_editor/`。

回归验证：`node --test ass_editor/tests/*.test.mjs`。

表格编辑尊重每条字幕对应的 `Format`（包括重排及额外字段），保留未改动行、注释、样式、BOM 与换行；文字中的逗号和首尾空格不丢失。文字框的真实换行转为 ASS 的 `\N`。元数据字段禁止插入新字段或新行。无效时间显示错误并暂停预览/导出，修正后自动恢复。

视频与字幕在本地浏览器中处理。网页 ASS.js 预览用于校对文字和时间，复杂特效、字体和最终颜色仍须由 IINA / FFmpeg 实际验证。这个工具没有校准颜色映射。

实际文件导入从字节读取，支持 UTF-8（含/不含 BOM）与带 BOM 的 UTF-16 LE/BE，导出保留其编码。无效 UTF-8、旧 ANSI/GBK 和无 BOM UTF-16 会明确报错，避免静默生成乱码。
