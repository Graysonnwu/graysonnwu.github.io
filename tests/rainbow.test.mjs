import test from 'node:test';
import assert from 'node:assert/strict';
import { hsvColor, fitScale, interpolateHue } from '../text_rainbow_effect/src/color.mjs';

test('HSV conversion preserves fractional values and handles negative hues', () => {
  assert.equal(hsvColor(-180, 1, 1), hsvColor(180, 1, 1));
  assert.equal(hsvColor(720, 1, 1), 'hsl(0, 100%, 50%)');
  assert.equal(hsvColor(0, 0, 0), 'hsl(0, 0%, 0%)');
  assert.equal(hsvColor(0, 0, 1), 'hsl(0, 0%, 100%)');
  assert.throws(() => hsvColor(Infinity, 1, 1));
  assert.notEqual(hsvColor(1.1, .333, .752), hsvColor(1, .33, .75));
});

test('large opposing hue endpoints do not overflow interpolation or crash rendering', () => {
  for (const left of [1e308,Number.MAX_VALUE]) for (const right of [-1e308,Number.MAX_VALUE]) {
    for (let step=0;step<50;step++) {
      const hue = interpolateHue(left,right,step/49);
      assert.ok(Number.isFinite(hue));
      assert.doesNotThrow(() => hsvColor(hue,.3,.95));
    }
  }
});

test('long text and multiple lines fit both axes without upscaling short text', () => {
  assert.equal(fitScale(2000, 288, 390, 500), 358 / 2000);
  assert.equal(fitScale(288, 2000, 390, 500), 468 / 2000);
  assert.equal(fitScale(100, 100, 390, 500), 1);
  assert.equal(fitScale(0, 0, 390, 500), 1);
  assert.ok(Number.isFinite(fitScale(100, 100, 0, 0)));
});
