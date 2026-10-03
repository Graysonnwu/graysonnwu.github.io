'use strict';
const el = id => document.getElementById(id);
const Color = ASSColor;
let target = Color.parseHex('#EB8330'), original = target.slice(), samples = [], model = null;
let toastTimer;
function status(message) {
    clearTimeout(toastTimer);
    el('globalStatus').textContent = message;
    toastTimer = setTimeout(() => { el('globalStatus').textContent = ''; }, 2800);
}
function switchTab(tabId, button) {
    document.querySelectorAll('.card').forEach(node => node.classList.toggle('active', node.id === tabId));
    document.querySelectorAll('.nav-btn').forEach(node => node.classList.toggle('active', node === button));
    history.replaceState(null, '', tabId === 'tool-color' ? '#color' : '#position');
}
el('sidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-closed');
    el('sidebarToggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-closed')));
});
if (matchMedia('(max-width: 760px)').matches) {
    document.body.classList.add('sidebar-closed');
    el('sidebarToggle').setAttribute('aria-expanded', 'false');
}
if (location.hash === '#color') switchTab('tool-color', document.querySelectorAll('.nav-btn')[1]);
async function copyCode(input) {
    if (!input.value || !/^(\\pos\(|\\1c&H|&H)/.test(input.value)) return;
    const value = input.value;
    try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
        else {
            input.focus(); input.select();
            if (!document.execCommand('copy')) throw new Error('copy unavailable');
        }
        status('已复制：' + value);
    } catch (_) { input.focus(); input.select(); status('浏览器未允许自动复制，请按 Ctrl/Cmd + C。'); }
}
['posCode', 'assCode', 'styleCode'].forEach(id => el(id).addEventListener('click', () => copyCode(el(id))));

// Position tool: screenshot pixels and ASS script units are separate dimensions.
let imageReady = false, imageLoadId = 0;
const image = el('previewImg'), wrapper = el('imgWrapper'), upload = document.querySelector('.file-upload-box');
upload.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el('imageLoader').click(); } });
document.querySelector('label[for="importProfile"]').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el('importProfile').click(); } });
function validResolution() {
    const values = ['playResX', 'playResY'].map(id => Number(el(id).value));
    if (!values.every(n => Number.isInteger(n) && n > 0 && n <= 65535)) throw new Error('PlayRes 必须是 1–65535 的整数。');
    return values;
}
function hideCrosshair() { el('hline').style.display = 'none'; el('vline').style.display = 'none'; }
function useImageResolution() {
    if (!imageReady) return;
    el('playResX').value = image.naturalWidth; el('playResY').value = image.naturalHeight;
    el('posCode').value = ''; status('PlayRes 已设为截图尺寸。');
}
el('useImageRes').addEventListener('click', useImageResolution);
async function loadPosition(file) {
    if (!file) return;
    const generation = ++imageLoadId;
    if (!file.type.startsWith('image/')) { status('请选择图片文件。'); return; }
    const url = URL.createObjectURL(file), probe = new Image();
    try {
        probe.src = url; await probe.decode();
        if (generation !== imageLoadId) return;
        image.src = url; await image.decode();
        if (generation !== imageLoadId) return;
        hideCrosshair(); el('posCode').value = '';
        imageReady = true; wrapper.style.display = 'block'; el('imgInfo').style.display = 'flex';
        el('upload-text').textContent = '重新选择图片（' + file.name + '）';
        el('resText').textContent = `截图：${image.naturalWidth} × ${image.naturalHeight}`;
        if (!el('playResX').value || !el('playResY').value) useImageResolution();
    } catch (_) { if (generation === imageLoadId) status('图片解码失败，请换用 PNG、JPEG 或 WebP。'); }
    finally { URL.revokeObjectURL(url); }
}
el('imageLoader').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    void loadPosition(file);
});
upload.addEventListener('dragover', event => { event.preventDefault(); upload.style.borderColor = 'var(--primary)'; });
upload.addEventListener('dragleave', () => { upload.style.borderColor = 'var(--border)'; });
upload.addEventListener('drop', event => { event.preventDefault(); upload.style.borderColor = 'var(--border)'; loadPosition(event.dataTransfer.files[0]); });
function getCoords(event) {
    const rect = image.getBoundingClientRect(), bounds = wrapper.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const [width, height] = validResolution();
    return {x: Math.round(x / rect.width * width), y: Math.round(y / rect.height * height),
        left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height, cx: x, cy: y};
}
image.addEventListener('mousemove', event => {
    if (!imageReady) return;
    let coords;
    try { coords = getCoords(event); } catch (_) { hideCrosshair(); el('coordText').textContent = '请填有效 PlayRes'; return; }
    if (!coords) { hideCrosshair(); return; }
    Object.assign(el('hline').style, {display: 'block', left: coords.left + 'px', width: coords.width + 'px', top: (coords.top + coords.cy) + 'px'});
    Object.assign(el('vline').style, {display: 'block', top: coords.top + 'px', height: coords.height + 'px', left: (coords.left + coords.cx) + 'px'});
    el('coordText').textContent = `ASS：X=${coords.x}, Y=${coords.y}`;
});
image.addEventListener('mouseleave', () => { hideCrosshair(); el('coordText').textContent = '当前鼠标：—'; });
image.addEventListener('click', event => {
    if (!imageReady) return;
    try {
        const coords = getCoords(event); if (!coords) return;
        el('posCode').value = `\\pos(${coords.x},${coords.y})`; copyCode(el('posCode'));
    } catch (error) { status(error.message); }
});
['playResX', 'playResY'].forEach(id => el(id).addEventListener('input', () => { el('posCode').value = ''; hideCrosshair(); }));

