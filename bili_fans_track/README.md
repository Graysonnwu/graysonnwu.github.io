# 粉丝数据交互图

真实前端工程在 `/Users/graysonwu/Downloads/bilibili-follower-tracker`，包含 `src/App.tsx`、`src/data-core.mjs`、已有依赖和 Vite 构建配置。该工程修改前 `dist` 的 SHA256 与站点原发布 bundle 完全一致，已经确认对应关系。

在真实工程运行 `npm run lint`、`npm test`、`npm run build`。本目录的 `index.html` 与新哈希 `assets/` 来自当前 `dist` 构建；保留旧发布资产，供短时间仍持有旧 HTML 缓存的浏览者使用。

- CSV 来源：`Bilibili-fans-actions/main/data/<UID>.csv`，按北京时间日历日解释。
- 日期、粉丝数验证与统计集中在可读 `data-core.mjs`，内容与真实工程 `src/data-core.mjs` 一致。
- 排除非法日期、空值、负数、小数及非安全整数。0 粉丝是有效观测。
- 同一天重复记录采用 CSV 中第一条（源仓库按最新记录倒序输出）。跨采集空档的变化是两个观测点之间的日均值。
- 快速切换 UP 主取消前一次请求；加载超时为 20 秒；单点区间显示 0 天。
- 站点根目录运行 `node --test bili_fans_track/data-core.test.mjs` 可独立执行相同离线回归。

源码修改前备份在 `/Users/graysonwu/Documents/GitClone/_maintenance_backups/20261004-bilibili-follower-tracker-before`，含文件 SHA256 清单；没有复制 node_modules、环境文件或凭据。
