const {test} = require('node:test');
const assert = require('node:assert/strict');
const Color = require('../color-model.js');
const samples = ['#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#00FFFF','#FF00FF','#EB8330','#202040','#80C0A0','#A080C0'];

test('RGB and BGR output preserve the selected colour, including noninteger HSV', () => {
    assert.equal(Color.ass(Color.parseHex('#EB8330')), '\\1c&H3083EB&');
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17)
        assert.deepEqual(Color.hsvToRgb(Color.rgbToHsv([r,g,b])), [r,g,b]);
    assert.deepEqual(Color.hsvToRgb([360,100,100]), [255,0,0]);
    assert.equal(Color.hex(Color.parseHex(' abc ')), '#AABBCC');
    assert.throws(() => Color.parseHex('#GG1122'));
    assert.throws(() => Color.parseHex('&HFFFFFF&'));
});

test('measured mapping corrects cross-channel transformations, not only gray values', () => {
    const forward = rgb => [0.8*rgb[0]+0.1*rgb[1]+10,0.05*rgb[0]+0.8*rgb[1]+0.1*rgb[2]+8,0.1*rgb[0]+0.1*rgb[1]+0.75*rgb[2]+12];
    const pairs = samples.map(ass => ({ass,rendered:Color.hex(forward(Color.parseHex(ass)))}));
    const model = Color.fit(pairs);
    assert.ok(model.rmse < 0.5);
    assert.ok(model.validation < 1);
    const expected = [120,80,150], result = Color.compensate(model, forward(expected));
    result.rgb.forEach((v,c) => assert.ok(Math.abs(v-expected[c]) <= 1));
    assert.equal(result.clipped,false);
    assert.equal(Color.compensate(model,[255,255,255]).clipped,true);
});

test('insufficient, gray-only, and noninvertible samples are rejected', () => {
    assert.throws(() => Color.fit(samples.slice(0,4).map(ass => ({ass,rendered:ass}))));
    assert.throws(() => Color.fit(['#000000','#202020','#404040','#808080','#AAAAAA','#FFFFFF'].map(ass => ({ass,rendered:ass}))));
    assert.throws(() => Color.fit(samples.map(ass => ({ass,rendered:'#888888'}))));
});

test('the fit exposes nonlinear error and preserves identity mappings', () => {
    const identity = Color.fit(samples.map(ass => ({ass,rendered:ass})));
    assert.ok(identity.validation < 1e-10);
    assert.deepEqual(Color.compensate(identity,[235,131,48]).rgb,[235,131,48]);
    const nonlinear = Color.fit(samples.map(ass => ({ass,rendered:Color.hex(Color.parseHex(ass).map(v => 255*Math.pow(v/255,1.8)))})));
    assert.ok(nonlinear.validation > 3);
});
