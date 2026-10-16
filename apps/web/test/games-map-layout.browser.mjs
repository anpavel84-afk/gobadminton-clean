/* global document, window */
// Read-only actual DEV map geometry. No mocks, login, forced clicks or service startup.
import assert from 'node:assert/strict';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
assert.ok(process.env.GB_MAP_ORIGIN, 'NOT_TESTED: authorized DEV origin required');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(process.env.GB_MAP_ORIGIN + '/games?view=map');
    await page.locator('[data-map-ready="true"][data-map-settled="true"]').waitFor({ timeout: 30000 });
    for (const size of [{width,height:600}, {width,height:1000}, {width:900,height:width}]) {
      await page.setViewportSize(size);
      await page.waitForFunction(() => {
        const map = document.querySelector('[data-map-ready="true"][data-map-settled="true"]');
        if (!map) return false;
        const box = map.getBoundingClientRect();
        const nav = document.querySelector('.gb-bottom-nav')?.getBoundingClientRect();
        const bottom = Math.min(window.innerHeight, nav?.height ? nav.top : window.innerHeight);
        return box.height > 0 && Math.abs(box.bottom - bottom) <= 2;
      });
      const geometry = await page.evaluate(() => {
        const box = selector => { const node=document.querySelector(selector); if (!node) throw new Error(selector); const r=node.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}; };
        return {map:box('[data-map-ready="true"][data-map-settled="true"]'), header:box('.gb-topbar'), controls:box('.gb-discovery-search'),
          scroll:window.scrollY, width:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth,
          height:window.innerHeight, documentHeight:document.documentElement.scrollHeight};
      });
      assert.equal(geometry.scroll, 0, 'entry/rotation must not need hero scrolling');
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'horizontal document overflow');
      assert.ok(geometry.controls.top >= geometry.header.bottom - 1, 'controls covered by header');
      assert.ok(geometry.controls.top - geometry.header.bottom <= 24, 'hero-sized gap');
      assert.ok(geometry.map.top >= geometry.controls.bottom, 'controls overlap map');
      assert.ok(geometry.map.height >= (geometry.height - geometry.header.height) * .4, 'map must occupy remaining space even on short screens');
      assert.ok(geometry.documentHeight <= geometry.height + 2, 'footer/blank scroll gap');
      assert.equal(await page.getByRole('group',{name:'Все площадки города',exact:true}).count(),0,'normal map must not mount catalog focus stops');
      await page.getByRole('button',{name:'Списком',exact:true}).click();
      await page.locator('.gb-discovery-hero').waitFor();
      assert.equal(await page.locator('.gb-discovery-create').count(),1,'original create banner');
      await page.getByRole('button',{name:'На карте',exact:true}).click();
      await page.locator('[data-map-ready="true"][data-map-settled="true"]').waitFor({timeout:30000});
    }
    await page.close();
  }
} finally { await browser.close(); }
