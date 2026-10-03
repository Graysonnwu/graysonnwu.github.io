import { analysePixels, splitMass, analysisSize } from './analysis.mjs';

        const canvas = document.getElementById('main-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const emptyState = document.getElementById('empty-state');

        const zoneTarget = document.getElementById('zone-target');
        const fileTarget = document.getElementById('file-target');
        const thumbTarget = document.getElementById('thumb-target');

        const zoneShape = document.getElementById('zone-shape');
        const fileShape = document.getElementById('file-shape');
        const thumbShape = document.getElementById('thumb-shape');

        const checkLock = document.getElementById('check-lock');
        const lockDesc = document.getElementById('lock-desc');

        const elGeoCenter = document.getElementById('geo-center');
        const elTargetCenter = document.getElementById('target-center');
        const elShapeCenter = document.getElementById('shape-center');
        const rowShapeCenter = document.getElementById('row-shape-center');
        const elOffsetDist = document.getElementById('offset-dist');
        const elOffsetMode = document.getElementById('offset-mode');

        let targetImg = new Image();
        let targetData = [];
        let targetTotalMass = 0;
        let targetCenterX = 0; let targetCenterY = 0;
        let imgWidth = 0; let imgHeight = 0;

        let shapeImg = new Image();
        let hasShape = false;
        let shapeCenterX = 0; let shapeCenterY = 0;

        let isLocked = checkLock.checked;

        let p1 = { x: 0, y: 0 };
        let p2 = { x: 0, y: 0 };
        let draggingPoint = null;
        const POINT_RADIUS = 8;

        // 色彩硬编码常量，防止 canvas 不支持 css var 导致颜色丢失
        const C_RED = '#ff4757';
        const C_BLUE = '#1e90ff';
        const C_YELLOW = '#ffa502';
        const C_GREEN = '#2ed573';
        const C_GREY = '#a4b0be';

        checkLock.addEventListener('change', (e) => {
            isLocked = e.target.checked;
            snapP1ToPivot();
            if(targetData.length > 0) queueRender();
        });

        function snapP1ToPivot() {
            if (!isLocked || imgWidth === 0) return;
            p1.x = hasShape ? shapeCenterX : imgWidth / 2;
            p1.y = hasShape ? shapeCenterY : imgHeight / 2;
        }

        function updateLockDescription() {
            if (hasShape) {
                lockDesc.innerHTML = `当前基准：<span style="color:var(--color-green)">透镜形状重心(绿)</span>。<br>锁定后蓝点不可拖动。`;
                elOffsetMode.innerText = "距透镜重心";
            } else {
                lockDesc.innerHTML = `当前基准：<span style="color:var(--color-grey)">图像正中心(虚线)</span>。<br>导入透镜形状后将切换基准。`;
                elOffsetMode.innerText = "距图像中心";
            }
        }

        function setupDropZone(zone, fileInput, loadCallback) {
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault(); zone.classList.remove('dragover');
                if (zone.classList.contains('disabled')) return;
                if (e.dataTransfer.files.length > 0) loadCallback(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) loadCallback(e.target.files[0]);
                e.target.value = '';
            });
        }

        const imageMessage = document.getElementById('image-message');
        const brightnessMode = document.getElementById('brightness-mode');
        const analysisInfo = document.getElementById('analysis-info');
        const clearShape = document.getElementById('clear-shape');
        let targetPixels = null, targetBackground = null;
        let targetGeneration = 0, shapeGeneration = 0, scheduledRender = 0;

        function queueRender() {
            if (scheduledRender) return;
            scheduledRender = requestAnimationFrame(() => { scheduledRender = 0; render(); });
        }

        function imagePixels(image, width, height) {
            const temp = document.createElement('canvas');
            temp.width = width; temp.height = height;
            const context = temp.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, width, height);
            return context.getImageData(0, 0, width, height).data;
        }

        async function loadImageFile(file, kind) {
            const generation = kind === 'target' ? ++targetGeneration : ++shapeGeneration;
            const current = () => generation === (kind === 'target' ? targetGeneration : shapeGeneration);
            const url = URL.createObjectURL(file);
            try {
                if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件');
                const image = new Image(); image.src = url;
                await image.decode();
                if (!current()) return;
                if (kind === 'target') {
                    const size = analysisSize(image.naturalWidth, image.naturalHeight);
                    const pixels = imagePixels(image, size.width, size.height);
                    const analysis = analysePixels(pixels, size.width, size.height, brightnessMode.value);
                    // Commit only after decode and analysis succeed. Invalid uploads keep the previous image.
                    targetImg = image; targetPixels = pixels;
                    imgWidth = size.width; imgHeight = size.height;
                    canvas.width = imgWidth; canvas.height = imgHeight;
                    commitTargetAnalysis(analysis);
                    hasShape = false; shapeGeneration++;
                    rowShapeCenter.style.display = 'none'; clearShape.hidden = true;
                    thumbShape.style.display = 'none'; zoneShape.style.paddingLeft = '';
                    p1 = { x: imgWidth / 2, y: imgHeight / 2 };
                    p2 = { x: imgWidth / 2, y: imgHeight * 0.1 };
                    if (thumbTarget.src.startsWith('blob:')) URL.revokeObjectURL(thumbTarget.src);
                    thumbTarget.src = URL.createObjectURL(file); thumbTarget.style.display = 'block';
                    zoneTarget.style.paddingLeft = '65px';
                    emptyState.style.display = 'none'; canvas.style.display = 'block';
                    zoneShape.classList.remove('disabled'); zoneShape.setAttribute('aria-disabled', 'false');
                    analysisInfo.textContent = `原图 ${image.naturalWidth} × ${image.naturalHeight}；分析 ${imgWidth} × ${imgHeight}。坐标与 px 距离按分析图计算。`;
                } else {
                    if (!targetPixels) throw new Error('请先导入目标亮度图');
                    const analysis = analysePixels(imagePixels(image, imgWidth, imgHeight), imgWidth, imgHeight);
                    shapeImg = image; hasShape = true;
                    shapeCenterX = analysis.x; shapeCenterY = analysis.y;
                    rowShapeCenter.style.display = 'flex'; clearShape.hidden = false;
                    if (thumbShape.src.startsWith('blob:')) URL.revokeObjectURL(thumbShape.src);
                    thumbShape.src = URL.createObjectURL(file); thumbShape.style.display = 'block';
                    zoneShape.style.paddingLeft = '65px';
                }
                imageMessage.textContent = '';
                updateLockDescription(); snapP1ToPivot(); updateStatsPanel(); queueRender();
            } catch (error) {
                if (current()) imageMessage.textContent = error.message || '图片加载失败';
            } finally { URL.revokeObjectURL(url); }
        }

        function commitTargetAnalysis(analysis) {
            targetData = analysis.values; targetTotalMass = analysis.mass;
            targetCenterX = analysis.x; targetCenterY = analysis.y;
            targetBackground = ctx.createImageData(imgWidth, imgHeight);
            for (let i = 0; i < targetData.length; i++) {
                const p = i * 4;
                targetBackground.data[p] = targetBackground.data[p+1] = targetBackground.data[p+2] = targetData[i];
                targetBackground.data[p+3] = 255;
            }
        }

        setupDropZone(zoneTarget, fileTarget, file => void loadImageFile(file, 'target'));
        setupDropZone(zoneShape, fileShape, file => void loadImageFile(file, 'shape'));
        for (const zone of [zoneTarget, zoneShape]) zone.addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && !zone.classList.contains('disabled')) {
                event.preventDefault(); zone.querySelector('input').click();
            }
        });
        brightnessMode.addEventListener('change', () => {
            if (!targetPixels) return;
            commitTargetAnalysis(analysePixels(targetPixels, imgWidth, imgHeight, brightnessMode.value));
            updateStatsPanel(); queueRender();
        });
        clearShape.addEventListener('click', () => {
            shapeGeneration++; hasShape = false; clearShape.hidden = true;
            rowShapeCenter.style.display = 'none';
            if (thumbShape.src.startsWith('blob:')) URL.revokeObjectURL(thumbShape.src);
            thumbShape.removeAttribute('src'); thumbShape.style.display = 'none'; zoneShape.style.paddingLeft = '';
            updateLockDescription(); snapP1ToPivot(); updateStatsPanel(); queueRender();
        });

        function updateStatsPanel() {
            let geoX = imgWidth / 2;
            let geoY = imgHeight / 2;
            elGeoCenter.innerText = `${Math.round(geoX)}, ${Math.round(geoY)}`;
            elTargetCenter.innerText = `${Math.round(targetCenterX)}, ${Math.round(targetCenterY)}`;

            let refX = hasShape ? shapeCenterX : geoX;
            let refY = hasShape ? shapeCenterY : geoY;

            if (hasShape) elShapeCenter.innerText = `${Math.round(shapeCenterX)}, ${Math.round(shapeCenterY)}`;

            let dist = Math.sqrt(Math.pow(targetCenterX - refX, 2) + Math.pow(targetCenterY - refY, 2));
            let diagonal = Math.sqrt(imgWidth * imgWidth + imgHeight * imgHeight);
            let distPercent = (dist / diagonal) * 100;

            elOffsetDist.innerText = `${dist.toFixed(1)} px (${distPercent.toFixed(2)}%)`;
        }

        function render() {
            if (!targetBackground || !(targetTotalMass > 0)) return;

            ctx.putImageData(targetBackground, 0, 0);
            const { a: massA, b: massB, dx, dy } = splitMass(targetData, imgWidth, p1, p2);

            let ratioA_num = (massA / targetTotalMass) * 100;
            let ratioB_num = (massB / targetTotalMass) * 100;
            let ratioA = ratioA_num.toFixed(1) + '%';
            let ratioB = ratioB_num.toFixed(1) + '%';
            document.getElementById('split-ratios').textContent = `${ratioA} / ${ratioB}`;

            // 判断四六分严重偏差 (仅在锁定模式下)
            let isUnbalanced = isLocked && (ratioA_num < 40 || ratioA_num > 60);

            const MAX_SIZE = Math.max(imgWidth, imgHeight) * 2;
            let angle = Math.atan2(dy, dx);

            ctx.save();
            ctx.translate(p1.x, p1.y);
            ctx.rotate(angle);
            ctx.fillStyle = 'rgba(30, 144, 255, 0.25)';
            ctx.fillRect(-MAX_SIZE, 0, MAX_SIZE * 2, MAX_SIZE);
            ctx.fillStyle = 'rgba(255, 165, 2, 0.25)';
            ctx.fillRect(-MAX_SIZE, -MAX_SIZE, MAX_SIZE * 2, MAX_SIZE);
            ctx.restore();

            // 绘制分割线（超差变红加粗）
            let len = Math.sqrt(dx*dx + dy*dy);
            let nx = dx / len;
            let ny = dy / len;
            ctx.beginPath();
            ctx.strokeStyle = isUnbalanced ? C_RED : 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = isUnbalanced ? 3 : 2;
            ctx.moveTo(p1.x - nx*MAX_SIZE, p1.y - ny*MAX_SIZE);
            ctx.lineTo(p2.x + nx*MAX_SIZE, p2.y + ny*MAX_SIZE);
            ctx.stroke();

            // 绘制文字
            const labelSize = Math.max(12, Math.min(42, Math.min(imgWidth, imgHeight) * 0.09));
            ctx.font = `bold ${labelSize}px 'Segoe UI', sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineWidth = Math.max(1, labelSize / 10);
            ctx.strokeStyle = "rgba(0,0,0,0.8)";

            let normalX = -dy / len;
            let normalY = dx / len;
            let midX = isLocked ? p1.x : p1.x + dx * 0.5;
            let midY = isLocked ? p1.y : p1.y + dy * 0.5;
            let textOffset = Math.min(imgWidth, imgHeight) * 0.2;

            let txtAX = midX + normalX * textOffset;
            let txtAY = midY + normalY * textOffset;
            ctx.strokeText(ratioA, txtAX, txtAY);
            ctx.fillStyle = "#70a1ff"; ctx.fillText(ratioA, txtAX, txtAY);

            let txtBX = midX - normalX * textOffset;
            let txtBY = midY - normalY * textOffset;
            ctx.strokeText(ratioB, txtBX, txtBY);
            ctx.fillStyle = "#eccc68"; ctx.fillText(ratioB, txtBX, txtBY);

            // 绘制中心点与准星
            const drawCross = (x, y, color) => {
                ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
                ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y);
                ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12);
                ctx.stroke();
            };

            ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
            ctx.moveTo(imgWidth/2, 0); ctx.lineTo(imgWidth/2, imgHeight);
            ctx.moveTo(0, imgHeight/2); ctx.lineTo(imgWidth, imgHeight/2);
            ctx.stroke(); ctx.setLineDash([]);

            let pivotX = imgWidth / 2;
            let pivotY = imgHeight / 2;
            if (hasShape) {
                pivotX = shapeCenterX; pivotY = shapeCenterY;
                drawCross(shapeCenterX, shapeCenterY, C_GREEN);
            }

            ctx.beginPath(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth=1;
            ctx.moveTo(pivotX, pivotY); ctx.lineTo(targetCenterX, targetCenterY);
            ctx.stroke(); ctx.setLineDash([]);

            drawCross(targetCenterX, targetCenterY, C_RED);
            ctx.beginPath(); ctx.arc(targetCenterX, targetCenterY, 4, 0, Math.PI*2); ctx.fillStyle = C_RED; ctx.fill();

            // P2 (Yellow)
            const pointRadius = POINT_RADIUS * canvas.width / canvas.getBoundingClientRect().width;
            ctx.beginPath(); ctx.arc(p2.x, p2.y, pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = C_YELLOW; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();

            // P1 (Blue)
            ctx.beginPath(); ctx.arc(p1.x, p1.y, pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = C_BLUE; ctx.fill();
            if (isLocked) {
                ctx.lineWidth = 3;
                ctx.strokeStyle = hasShape ? C_GREEN : C_GREY;
            } else {
                ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
            }
            ctx.stroke();
        }

        function getMousePos(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
        }

        function hitRadius(event) {
            // Hit targets stay usable in CSS pixels when the analysis image is scaled down.
            const rect = canvas.getBoundingClientRect();
            return (event.pointerType === 'touch' ? 24 : 16) * Math.max(canvas.width / rect.width, canvas.height / rect.height);
        }

        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const pos = getMousePos(e);
            let d1 = Math.sqrt(Math.pow(pos.x - p1.x, 2) + Math.pow(pos.y - p1.y, 2));
            let d2 = Math.sqrt(Math.pow(pos.x - p2.x, 2) + Math.pow(pos.y - p2.y, 2));
            let threshold = hitRadius(e);

            if (d2 < threshold) {
                draggingPoint = p2;
            } else if (d1 < threshold && !isLocked) {
                draggingPoint = p1;
            }
            if (draggingPoint) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (draggingPoint) {
                const pos = getMousePos(e);
                draggingPoint.x = Math.max(0, Math.min(imgWidth, pos.x));
                draggingPoint.y = Math.max(0, Math.min(imgHeight, pos.y));
                queueRender();
            } else {
                const pos = getMousePos(e);
                let d1 = Math.sqrt(Math.pow(pos.x - p1.x, 2) + Math.pow(pos.y - p1.y, 2));
                let d2 = Math.sqrt(Math.pow(pos.x - p2.x, 2) + Math.pow(pos.y - p2.y, 2));
                let canDragP1 = (d1 < hitRadius(e)) && !isLocked;
                let canDragP2 = (d2 < hitRadius(e));
                canvas.style.cursor = (canDragP1 || canDragP2) ? 'grab' : 'crosshair';
            }
        });

        const endDrag = () => { draggingPoint = null; };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('lostpointercapture', endDrag);
