/* global process, Buffer, URL, console, document, innerWidth */
// Synthetic loopback UI regression. Does not start services or authenticate live accounts.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin=process.env.P1_ORIGIN||'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname,'127.0.0.1','Synthetic loopback only');
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const id='00000037-1111-4111-8111-111111111111';
try {
  for(const width of [320,360,390,1440]){
    const context=await browser.newContext({viewport:{width,height:900}});
    let version=1,hasCover=false,uploadedUrl=null,bytes=null,writes=0,failNext=false,broken=false,authorized=true;
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),p=url.pathname;
      if(url.origin!==origin)return route.abort();
      if(!p.startsWith('/v1/'))return route.continue();
      const reply=(json,status=200)=>route.fulfill({json,status});
      if(p===`/v1/venues/${id}`)return reply({id,cityId:'a0000000-0000-4000-8000-000000000001',name:'Synthetic venue',address:'Synthetic address',timezone:'Europe/Moscow',latitude:55.7,longitude:37.6,dataStatus:'verified',provenance:'admin_created',cover:{uploadedUrl}});
      if(p===`/v1/admin/venues/${id}/cover/access`){
        assert.equal(req.method(),'GET');
        return authorized?reply({version,hasCover,cover:{uploadedUrl},csrfToken:'synthetic-csrf'},200):reply({title:'Forbidden'},403);
      }
      if(p===`/v1/admin/venues/${id}/cover`){
        assert.equal(req.headers()['x-csrf-token'],'synthetic-csrf');assert.ok(req.headers()['idempotency-key']);
        if(req.method()==='PUT'){
          assert.equal(req.headers()['x-venue-version'],String(version));assert.equal(req.headers()['content-type'],'image/webp');
          hasCover=true;bytes=req.postDataBuffer();assert.ok(bytes.length<=512*1024);uploadedUrl='/v1/media/venue-covers/'+String(version).repeat(64)+'.png';
        } else {assert.equal(req.method(),'DELETE');assert.deepEqual(req.postDataJSON(),{expectedVersion:version});uploadedUrl=null;hasCover=false;}
        writes++;version++;
        if(failNext){failNext=false;return route.abort();}
        return reply({version,hasCover,cover:{uploadedUrl}});
      }
      if(p.startsWith('/v1/media/venue-covers/'))return broken?route.abort():route.fulfill({contentType:'image/webp',body:bytes});
      if(p==='/v1/me')return reply({title:'Synthetic anonymous consumer'},401);
      if(p==='/v1/cities')return reply({items:[{id:'a0000000-0000-4000-8000-000000000001',nameRu:'Москва',nameEn:'Moscow',countryCode:'RU',defaultTimezone:'Europe/Moscow'}]});
      return reply({items:[]});
    });
    const page=await context.newPage();await page.goto(`${origin}/venues/${id}`);
    await page.getByRole('heading',{name:'Обложка площадки',exact:true}).waitFor();
    assert.equal(await page.locator('[data-cover="default"]').count(),1);
    const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');x.fillStyle='green';x.fillRect(0,0,1200,800);x.fillStyle='purple';x.fillRect(0,0,600,800);return c.toDataURL('image/png').split(',')[1];});
    await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
    await page.getByAltText('Предпросмотр обложки').waitFor();assert.equal(writes,0,'selection never uploads');
    await page.getByRole('slider',{name:'По горизонтали'}).focus();await page.keyboard.press('ArrowRight');
    await page.getByRole('button',{name:'Подтвердить обложку',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Обложка сохранена.'}).waitFor();assert.equal(writes,1);
    await page.getByAltText('Обложка: Synthetic venue').waitFor();
    await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
    await page.getByAltText('Предпросмотр обложки').waitFor();
    const draft=await page.getByAltText('Предпросмотр обложки').getAttribute('src');
    failNext=true;await page.getByRole('button',{name:'Подтвердить обложку',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Результат не подтверждён'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Подтвердить обложку',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Обновить данные',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Данные обновлены'}).waitFor();
    assert.equal(await page.getByAltText('Предпросмотр обложки').getAttribute('src'),draft,'reconciliation preserves local crop');
    await page.getByRole('button',{name:'Подтвердить обложку',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Обложка сохранена.'}).waitFor();
    // Moderation hides the public derivative but retains the owner's removable cover.
    uploadedUrl=null;
    await page.reload();
    await page.getByRole('heading',{name:'Обложка площадки',exact:true}).waitFor();
    await page.locator('[data-cover="default"]').waitFor();
    assert.equal(hasCover,true);
    assert.equal(await page.getByRole('button',{name:'Удалить обложку',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'Удалить обложку',exact:true}).click();
    await page.locator('[data-cover="default"]').waitFor();assert.equal(uploadedUrl,null);
    await page.getByRole('status').filter({hasText:'Обложка сохранена.'}).waitFor();
    assert.equal(hasCover,false);
    assert.equal(await page.getByRole('button',{name:'Удалить обложку',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // Broken current media uses the neutral shell; revoked access never mounts controls.
    uploadedUrl='/v1/media/venue-covers/'+'a'.repeat(64)+'.png';broken=true;authorized=false;
    await page.reload();await page.locator('[data-cover="default"]').waitFor();
    assert.equal(await page.getByRole('button',{name:'Подтвердить обложку',exact:true}).count(),0);
    await context.close();
  }
  console.log('Synthetic venue cover UI regression completed; not live authorization/UAT evidence.');
} finally {await browser.close();}
