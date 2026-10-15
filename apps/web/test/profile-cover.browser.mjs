/* global process, Buffer, URL, console, document, innerWidth */
// Synthetic UI regression only. Independent QA supplies an already-built loopback
// Web server and Playwright; this script never starts services or authenticates live users.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin=process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname,'127.0.0.1','Synthetic loopback only');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  let version=1, uploadedUrl=null, writes=0, failNext=false, broken=false;
  const cover=()=>({uploadedUrl});
  const profile=()=>({publicPlayerId:'00000036-1111-4111-8111-111111111111',version,displayName:'Synthetic cover owner',cityId:null,areaKey:null,level:null,bio:null,directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,optedInAt:null,radarConsented:false,radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:true,trainer:false,lookingForGame:null,cover:cover()});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(p.startsWith('/v1/media/covers/'))return broken?route.abort():route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=','base64')});
   if(!p.startsWith('/v1/'))return route.continue();
   const reply=(json,status=200)=>route.fulfill({json,status});
   if(p==='/v1/me')return reply({id:'synthetic-owner',displayName:'Synthetic cover owner',csrfToken:'fixture',locale:'ru',linkedProviders:[]});
   if(p==='/v1/me/social-profile')return reply(profile());
   if(p==='/v1/me/cover') {
    if(request.method()==='GET')return reply({version,cover:cover()});
    writes++;assert.equal(request.headers()['x-csrf-token'],'fixture');assert.equal(Number(request.headers()['x-profile-version']),version);assert.ok(request.headers()['idempotency-key']);
    if(failNext){failNext=false;return reply({code:'MODERATION_TEMPORARILY_UNAVAILABLE',title:'Synthetic retry'},503);}
    if(request.method()==='PUT') {
     const body=request.postDataBuffer();assert.ok(body?.length && body.length<=524288);
     assert.match(request.headers()['content-type'],/^image\/(jpeg|webp)$/);
     uploadedUrl='/v1/media/covers/'+(writes%2?'a':'b').repeat(64)+'.png';
    } else {assert.equal(request.method(),'DELETE');assert.match(request.headers()['content-type'],/^application\/json/);assert.deepEqual(request.postDataJSON(),{expectedVersion:version});uploadedUrl=null;}
    version++;return reply({version,cover:cover()});
   }
   if(p==='/v1/cities')return reply({items:[]});
   if(p==='/v1/me/trainer-profile')return reply({},404);
   if(p==='/v1/me/participations'||p==='/v1/me/games')return reply({items:[],nextCursor:null});
   if(p==='/v1/me/inbox/counts')return reply({pendingRequestCount:0,pendingInvitationCount:0,dmUnread:0,gameChatUnread:0});
   return reply({},404);
  });
  const page=await context.newPage();
  await page.goto(origin+'/profile');await page.getByRole('button',{name:'Изменить обложку',exact:true}).waitFor();
  // Build a real local source with a different size from the transmitted derivative.
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='green';ctx.fillRect(0,0,900,600);return canvas.toDataURL('image/png').split(',')[1];});
  const choose=async()=>{
   await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();
   await page.getByLabel('Выбрать изображение обложки',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
   await page.getByAltText('Выбранный фрагмент на компьютере').waitFor();
  };
  await choose();assert.equal(writes,0,'selection and preview do not upload');
  await page.getByLabel('По вертикали',{exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.getByAltText('Выбранный фрагмент на компьютере').waitFor();
  await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();await page.getByText('Обложка сохранена.',{exact:true}).waitFor();
  assert.equal(writes,1);const first=uploadedUrl;
  await choose();await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();await page.getByText('Обложка сохранена.',{exact:true}).waitFor();assert.notEqual(uploadedUrl,first);
  broken=true;await page.reload();await page.locator('.own-profile-avatar > .profile-cover[data-cover="default"]').waitFor();broken=false;
  await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();await page.getByRole('button',{name:'Удалить обложку',exact:true}).click();await page.getByText('Обложка удалена. Используется стандартное оформление.',{exact:true}).waitFor();assert.equal(uploadedUrl,null);
  await choose();failNext=true;await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();await page.getByRole('button',{name:'Обновить данные',exact:true}).click();
  await page.getByRole('button',{name:'Изменить обложку',exact:true}).waitFor();assert.equal(uploadedUrl,null);
  await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Обложка профиля'}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no overflow`);
  await context.close();
 }
 console.log('Synthetic cover UI regression completed (mock API; not live authenticated acceptance)');
} finally {await browser.close();}
