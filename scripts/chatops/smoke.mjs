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
const errors=[], resources=[];
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
  }
  assert.equal(errors.length,0,errors.join('\n'));
  passed=true;
  console.log(JSON.stringify({smoke:'PASS',source_sha:process.env.EXPECTED_SHA,
    radar:process.env.REQUIRE_RADAR==='0'?'NOT_REQUESTED':'VISIBLE',url:url.origin}));
 } catch(error) { failure=error.message; throw error; } finally {
  if(page) await page.screenshot({path:'_out/radar/screenshot.png',fullPage:true});
  await writeFile('_out/radar/receipt.json',JSON.stringify({status:passed?(process.env.REQUIRE_RADAR==='0'?'PLATFORM_CANARY_PASS':'ANONYMOUS_MAP_PASS'):'FAIL',
    observedApiSha:process.env.EXPECTED_SHA,radarAcceptance:process.env.REQUIRE_RADAR==='0'?'NOT_TESTED':(passed?'PASS':'FAIL'),privatePlayerAcceptance:'NOT_TESTED',failure,resources,errors},null,2));
  await browser.close();
}
