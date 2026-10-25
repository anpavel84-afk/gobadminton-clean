/* global process, Buffer, URL, console, document */
// Executable synthetic loopback UI regression; no service startup or live account access.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin=process.env.P1_ORIGIN||'http://127.0.0.1:18984';assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const id='00000047-1111-4111-8111-111111111111',venueId='00000037-1111-4111-8111-111111111111';
try {
 for(const width of [360,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  let version=1,own=null,venue='/v1/media/venue-covers/'+'a'.repeat(64)+'.png',bytes=null,writes=0,fail=false,authorized=true;
  const game=()=>({id,version,title:'Synthetic game',status:'draft',visibility:'unlisted',activityKind:'regular',trainer:null,trainingDescription:null,
   organizer:{id:null,displayName:'Synthetic organizer',publicContact:'Synthetic'},
   venue:{id:venueId,name:'Synthetic venue',address:'Synthetic',cityId:'a0000000-0000-4000-8000-000000000001',timezone:'Europe/Moscow',cover:{uploadedUrl:venue}},cover:{uploadedUrl:own||venue},
   startsAt:'2029-01-01T12:00:00Z',endsAt:'2029-01-01T13:00:00Z',timezone:'Europe/Moscow',applicationDeadlineAt:'2029-01-01T12:00:00Z',capacity:4,externalReservedCount:0,confirmedCount:1,availablePlaces:3,formatKey:'doubles',levelRule:{scaleId:'test',scaleVersion:1,allowedLevelIds:['test']},settlement:{mode:'external',purpose:'no_trainer_fee',terms:'Synthetic',priceMinor:null,currency:null},management:{role:'owner',createdByMe:true}});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(url.origin!==origin)return route.abort();if(!p.startsWith('/v1/'))return route.continue();
   const reply=(json,status=200)=>route.fulfill({json,status});
   if(p==='/v1/me')return reply({id:'synthetic',displayName:'Synthetic',linkedProviders:[],csrfToken:'synthetic-csrf'});
   if(p==='/v1/me/games')return reply({items:authorized?[game()]:[],nextCursor:null});
   if(p===`/v1/games/${id}/cover`){
    if(!authorized)return reply({title:'Not found'},404);
    if(req.method()!=='GET'){
     assert.equal(req.headers()['x-csrf-token'],'synthetic-csrf');assert.equal(req.headers()['x-game-version'],String(version));assert.ok(req.headers()['idempotency-key']);
     if(req.method()==='PUT'){bytes=req.postDataBuffer();assert.ok(bytes.length<=512*1024);own='/v1/media/game-covers/'+String(version).repeat(64)+'.png';}
     else {assert.equal(req.method(),'DELETE');assert.deepEqual(req.postDataJSON(),{expectedVersion:version});own=null;}
     version++;writes++;if(fail){fail=false;return route.abort();}
    }
    return reply({version,hasCover:!!own,cover:{uploadedUrl:own||venue}});
   }
   if(p.startsWith('/v1/media/'))return bytes?route.fulfill({contentType:'image/webp',body:bytes}):route.abort();
   if(p==='/v1/cities')return reply({items:[{id:'a0000000-0000-4000-8000-000000000001',nameRu:'Москва',defaultTimezone:'Europe/Moscow'}]});
   return reply({items:[],nextCursor:null});
  });
  const page=await context.newPage();await page.goto(`${origin}/my-games/${id}`);
  await page.getByRole('heading',{name:'Фото этой игры · необязательно',exact:true}).waitFor();
  const source=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=600;const x=c.getContext('2d');x.fillStyle='green';x.fillRect(0,0,1200,600);return c.toDataURL('image/png').split(',')[1];});
  const select=async()=>{
   await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
   await page.getByAltText('Предпросмотр фото игры').waitFor();assert.equal(await page.getByRole('button',{name:'Сохранить фото игры',exact:true}).isDisabled(),true);
   await page.getByRole('slider',{name:'По горизонтали'}).focus();await page.keyboard.press('ArrowRight');
   await page.getByRole('button',{name:'Подтвердить выбор фото',exact:true}).click();
  };
  await select();assert.equal(writes,0,'local selection does not upload');
  await page.getByRole('button',{name:'Сохранить фото игры',exact:true}).click();
  await page.getByRole('heading',{name:'Фото этой игры · необязательно',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('img[src*="/media/game-covers/"]'));
  const first=own;venue='/v1/media/venue-covers/'+'b'.repeat(64)+'.png';await page.reload();
  await page.waitForFunction(()=>document.querySelector('img[src*="/media/game-covers/"]'));assert.equal(own,first,'own photo keeps priority after venue change');
  await select();fail=true;await page.getByRole('button',{name:'Сохранить фото игры',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Сохранение не подтверждено'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Сохранить фото игры',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Обновить данные',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Данные обновлены'}).waitFor();
  await page.getByRole('button',{name:'Сохранить фото игры',exact:true}).click();
  await page.getByRole('heading',{name:'Фото этой игры · необязательно',exact:true}).waitFor();
  await page.getByRole('button',{name:'Удалить своё фото',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('img[src*="/media/game-covers/"]'));assert.equal(own,null);
  venue=null;await page.reload();await page.locator('[data-cover="default"]').first().waitFor();
  authorized=false;await page.reload();await page.getByRole('heading',{name:'Игра не в вашем списке управления'}).waitFor();assert.equal(await page.locator('input[type=file]').count(),0);
  await context.close();
 }
 console.log('Synthetic Issue47 management photo regression complete; this is not authenticated hosted UAT.');
}finally{await browser.close();}
