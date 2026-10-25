/* global document, window */
// Independent QA only. Computed transparency does not prove tile contents.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join } from 'node:path';

class NotTested extends Error {}
async function main() {
  const origin = process.env.GB_MAP_ORIGIN;
  const modulePath = process.env.GB_MAP_PLAYWRIGHT_MODULE;
  if (origin !== 'https://dev.gobadminton.ru') throw new NotTested('GB_MAP_ORIGIN must equal https://dev.gobadminton.ru');
  if (!modulePath || !isAbsolute(modulePath)) throw new NotTested('GB_MAP_PLAYWRIGHT_MODULE must be an absolute local module path');
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(modulePath).href));
  } catch (error) {
    throw new NotTested(`local Playwright module unavailable: ${error.message}`);
  }
  if (!chromium?.launch) throw new NotTested('local Playwright module does not expose chromium.launch');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (/executable.*(?:doesn't exist|not found)|ENOENT/i.test(error.message)) {
      throw new NotTested(`browser executable unavailable: ${error.message}`);
    }
    throw error;
  }
  let failure;
  try {
    for (const width of [390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let pageFailure;
      const measure = () => page.evaluate(() => {
        const rect = node => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return {
          width: window.innerWidth,
          canvases: [...document.querySelectorAll('.gb-games-map-canvas canvas')].map(node => ({
            geometry: rect(node), width: node.width, height: node.height,
          })),
          layers: [...document.querySelectorAll('.gb-radar-layer')].map(node => {
            const style = window.getComputedStyle(node);
            return { geometry: rect(node), backgroundColor: style.backgroundColor,
              backgroundImage: style.backgroundImage, minHeight: style.minHeight, pointerEvents: style.pointerEvents };
          }),
        };
      });
      try {
        await page.goto(origin + '/games?view=map');
        await Promise.all([
          page.locator('[data-map-ready="true"][data-map-settled="true"]').first().waitFor({ timeout: 30000 }),
          page.locator('.gb-radar-layer').first().waitFor({ state: 'attached', timeout: 30000 }),
        ]);
        const diagnostic = await measure();
        console.log(JSON.stringify({ width, phase: 'before-assertions', ...diagnostic }));
        assert.ok(diagnostic.canvases.length >= 1, 'actual map canvas required');
        for (const canvas of diagnostic.canvases) {
          assert.ok(canvas.width > 0 && canvas.height > 0 && canvas.geometry.width > 0 && canvas.geometry.height > 0, 'positive canvas dimensions');
        }
        assert.ok(diagnostic.layers.length >= 1, 'shared Radar layer required');
        for (const layer of diagnostic.layers) {
          const color = layer.backgroundColor;
          const alpha = color === 'transparent' ? 0
            : color.includes('/') ? Number.parseFloat(color.split('/')[1])
            : /^rgba\(/.test(color) ? Number.parseFloat(color.split(',')[3]) : 1;
          assert.equal(alpha, 0, `transparent layer background: ${color}`);
          assert.equal(layer.backgroundImage, 'none');
          assert.equal(layer.minHeight, '0px');
          assert.equal(layer.pointerEvents, 'none');
        }
      } catch (error) {
        pageFailure = error;
        try { console.log(JSON.stringify({ width, phase: 'error-diagnostic', ...await measure() })); }
        catch (diagnosticError) { console.error(`diagnostic unavailable: ${diagnosticError.message}`); }
      } finally {
        try {
          if (process.env.GB_MAP_EVIDENCE_DIR) {
            await page.screenshot({ path: join(process.env.GB_MAP_EVIDENCE_DIR, `basemap-overlay-${width}x900.png`), fullPage: true });
          }
        } catch (error) {
          console.error(`screenshot failed: ${error.message}`);
          pageFailure ??= error;
        } finally {
          try { await page.close(); } catch (error) { pageFailure ??= error; }
        }
      }
      if (pageFailure) throw pageFailure;
    }
  } catch (error) {
    failure = error;
  } finally {
    try { await browser.close(); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
  console.log('PASS: computed overlay transparency only; tile contents and visual parity UNVERIFIED');
}
try { await main(); }
catch (error) {
  console.error(`${error instanceof NotTested ? 'NOT_TESTED' : 'FAIL'}: ${error.stack ?? error}`);
  process.exitCode = 1;
}
