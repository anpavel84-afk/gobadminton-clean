import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
const url = new URL(process.env.PUBLIC_URL);
assert.equal(url.protocol, 'https:');
assert.match(process.env.EXPECTED_SHA || '', /^[0-9a-f]{40}$/);
const response = await fetch(new URL('/v1/meta', url), {signal: AbortSignal.timeout(15000), redirect:'error'});
assert(response.ok, `meta HTTP ${response.status}`);
assert.equal((await response.json()).gitSha, process.env.EXPECTED_SHA);
await mkdir('_out/radar', {recursive:true});
let page, passed=false, failure=null;
const errors=[], resources=[], viewportResults=[], radarMutations=[];
const browser = await chromium.launch({headless:true});
try {
  page = await browser.newPage({viewport:{width:390,height:844}}); // no geolocation permission; public map must work abroad
  page.on('response',r=>{if(r.url().includes('/map-assets/')) resources.push({url:r.url(),status:r.status()});});
  page.on('pageerror', e => errors.push(e.message));
  const players = await page.goto(new URL('/players',url).href,{waitUntil:'domcontentloaded',timeout:45000});
  assert(players && players.ok(), 'players HTTP '+(players ? players.status() : 'NO_RESPONSE'));
  if (process.env.REQUIRE_RADAR !== '0') {
    const city = page.getByRole('combobox',{name:'Город',exact:true});
    if (await city.count()) {
      await city.locator('option').filter({hasText:/Москв/}).first().waitFor({state:'attached',timeout:30000});
      const opts = await city.locator('option').evaluateAll(nodes => nodes.map(n => ({value:n.value,text:n.textContent})));
      const moscow = opts.find(o => /Москв/.test(o.text));
      assert(moscow, 'Moscow option missing');
      await city.selectOption(moscow.value);
    }
    const entry = page.getByRole('link',{name:/^(Карта|Показать на карте)$/}).first();
    await entry.waitFor({state:'visible',timeout:30000});
    await entry.click();
    await page.locator('[data-map-ready="true"] canvas').first().waitFor({state:'visible',timeout:45000});
    await page.locator('.g2-map-venue-marker').first().waitFor({state:'visible',timeout:20000});
    assert.equal(await page.locator('.g2-map-fallback').count(),0,'Fallback is not acceptance');
    assert(resources.some(r=>r.url.startsWith(url.origin+'/map-assets/') && r.url.includes('.pmtiles') && r.status===206),'No actual same-origin PMTiles range response');
    await page.locator('.g2-map-venue-marker').first().click();
    await page.locator('.maplibregl-popup-content strong').waitFor();
    await page.getByRole('button',{name:'Увеличить карту',exact:true}).click();
    await page.getByRole('button',{name:'Уменьшить карту',exact:true}).click();
    assert.equal(await page.locator('.g2-map-marker').count(),0,'Guest must not see private player pins');
    // Issue #184: anonymous display-filter UI at 390 / 430 / desktop; reuse same map page.
    await page.locator('[data-map-ready="true"] canvas').first().evaluate(el => el.setAttribute('data-smoke-canvas','1'));
    page.on('request', req => {
      const method = req.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      let path; try { path = new URL(req.url()).pathname; } catch { return; }
      // Mutating Radar publish/session paths. The POST results/preview endpoint is a read and stays allowed.
      if (path === '/v1/me/radar/activations' || path.startsWith('/v1/me/radar/activations/current')
        || path === '/v1/me/social-profile' || path.startsWith('/v1/auth/')) {
        radarMutations.push({method, path});
      }
    });
    for (const vp of [{width:390,height:844},{width:430,height:900},{width:1440,height:900}]) {
      const errBefore = errors.length;
      await page.setViewportSize(vp);
      await page.getByRole('button',{name:'Фильтры',exact:true}).click();
      const dialog = page.getByRole('dialog',{name:'Фильтры карты'});
      await dialog.waitFor({state:'visible'});
      const box = await dialog.boundingBox();
      assert(box, 'Фильтры карты box missing');
      assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1,
        `Фильтры карты overflows ${vp.width}x${vp.height}`);
      assert.equal(await dialog.locator('.gb-map-filters-section').count(), 2, 'expected Площадки + Радар игроков');
      assert.equal(await dialog.getByRole('radio',{name:/Все площадки/}).getAttribute('aria-checked'), 'true');
      assert.equal(await dialog.getByRole('switch',{name:'Показывать игроков рядом',exact:true}).getAttribute('aria-checked'), 'true');
      await page.screenshot({path:`_out/radar/filters-open-${vp.width}.png`});
      await dialog.getByRole('radio',{name:/Только с играми/}).click();
      await dialog.getByRole('switch',{name:'Показывать игроков рядом',exact:true}).click();
      await dialog.getByRole('button',{name:'Применить',exact:true}).click();
      await dialog.waitFor({state:'hidden'});
      const chip = page.locator('.gb-map-filters-chip__label');
      await chip.waitFor({state:'visible'});
      const chipText = (await chip.textContent()) || '';
      assert.match(chipText, /Показ игроков выключен/);
      assert.doesNotMatch(chipText, /Радар\s*выкл/i);
      await page.screenshot({path:`_out/radar/filters-applied-${vp.width}.png`});
      await page.locator('.gb-map-filters-chip__reset').click();
      await page.locator('.gb-map-filters-chip').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Фильтры',exact:true}).click();
      const again = page.getByRole('dialog',{name:'Фильтры карты'});
      await again.waitFor({state:'visible'});
      assert.equal(await again.getByRole('radio',{name:/Все площадки/}).getAttribute('aria-checked'), 'true');
      assert.equal(await again.getByRole('switch',{name:'Показывать игроков рядом',exact:true}).getAttribute('aria-checked'), 'true');
      await again.getByRole('button',{name:'Закрыть фильтры карты',exact:true}).click();
      await again.waitFor({state:'hidden'});
      assert.equal(await page.locator('canvas[data-smoke-canvas="1"]').count(), 1, 'MapLibre canvas DOM identity lost');
      assert(await page.locator('canvas[data-smoke-canvas="1"]').evaluate(el => el.isConnected), 'canvas disconnected');
      assert.equal(await page.locator('.g2-map-marker').count(), 0, 'Guest must not see private player pins');
      assert.equal(errors.length, errBefore, errors.slice(errBefore).join('\n'));
      viewportResults.push({width:vp.width,height:vp.height,dialogFits:true,chipLabel:chipText.trim(),canvasPreserved:true,privatePins:0});
    }
    assert.equal(radarMutations.length, 0, 'display filters must not mutate Radar/session: '+JSON.stringify(radarMutations));
  }
  assert.equal(errors.length,0,errors.join('\n'));
  if (process.env.CHATOPS_DEV_ADMIN_COMMISSIONED === 'true') {
    assert.equal(url.origin, 'https://dev.gobadminton.ru');
    assert.match(process.env.EXPECTED_ADMIN_DIGEST || '', /^sha256:[0-9a-f]{64}$/);
    const admin = 'https://dev.gobadminton.ru';
    const meta = await fetch(admin+'/v1/meta', {redirect:'error',signal:AbortSignal.timeout(15000)});
    assert(meta.ok, `Admin meta HTTP ${meta.status}`);
    assert.equal((await meta.json()).gitSha, process.env.EXPECTED_SHA);
    // Fresh unauthenticated context; never enroll a credential or start provider login.
    const adminPage = await browser.newPage();
    const adminErrors = [];
    adminPage.on("pageerror", error => adminErrors.push(error.message));
    try {
      const response = await adminPage.goto(admin+'/admin/', {waitUntil:'domcontentloaded',timeout:45000});
      assert(response?.ok(), 'Admin HTTP response failed');
      assert.equal(new URL(adminPage.url()).pathname, '/admin/');
      await adminPage.getByRole('heading',{name:'Вход для команды',exact:true}).waitFor({timeout:15000});
      const login = adminPage.getByRole('button',{name:'Войти через Яндекс',exact:true});
      await login.waitFor();
      assert(await login.isEnabled(), 'Admin login is not ready');
      assert.equal(await adminPage.title(), 'GoBadminton · Администрирование');
      assert.equal(await adminPage.getByRole('navigation',{name:'Разделы администрирования'}).count(), 0);
      assert.equal(adminErrors.length, 0, adminErrors.join('\n'));
      const me = await adminPage.request.get(admin+'/admin/v1/admin/auth/me', {headers:{Origin:admin}});
      assert.equal(me.status(),401,'Anonymous Admin must require authentication');
      await adminPage.screenshot({path:'_out/radar/admin.png'});
    } finally { await adminPage.close(); }
  }
  passed=true;
  console.log(JSON.stringify({smoke:'PASS',source_sha:process.env.EXPECTED_SHA,
    radar:process.env.REQUIRE_RADAR==='0'?'NOT_REQUESTED':'VISIBLE',url:url.origin}));
 } catch(error) { failure=error.message; throw error; } finally {
  if(page) await page.screenshot({path:'_out/radar/screenshot.png',fullPage:true});
  await writeFile('_out/radar/receipt.json',JSON.stringify({status:passed?(process.env.REQUIRE_RADAR==='0'?'PLATFORM_CANARY_PASS':'ANONYMOUS_MAP_PASS'):'FAIL',
    observedApiSha:process.env.EXPECTED_SHA,
    adminAcceptance:process.env.CHATOPS_DEV_ADMIN_COMMISSIONED==='true'?(passed?'ANONYMOUS_ENTRY_PASS':'FAIL'):'NOT_REQUESTED',
    adminProviderAndPasskey:'NOT_TESTED',
    ...(process.env.CHATOPS_DEV_ADMIN_COMMISSIONED==='true'?{admin_digest:process.env.EXPECTED_ADMIN_DIGEST}:{}),radarAcceptance:process.env.REQUIRE_RADAR==='0'?'NOT_TESTED':(passed?'PASS':'FAIL'),privatePlayerAcceptance:'NOT_TESTED',
    viewportFilters:process.env.REQUIRE_RADAR==='0'?'NOT_TESTED':viewportResults,radarMutations,failure,resources,errors},null,2));
  await browser.close();
}
