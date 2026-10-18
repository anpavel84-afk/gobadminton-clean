/* global document, window */
// Local mocked-API browser regressions ONLY. No actual map or authenticated UAT claim.
// Run against an already running local web app; never intercept a hosted DEV session.
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const origin = new URL(process.env.GB_MAP_LOCAL_ORIGIN || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'local mocked-API tests require loopback');
const cityId = 'a0000000-0000-4000-8000-000000000001';
const name = 'Очень длинное название площадки ' + 'БадминтонБезПробелов'.repeat(12);
const venue = { id:'empty-long-venue', cityId, name, address:'Тестовый адрес', timezone:'Europe/Moscow', latitude:55.75, longitude:37.62 };
const browser = await chromium.launch({headless:true});
try {
  for (const width of [390,430,768,1024,1440]) {
    const context = await browser.newContext({viewport:{width,height:700}});
    const page = await context.newPage();
    let fail = false;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = body => route.fulfill({status:200,json:body});
      if(path === '/v1/me') return route.fulfill({status:401,json:{title:'Guest'}});
      if(path === '/v1/discovery/city-hint') return json({cityId,source:'default'});
      if(path === '/v1/cities') return json({items:[{id:cityId,nameRu:'Москва',timezone:'Europe/Moscow'}]});
      if(path === '/v1/venues/' + venue.id) return json(venue);
      if(path === '/v1/venues' || path === '/v1/games') {
        await gate;
        if(fail) return route.fulfill({status:503,json:{title:'Controlled offline'}});
        return json({items:path === '/v1/venues' ? [venue] : [],nextCursor:null});
      }
      return route.fulfill({status:404,json:{title:'No fixture'}});
    });
    // Local origin deliberately cannot load the approved hosted map bundle. No fake map.
    await page.goto(origin + 'games?view=map&activity=regular');
    const loading = page.getByRole('status').filter({hasText:'Загружаем все площадки и расписание'});
    await loading.waitFor({state:'attached'});
    assert.equal(await page.getByRole('button',{name:'Обновить карту и расписание',exact:true}).count(),0);
    release();
    const disclosure = page.locator('.gb-games-map-fallback > summary');
    await disclosure.waitFor();
    await page.getByRole('heading',{name:'Карта не загрузилась'}).waitFor();
    assert.equal(await page.locator('.gb-games-map-back').count(),0,'M0 card owns the only return control');
    assert.equal(await page.getByRole('button',{name:'Повторить',exact:true}).count(),1);
    const pinAlternative = page.getByRole('button',{name:name+' · 0',exact:true});
    assert.equal(await pinAlternative.isVisible(),false,'closed fallback hides focus targets');
    await disclosure.focus(); await page.keyboard.press('Enter');
    await pinAlternative.waitFor();
    assert.equal(await pinAlternative.isEnabled(),true,'zero-game venue remains accessible');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth+1),'long fallback name must not widen document');
    await pinAlternative.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(url=>url.pathname==='/venues/'+venue.id);
    await page.getByRole('heading',{name,exact:true}).waitFor();
    const schedule = page.getByRole('region',{name:'Расписание площадки'});
    await schedule.getByText('Нет предстоящих доступных игр',{exact:true}).waitFor();
    assert.equal(await schedule.getByRole('link',{name:/^Подробнее:/}).count(),0,'empty venue must not route to a random game');
    const create = schedule.getByRole('link',{name:'Создать игру на этой площадке',exact:true});
    assert.equal(await create.getAttribute('href'),'/games/create?venueId='+venue.id);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth+1),'long venue heading must fit');
    await page.getByRole('link',{name:'Назад к карте',exact:true}).click();
    await disclosure.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('activity'),'regular');
    fail = true;
    await page.evaluate(() => window.dispatchEvent(new globalThis.Event('online')));
    await page.getByRole('alert').filter({hasText:'Не удалось загрузить полный каталог'}).waitFor();
    await disclosure.click();
    await page.getByRole('button',{name:name+' · ?',exact:true}).waitFor();
    fail = false;
    await page.evaluate(() => window.dispatchEvent(new globalThis.Event('online')));
    await pinAlternative.waitFor();
    assert.equal(await page.getByRole('alert').filter({hasText:'Не удалось загрузить полный каталог'}).count(),0,'retry clears error');
    await context.close();
  }
} finally { await browser.close(); }
