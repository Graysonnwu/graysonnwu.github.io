import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCrop, resizeCrop, moveCrop, scaleCrop } from './crop-geometry.mjs';

const bounded = (crop, width, height, ratio) => {
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.w >= 0 && crop.h >= 0);
  assert.ok(crop.x + crop.w <= width + 1e-9 && crop.y + crop.h <= height + 1e-9);
  assert.ok(Math.abs(crop.w / crop.h - ratio) < 1e-9);
};
test('tiny images never expand beyond their bounds while resizing', () => {
  const crop = fitCrop(20, 10, 16 / 9);
  for (const delta of [-1000, 0, 1000]) bounded(resizeCrop(crop, delta, delta, 20, 10, 16 / 9), 20, 10, 16 / 9);
});
test('both landscape and portrait crops remain bounded after moves/resizes', () => {
  for (const [width, height] of [[1200, 800], [800, 1200], [35, 200]]) {
    for (const ratio of [16 / 9, 4 / 3]) {
      const initial = fitCrop(width, height, ratio);
      const smaller = resizeCrop(initial, -400, -400, width, height, ratio);
      const moved = moveCrop(smaller, 10000, 10000, width, height);
      bounded(moved, width, height, ratio);
      bounded(resizeCrop(moved, 10000, 10000, width, height, ratio), width, height, ratio);
      bounded(scaleCrop(moved, width, height, 240, 160, ratio), 240, 160, ratio);
    }
  }
});
test('responsive crop scales the selection proportionally when the display halves', () => {
  const initial = { x: 100, y: 50, w: 400, h: 300 };
  const resized = scaleCrop(initial, 800, 600, 400, 300, 4 / 3);
  assert.deepEqual(resized, { x: 50, y: 25, w: 200, h: 150 });
});
