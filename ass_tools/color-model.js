/* Pure colour helpers shared by the browser and the reproducible Node checks. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ASSColor = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const clamp = value => Math.min(255, Math.max(0, Math.round(value)));
    function parseHex(value) {
        let s = String(value).trim().replace(/^#/, '');
        if (/^[\da-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
        if (!/^[\da-f]{6}$/i.test(s)) throw new Error('请输入 RGB 十六进制颜色，如 #EB8330。');
        return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
    }
    const hex = rgb => '#' + rgb.map(v => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const ass = rgb => '\\1c&H' + hex(rgb).slice(1).match(/../g).reverse().join('') + '&';
    function rgbToHsv(rgb) {
        const [r, g, b] = rgb.map(v => v / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return [h * 360, max ? d / max * 100 : 0, max * 100];
    }
    function hsvToRgb(hsv) {
        const [h, s, v] = [((hsv[0] % 360 + 360) % 360) / 60, hsv[1] / 100, hsv[2] / 100];
        const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
        const variants = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
        return variants[Math.floor(h)].map(n => clamp((n + m) * 255));
    }
    function legacy(rgb) {
        return rgb.map(y => clamp(y < 74 ? 85 / 74 * y : y < 163 ? 85 + 85 / 89 * (y - 74) : y < 253 ? 170 + 85 / 90 * (y - 163) : 255));
    }
    // Pivoted elimination rejects grayscale-only data and ill-conditioned fits.
    function solve(matrix, rhs) {
        const a = matrix.map((row, i) => [...row, rhs[i]]), n = rhs.length;
        for (let col = 0; col < n; col++) {
            let pivot = col;
            for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
            if (Math.abs(a[pivot][col]) < 1e-8) throw new Error('样本颜色分布不足：请加入不同色相和亮度，不能只用灰阶。');
            [a[col], a[pivot]] = [a[pivot], a[col]];
            const divisor = a[col][col];
            for (let j = col; j <= n; j++) a[col][j] /= divisor;
            for (let row = 0; row < n; row++) if (row !== col) {
                const factor = a[row][col];
                for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
            }
        }
        return a.map(row => row[n]);
    }
    function normalizeSamples(samples) {
        if (!Array.isArray(samples) || samples.length < 6 || samples.length > 1000) throw new Error('需要 6–1000 组 ASS 输入色和压制截图色。推荐 12 组以上。');
        return samples.map(sample => ({
            ass: parseHex(sample.ass), rendered: parseHex(sample.rendered),
            preview: sample.preview ? parseHex(sample.preview) : null
        }));
    }
    function fitRaw(samples) {
        const x = samples.map(s => [...s.ass.map(n => n / 255), 1]);
        const gram = Array.from({length: 4}, (_, i) => Array.from({length: 4}, (_, j) => x.reduce((sum, row) => sum + row[i] * row[j], 0)));
        return [0, 1, 2].map(channel => solve(gram, Array.from({length: 4}, (_, i) => x.reduce((sum, row, j) => sum + row[i] * samples[j].rendered[channel] / 255, 0))));
    }
    const predict = (coefficients, rgb) => coefficients.map(row => row[3] * 255 + row.slice(0, 3).reduce((sum, coefficient, i) => sum + coefficient * rgb[i], 0));
    function fit(samples) {
        const data = normalizeSamples(samples), coefficients = fitRaw(data);
        // Ensure inverse exists before this model can be applied.
        solve(coefficients.map(row => row.slice(0, 3)), [0, 0, 0]);
        const errors = data.flatMap(s => predict(coefficients, s.ass).map((v, i) => v - s.rendered[i]));
        let validation = null;
        try {
            const heldOut = data.flatMap((s, i) => predict(fitRaw(data.filter((_, j) => i !== j)), s.ass).map((v, c) => v - s.rendered[c]));
            validation = Math.sqrt(heldOut.reduce((sum, n) => sum + n * n, 0) / heldOut.length);
        } catch (_) { /* Sparse data may lose rank when one sample is removed. */ }
        return {coefficients, count: data.length,
            rmse: Math.sqrt(errors.reduce((sum, n) => sum + n * n, 0) / errors.length),
            maxError: Math.max(...errors.map(Math.abs)), validation,
            minimum: [0, 1, 2].map(c => Math.min(...data.map(s => s.rendered[c]))),
            maximum: [0, 1, 2].map(c => Math.max(...data.map(s => s.rendered[c]))) };
    }
    function compensate(model, target) {
        const raw = solve(model.coefficients.map(row => row.slice(0, 3)), target.map((v, i) => v - model.coefficients[i][3] * 255));
        const rgb = raw.map(clamp);
        return {rgb, clipped: raw.some(v => v < -0.5 || v > 255.5),
            extrapolated: target.some((v, c) => v < model.minimum[c] || v > model.maximum[c]),
            predicted: predict(model.coefficients, rgb).map(clamp)};
    }
    return {parseHex, hex, ass, rgbToHsv, hsvToRgb, legacy, fit, compensate, predict};
});
