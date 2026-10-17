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
      const mobile = size.width <= 720;
      const measure = () => page.evaluate(() => {
        const rect = node => { const r=node.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,left:r.left,right:r.right}; };
        const box = selector => { const node=document.querySelector(selector); if (!node) throw new Error(selector); return rect(node); };
        const frame = document.querySelector('.gb-games-map');
        const map = document.querySelector('.gb-games-map-canvas');
        if (!frame || !map) throw new Error('map frame absent');
        const children = [...frame.children].filter(node => node.getBoundingClientRect().height > 0);
        const index = children.indexOf(map);
        const gap = parseFloat(window.getComputedStyle(frame).rowGap) || 0;
        const before = children.slice(0,index).map(rect);
        const after = children.slice(index+1).map(rect);
        const viewport = window.visualViewport;
        const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        const blockers = ['.gb-bottom-nav','.gb-games-view-action'].map(selector => document.querySelector(selector)).filter(Boolean).map(rect).filter(r => r.height > 0);
        const bottom = Math.min(viewportBottom, ...blockers.map(r => r.top));
        return {map:rect(map), canvas:box('.gb-games-map-canvas canvas'), frame:rect(frame),
          header:box('.gb-topbar'), controls:box('.gb-discovery-search'), context:box('.gb-games-map-context'),
          before, after, gap, bottom, blockers,
          expectedTop: rect(frame).top + before.reduce((sum,r) => sum+r.height+gap,0),
          expectedBottom: bottom - after.reduce((sum,r) => sum+r.height+gap,0),
          settled:map.dataset.mapReady === 'true' && map.dataset.mapSettled === 'true',
          scroll:window.scrollY, width:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth,
          height:window.innerHeight, documentHeight:document.documentElement.scrollHeight};
      });
      // Always retain diagnostics, including when layout never reaches settlement.
      console.log(JSON.stringify({size,phase:'resize',geometry:await measure()}));
      let geometry;
      try {
        await page.waitForFunction(() => {
          const node=document.querySelector('[data-map-ready="true"][data-map-settled="true"] canvas');
          const map=document.querySelector('.gb-games-map-canvas');
          if (!node || !map) return false;
          return Math.abs(node.getBoundingClientRect().height-map.getBoundingClientRect().height) <= 2;
        });
        geometry = await measure();
        console.log(JSON.stringify({size,phase:'settled',geometry}));
        assert.equal(await page.locator('.gb-games-list-return').isVisible(), !mobile, 'inline return is desktop-only; mobile uses the above-nav List action');
        assert.equal(await page.getByRole('button',{name:'Список',exact:true}).isVisible(), mobile, 'mobile List action remains available');
        assert.ok(geometry.settled, 'genuine map idle required');
        assert.ok(Math.abs(geometry.frame.bottom-geometry.bottom) <= 2, 'frame reaches measured action/nav/viewport');
        assert.ok(Math.abs(geometry.map.top-geometry.expectedTop) <= 2, 'only visible required controls above canvas');
        assert.ok(Math.abs(geometry.map.bottom-geometry.expectedBottom) <= 2, 'only visible required fallback/status below canvas');
        assert.ok(Math.abs(geometry.canvas.height-geometry.map.height) <= 2, 'MapLibre resized its actual canvas');
        assert.ok(Math.abs(geometry.canvas.bottom-geometry.map.bottom) <= 2, 'actual canvas fills map container');
        for (const control of [...geometry.before,...geometry.after]) {
          assert.ok(control.top >= geometry.frame.top-1 && control.bottom <= geometry.bottom+1, 'required controls remain visible above action/nav');
          assert.ok(control.width <= geometry.frame.width+1, 'required controls fit frame');
        }
        for (const selector of ['.maplibregl-ctrl-attrib','.maplibregl-ctrl-zoom-in','.maplibregl-ctrl-zoom-out']) {
          const control=await page.locator(selector).boundingBox();
          assert.ok(control && control.y >= geometry.canvas.top-1 && control.y+control.height <= geometry.canvas.bottom+1, 'attribution/zoom inside canvas');
        }
      } finally {
        console.log(JSON.stringify({size,phase:'diagnostic',geometry:await measure()}));
        if (process.env.GB_MAP_EVIDENCE_DIR) await page.screenshot({path:process.env.GB_MAP_EVIDENCE_DIR + `/map-${width}-${size.width}x${size.height}.png`,fullPage:true});
      }
      assert.equal(geometry.scroll, 0, 'entry/rotation must not need hero scrolling');
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'horizontal document overflow');
      assert.ok(geometry.controls.top >= geometry.header.bottom - 1, 'controls covered by header');
      assert.ok(geometry.controls.top - geometry.header.bottom <= 24, 'hero-sized gap');
      assert.ok(geometry.map.top >= geometry.controls.bottom, 'controls overlap map');
      assert.ok(geometry.map.height >= (geometry.height - geometry.header.height) * .4, 'map must occupy remaining space even on short screens');
      assert.ok(geometry.documentHeight <= geometry.height + 2, 'footer/blank scroll gap');
      const fallback=page.locator('.gb-games-map-fallback');
      if (await fallback.count()) {
        assert.equal(await fallback.getAttribute('open'),null,'fallback starts closed');
        assert.equal(await page.getByRole('group',{name:'Все площадки города',exact:true}).count(),0,'closed fallback has no accessible catalog focus stops');
      } else assert.equal(await page.getByRole('group',{name:'Все площадки города',exact:true}).count(),0,'normal map has no catalog cloud');
      assert.equal(await page.getByRole('group',{name:'Вид игр',exact:true}).count(),0,'no duplicate view pills');
      await page.getByRole('button',{name:mobile ? 'Список' : '← К списку игр',exact:true}).click();
      await page.locator('.gb-discovery-hero').waitFor();
      assert.equal(await page.locator('.gb-discovery-create').count(),1,'original create banner');
      await page.getByRole('button',{name:mobile ? 'Карта' : 'Все игры на карте',exact:true}).click();
      await page.locator('[data-map-ready="true"][data-map-settled="true"]').waitFor({timeout:30000});
    }
    await page.close();
  }
} finally { await browser.close(); }