function updateColor() {
    let rgb = target, description = '原样转换；没有额外颜色补偿。';
    if (el('mappingMode').value === 'legacy') {
        rgb = Color.legacy(target); description = '历史公式：0→0、74→85、163→170、253→255。缺少原始流程记录；请用自己的截图验证。';
    } else if (el('mappingMode').value === 'measured') {
        if (!model) { el('mappingMode').value = 'identity'; description = '请先加入或导入样本并计算校准。当前使用原样转换。'; }
        else {
            const result = Color.compensate(model, target); rgb = result.rgb;
            description = `本次校准：预测压制截图为 ${Color.hex(result.predicted)}。`;
            if (result.clipped) description += ' 所需输入超出 RGB 范围，已截断，目标可能无法准确达到。';
            if (result.extrapolated) description += ' 目标超出样本通道范围，属于外推，需要再测。';
            if (model.validation === null || model.validation > 3) description += ' 验证不足或误差较大，请补充样本。';
        }
    }
    el('demoTarget').style.backgroundColor = Color.hex(target); el('textTarget').textContent = Color.hex(target);
    el('demoASS').style.backgroundColor = Color.hex(rgb); el('textASS').textContent = Color.hex(rgb);
    el('assCode').value = Color.ass(rgb); el('styleCode').value = '&H00' + Color.ass(rgb).slice(5, -1);
    el('mappingStatus').textContent = description;
}
function setTarget(rgb, reset = true) {
    target = rgb.slice(); if (reset) original = rgb.slice();
    el('picker').value = Color.hex(rgb); el('hexInput').value = Color.hex(rgb); el('hexError').textContent = '';
    Color.rgbToHsv(rgb).forEach((n, i) => {
        el(['h_slider', 's_slider', 'v_slider'][i]).value = n;
        el(['h_val', 's_val', 'v_val'][i]).textContent = n.toFixed(2);
    });
    updateColor();
}
el('picker').addEventListener('input', event => setTarget(Color.parseHex(event.target.value)));
function updateHexInput(event, allowShort = false) {
    try {
        // Do not expand #RGB while the user is still typing #RRGGBB.
        if (!allowShort && !/^#?[\da-f]{6}$/i.test(event.target.value.trim())) throw new Error('请输入完整的 6 位 RGB；3 位简写可按 Enter 确认。');
        setTarget(Color.parseHex(event.target.value));
    }
    catch (error) { el('hexError').textContent = error.message; }
}
el('hexInput').addEventListener('input', event => updateHexInput(event));
el('hexInput').addEventListener('change', event => updateHexInput(event, true));
el('hexInput').addEventListener('keydown', event => { if (event.key === 'Enter') updateHexInput(event, true); });
el('resetHSV').addEventListener('click', () => setTarget(original));
['h_slider', 's_slider', 'v_slider'].forEach(id => el(id).addEventListener('input', () => {
    const hsv = ['h_slider', 's_slider', 'v_slider'].map(name => Number(el(name).value));
    hsv.forEach((n, i) => { el(['h_val', 's_val', 'v_val'][i]).textContent = n.toFixed(2); });
    target = Color.hsvToRgb(hsv); el('picker').value = Color.hex(target); el('hexInput').value = Color.hex(target); updateColor();
}));
el('mappingMode').addEventListener('change', updateColor);
if (!window.EyeDropper) { el('screenPick').disabled = true; el('screenPick').title = '当前浏览器不支持屏幕取色；可在下方加载截图取色。'; }
el('screenPick').addEventListener('click', async () => {
    try { const result = await new EyeDropper().open(); setTarget(Color.parseHex(result.sRGBHex)); }
    catch (error) { if (error.name !== 'AbortError') status('屏幕取色不可用；请加载截图取色。'); }
});

const canvases = {};
function median(values) { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; }
async function imageMetadata(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return '取色口径：浏览器 Canvas sRGB；非 PNG 描述文件由浏览器处理。';
    const view = new DataView(bytes.buffer), records = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset), end = offset + length + 12;
        if (end > bytes.length) break;
        const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)), data = offset + 8;
        if (type === 'cICP' && length === 4) {
            const primaries = {1: 'BT.709/sRGB', 9: 'BT.2020', 12: 'Display P3'}[bytes[data]] || bytes[data];
            const transfer = {1: 'BT.709', 13: 'sRGB', 16: 'PQ/HDR', 18: 'HLG/HDR'}[bytes[data + 1]] || bytes[data + 1];
            records.push(`cICP：原色 ${primaries}，传递 ${transfer}，矩阵 ${bytes[data + 2]}，范围 ${bytes[data + 3]}`);
        } else if (type === 'gAMA' && length === 4) records.push('gAMA=' + (view.getUint32(data) / 100000).toFixed(5));
        else if (type === 'sRGB') records.push('sRGB 描述');
        else if (type === 'iCCP') records.push('内嵌 ICC 描述文件');
        offset = end;
    }
    return '取色口径：浏览器 Canvas sRGB。PNG ' + (records.length ? records.join('；') : '未声明 cICP/gAMA/sRGB/ICC（浏览器按默认颜色处理）') + '。';
}
['preview', 'rendered'].forEach(kind => {
    let generation = 0;
    el(kind + 'File').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        if (!file.type.startsWith('image/')) { status('请选择图片文件。'); return; }
        if (file.size > 50000000) { status('图片文件超过 50 MB，请裁剪或压缩后再加载。'); return; }
        const token = ++generation, url = URL.createObjectURL(file), probe = new Image();
        try {
            probe.src = url; await probe.decode(); if (token !== generation) return;
            if (probe.naturalWidth * probe.naturalHeight > 40000000) throw new Error('图片超过 4000 万像素，请裁剪后再加载。');
            const canvas = el(kind + 'Canvas'); canvas.width = probe.naturalWidth; canvas.height = probe.naturalHeight;
            const context = canvas.getContext('2d', {willReadFrequently: true, colorSpace: 'srgb'});
            context.drawImage(probe, 0, 0); canvas.style.display = 'block'; canvases[kind] = context;
            el(kind + 'Sample').textContent = `${file.name} · ${canvas.width} × ${canvas.height}；点击纯色内部取 5×5 中位数。`;
            const description = await imageMetadata(file);
            if (token === generation) el(kind + 'Metadata').textContent = description;
        } catch (error) { status(error.message || '截图加载失败。'); }
        finally { URL.revokeObjectURL(url); }
    });
    el(kind + 'Canvas').addEventListener('click', event => {
        const canvas = event.currentTarget, context = canvases[kind]; if (!context) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * canvas.width)));
        const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * canvas.height)));
        const left = Math.max(0, x - 2), top = Math.max(0, y - 2);
        const data = context.getImageData(left, top, Math.min(canvas.width - left, 5), Math.min(canvas.height - top, 5)).data;
        const channels = [[], [], []]; let translucent = false;
        for (let i = 0; i < data.length; i += 4) { channels.forEach((list, c) => list.push(data[i + c])); if (data[i + 3] !== 255) translucent = true; }
        const rgb = channels.map(median), spread = Math.max(...channels.map(list => Math.max(...list) - Math.min(...list)));
        el('sample' + (kind === 'preview' ? 'Preview' : 'Rendered')).value = Color.hex(rgb);
        el(kind + 'Sample').textContent = `(${x}, ${y}) ${Color.hex(rgb)} · 最大通道跨度 ${spread}/255` + (spread > 5 ? '；颜色不均匀，建议重新取样。' : '') + (translucent ? '；包含透明像素，不适合拟合。' : '');
    });
});
function clearModel() { model = null; el('fitStatus').textContent = '样本已改变，请重新计算校准。'; if (el('mappingMode').value === 'measured') el('mappingMode').value = 'identity'; updateColor(); }
function renderRows() {
    const rows = el('sampleRows'); rows.replaceChildren();
    samples.forEach((sample, index) => {
        const row = document.createElement('tr');
        ['ass', 'preview', 'rendered'].forEach(key => {
            const td = document.createElement('td');
            if (sample[key]) { const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = sample[key]; td.append(swatch); }
            const code = document.createElement('code'); code.textContent = sample[key] || '—'; td.append(code); row.append(td);
        });
        const td = document.createElement('td'), button = document.createElement('button'); button.textContent = '删除'; button.type = 'button';
        button.addEventListener('click', () => { samples.splice(index, 1); clearModel(); renderRows(); }); td.append(button); row.append(td); rows.append(row);
    });
}
el('addSample').addEventListener('click', () => {
    try {
        if (samples.length >= 1000) throw new Error('最多 1000 个样本。');
        const sample = {ass: Color.hex(Color.parseHex(el('sampleAss').value)), rendered: Color.hex(Color.parseHex(el('sampleRendered').value))};
        if (el('samplePreview').value.trim()) sample.preview = Color.hex(Color.parseHex(el('samplePreview').value));
        samples.push(sample); el('sampleError').textContent = ''; clearModel(); renderRows();
    } catch (error) { el('sampleError').textContent = error.message; }
});
el('applyPreview').addEventListener('click', () => {
    try { setTarget(Color.parseHex(el('samplePreview').value)); el('sampleError').textContent = ''; }
    catch (error) { el('sampleError').textContent = error.message; }
});
el('fitProfile').addEventListener('click', () => {
    try {
        model = Color.fit(samples);
        el('fitStatus').textContent = `${model.count} 组样本；训练 RMS ${model.rmse.toFixed(2)}/255，最大通道残差 ${model.maxError.toFixed(2)}/255；逐个留出验证 RMS ${model.validation === null ? '无法计算（补充颜色分布）' : model.validation.toFixed(2) + '/255'}。`;
        el('mappingMode').value = 'measured'; updateColor();
    } catch (error) { clearModel(); el('fitStatus').textContent = error.message; }
});
el('exportProfile').addEventListener('click', () => {
    if (!samples.length) { status('请先加入样本。'); return; }
    const profile = {schema: 1, name: el('profileName').value.trim(), notes: el('profileNotes').value, created: new Date().toISOString(), sampling: 'browser-canvas-srgb-median-5x5-or-manual', samples};
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'ass-color-calibration.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
el('importProfile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
        if (file.size > 2000000) throw new Error('JSON 文件超过 2 MB。');
        const profile = JSON.parse(await file.text());
        if (profile.schema !== 1 || !Array.isArray(profile.samples) || !profile.samples.length || profile.samples.length > 1000) throw new Error('不是有效的 schema 1 校准样本文件。');
        // Validate everything before replacing the existing session.
        const imported = profile.samples.map(sample => ({ass: Color.hex(Color.parseHex(sample.ass)), rendered: Color.hex(Color.parseHex(sample.rendered)), ...(sample.preview ? {preview: Color.hex(Color.parseHex(sample.preview))} : {})}));
        samples = imported; el('profileName').value = String(profile.name || '').slice(0, 300); el('profileNotes').value = String(profile.notes || '').slice(0, 10000);
        clearModel(); renderRows(); el('sampleError').textContent = ''; status(`已导入 ${samples.length} 组样本，请计算校准。`);
    } catch (error) { el('sampleError').textContent = '导入失败：' + error.message; }
    finally { event.target.value = ''; }
});
setTarget(target);
