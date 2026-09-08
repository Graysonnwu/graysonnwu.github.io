// Customer-facing English. Longer phrases take precedence over small labels.
export const english = `
焦散光路|Caustic Layout
项目名称|Project name
点击编辑项目名称|Click to rename project
编辑项目名称|Rename project
已保存在此浏览器|Saved in this browser
正在保存…|Saving…
原文件尚未保存，请导出项目|Originals are not saved yet. Export your project.
图片较大，请导出保存|Images are too large for local storage. Export to save.
撤销|Undo
重做|Redo
打开已保存的项目|Open a saved project
导出完整项目，可保存或分享|Save or share your project
导出项目|Export project
导入项目|Import project
分享项目|Share project
保存文件|Save file
导入|Import\u0020
导出|Export\u0020
项目|project
光路与素材|Setup and images
光路设置|Setup
物体参数|Object properties
收起|Collapse\u0020
展开|Expand\u0020
光路预设|Starting layout
4 种预设|4 presets
正射平行光|Normal · parallel
正射点光源|Normal · point
斜射平行光|Oblique · parallel
斜射点光源|Oblique · point
光学元件|Optical element
透射透镜|Lens
反射镜轮廓与尺寸|Mirror shape & size
透镜轮廓与尺寸|Lens shape & size
反射镜形状|Mirror shape
透镜形状|Lens shape
阴影形状|Shadow shape
轮廓参考面|Shape reference
左：透镜形状；右：阴影形状|Left: lens shape; right: shadow shape
直接设置实际透镜的形状|Set the physical lens outline
设置单个入射面的阴影形状，反算透镜轮廓|Choose a shadow outline and derive the lens shape
直接设置光学元件形状|Set the physical outline
用入射面上的平面反射关系反算轮廓|Derive the outline from the flat mirror footprint
用单个入射面的直射阴影反算透镜轮廓|Derive the lens outline from its entrance-face shadow
当前透镜轮廓|Current lens outline
上传轮廓图|Upload outline
白色区域为透镜|White defines the lens
自定义轮廓|Custom outline
圆形|Circle
正方形|Square
长方形|Rectangle
正多边形|Regular polygon
多边形|Polygon
按正多边形计算|Calculated for a regular polygon
圆角半径|Corner radius
边数|Sides
投影图案|Projection image
编辑变形|Warp image
点击更换投影图案|Choose a projection image
当前目标投影图|Current projection image
更换图片|Change image
示例 · 光|Sample · Light
恢复示例图|Restore sample image
重置|Reset
将图案中心移到阴影中心，图案设为正方形，边长匹配阴影包围框的长边。|Center the image on the shadow and fit a square to its longest side.
居中并匹配反射范围尺寸|Center & fit mirror footprint
居中并匹配阴影尺寸|Center & fit shadow
裁剪到反射范围|Clip to mirror footprint
裁剪到阴影范围|Clip to shadow
已裁剪到反射范围|Clipped to mirror footprint
已裁剪到阴影范围|Clipped to shadow
已裁剪到阴影|Clipped to shadow
按整个透镜实体的阴影裁剪，随光路更新。再次点击取消，原图保留。|Clip to the solid lens shadow. Click again to restore the full image.
按入射面的平面反射范围裁剪；实际曲面效果需导入模型追迹。再次点击取消。|Clip to the flat mirror footprint. Click again to undo clipping.
投影面摆放已固定，解除固定后可对齐。|Unlock the screen before aligning it.
图案居中到|Center the image on the\u0020
，方形边长匹配包围框长边。| and fit a square to its longest side.
模型验证|Model check
高级|Advanced
导入计算好的模型|Import model
模型单位|Model units
自动识别|Automatic
相对透镜尺寸|Relative to lens size
毫米|Millimeters
快速 · 5 万束|Quick · 50k rays
标准 · 20 万束|Standard · 200k rays
精细 · 100 万束|Fine · 1M rays
追迹精度|Trace quality
追迹进度|Trace progress
导入后，检查实际曲面在当前光路下的投影。|Import a model to test its projection in this layout.
布局已改变，点击追迹更新结果。|Layout changed. Trace again to update the result.
三维光路场景|3D optical scene
选中物体|Select object
当前光路提示|Layout checks
光路提示|Checks
估算如何使用|About estimates
焦距小于 1 倍或大于 6 倍时提醒。设置厚度小于曲面起伏时提醒。光源模糊需主动开启，超过 4% 时提醒。|Warnings appear for focal ratios outside 1–6×, relief exceeding a specified thickness, or enabled source blur exceeding 4%.
几何阴影包含整个实体、厚度与侧壁。透射模式按实体阴影裁剪；反射模式按入射面的平面反射范围裁剪。轮廓反算均只考虑单个入射面。布置中的反射参考线按平面镜绘制，导入模型后的追迹使用实际曲面法线。|Shadows include the whole solid. Image clipping uses the solid shadow for lenses and a flat-surface footprint for mirrors. Shape matching uses the entrance face. Import a model to trace the actual curved surface.
操作说明|Controls
变换工具|Transform tools
切换世界或物体坐标|Switch between world and local axes
透视视角|Perspective view
正对投影图|View the screen straight on
近看透镜曲面|Inspect the lens surface
显示完整光路|Fit the entire layout
近轴等效焦距与口径之比；小于 1.0 倍或大于 6.0 倍时提醒|Approximate focal length and aperture ratio; warnings below 1.0× or above 6.0×
预览光源尺寸造成的模糊；模型需重新追迹，导出的目标图保持清晰|Preview blur from source size. Models need retracing; exported artwork stays sharp.
在透镜上显示粗估面形；不是制造模型|Preview the estimated surface shape
拖动旋转 · 右键平移 · 滚轮缩放|Drag to orbit · Right-drag to pan · Scroll to zoom
单指旋转 · 双指平移 / 缩放 · 轻点选中物体|One finger: orbit · Two fingers: pan/zoom · Tap to select
固定位置和倾角；透镜仍可面内旋转及调整尺寸|Lock position and tilt; lens size and in-plane rotation remain editable
固定摆放时，面内旋转和尺寸仍可调整。|Size and in-plane rotation remain editable while locked.
取消选择|Deselect
显示设置|View settings
显示与标注|View & dimensions
场景设置|Scene settings
关闭导出窗口|Close export
调整投影图案|Warp projection image
拖动四个角，改变图案在投影面内的形状。|Drag the four corners to reshape the image on the screen.
拖动图像四角进行透视变形|Drag image corners to change perspective
恢复四角|Reset corners
选择一个光路预设，上传轮廓和投影图。|Choose a starting layout, then upload an outline and projection image.
点击场景中的物体，拖动彩色坐标轴。右上参数窗可输入毫米和角度。点击空白处取消选择。|Select an object and drag its colored handles, or enter dimensions and angles in its panel. Tap empty space to deselect.
左侧直接修改轮廓宽高、圆角和厚度。透镜默认固定摆放，尺寸仍可修改。|Edit width, height, corner radius and thickness in the shape panel. A locked lens can still be resized.
“阴影形状”会沿光线反算透镜形状；可将图案居中匹配到实体阴影，或裁剪到阴影内。|Shadow shape derives a lens outline from the desired shadow. Center and fit the image, or clip it to the shadow.
点击“导出项目”保存或分享，重新导入可继续编辑。|Export to save or share your project. Import it later to continue editing.
缩放方块保持比例，单轴柄可改变宽高比。|The square handle scales uniformly; individual axis handles change the aspect ratio.
只有导入实际模型后才会追迹。布置预览中的图案和光线用于说明空间关系。|Ray tracing is available after importing a model. The layout preview shows the intended image and optical arrangement.
请启用 JavaScript 后使用三维编辑器。|Enable JavaScript to use the 3D editor.
面内旋转负90度|Rotate in plane by −90°
面内旋转90度|Rotate in plane by 90°
面内旋转|In-plane rotation
轮廓尺寸|Outline size
材质与厚度|Material & thickness
材料折射率|Refractive index
保持宽高比|Keep aspect ratio
模型等比缩放|Uniform model scaling
按此总厚度约束求解|Use this as the total thickness limit
模型保持原始曲面，整体等比缩放。|The model scales uniformly while preserving its surface.
当前厚度用于摆放，曲面求解后再确认。|Thickness is a layout setting; confirm it after surface design.
投影图尺寸|Image size
编辑图案四角|Edit image corners
接收面范围|Screen extent
相对图案尺寸的倍数|Scale relative to image size
显示内容|Display
期望投影图|Intended image
实际模型追迹|Traced model
叠加 · 目标白 / 追迹蓝|Overlay · image white / trace blue
追迹结果显示亮度|Trace display brightness
自动 · 尺寸 × 0.1|Auto · 10% of lens size
手机闪光灯|Phone flash
理想点光源|Ideal point source
理想平行光|Ideal parallel light
发光面直径|Emitter diameter
光源视直径|Angular diameter
2 mm 是闪光灯发光面的示例值，可按实际光源调整。|2 mm is a flash example. Enter your actual emitter size.
视直径决定光束发散范围；旋转改变中心照射方向。|Angular diameter sets divergence; rotation changes the beam direction.
朝向透镜中心|Aim at lens center
实际透镜|Physical lens
透镜尺寸|Lens size
投影尺寸|Image size
等效焦距|Focal length
投影距离|Projection distance
入射角|Incidence angle
灯距|Source distance
查看光源模糊数据|View source blur estimate
模糊占比|Blur ratio
此项不限制|No source-size limit
>1万|>10k
光源在透镜背面|Source behind lens
投影面与透镜重合|Screen overlaps lens
接收面穿过透镜|Screen intersects lens
入射角较大|Steep incidence
投影面接近侧对光路|Screen nearly edge-on
投影中心在透镜前方|Image in front of lens
投影面在反射镜背面|Screen behind mirror
接收面未接住阴影|Shadow misses screen
阴影超出接收面|Shadow exceeds screen
实体阴影超出接收面|Solid shadow exceeds screen
图案超出接收面|Image exceeds screen
亮区需要的偏折较大|Large deflection required
曲面暂无法可靠估计，当前显示设置厚度的外形。|Surface estimation is unavailable; the preview uses the specified thickness.
曲面暂无法可靠估计|Surface estimate unavailable
透镜实体的阴影超出接收面，可在投影面参数中增大接收面范围。|The solid shadow exceeds the screen. Increase the screen extent.
裁剪后没有亮区。请将图案移进|Clipping removed all bright areas. Move the image into the\u0020
，或取消裁剪。|, or turn clipping off.
裁剪后没有亮区|Clipped image has no bright area
实际模型穿过接收平面，请增大间距或调整摆放后再追迹。|The model intersects the screen. Adjust the layout before tracing.
实际模型穿过接收面|Model intersects screen
当前没有光路提醒。|No layout warnings.
光源模糊数据|Source blur estimate
按当前光源设置估计。|Estimated using the current source settings.
当前未启用。需要时先在光源参数中设置发光面尺寸，再勾选底部的光源模糊。|Disabled. Enter your source size, then enable source blur if needed.
参考光源|Reference source
模糊斑|Blur spot
占图案宽 / 高|Fraction of image width / height
粗略可分辨格数|Approximate resolvable cells
点光源：发光面直径 × 投影距离 ÷ 灯距。平行光：2 × 投影距离 × tan(视直径 / 2)。斜面按夹角展开；未计加工误差。|Point source: emitter diameter × projection distance ÷ source distance. Parallel light: 2 × projection distance × tan(angular diameter / 2). Tilt is included; manufacturing errors are not.
整体倾斜数据|Overall tilt estimate
整体倾角|Overall tilt
倾斜高度差|Wedge height
亮度重心偏离|Brightness center offset from\u0020
按实际亮度重心与折射 / 反射方向估计整体坡度，不含局部起伏，不作为总厚度。|Estimated from brightness distribution and ray direction. Local relief is excluded; this is not the total thickness.
曲面粗估数据|Surface estimate
曲面起伏|Surface relief
厚度约束|Thickness limit
未指定|Not specified
粗估按实际比例显示，可能低估真实起伏。|The estimate is shown at real scale and may underestimate relief.
当前近场或斜射布局的估计误差较大。|This close or oblique layout has greater estimation uncertainty.
阴影和裁剪按设置厚度；制造前需完整求解。|Shadows use the specified thickness. Final surface design is needed before manufacturing.
更多布置数据|More layout details
曲面暂无结果|Surface unavailable
曲面粗估|Surface estimate
已检查|Ready
已统一朝外法线|Outward normals
原始几何法线|Original normals
移除模型，返回布置|Remove model
先移除实际模型，再调整基础轮廓。|Remove the model before editing the base outline.
请输入|Enter a value from\u0020
 之间的数值|.
 到 | to\u0020
接收面没有有效阴影，请先调整光路。|No valid shadow on the screen. Adjust the layout first.
请先解除投影面的固定摆放|Unlock the screen first
分享未完成，可先保存文件再转发。|Sharing did not complete. Save the file and share it from your device.
已打开系统分享。|Opened system sharing.
已停止追迹|Tracing stopped
请先移除实际模型，再更换轮廓|Remove the model before changing the outline
轮廓已更新|Outline updated
投影图已更新，可拖动四角调整形状|Image updated. Drag its corners to reshape it.
未下载？点此保存|Not downloaded? Tap to save
如果浏览器没有自动下载，点击这里保存已准备好的文件|Tap here if the download did not start
投影图没有亮区，请更换图片或调整四角|The image has no bright area. Choose another image or adjust the corners.
正在整理项目…|Preparing file…
可在系统分享菜单中选择微信等应用。|Choose WeChat or another app in the share sheet.
此浏览器不支持文件分享，请先保存再转发。|This browser cannot share files. Save the file, then share it from your device.
项目未能生成|Could not prepare file
项目文件请小于|Project file must be smaller than
导入的投影图|Imported image
导入的轮廓|Imported outline
项目已恢复，图片与摆放参数均已载入|Project restored
模型文件请小于|Model file must be smaller than
请选择 OBJ 或 STEP 文件|Choose an OBJ or STEP file
正在读取模型…|Loading model…
模型读取失败，可重新选择。|Could not load the model. Choose it again.
模型解析失败：|Could not read the model:\u0020
模型需要具有非零厚度的完整实体|Use a closed solid model with non-zero thickness
 单位 = | unit =\u0020
原文件毫米|Original units: mm
实际孔径|Physical aperture
正在建立模型追迹索引…|Preparing model for tracing…
模型已载入，曲面保持原始比例|Model loaded at its original proportions
模型读取失败，请检查入射面和单位。|Could not load the model. Check the entrance face and units.
已恢复项目中的追迹预览，可以继续查看或重新追迹。|Saved trace restored. You can inspect it or trace again.
模型已就绪，可以追迹当前光路。|Model ready to trace.
追迹未完成，请检查模型与光路。|Tracing did not complete. Check the model and layout.
正在追迹|Tracing
命中透镜|Rays entering lens:
图案范围内|Inside image:
光线未命中模型，请检查位置和朝向。|Rays missed the model. Check its position and orientation.
追迹线程出错：|Tracing failed:\u0020
模型索引仍在准备|The model is still being prepared
左上|Top left
右上|Top right
右下|Bottom right
左下|Bottom left
角，方向键可微调| corner; use arrow keys to adjust
已恢复图案|Restored image
已恢复光路；实际模型|Layout restored; please reimport model
已恢复光路；请重新导入实际模型|Layout restored. Reimport the model to continue tracing.
需重新导入|.
页面未能载入：|Could not load the editor:\u0020
。请刷新重试，或使用支持三维显示的浏览器。|. Refresh or try a browser with 3D support.
OBJ 含无效顶点|The OBJ contains invalid vertices
OBJ 面索引无效|The OBJ contains invalid face indices
OBJ 中没有三角网格|The OBJ contains no triangle mesh
模型缺少平面入射面。请将入射面放在 XY 平面，+Z 朝向光源。|The model needs a flat entrance face in the XY plane, with +Z facing the source.
正在读取 STEP 曲面…|Reading STEP surfaces…
无法解析 STEP 实体|Could not read the STEP solid
文件中没有有效的三角网格|The file contains no valid triangle mesh
模型超过 250 万个三角面，请降低导出网格分辨率|The model exceeds 2.5 million triangles. Export a lighter mesh.
模型坐标含无效数值|The model contains invalid coordinates
图片文件请小于 40 MB|Image files must be smaller than 40 MB
这张图片无法读取，请从相册另存为 JPEG 或 PNG 后再选取|This image cannot be read. Save it as JPEG or PNG and try again.
图片像素过大，请缩小到 4000 × 4000 左右|The image is too large. Resize it to around 4000 × 4000 pixels.
轮廓图没有白色区域。白色为透镜，黑色或透明为外部。|The outline contains no white area. White defines the lens; black or transparent areas lie outside it.
亮区需要的偏折超出当前近似范围，请调整光路或用完整求解确认。|Required deflection exceeds the estimate's range. Adjust the layout or confirm with a full surface design.
三维画面暂时中断，场景已保留。请刷新页面恢复。|3D rendering was interrupted. Your layout is retained; refresh to restore the view.
等效焦距小于口径的 1.0 倍，曲面可能较陡、较厚。可增加光路距离，并结合曲面粗估检查。|Focal length is below 1.0× the aperture. The surface may be steep or thick. Increase the optical distances and inspect the surface estimate.
等效焦距大于口径的 6.0 倍，曲面可能过平，细节对加工精度更敏感。可缩短光路距离。|Focal length is above 6.0× the aperture. The surface may be too shallow for reliable manufacturing detail. Consider shorter optical distances.
光源在透镜背面。请把光源移到入射面前方，或转动透镜。|The source is behind the lens. Move it in front of the entrance face or rotate the lens.
投影面与透镜重合，请拉开距离。|The screen overlaps the lens. Increase their separation.
接收平面穿过透镜，请移动或旋转投影面。|The screen intersects the lens. Move or rotate the screen.
光源模糊占图案宽 |Source blur covers\u0020
%、高 |% of image width and\u0020
%，超过 4%。|% of height, exceeding 4%.\u0020
可减小发光面，或调整灯距、投影距离及图案尺寸。|Use a smaller emitter or adjust distances and image size.
可缩短投影距离，或增大图案尺寸。|Reduce projection distance or enlarge the image.
入射角较大，侧面遮挡与反射损失可能增加。|Steep incidence can increase side-wall obstruction and reflection losses.
投影面接近侧对光路，图案拉伸和亮度不均会更明显。|The screen is nearly edge-on. Expect more stretching and uneven brightness.
投影中心在入射面前方，这种透射光路可能无法用单个连续曲面实现。|The image lies in front of the entrance face. A single continuous lens surface may not support this layout.
接收面在反射镜背面。请移到入射面一侧，接住反射光。|The screen is behind the mirror. Move it to the source side to receive reflected light.
接收面未接住完整的直射阴影，无法按阴影对齐。可调整接收面位置或朝向。|The screen misses the direct shadow. Adjust its position or orientation before aligning.
阴影超出了接收面范围。可增大接收面，或居中并匹配阴影尺寸。|The shadow exceeds the screen. Enlarge the screen or center and fit the image.
变形后的图案超出了接收面。请增大接收面范围或收回图案四角。|The warped image exceeds the screen. Enlarge the screen or bring the corners inward.
缺少场景数据|Missing scene data
光路名称或模式无效|Invalid project name or optical mode
显示设置无效|Invalid display settings
位置或旋转数值无效|Invalid position or rotation
尺寸应为 0.1–100000 mm|Dimensions must be between 0.1 and 100000 mm
厚度数值无效|Invalid thickness
折射率应在 1–3 之间|Refractive index must be between 1 and 3
未知的光源或轮廓类型|Unknown source or outline type
发光面尺寸无效|Invalid emitter size
光源视直径应为 0–10°|Angular diameter must be between 0° and 10°
光源模糊预览设置无效|Invalid source blur setting
曲面预览设置无效|Invalid surface preview setting
接收面范围无效|Invalid screen extent
图像四角不能交叉或重叠|Image corners cannot cross or overlap
图像旋转无效|Invalid image rotation
阴影裁剪设置无效|Invalid shadow clipping setting
轮廓面内旋转角无效|Invalid outline rotation
轮廓参考面无效|Invalid shape reference
圆角半径不能为负数|Corner radius cannot be negative
多边形边数应为 3–32|Polygons must have 3–32 sides
自定义轮廓数据无效|Invalid custom outline data
请选择本页面导出的光路 JSON（版本 1）|Choose a project exported by this editor
项目缺少完整的光路设置|The project is missing required layout data
缺少有效的 |Missing a valid\u0020
 图片| image
轮廓跨越投影极限，请调整光路。|The outline exceeds the projection limit. Adjust the layout.
项目包请小于 256 MB|Projects must be smaller than 256 MB
ZIP 文件不完整|Incomplete ZIP file
项目包文件数量过多|The project contains too many files
ZIP 目录无效|Invalid ZIP directory
项目包展开后过大|The unpacked project is too large
项目包含无效文件路径|The project contains an invalid file path
不支持加密或此压缩方式的 ZIP|Encrypted ZIPs or this compression method are unsupported
ZIP 文件头无效|Invalid ZIP header
ZIP 文件被截断|Truncated ZIP file
ZIP 展开大小不符|ZIP size does not match its contents
ZIP 文件校验失败|ZIP integrity check failed
项目超过 256 MB，请降低模型网格分辨率后导出|The project exceeds 256 MB. Reduce the model mesh resolution before exporting.
请选择本页面导出的光路项目包|Choose a project exported by this editor
项目包原图校验失败|Original image integrity check failed
项目中的追迹设置无效|Invalid saved tracing settings
项目模型或追迹数据校验失败|Model or trace integrity check failed
项目中的模型几何无效|Invalid model geometry in project
项目中的追迹预览尺寸无效|Invalid trace preview dimensions
项目中的追迹预览无效|Invalid saved trace preview
项目中的视角数据无效|Invalid saved camera view
项目中的二进制数据长度无效|Invalid binary data length
光源范围内有光线从背面入射，请减小视直径或入射角。|Some rays enter from behind. Reduce angular diameter or incidence angle.
入射光接近与透镜平行，无法追迹|The beam is nearly parallel to the lens plane and cannot be traced
接收面不在|The screen is outside the\u0020
路径内，请调整光源或接收面。| path. Adjust the source or screen.
阴影轮廓越过了投影极限，请减小轮廓、增大灯距或调整接收面。|The shadow outline exceeds the projection limit. Reduce its size, increase source distance or adjust the screen.
轮廓尺寸或投影比例无效。|Invalid outline size or projection scale.
接收面没有有效的直射阴影，请先调整位置或朝向。|There is no valid direct shadow. Adjust the screen position or orientation.
透镜边长|Lens side
透镜宽|Lens width
透镜高|Lens height
反射镜边长|Mirror side
反射镜宽|Mirror width
反射镜高|Mirror height
阴影边长|Shadow side
阴影宽|Shadow width
阴影高|Shadow height
反射范围边长|Footprint side
反射范围宽|Footprint width
反射范围高|Footprint height
曲面起伏约 |Surface relief is about\u0020
 mm，超过设置厚度 | mm, exceeding the set thickness of\u0020
平行光|Parallel light
点光源|Point source
反射范围|mirror footprint
反射光|reflected light
直射阴影|direct shadow
反射镜|Mirror
透镜|Lens
投影面|Screen
光源|Light
光路|Setup
图案|Image
显示|View
射线|Rays
标注|Dimensions
光源模糊|Source blur
平移|Move
旋转|Rotate
缩放|Scale
面内|In plane
自身|Local
世界|World
透视|Perspective
正对投影|Front
侧视|Side
看曲面|Surface
全景|Fit
已固定|Locked
固定|Lock
位置|Position
厚度|Thickness
起伏|Relief
焦距|Focal ratio
模糊|Blur
阴影|shadow
太阳光|Sunlight
发光面|emitter
视直径|angular diameter
边长|Side length
亮度|Brightness
追迹|Trace
停止|Stop
反相|Invert
取消|Cancel
完成|Done
关闭|Close
空白处|Empty space
退出变换|Deselect
宽|Width
高|Height
厚|Thickness
 条| checks
 面| faces
 束| rays
缺少 |Missing\u0020
未知光路预设|Unknown starting layout
反算透镜|derived lens
（|(
）|)
。|.
：|:\u0020
；|;\u0020
，|,\u0020
`
  .trim()
  .split("\n")
  .map((line) => {
    const at = line.indexOf("|");
    return [line.slice(0, at), line.slice(at + 1)];
  });
