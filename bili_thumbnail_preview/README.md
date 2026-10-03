# B站封面预览模拟器

纯静态页面，上传/拖拽/粘贴的图片只在本地解码，使用 Blob URL，不发送到服务器。

- 分别维护 4:3、16:9 裁剪框；支持鼠标和触摸 Pointer Events。
- 窗口变化按原图比例保留裁剪区域。使用实际渲染尺寸（含小数像素）转换坐标，避免整像素取整造成预览区域偏差。
- 即时预览按屏幕分辨率绘制（最大宽度 1040 px），分别显示 4:3、16:9 裁剪后的卡片效果。
- 不可解码文件会显示错误并保留之前的有效图片；后选择的图片优先，防止异步读取竞态。
- 文件上限 64 MB / 1 亿像素，用于限制浏览器内存占用；不改变上传图片的原始像素。
- 运行 `node --test bili_thumbnail_preview/crop-geometry.test.mjs` 验证小图边界、横竖图拖动/缩放及响应式坐标映射。

本地开发可从站点根目录启动 HTTP 静态服务器，直接访问本目录。页面使用 ES module，请通过 HTTP 预览。

真实开发源为 `/Users/graysonwu/Documents/Sub/sub/_src/bilibili_thumbnail_preview.html`。该文件同步相同裁剪与预览修复，并内嵌几何函数，可直接独立打开；站点版本则从 `crop-geometry.mjs` 导入相同函数。修改前源文件已备份至 `/Users/graysonwu/Documents/GitClone/_maintenance_backups/20261004-bilibili-thumbnail-preview-before`，含 SHA256 清单。
