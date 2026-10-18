/* global document, window */
// Read-only actual DEV map geometry. No mocks, login, forced clicks or service startup.
import assert from 'node:assert/strict';
import console from 'node:console';
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
      const measure = () => page.evaluate(() => {
        const rect = node => { const r=node.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,left:r.left,right:r.right}; };
        const box = selector => { const node=document.querySelector(selector); if (!node) throw new Error(selector); return rect(node); };
        const frame = document.querySelector('.gb-games-map');
        const map = document.querySelector('.gb-games-map-canvas');
        if (!frame || !map) throw new Error('map frame absent');
        // The canvas is nested in an absolute area; the fixed return capsule
        // overlays it. Neither participates in the frame's normal flow.
        const area = frame.querySelector('.gb-games-map-area');
        if (!area || !area.contains(map)) throw new Error('map area absent');
        const flowControls = [...frame.children].filter(node => {
          const position = window.getComputedStyle(node).position;
          return node.getBoundingClientRect().height > 0 && position !== 'absolute' && position !== 'fixed';
        }).map(rect);
        const viewport = window.visualViewport;
        const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        const blockers = [...frame.querySelectorAll('.gb-bottom-nav,.gb-games-view-action')].map(rect).filter(r => r.height > 0);
        const bottom = Math.min(viewportBottom, ...blockers.map(r => r.top));
        return {map:rect(map), area:rect(area), canvas:box('.gb-games-map-canvas canvas'), frame:rect(frame),
          header:box('.gb-topbar'), back:box('.gb-games-map-back'),
          flowControls, bottom, blockers,
          expectedTop: rect(frame).top,
          expectedBottom: bottom,
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
        assert.equal(await page.getByRole('button',{name:'К списку игр',exact:true}).count(),1,'one return control at every size');
        assert.equal(await page.locator('.gb-games-view-action,.gb-games-map-context,.gb-discovery-search,.gb-games-map-toolbar').count(),0,'fullscreen composition has no old controls');
        assert.ok(geometry.back.width >= 44 && geometry.back.height >= 44,'accessible return target');
        assert.ok(geometry.back.left >= geometry.frame.left && geometry.back.right <= geometry.frame.right,'return fits frame');
        assert.ok(geometry.back.top >= geometry.frame.top && geometry.back.bottom <= geometry.frame.bottom,'return stays in viewport');
        assert.ok(geometry.settled, 'genuine map idle required');
        assert.ok(Math.abs(geometry.frame.bottom-geometry.bottom) <= 2, 'frame reaches measured action/nav/viewport');
        assert.ok(Math.abs(geometry.map.top-geometry.expectedTop) <= 2, 'fullscreen map reaches frame top');
        assert.ok(Math.abs(geometry.map.bottom-geometry.expectedBottom) <= 2, 'fullscreen map reaches viewport bottom');
        assert.ok(Math.abs(geometry.canvas.height-geometry.map.height) <= 2, 'MapLibre resized its actual canvas');
        assert.ok(Math.abs(geometry.canvas.bottom-geometry.map.bottom) <= 2, 'actual canvas fills map container');
        assert.ok(Math.abs(geometry.area.top-geometry.frame.top) <= 2 && Math.abs(geometry.area.bottom-geometry.bottom) <= 2, 'absolute map area fills frame vertically');
        assert.ok(Math.abs(geometry.map.left-geometry.frame.left) <= 2 && Math.abs(geometry.map.right-geometry.frame.right) <= 2, 'map fills frame width');
        assert.ok(Math.abs(geometry.canvas.width-geometry.map.width) <= 2, 'MapLibre resized actual canvas width');
        for (const control of geometry.flowControls) {
          assert.ok(control.top >= geometry.frame.top-1 && control.bottom <= geometry.bottom+1, 'required controls remain visible above action/nav');
          assert.ok(control.width <= geometry.frame.width+1, 'required controls fit frame');
        }
        for (const selector of ['.maplibregl-ctrl-attrib']) {
          const control=await page.locator(selector).boundingBox();
          assert.ok(control && control.y >= geometry.canvas.top-1 && control.y+control.height <= geometry.canvas.bottom+1 && control.x >= geometry.canvas.left-1 && control.x+control.width <= geometry.canvas.right+1, 'attribution inside canvas');
        }
      } finally {
        console.log(JSON.stringify({size,phase:'diagnostic',geometry:await measure()}));
        if (process.env.GB_MAP_EVIDENCE_DIR) await page.screenshot({path:process.env.GB_MAP_EVIDENCE_DIR + `/map-${width}-${size.width}x${size.height}.png`,fullPage:true});
      }
      assert.equal(geometry.scroll, 0, 'entry/rotation must not need hero scrolling');
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'horizontal document overflow');
      // Fullscreen overlays the page header; equivalent chrome/gap checks use the frame edge.
      assert.ok(Math.abs(geometry.frame.top) <= 2,'fullscreen starts above the underlying header');
      assert.ok(Math.abs(geometry.map.top - geometry.frame.top) <= 2,'no hero/header gap above map');
      assert.ok(geometry.back.top - geometry.frame.top <= 44,'return remains at the top of the map');
      assert.ok(geometry.map.height >= (geometry.height - geometry.header.height) * .4, 'map must occupy remaining space even on short screens');
      assert.ok(geometry.documentHeight <= geometry.height + 2, 'footer/blank scroll gap');
      const fallback=page.locator('.gb-games-map-fallback');
      if (await fallback.count()) {
        assert.equal(await fallback.getAttribute('open'),null,'fallback starts closed');
        assert.equal(await page.getByRole('group',{name:'Все площадки города',exact:true}).count(),0,'closed fallback has no accessible catalog focus stops');
      } else assert.equal(await page.getByRole('group',{name:'Все площадки города',exact:true}).count(),0,'normal map has no catalog cloud');
      assert.equal(await page.getByRole('group',{name:'Вид игр',exact:true}).count(),0,'no duplicate view pills');
      await page.getByRole('button',{name:'К списку игр',exact:true}).click();
      await page.locator('.gb-discovery-hero').waitFor();
      assert.equal(await page.locator('.gb-discovery-create').count(),1,'original create banner');
      await page.getByRole('button',{name:'На карте',exact:true}).click();
      await page.locator('[data-map-ready="true"][data-map-settled="true"]').waitFor({timeout:30000});
    }
    await page.close();
  }
} finally { await browser.close(); }
