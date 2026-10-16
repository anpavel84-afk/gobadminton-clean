/* global process, Buffer, URL, console, document, window */
// Independent QA runner: existing loopback build only; no service startup/live accounts.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const id='00000047-1111-4111-8111-111111111111';
const city='a0000000-0000-4000-8000-000000000001';
const venueId='00000037-1111-4111-8111-111111111111';
const venue={id:venueId,cityId:city,name:'Synthetic venue',address:'Fixture',timezone:'Europe/Moscow',cover:{uploadedUrl:null}};
const own='/v1/media/game-covers/'+'b'.repeat(64)+'.webp';
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try {
 for(const width of [360,1440]) for(const scenario of ['approved','rejected','uncertain','none','cancel']) {
  const context=await browser.newContext({viewport:{width,height:1000}});
  const events=[];let saved=null,uploaded=null,readbacks=0;
  // Hold the real decoder deterministically. Cancellation must clear busy state
  // while this operation is pending, then ignore its late completion.
  await context.addInitScript(()=>{
   const decode=window.createImageBitmap.bind(window);
   window.__photoGate=false;
   window.createImageBitmap=async(...args)=>{
    if(window.__photoGate){
     window.__photoDecodePending=true;
     await new Promise(resolve=>{window.__releasePhotoDecode=resolve;});
    }
    try { return await decode(...args); }
    finally { window.__photoDecodeSettled=true; }
   };
  });
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(!p.startsWith('/v1/'))return route.continue();
   const reply=(json,status=200)=>route.fulfill({json,status});
   if(p==='/v1/me')return reply({id:'synthetic',displayName:'Synthetic organizer',csrfToken:'fixture',linkedProviders:[]});
   if(p==='/v1/me/social-profile')return reply({cityId:city});
   if(p==='/v1/me/trainer-profile')return reply({},404);
   if(p==='/v1/me/game-preferences')return reply({version:1,defaultPublicGameContact:'Synthetic contact'});
   if(p==='/v1/me/discovery-preference')return reply({cityId:city,version:1});
   if(p==='/v1/discovery/city-hint')return reply({cityId:city,source:'default'});
   if(p==='/v1/cities')return reply({items:[{id:city,nameRu:'Москва',timezone:'Europe/Moscow'}]});
   if(p==='/v1/venues')return reply({items:[venue],nextCursor:null});
   if(p==='/v1/me/participations')return reply({items:[],nextCursor:null});
   if(p==='/v1/me/games'){readbacks++;return reply({items:saved?[{...saved,management:{role:'owner',createdByMe:true}}]:[],nextCursor:null});}
   if(p==='/v1/games'&&req.method()==='POST'){
    events.push('draft');assert.equal(req.headers()['x-csrf-token'],'fixture');
    const input=req.postDataJSON();assert.equal(input.venueId,venueId);
    assert.equal('cover' in input,false,'venue/own media is not copied into creation payload');
    saved={...input,id,version:7,title:'Synthetic game',status:'draft',venue,cover:{uploadedUrl:null},organizer:{id:null,displayName:'Synthetic organizer',publicContact:'Synthetic contact'},trainer:null,confirmedCount:1,availablePlaces:3};
    return reply(saved,201);
   }
   if(p===`/v1/games/${id}/cover`&&req.method()==='PUT'){
    events.push('cover');assert.equal(saved.status,'draft');
    assert.equal(req.headers()['x-game-version'],'7');assert.equal(req.headers()['x-csrf-token'],'fixture');assert.ok(req.headers()['idempotency-key']);
    uploaded=req.postDataBuffer();assert.ok(uploaded.length>0&&uploaded.length<=512*1024);
    if(scenario==='rejected')return reply({title:'Moderation rejected'},422);
    saved={...saved,version:11,cover:{uploadedUrl:own}};
    if(scenario==='uncertain')return route.abort(); // committed, receipt lost
    return reply({version:11,hasCover:true,cover:{uploadedUrl:own}});
   }
   if(p===`/v1/games/${id}/publish`){
    events.push('publish');assert.equal(req.method(),'POST');
    assert.equal(req.postDataJSON().expectedVersion,scenario==='approved'?11:7,'publish uses upload receipt version, or original version without an image');
    assert.equal(req.headers()['x-csrf-token'],'fixture');
    saved={...saved,status:'published',version:saved.version+1};return reply(saved);
   }
   if(p.startsWith('/v1/media/'))return uploaded?route.fulfill({body:uploaded,contentType:'image/webp'}):route.abort();
   return reply({items:[],nextCursor:null});
  });
  const page=await context.newPage();
  await page.goto(`${origin}/games/create?venueId=${venueId}`);
  await page.getByRole('heading',{name:'Фото этой игры · необязательно',exact:true}).waitFor();
  await page.locator('#venueId').filter({hasText:'Synthetic venue'}).waitFor();
  await page.getByRole('button',{name:'Завтра',exact:true}).click();
  await page.locator('#startTime').fill('18:00');
  const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=600;const x=c.getContext('2d');x.fillStyle='green';x.fillRect(0,0,1200,600);return c.toDataURL('image/png').split(',')[1];});
  if(scenario!=='none'){
   if(scenario==='cancel')await page.evaluate(()=>{window.__photoGate=true;});
   await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
   if(scenario==='cancel'){
    await page.waitForFunction(()=>window.__photoDecodePending===true);
    const selection=page.getByRole('region',{name:'Фото этой игры',exact:true});
    assert.equal(await selection.getAttribute('aria-busy'),'true');
    assert.equal(await page.getByRole('button',{name:'Проверить игру',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Без своего фото',exact:true}).click();
    assert.equal(await selection.getAttribute('aria-busy'),'false');
    assert.equal(await selection.getByRole('status').textContent(),'Используется текущая обложка площадки или стандартная.');
    assert.equal(await page.getByRole('button',{name:'Проверить игру',exact:true}).isEnabled(),true);
    await page.evaluate(()=>{window.__photoGate=false;window.__releasePhotoDecode();});
    await page.waitForFunction(()=>window.__photoDecodeSettled===true);
    assert.equal(await selection.getAttribute('aria-busy'),'false');
    assert.equal(await page.getByAltText('Предпросмотр фото игры').count(),0);
   }else{
    await page.getByAltText('Предпросмотр фото игры').waitFor();
    await page.getByRole('button',{name:'Подтвердить выбор фото',exact:true}).click();
   }
  }
  assert.deepEqual(events,[],'selection must remain local');
  await page.getByRole('button',{name:'Проверить игру',exact:true}).click();
  await page.getByRole('heading',{name:'Проверка перед публикацией',exact:true}).waitFor();
  await page.getByRole('button',{name:'Опубликовать игру',exact:true}).click();
  if(['rejected','uncertain'].includes(scenario)){
   await page.getByRole('status').filter({hasText:'Игра сохранена как черновик'}).waitFor();
   assert.deepEqual(events,['draft','cover'],'failed/uncertain image must stop publication');
   assert.equal(saved.status,'draft');assert.ok(readbacks>0,'reconcile saved draft');
   assert.equal(await page.getByRole('button',{name:'Опубликовать игру',exact:true}).count(),0);
  }else{
   await page.getByRole('heading',{name:'Игра опубликована',exact:true}).waitFor();
   assert.deepEqual(events,scenario==='approved'?['draft','cover','publish']:['draft','publish']);
   assert.equal(saved.status,'published');
   assert.equal(saved.cover.uploadedUrl,scenario==='approved'?own:null);
  }
  await context.close();
 }
 console.log('Synthetic Issue47 create/cancellation regressions complete; not hosted authenticated UAT.');
}finally{await browser.close();}
