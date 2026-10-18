/* global document, window */
// Independent QA only: already running authorized DEV, no service startup.
import assert from 'node:assert/strict';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
assert.ok(process.env.GB_MAP_ORIGIN, 'authorized DEV origin required');
const browser = await chromium.launch({headless:true});
try {
  for (const size of [{width:390,height:600},{width:430,height:900},{width:900,height:390},{width:1440,height:900}]) {
    const page = await browser.newPage({viewport:size});
    await page.goto(process.env.GB_MAP_ORIGIN + '/games?view=map');
    const back = page.getByRole('button',{name:'К списку игр',exact:true});
    await back.waitFor();
    assert.equal(await back.count(),1);
    assert.equal(await back.evaluate(node => node === document.activeElement),true,'map opens with return focus');
    await page.locator('[data-map-ready="true"][data-map-settled="true"]').waitFor({timeout:30000});
    for (const selector of ['.gb-discovery-search','.gb-games-map-context','.gb-games-view-action','.gb-games-map-toolbar','.gb-games-map-fallback'])
      assert.equal(await page.locator(selector).count(),0,selector);
    const geometry = await page.evaluate(() => {
      const box = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
      return {map:box('.gb-games-map-canvas'),canvas:box('.gb-games-map-canvas canvas'),back:box('.gb-games-map-back'),attribution:box('.maplibregl-ctrl-attrib'),
        width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:window.visualViewport?.height ?? window.innerHeight};
    });
    assert.ok(geometry.back.width>=44 && geometry.back.height>=44);
    assert.ok(Math.abs(geometry.map.height-geometry.height)<=2);
    assert.ok(Math.abs(geometry.canvas.height-geometry.map.height)<=2);
    assert.ok(geometry.attribution.bottom<=geometry.map.bottom+1);
    assert.ok(geometry.scrollWidth<=geometry.width+1);
    assert.equal(await page.locator('.gb-map-radar').count(),1);
    await back.click();
    await page.locator('.gb-discovery-search').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'),'list');
    await page.getByRole('button',{name:'На карте',exact:true}).waitFor();
    await page.goBack();
    await back.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'),'map');
    await page.close();
  }
} finally { await browser.close(); }
