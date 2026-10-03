import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analysePixels, splitMass, analysisSize } from '../caustic_lens_centroid/analysis.mjs';

test('uniform images centre on pixel centres and split evenly, including pixels on the line', () => {
  for (const width of [1, 2, 5, 8]) {
    const rgba = new Uint8ClampedArray(width * 3 * 4).fill(255);
    const result = analysePixels(rgba, width, 3);
    assert.ok(Math.abs(result.x - width / 2) < 1e-10);
    assert.ok(Math.abs(result.y - 1.5) < 1e-10);
    const halves = splitMass(result.values, width, {x: width / 2, y: 1.5}, {x: width / 2, y: 0});
    assert.ok(Math.abs(halves.a - halves.b) < 1e-8);
  }
});

test('alpha contributes visible mass; all black or transparent images are rejected', () => {
  const pixels = new Uint8ClampedArray([255,255,255,0, 255,255,255,255]);
  assert.equal(analysePixels(pixels, 2, 1).x, 1.5);
  assert.throws(() => analysePixels(new Uint8ClampedArray(8), 2, 1), /没有可见亮度/);
  assert.throws(() => analysePixels(new Uint8ClampedArray([255,255,255,0]), 1, 1), /没有可见亮度/);
  assert.throws(() => analysePixels(pixels, 0, 1), /无效/);
});

test('linear sRGB mode differentiates optical energy from encoded brightness', () => {
  const pixels = new Uint8ClampedArray([128,128,128,255, 255,255,255,255]);
  const encoded = analysePixels(pixels, 2, 1);
  const energy = analysePixels(pixels, 2, 1, 'linear');
  assert.ok(energy.x > encoded.x);
  assert.ok(Math.abs(energy.values[0] / 255 - 0.2158605) < 1e-6);
});

test('coincident split points remain finite; extreme image aspect ratios retain a pixel', () => {
  const halves = splitMass(new Float64Array([5]), 1, {x:.5,y:.5}, {x:.5,y:.5});
  assert.equal(halves.a, 2.5); assert.equal(halves.b, 2.5);
  assert.deepEqual(analysisSize(100000, 1), {width:900,height:1});
});

function calculator() {
  const html = readFileSync(new URL('../caustic_lens_focal/index.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1].split('</script>')[0].split('    bindInput(els.uInput')[0];
  const context = vm.createContext({document:{getElementById(){return {}}}, URLSearchParams, window:{location:{search:''}}});
  // Stub only display updates; execute the production solvers and URL implementation unchanged.
  vm.runInContext(script + '\nupdateSceneView=()=>{};render=()=>{};scheduleUrlSync=()=>{};', context);
  return code => vm.runInContext(code, context);
}
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);

test('locking f or M captures the exact current value without a jump', () => {
  const run = calculator();
  run('state.u=1.2;state.v=1.3;syncDerived();setLock("f")');
  close(run('state.fixedF'), .624);
  run('setU(1.2)'); close(run('state.v'), 1.3);
  run('state.lock=null;state.u=1;state.v=3;syncDerived();setLock("m");setU(2)');
  close(run('state.fixedM'), 4/3); close(run('state.v'), 6);
});

test('f lock remains valid at the minimum physical focal length and both distance bounds', () => {
  const run = calculator();
  for (const [u,v] of [[.5,.5],[10,.5],[.5,10],[1.2,1.3],[10,10]]) {
    run(`state.lock=null;state.u=${u};state.v=${v};syncDerived();setLock("f")`);
    const focal = run('currentFocal()');
    for (const command of ['setU(.5)','setU(10)','setV(.5)','setV(10)','setM(1.05)','setM(21)']) {
      run(command);
      close(run('currentFocal()'), focal);
      assert.ok(run('state.u >= .5-1e-8 && state.u <= 10+1e-8 && state.v >= .5-1e-8 && state.v <= 10+1e-8'));
    }
  }
});

test('shared geometry preserves nonlinear results and locked M through reload', () => {
  const run = calculator();
  run('state.u=1;state.v=3;syncDerived();setLock("m");setU(2)');
  const before = [run('state.u'),run('state.v'),run('state.fixedM')];
  run('window.location.search="?"+canonicalParams().toString();applyUrlState()');
  [run('state.u'),run('state.v'),run('state.fixedM')].forEach((value,i) => close(value,before[i]));
  assert.equal(run('readUrlNumber(new URLSearchParams("u=2oops"),["u"],.5,10)'), null);
  run('window.location.search="";applyUrlState()'); assert.equal(run('state.u'), 6); assert.equal(run('state.lock'), null);
});

test('nonfinite input cannot poison the scene', () => {
  const run = calculator();
  for (const setter of ['setU','setV','setF','setM','setLens','setZoom']) run(`${setter}(NaN);${setter}(Infinity)`);
  assert.ok(run('[state.u,state.v,state.lens,state.fixedF,state.fixedM,state.zoom].every(Number.isFinite)'));
});

test('parallel light honours both u and f locks, including f above the point-source limit', () => {
  const run = calculator();
  run('setMode("parallel");setF(8);setLock("f");setU(2)');
  assert.equal(run('state.u'), 8); assert.equal(run('state.fixedF'), 8);
  run('setLock("f");setLock("u");setF(2)'); assert.equal(run('state.u'), 8);
});

test('f inputs and f-only links cover the feasible range in each lighting mode', () => {
  const run = calculator();
  run('setF(.25)'); close(run('currentFocal()'),.25);
  run('window.location.search="?mode=parallel&f=8";applyUrlState()');
  assert.equal(run('currentFocal()'), 8);
});

test('mode changes preserve feasible locked focal lengths and release infeasible locks', () => {
  const run = calculator();
  run('state.u=1.2;state.v=1.3;syncDerived();setLock("f");setMode("parallel")');
  close(run('currentFocal()'), .624);
  run('setMode("point")'); close(run('currentFocal()'), .624);
  run('state.lock=null;state.u=.5;state.v=.5;syncDerived();setLock("f");setMode("parallel")');
  assert.equal(run('state.lock'), null);
  run('state.lock=null;setU(8);setLock("f");setMode("point")');
  assert.equal(run('state.lock'), null);
});

test('lock URL aliases reject inherited object properties', () => {
  const run = calculator();
  for (const lock of ['constructor','__proto__','toString']) {
    assert.equal(run(`readUrlLock(new URLSearchParams("lock=${lock}"),"point")`), null);
  }
});
