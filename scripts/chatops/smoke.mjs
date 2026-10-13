import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
const url = new URL(process.env.PUBLIC_URL);
assert.equal(url.protocol, 'https:');
assert.match(process.env.EXPECTED_SHA || '', /^[0-9a-f]{40}$/);
const response = await fetch(new URL('/v1/meta', url), {signal: AbortSignal.timeout(15000), redirect:'error'});
assert(response.ok, `meta HTTP ${response.status}`);
assert.equal((await response.json()).gitSha, process.env.EXPECTED_SHA);
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage(); // no geolocation permission; public map must work abroad
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('/players',url).href,{waitUntil:'domcontentloaded',timeout:45000});
  if (process.env.REQUIRE_RADAR !== '0') {
    const city = page.getByRole('combobox',{name:'Город',exact:true});
    if (await city.count()) {
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
    await page.getByRole('button',{name:'Увеличить карту',exact:true}).click();
    await page.getByRole('button',{name:'Уменьшить карту',exact:true}).click();
    assert.equal(await page.locator('.g2-map-marker').count(),0,'Guest must not see private player pins');
  }
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({smoke:'PASS',source_sha:process.env.EXPECTED_SHA,
    radar:process.env.REQUIRE_RADAR==='0'?'NOT_REQUESTED':'VISIBLE',url:url.origin}));
} finally { await browser.close(); }
