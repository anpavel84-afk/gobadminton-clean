/* global document, window */
// Independent QA entry point; source author MUST NOT run this as self-QA.
// Real hosted MapLibre/tiles/public API only, guest context, no API interception.
// Authenticated Radar and physical iOS/WebKit are NOT_TESTED by this script.
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const origin = new URL(process.env.GB_MAP_PUBLIC_ORIGIN || 'https://dev.gobadminton.ru');
assert.equal(origin.protocol, 'https:');
assert.equal(origin.hostname, 'dev.gobadminton.ru', 'DEV only');
const output = 'docs/handoffs/issue76-public-evidence';
await mkdir(output, { recursive: true });
const geometry = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[390,844],[430,932],[768,1024],[1024,768],[1440,900],[390,600],[390,1000],[900,390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    // Fail on a mutation rather than silently blocking or manufacturing a response.
    const mutations = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/v1/') && request.method() !== 'GET') mutations.push(request.method() + ' ' + request.url()); });
    for (const path of ['/games?view=map', '/players/radar']) {
      await page.goto(new URL(path, origin).href);
      await page.locator('.gb-games-map-canvas[data-map-ready="true"][data-map-settled="true"]').waitFor();
      await page.locator('button.maplibregl-marker').first().waitFor();
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 1, 'one real shared map');
      const frame = await page.locator('.gb-fullscreen-map-viewport').boundingBox();
      assert.ok(frame && Math.abs(frame.x) <= 1 && Math.abs(frame.y) <= 1);
      assert.ok(Math.abs(frame.width - width) <= 1 && Math.abs(frame.height - height) <= 1, JSON.stringify(frame));
      const back = page.getByRole('button', { name: 'К списку', exact: true }).or(page.getByRole('link', { name: 'К списку', exact: true }));
      assert.equal(await back.count(), 1); assert.equal(await back.isVisible(), true);
      const backBox = await back.boundingBox(); assert.ok(backBox.height >= 44 && backBox.y >= 0);
      const attribution = page.locator('.maplibregl-ctrl-attrib');
      assert.equal(await attribution.isVisible(), true);
      const attributionBox = await attribution.boundingBox();
      assert.ok(attributionBox.y + attributionBox.height <= height + 1);
      for (const selector of ['.gb-topbar', '.gb-bottom-nav', '.gb-games-map-toolbar', '.gb-discovery-search', '.g2-map-header', '.g2-map-summary']) {
        for (const element of await page.locator(selector).all()) assert.equal(await element.isVisible(), false, selector);
      }
      for (const marker of await page.locator('button.maplibregl-marker').all()) {
        const box = await marker.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
      }
      for (const disk of await page.locator('.g2-map-venue-marker').all()) assert.equal(await disk.locator('svg path').count(), 1, 'native shuttlecock');
      assert.equal(await page.locator('.gb-map-radar button').first().isVisible(), true, 'existing Radar affordance on both entries');
      assert.equal(await page.locator('.g2-person-marker').count(), 0, 'guest sees no private people');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow');
      // Real keyboard movement must alter venue screen coordinates without losing venues.
      const marker = page.locator('button.maplibregl-marker').first();
      const before = await marker.boundingBox();
      await page.locator('canvas.maplibregl-canvas').focus(); await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
      const after = await marker.boundingBox(); assert.notEqual(Math.round(before.x), Math.round(after.x), 'keyboard pans real map');
      await page.setViewportSize({ width: height, height: width });
      await page.waitForTimeout(300);
      const rotated = await page.locator('.gb-fullscreen-map-viewport').boundingBox();
      assert.ok(Math.abs(rotated.height - width) <= 1 && Math.abs(rotated.width - height) <= 1, 'rotation fills viewport');
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      geometry.push({ path, width, height, frame, backBox, attributionBox, before, after, rotated });
      await page.screenshot({ path: `${output}/${path.startsWith('/games') ? 'games' : 'radar'}-${width}x${height}.png` });
      if (path.startsWith('/games')) {
        await back.click();
        const entry = page.getByRole('button', { name: 'На карте', exact: true });
        if (width <= 720) {
          await entry.waitFor({ state: 'visible' });
          assert.equal(await entry.evaluate(element => element === document.activeElement), true, 'R6 visible mobile entry receives focus');
          const box = await entry.boundingBox(); const nav = await page.locator('.gb-bottom-nav').boundingBox();
          assert.ok(box.height >= 48 && box.width >= 180 && box.width <= 205);
          assert.ok(box.y + box.height < nav.y, 'capsule has gap above bottom nav');
        }
        await page.screenshot({ path: `${output}/list-${width}x${height}.png` });
      }
      assert.deepEqual(mutations, [], 'public regression performs no API mutations');
    }
    await context.close();
  }
  await writeFile(`${output}/geometry.json`, JSON.stringify(geometry, null, 2));
} finally { await browser.close(); }
