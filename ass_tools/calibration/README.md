# ASS 颜色校准夹具

这里用小样分开检查三件事：ASS 的 RGB 数字、视频矩阵/范围转换、截图在浏览器色彩管理后的 sRGB 取色。不要把其中一种口径的误差当作另一种口径的验收。

## 使用工具

1. 默认使用「原样 RGB → ASS」。旧经验公式仍可选择，但不再自动套用。
2. 对实际视频，用同一 IINA 和同一截图方式分别保存外挂 ASS 预览及压制成片。保持同帧、同像素区域与同一套播放设置。
3. 展开校准区，加载截图并点击纯色内部。工具按浏览器色彩管理转换至 sRGB 后，取 5×5 区域中位数；同时显示不均匀程度及 PNG 色彩描述。
4. 记录写进 ASS 的原始 RGB、IINA 预览 RGB、成片截图 RGB。至少 6 组、推荐 12–24 组不同色相和亮度；灰阶不足以拟合三维仿射矩阵。
5. 计算校准后查看训练残差、逐个留出验证误差及输入截断提示。再次压制小样并用同口径截图比较，只有这一步可以验证改善。
6. 导出 JSON 保存样本和流程记录。网页不上传文件，不自动永久保存校准。

拟合只支持仿射关系。截图色彩管理、HDR、透明叠加或非线性曲线可能不适用；数学预测也不能代替重新渲染。已经接近一致的流程往往适合原样转换，微小整数补偿有时会使误差增加。

## 生成与采样

需要已安装、带 libass/libx264 的 FFmpeg、Python 3；无需第三方 Python 包。

```sh
python3 ass_tools/calibration/calibrate.py generate
python3 ass_tools/calibration/calibrate.py sample ass_tools/calibration/output/ffmpeg-none.png
node --test ass_tools/tests/color-model.test.cjs
```

默认输出在 `ass_tools/calibration/output/`，已排除在 Git 跟踪外。包含 1280×720、6 秒、BT.709 limited SDR 小样，24 个不透明 ASS 矢量色块，四种 ASS Matrix 头部以及压制视频。Python 采样是 **原始解码 RGB** 的 11×11 中位数，不做浏览器 ICC/cICP 色彩管理。

## IINA 原生截图

仅在已经安装官方 IINA 的 macOS 上执行：

```sh
python3 ass_tools/calibration/capture_iina.py
```

脚本调用官方 `iina-cli`，在独立 IINA 实例中播放上述夹具，通过唯一 mpv IPC socket 截图并记录版本、视频属性和运行参数。临时参数包括 `sub-ass-override=no`、`screenshot-tag-colorspace=no`，不写用户的偏好文件。截图完成只关闭该夹具实例，不关闭原先的 IINA。为避免异步加载后取得空帧，切换 ASS 后短暂解码新帧，再截图；还检查黑白色块是否存在。

这些是播放器原生 PNG 截图，**不是 macOS 桌面截图**。显示器 ICC、True Tone、HDR、截图工具及软件版本都可能改变实际屏幕取色结果，应另建同口径样本。

## 源文件关系

GitHub Pages 的 `ass_tools/index.html`、`app.js`、`color-model.js` 是这里的规范实现。本地 `Sub/sub/_src/ass_tools.html` 和 `color_correction.html` 保持独立打开能力，由脚本内嵌上述资源；后者默认打开颜色页。只有明确选择同步时执行：

```sh
python3 ass_tools/calibration/sync_sources.py /Users/graysonwu/Documents/Sub/sub/_src
```

## 原理来源

- [libass 的 ASS_YCbCrMatrix 说明](https://github.com/libass/libass/blob/master/libass/ass_types.h)：矩阵头部用于历史 VSFilter 兼容；`None` 请求原样 RGB，具体转换由使用 libass 的应用负责。
- [FFmpeg 8.1 字幕滤镜源代码](https://github.com/FFmpeg/FFmpeg/blob/n8.1/libavfilter/vf_subtitles.c)：按 ASS Matrix 选择绘制矩阵和范围，`None` 使用输入视频属性。
- [FFmpeg 7.1 字幕滤镜源代码](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavfilter/vf_subtitles.c)：该版本直接使用视频属性，不能把本次 8.1 行为推广到所有旧版本。
- [mpv 0.38.0 选项说明](https://github.com/mpv-player/mpv/blob/v0.38.0/DOCS/man/options.rst)：包含 ASS 色彩兼容、样式覆盖、截图色彩标签与截图软件渲染的独立选项。

本轮结果和边界见 [REPORT_20261004.md](REPORT_20261004.md)。
