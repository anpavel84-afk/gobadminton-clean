import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatestResource } from '../src/resource.ts';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('late city response cannot overwrite a new selection, even ignoring AbortSignal', async () => {
  const resource = new LatestResource<string[]>();
  const a = deferred<string[]>(), b = deferred<string[]>();
  const first = resource.load('city-a', () => a.promise);
  const second = resource.load('city-b', () => b.promise);
  assert.equal(resource.state.key, 'city-b');
  assert.equal(resource.state.data, undefined);
  b.resolve(['real-b']); await second;
  a.resolve(['stale-a']); await first;
  assert.deepEqual(resource.state, { key: 'city-b', status: 'ready', data: ['real-b'] });
});
test('late pagination error is discarded after switching cities', async () => {
  const resource = new LatestResource<string[]>();
  await resource.load('a', async () => ['a']);
  const next = deferred<string[]>();
  const loading = resource.load('a', () => next.promise, (old, page) => [...old, ...page]);
  await resource.load('b', async () => []);
  next.reject(new Error('old city offline')); await loading;
  assert.equal(resource.state.status, 'ready');
  assert.equal(resource.state.key, 'b');
  assert.deepEqual(resource.state.data, []);
});
test('network error preserves request intent; explicit retry succeeds', async () => {
  const resource = new LatestResource<string>();
  await resource.load('game/direct-id', async () => { throw new Error('offline'); });
  assert.equal(resource.state.status, 'error');
  assert.equal(resource.state.key, 'game/direct-id');
  await resource.load('game/direct-id', async () => 'public details');
  assert.equal(resource.state.data, 'public details');
  resource.cancel();
});
