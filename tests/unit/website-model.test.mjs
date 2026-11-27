// landing/audio/engine/model.js on a stand-in for ONNX Runtime Web: each
// InferenceSession.create() takes the next factory from globalThis.sessions
// (the separator first, then the detector).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const ort = 'export const env = { wasm: {} };' +
  'export class Tensor { constructor(type, data) { this.data = data; } }' +
  'export const InferenceSession = { create: async () => globalThis.sessions.shift()() };';
registerHooks({
  resolve: (specifier, context, next) => specifier.endsWith('/vendor/ort.wasm.min.mjs')
    ? { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(ort) }
    : next(specifier, context),
});
const { createModel } = await import('../../landing/audio/engine/model.js');

const scores = value => ({ data: new Float32Array(64).fill(value), dims: [1, 64] });
const separator = () => ({ run: async () => ({ y: { data: 'separated' } }) });
const detector = (...outputs) => () => ({
  run: async () => { const y = outputs.shift(); if (y instanceof Error) throw y; return { y }; },
});

test('the detector is dropped for the run once it fails or returns anything but 64 finite scores', async t => {
  t.mock.method(console, 'error', () => {});
  const bad = [new Error('run failed'), scores(NaN), scores(Infinity), { data: new Float32Array(63), dims: [1, 63] },
    { data: new Float32Array(0), dims: [1, 0] }, undefined, {}];
  for (const output of bad) {
    globalThis.sessions = [separator, detector(scores(-2), output, scores(-2))];
    const model = await createModel(new Uint8Array());
    assert.equal(await model.score(), -2, 'a working detector scores the window');
    assert.equal(await model.score(), Infinity, `separate after ${output?.message ?? JSON.stringify(output?.dims)}`);
    assert.equal(await model.score(), Infinity, 'and every later window');
  }
  globalThis.sessions = [separator, async () => { throw new Error('no detector'); }];
  assert.equal(await (await createModel(new Uint8Array())).score(), Infinity, 'a detector that fails to load');
});

test('a detector that never finishes loading is dropped after a minute', async t => {
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.sessions = [separator, () => new Promise(() => {})];
  const pending = createModel(new Uint8Array());
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(60_000);
  assert.equal(await (await pending).score(), Infinity);
});

test('errors of the separation model are not caught', async () => {
  globalThis.sessions = [() => ({ run: async () => { throw new Error('separator failed'); } }), detector(scores(1))];
  const model = await createModel(new Uint8Array());
  assert.equal(await model.score(), 1);
  await assert.rejects(model.run(new Float32Array()), /separator failed/);
});
