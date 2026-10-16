/* global document */
// Independent QA entrypoint; requires an existing authorized DEV and controlled public games.
// No service startup, deployment, login or mutation. Missing map/fixtures is never PASS.
import assert from 'node:assert/strict';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
assert.ok(process.env.GB_MAP_ORIGIN, 'NOT_TESTED: provide authorized DEV origin');
assert.ok(process.env.GB_MAP_VENUES, 'NOT_TESTED: provide JSON [{id,name,gameIds}] with 5/4/6 eligible games');
const venues = JSON.parse(process.env.GB_MAP_VENUES);
assert.deepEqual(venues.map(v => v.gameIds.length), [5, 4, 6]);
const browser = await (process.env.GB_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true});
try {
  for (const width of [390,430,768,1024,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<500});
    const page = await context.newPage();
    const bounded = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `overflow at ${width}`);
    await page.goto(process.env.GB_MAP_ORIGIN + '/games?view=map');
    await bounded();
    await page.locator('[data-map-ready="true"]').waitFor({timeout:30000});
    const marker = page.locator('.maplibregl-marker.g2-map-marker');
    assert.ok(await marker.count() >= 3, 'NOT_TESTED: actual map markers required');
    await bounded();
    for (const venue of venues) {
      const pin = page.getByRole('button',{name:`${venue.name}: ${venue.gameIds.length} доступных игр`,exact:true});
      const box = await pin.boundingBox();
      assert.ok(box, 'NOT_TESTED: visible marker required');
      assert.equal(await pin.textContent(), String(venue.gameIds.length));
      // Real hit testing: no force, no dispatchEvent, no title-link substitution.
      if(width<500) await pin.tap(); else await pin.click();
      await page.waitForURL(url => url.pathname === `/venues/${venue.id}`);
      await page.getByRole('heading',{name:venue.name,exact:true}).waitFor();
      const schedule = page.getByRole('region',{name:'Расписание площадки'});
      const details = schedule.getByRole('link',{name:/^Подробнее:/});
      await details.first().waitFor();
      assert.equal(await details.count(), venue.gameIds.length);
      const hrefs = await details.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.deepEqual([...hrefs].sort(), venue.gameIds.map(id=>`/games/${id}`).sort());
      const times = await schedule.locator('time[datetime]').evaluateAll(nodes => nodes.map(node=>Date.parse(node.dateTime)));
      assert.deepEqual(times,[...times].sort((a,b)=>a-b));
      assert.equal(await schedule.locator('.gb-discovery-spots').count(),venue.gameIds.length);
      await bounded();
      await details.first().click();
      await page.waitForURL(url=>url.pathname===hrefs[0]);
      await page.goBack();
      await page.getByRole('link',{name:'Назад к карте',exact:true}).click();
      await page.locator('[data-map-ready="true"]').waitFor();
      await bounded();
    }
    const canvas=page.locator('.maplibregl-canvas');
    const box=await canvas.boundingBox(); assert.ok(box);
    const before=page.url();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down(); await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+30,{steps:10}); await page.mouse.up();
    assert.equal(page.url(),before,'pan must not select venue'); await bounded();
    const pin=page.locator('.maplibregl-marker.g2-map-marker').first();
    await pin.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(url=>url.pathname.startsWith('/venues/'));
    await bounded();
    await context.close();
  }
} finally { await browser.close(); }
