import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

// Execute actual controller/merge code without React, package installs or network.
const source = readFileSync(new URL('../src/lib/unified-directory.ts', import.meta.url), 'utf8')
  .replace('import { apiFetch, type ApiResult } from "./api-client";', 'type ApiResult<T> = any; const apiFetch = () => { throw new Error("Unexpected network"); };');
const { mergeRadarCatalog, UnifiedDirectoryController, scopedCatalogCursor } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString('base64')}`);
const now = Date.parse('2030-01-01T00:00:00Z');
const deadline = new Date(now + 45000).toISOString();
const player = (id, cityId = 'moscow') => ({ publicPlayerId: id, displayName: id, cityId });
const radarRow = id => ({ publicPlayerId: id, player: player(id), radar: { validUntil: deadline }, projection: 'directory' });
const ids = rows => rows.map(row => row.publicPlayerId);
const snapshot = (rows, total = rows.length, nextCursor = null) => ({
  contractVersion: 'players-unified-radar-v1', cityId: 'moscow', validUntil: deadline,
  query: { queryRef: 'private', originRef: 'origin', originState: 'authorized' },
  items: rows, totals: { radarTotal: total }, page: { nextCursor },
});
const view = (rows, total = rows.length, nextCursor = null) => ({
  mode: 'unified', rows, snapshot: snapshot(rows, total, nextCursor), busy: false,
  stale: false, authenticationRequired: false, capabilityUnavailable: false,
});
const catalog = [player('normal-moscow'), player('r2'), player('normal-kazan', 'kazan'), player('normal-spb', 'spb')];
const peers = Array.from({ length: 6 }, (_, i) => radarRow(`r${i + 1}`));
const combine = result => [...ids(result.radar), ...ids(result.ordinary)];

test('All cities: six server-ordered Radar peers then independent multi-city catalog; unified ordinary rows ignored', () => {
  const state = view([...peers, { publicPlayerId: 'not-real-catalog', radar: null }], 6);
  assert.deepEqual(combine(mergeRadarCatalog(catalog, state, true, now)),
    [...ids(peers), 'normal-moscow', 'normal-kazan', 'normal-spb']);
});
test('selected city remainder is untouched; duplicates on ordinary page2 are removed', () => {
  const moscow = catalog.filter(p => p.cityId === 'moscow');
  assert.deepEqual(combine(mergeRadarCatalog(moscow, view(peers), true, now)), [...ids(peers), 'normal-moscow']);
  const page2 = [...catalog, player('r6'), player('page2-kazan', 'kazan'), player('normal-kazan', 'kazan')];
  assert.deepEqual(combine(mergeRadarCatalog(page2, view(peers), true, now)),
    [...ids(peers), 'normal-moscow', 'normal-kazan', 'normal-spb', 'page2-kazan']);
});
test('OFF/ON preserves ordinary pages and exact order; no private stale/busy/expired fallback hides catalog', () => {
  const state = view(peers);
  assert.deepEqual(combine(mergeRadarCatalog(catalog, state, false, now)), ids(catalog));
  assert.deepEqual(combine(mergeRadarCatalog(catalog, state, true, now)), [...ids(peers), 'normal-moscow', 'normal-kazan', 'normal-spb']);
  assert.deepEqual(combine(mergeRadarCatalog(catalog, { ...state, busy: true }, true, now)), [...ids(peers), 'normal-moscow', 'normal-kazan', 'normal-spb']);
  for (const patch of [{ stale: true }, { authenticationRequired: true }, { capabilityUnavailable: true }, { snapshot: null }])
    assert.deepEqual(combine(mergeRadarCatalog(catalog, { ...state, ...patch }, true, now)), ids(catalog));
  assert.deepEqual(combine(mergeRadarCatalog(catalog, state, true, now + 45000)), ids(catalog));
  assert.deepEqual(combine(mergeRadarCatalog(catalog, view(peers.map(r => ({ ...r, radar: { validUntil: new Date(now).toISOString() } }))), true, now)), ids(catalog));
});
test('More loads unseen Radar before ordinary remainder and dedupes across Radar pages', async () => {
  const first = Array.from({ length: 50 }, (_, i) => radarRow(`r${i + 1}`));
  let calls = 0;
  const controller = new UnifiedDirectoryController(async () => ({ ok: true, data: ++calls === 1 ? snapshot(first, 56, 'next') : snapshot([first[49], ...Array.from({ length: 6 }, (_, i) => radarRow(`r${i + 51}`))], 56) }), () => now);
  controller.bind({ id: 'viewer', csrfToken: 'csrf' });
  await controller.query({ cityId: 'moscow' });
  const initial = mergeRadarCatalog(catalog, controller.view, true, now);
  assert.equal(initial.moreRadar, true); assert.deepEqual(ids(initial.ordinary), ['normal-moscow', 'normal-kazan', 'normal-spb']);
  await controller.more();
  const full = mergeRadarCatalog(catalog, controller.view, true, now);
  assert.equal(full.moreRadar, false); assert.equal(full.radar.length, 56);
  assert.deepEqual(ids(full.ordinary), ['normal-moscow', 'normal-kazan', 'normal-spb']);
});
test('target private lease expiry clears selected preview and map pins before query expiry', async () => {
  let time = now;
  const short = { ...radarRow('short-lived'), radar: { validUntil: new Date(now + 10000).toISOString() } };
  const c = new UnifiedDirectoryController(async () => ({ ok: true, data: snapshot([short], 1) }), () => time);
  c.bind({ id: 'viewer', csrfToken: 'csrf' });
  await c.query({ cityId: 'moscow' });
  c.view.selected = short.publicPlayerId;
  c.view.preview = { radar: { validUntil: new Date(now + 10000).toISOString() }, player: { publicPlayerId: short.publicPlayerId } };
  c.view.pins = [short];
  assert(c.view.snapshot && new Date(c.view.snapshot.validUntil).getTime() > now + 10000);
  time += 11000;
  c.tick();
  assert.equal(c.view.snapshot, null);
  assert.equal(c.view.selected, null);
  assert.equal(c.view.preview, null);
  assert.deepEqual(c.view.pins, []);
  assert.deepEqual(c.view.rows, []);
  assert.equal(c.view.stale, true);
});
test('private A-B-A and OFF/ON fence late responses and keep 30s budget', async () => {
  let time = now, calls = 0, resolve;
  const controller = new UnifiedDirectoryController(async () => {
    ++calls; return await new Promise(r => { resolve = r; });
  }, () => time);
  controller.bind({ id: 'viewer', csrfToken: 'csrf' });
  const a = { cityId: 'moscow' }, b = { cityId: 'kazan' };
  const pending = controller.query(a, { kind: 'current_activation', activationId: 'on' }, 'on:1');
  await controller.query(b); await controller.query(a);
  resolve({ ok: true, data: snapshot(peers) }); await pending;
  assert.equal(controller.view.snapshot, null); assert.equal(calls, 1);
  controller.ordinary(); await controller.query(a); assert.equal(calls, 1);
  time += 30000;
  const next = controller.query(a); controller.ordinary();
  resolve({ ok: true, data: snapshot(peers) }); await next;
  assert.equal(controller.view.snapshot, null); assert.equal(calls, 2);
  assert.deepEqual(combine(mergeRadarCatalog(catalog, controller.view, true, time)), ids(catalog));
  assert.equal(scopedCatalogCursor({ scope: 'A', value: 'page2' }, 'B'), null);
});
test('page wires preserve ordinary All cities and independent Radar geography', () => {
  const page = readFileSync(new URL('../src/components/consumer/pages/PlayersDirectoryPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /value=\{cityId\}/); assert.match(page, /<option value="">Все города/);
  assert.match(page, /listPlayers\(\{ cityId: cityId \|\| undefined/);
  assert.match(page, /cityId: queryCity/); assert.doesNotMatch(page, /directoryVisible|effectiveCityId|radarOn:/);
  assert.match(page, /return \(\) => \{ live = false; clearTimeout\(timer\); \}/);
  assert.match(page, /\{availableNextCursor && <Button/);
  assert.match(page, /Ещё участники Radar/);
});
