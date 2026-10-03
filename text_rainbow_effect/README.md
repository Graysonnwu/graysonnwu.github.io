# 彩虹文字

开发工程位于 `/Users/graysonwu/Downloads/text-rainbow-effect`。其原 dist 与网站 HEAD 旧包 SHA256 完全一致；已补回源工程修复，lint/build 均通过。

此目录的 index.html 和新 assets/index-*.js/css 是 Vite 构建产物。src/app.mjs、src/color.mjs 和 style.css 是便于审阅的应用源码镜像，页面从构建包启动；不要只改镜像而忘记修改开发源/重新构建。

构建：在开发工程运行 `npm run lint` 和 `npm run build`，复制 dist/index.html 与 dist/assets 文件到本站对应目录。现有旧包保留以兼容已打开页面缓存；不再由新入口加载。

维护前开发源与 dist 备份在 `/Users/graysonwu/Documents/GitClone/_maintenance_backups/20261004-text-rainbow-effect-before`，不包含 node_modules 或环境文件。
