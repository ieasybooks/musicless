import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, liveCommit } from './deploy-order.mjs';
import { checkModel, checkSite } from './check.mjs';

const old = '1'.repeat(40), recent = '2'.repeat(40);
test('deploys newer main commits and skips delayed older runs', () => {
  const ancestor = (a, b) => a === old && b === recent;
  assert.equal(decide(recent, old, ancestor), 'deploy');
  assert.equal(decide(old, recent, ancestor), 'skip');
  assert.equal(decide(recent, recent, ancestor), 'recheck');
});
test('refuses divergent or malformed deployment identities', () => {
  assert.throws(() => decide(recent, old, () => false), /diverged/);
  assert.throws(() => decide('main', old, () => true), /full commit/);
});
test('requires one live version and its recorded commit', () => {
  const status = { versions: [{ version_id: 'version-1', percentage: 100 }] };
  assert.equal(liveCommit(status, { annotations: { 'workers/message': old } }), old);
  assert.throws(() => liveCommit(status, {}), /full commit/);
  assert.throws(() => liveCommit({ versions: [] }, {}), /one version/);
  assert.throws(() => liveCommit({ versions: [{ percentage: 50 }, { percentage: 50 }] }, {}), /one version/);
});
test('live verification refuses a different build before checking its assets', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ commit: old, files: [] })));
  await assert.rejects(checkSite('https://example.test', { commit: recent, files: [] }), /must match this checkout/);
});
test('model verification rejects damaged bytes and missing CORS', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('damaged', {
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, immutable' },
  }));
  await assert.rejects(checkModel({ url: 'https://example.test/model.onnx', sha256: '0'.repeat(64) }), /model integrity/);
  fetch.mock.mockImplementation(async () => new Response('damaged'));
  await assert.rejects(checkModel({ url: 'https://example.test/model.onnx', sha256: '0'.repeat(64) }), /model CORS/);
});
