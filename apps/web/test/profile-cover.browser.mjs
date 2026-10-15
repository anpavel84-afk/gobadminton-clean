/* global process, Buffer, URL, console, document, innerWidth, getComputedStyle */
// Synthetic UI regression only. Independent QA supplies an already-built loopback
// Web server and Playwright; this script never starts services or authenticates live users.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin=process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname,'127.0.0.1','Synthetic loopback only');
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try {
 for(const width of [320,360,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  let version=1, uploadedUrl=null, writes=0, failNext=null, broken=false, savedBytes=null;
  let coverReads=0, profileReads=0, profileWrites=0, readFailure=0, readGate=null, readVersion=null;
  const cityA='00000036-2222-4222-8222-111111111111', cityB='00000036-2222-4222-8222-222222222222';
  let fields={displayName:'Synthetic owner',bio:'Initial bio',cityId:cityA,areaKey:'Old area',directoryVisible:false,contactPolicy:'closed'};
  const cover=()=>({uploadedUrl});
  const profile=()=>({publicPlayerId:'00000036-1111-4111-8111-111111111111',version,...fields,level:null,consentPolicyVersion:null,optedInAt:null,radarConsented:false,radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:true,trainer:false,lookingForGame:null,cover:cover()});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(p.startsWith('/v1/media/covers/'))return broken?route.abort():route.fulfill({contentType:'image/png',body:savedBytes ?? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=','base64')});
   if(!p.startsWith('/v1/'))return route.continue();
   const reply=(json,status=200)=>route.fulfill({json,status});
   if(p==='/v1/me')return reply({id:'synthetic-owner',displayName:'Synthetic cover owner',csrfToken:'fixture',locale:'ru',linkedProviders:[]});
   if(p==='/v1/me/social-profile'){
    if(request.method()==='PATCH'){
     const input=request.postDataJSON();
     assert.equal(request.headers()['x-csrf-token'],'fixture');assert.ok(request.headers()['idempotency-key']);
     assert.equal(input.expectedVersion,version,'subsequent profile save uses coherent CAS');
     assert.equal(input.displayName,fields.displayName,'must preserve the other tab name');
     assert.equal(input.cityId,fields.cityId);assert.equal(input.areaKey,fields.areaKey);
     assert.equal(input.bio,fields.bio+' + local','local bio edit starts from the authoritative bio');
     fields={...fields,bio:input.bio};version++;profileWrites++;
     return reply(profile());
    }
    assert.equal(request.method(),'GET');profileReads++;
    if(readGate)await readGate;
    if(readFailure){const status=readFailure;readFailure=0;return reply({title:'Synthetic read failure'},status);}
    const snapshot=profile();snapshot.version=readVersion ?? version;readVersion=null;
    return reply(snapshot);
   }
   if(p==='/v1/me/cover') {
    if(request.method()==='GET'){
     coverReads++;
     return reply({version,cover:cover()});
    }
    writes++;assert.equal(request.headers()['x-csrf-token'],'fixture');assert.ok(request.headers()['idempotency-key']);
    const failure=failNext;failNext=null;
    if(failure?.startsWith('conflict')){
     assert.equal(Number(request.headers()['x-profile-version']),version-1,'tab A still has the pre-tab-B version');
     return reply({title:'Synthetic concurrent non-cover update'},409);
    }
    assert.equal(Number(request.headers()['x-profile-version']),version);
    if(failure==='offline')return route.abort('internetdisconnected');
    if(request.method()==='PUT') {
     const body=request.postDataBuffer();assert.ok(body?.length && body.length<=524288);
     assert.match(request.headers()['content-type'],/^image\/(jpeg|webp)$/);
     savedBytes=body;
     uploadedUrl='/v1/media/covers/'+(writes%2?'a':'b').repeat(64)+'.png';
    } else {assert.equal(request.method(),'DELETE');assert.match(request.headers()['content-type'],/^application\/json/);assert.deepEqual(request.postDataJSON(),{expectedVersion:version});uploadedUrl=null;}
    version++;
    if(failure==='committed')return route.abort('connectionreset');
    return reply({version,cover:cover()});
   }
   if(p==='/v1/cities')return reply({items:[{id:cityA,nameRu:'Москва'},{id:cityB,nameRu:'Казань'}]});
   if(p==='/v1/me/trainer-profile')return reply({},404);
   if(p==='/v1/me/participations'||p==='/v1/me/games')return reply({items:[],nextCursor:null});
   if(p==='/v1/me/inbox/counts')return reply({pendingRequestCount:0,pendingInvitationCount:0,dmUnread:0,gameChatUnread:0});
   return reply({},404);
  });
  const page=await context.newPage();
  await page.goto(origin+'/profile');await page.getByRole('button',{name:'Изменить обложку',exact:true}).waitFor();
  // Build a real local source with a different size from the transmitted derivative.
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d');for(let y=0;y<600;y+=20)for(let x=0;x<900;x+=20){ctx.fillStyle=`rgb(${x%255},${y%255},${(x+y)%255})`;ctx.fillRect(x,y,20,20);}return canvas.toDataURL('image/png').split(',')[1];});
  const choose=async()=>{
   await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();
   await page.getByLabel('Выбрать изображение обложки',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
   await page.getByAltText('Выбранный фрагмент в шапке профиля').waitFor();
  };
  await choose();assert.equal(writes,0,'selection and preview do not upload');
  // Compare actual object-fit source rectangles and rasterized visible pixels,
  // not CSS declarations. Save/reload must show the same asymmetric landmarks.
  const cropPixels=async selector=>page.locator(selector).evaluate(async element=>{
   const img=element.querySelector('img');await img.decode();
   const {width:w,height:h}=element.getBoundingClientRect();
   const css=getComputedStyle(img);
   if(css.objectFit!=='cover'||css.objectPosition!=='50% 50%')throw new Error('Unexpected cover fit');
   const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight);
   const sw=w/scale,sh=h/scale,sx=(img.naturalWidth-sw)/2,sy=(img.naturalHeight-sh)/2;
   const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,96,96);
   return {ratio:w/h,rect:[sx,sy,sw,sh],pixels:Array.from(ctx.getImageData(0,0,96,96).data)};
  });
  const draftPixels=async()=>page.getByAltText('Выбранный фрагмент в шапке профиля').evaluate(async img=>{
   await img.decode();const canvas=document.createElement('canvas');canvas.width=96;canvas.height=32;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,96,32);
   return Array.from(ctx.getImageData(0,0,96,32).data);
  });
  // Resize while the confirmation dialog stays open: observer must follow layout.
  await page.setViewportSize({width:width===1440?1000:width+20,height:900});
  await page.waitForFunction(()=>{
   const a=document.querySelector('.own-profile-avatar').getBoundingClientRect();
   const b=document.querySelector('.profile-cover--preview').getBoundingClientRect();
   return Math.abs(a.width/a.height-b.width/b.height)<0.002;
  });
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(()=>{
   const a=document.querySelector('.own-profile-avatar').getBoundingClientRect();
   const b=document.querySelector('.profile-cover--preview').getBoundingClientRect();
   return Math.abs(a.width/a.height-b.width/b.height)<0.002;
  });
  const previewCrop=await cropPixels('.profile-cover--preview');
  const headerBox=await page.locator('.own-profile-avatar').boundingBox();
  assert.ok(Math.abs(previewCrop.ratio-headerBox.width/headerBox.height)<0.002,`${width}: preview follows real panel`);

  await page.getByLabel('По вертикали',{exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.getByAltText('Выбранный фрагмент в шапке профиля').waitFor();
  await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.profile-cover-controls').getAttribute('aria-busy') || document.querySelector('.profile-cover-controls').getAttribute('aria-busy')==='false');
  const finalPreview=await cropPixels('.profile-cover--preview');
  await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();await page.getByText('Обложка сохранена.',{exact:true}).waitFor();
  const confirmedCrop=await cropPixels('.own-profile-avatar > .profile-cover');
  // The keyboard move above changes preprocessing: capture the final preview before save below.
  assert.ok(Math.abs(confirmedCrop.ratio-previewCrop.ratio)<0.002);
  assert.deepEqual(confirmedCrop.rect.map(Math.round),finalPreview.rect.map(Math.round),`${width}: identical visible source bounds`);
  assert.equal(confirmedCrop.pixels.length,finalPreview.pixels.length);
  const meanError=confirmedCrop.pixels.reduce((sum,value,i)=>sum+Math.abs(value-finalPreview.pixels[i]),0)/confirmedCrop.pixels.length;
  assert.ok(meanError<1,`${width}: visible landmark pixels differ by ${meanError}`);
  assert.equal(writes,1);const first=uploadedUrl;
  await choose();await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();await page.getByText('Обложка сохранена.',{exact:true}).waitFor();assert.notEqual(uploadedUrl,first);
  broken=true;await page.reload();await page.locator('.own-profile-avatar > .profile-cover[data-cover="default"]').waitFor();broken=false;
  await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();await page.getByRole('button',{name:'Удалить обложку',exact:true}).click();await page.getByText('Обложка удалена. Используется стандартное оформление.',{exact:true}).waitFor();assert.equal(uploadedUrl,null);
  // Tab B changes NON-cover fields while tab A retains its crop and old snapshot.
  // Cover-only receipts cannot authorize a later profile edit with stale fields.
  for(const failure of ['offline','committed','conflict-retry','conflict-cancel']){
   await choose();
   await page.getByLabel('По горизонтали',{exact:true}).press('Home');
   await page.getByLabel('По горизонтали',{exact:true}).press('ArrowRight');
   await page.getByLabel('По вертикали',{exact:true}).press('End');
   await page.getByLabel('По вертикали',{exact:true}).press('ArrowLeft');
   const save=page.getByRole('button',{name:'Сохранить фрагмент',exact:true});
   await page.waitForFunction(()=>document.querySelector('.profile-cover-controls').getAttribute('aria-busy')==='false');
   const draft=await page.getByAltText('Выбранный фрагмент в шапке профиля').getAttribute('src');
   const draftBitmap=await draftPixels();
   const pixels=await cropPixels('.profile-cover--preview');
   const readsBefore=profileReads, coverReadsBefore=coverReads, versionBefore=version;
   const otherTabEdit=()=>{
    fields={displayName:'Owner '+failure,bio:'Bio '+failure,cityId:fields.cityId===cityA?cityB:cityA,areaKey:'Area '+failure,directoryVisible:!fields.directoryVisible,contactPolicy:fields.contactPolicy==='closed'?'requests':'closed'};
    version++;
   };
   if(failure.startsWith('conflict'))otherTabEdit();
   failNext=failure;await save.click();
   const refresh=page.getByRole('button',{name:'Обновить данные',exact:true});
   await refresh.waitFor();
   assert.equal(version,versionBefore+(failure==='committed'||failure.startsWith('conflict')?1:0));
   if(!failure.startsWith('conflict'))otherTabEdit();
   if(failure==='offline'){
    readFailure=503;await refresh.click();
    await page.waitForFunction(()=>document.querySelector('.profile-cover-controls').getAttribute('aria-busy')==='false');
    await page.getByText('Не удалось проверить результат. Повторите обновление данных.',{exact:true}).waitFor();
    assert.equal(await save.count(),0,'failed reconciliation cannot unlock mutation');
    readVersion=versionBefore-1;await refresh.click();
    await page.waitForFunction(()=>document.querySelector('.profile-cover-controls').getAttribute('aria-busy')==='false');
    await page.getByText('Не удалось проверить результат. Повторите обновление данных.',{exact:true}).waitFor();
    assert.equal(await save.count(),0,'older profile snapshots cannot unlock mutation');
    assert.notEqual(await page.locator('.own-profile-intro h1').textContent(),fields.displayName,'stale read cannot hydrate newer fields or clear uncertainty');
   }
   let releaseRead;
   readGate=new Promise(resolve=>{releaseRead=resolve;});
   const readStarted=page.waitForRequest(request=>new URL(request.url()).pathname==='/v1/me/social-profile'&&request.method()==='GET');
   await refresh.click();await readStarted;
   assert.equal(await refresh.isDisabled(),true,'reconciliation locks repeated reads');
   assert.equal(await page.getByLabel('По горизонтали',{exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Изменить профиль',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Отмена',exact:true}).isDisabled(),true);
   releaseRead();readGate=null;
   await save.waitFor();
   assert.equal(await save.isEnabled(),true);
   assert.equal(profileReads,readsBefore+(failure==='offline'?3:1),'complete authoritative profile GET was performed');
   assert.equal(coverReads,coverReadsBefore,'cover-only reads cannot reconcile the shared profile');
   assert.equal(await page.getByAltText('Выбранный фрагмент в шапке профиля').getAttribute('src'),draft);
   assert.equal(await page.getByLabel('По горизонтали',{exact:true}).inputValue(),'0.01');
   assert.equal(await page.getByLabel('По вертикали',{exact:true}).inputValue(),'0.99');
   assert.deepEqual(await draftPixels(),draftBitmap,'all draft image pixels survive reconciliation');
   const refreshedPixels=await cropPixels('.profile-cover--preview');
   // A complete profile refresh may change the content-driven panel height;
   // the retained image must follow that framing, without regenerating the blob.
   if(Math.abs(refreshedPixels.ratio-pixels.ratio)<0.002)assert.deepEqual(refreshedPixels,pixels,'draft pixels survive reconciliation');
   await page.waitForFunction(()=>{
    const a=document.querySelector('.own-profile-avatar').getBoundingClientRect();
    const b=document.querySelector('.profile-cover--preview').getBoundingClientRect();
    return Math.abs(a.width/a.height-b.width/b.height)<0.002;
   });
   await page.waitForFunction(name=>document.querySelector('.own-profile-intro h1')?.textContent===name,fields.displayName);
   assert.equal(await page.getByRole('switch',{name:'Показывать профиль в каталоге',exact:true}).getAttribute('aria-checked'),String(fields.directoryVisible));
   assert.equal(await page.getByRole('switch',{name:'Принимать запросы на общение',exact:true}).getAttribute('aria-checked'),String(fields.contactPolicy==='requests'));
   const reconciledVersion=version;
   if(failure==='conflict-cancel'){
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
    assert.equal(version,reconciledVersion,'cancel leaves the server unchanged');
   } else {
    await save.click();await page.getByText('Обложка сохранена.',{exact:true}).waitFor();
    assert.equal(version,reconciledVersion+1,'retry uses fresh CAS version (asserted by the route)');
   }
   await page.getByRole('button',{name:'Изменить профиль',exact:true}).click();
   const form=page.getByRole('dialog',{name:'Игровой профиль',exact:true});
   assert.equal(await form.getByLabel('Имя',{exact:true}).inputValue(),fields.displayName);
   assert.equal(await form.getByRole('textbox',{name:'О себе',exact:true}).inputValue(),fields.bio);
   assert.equal(await form.getByLabel('Город',{exact:true}).inputValue(),fields.cityId);
   assert.equal(await form.getByLabel('Район / метро',{exact:true}).inputValue(),fields.areaKey);
   await form.getByRole('textbox',{name:'О себе',exact:true}).fill(fields.bio+' + local');
   const profileWritesBefore=profileWrites;
   await form.getByRole('button',{name:'Сохранить',exact:true}).click();
   await page.getByText('Профиль сохранён.',{exact:true}).waitFor();
   assert.equal(profileWrites,profileWritesBefore+1,'subsequent edit preserves non-cover fields (asserted by route)');
  }
  await page.getByRole('button',{name:'Изменить обложку',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Обложка профиля'}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no overflow`);
  await choose();failNext='offline';await page.getByRole('button',{name:'Сохранить фрагмент',exact:true}).click();
  readFailure=401;await page.getByRole('button',{name:'Обновить данные',exact:true}).click();
  await page.getByRole('heading',{name:'Ваша игра начинается здесь',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Обложка профиля'}).count(),0,'unauthorized read returns to auth and discards private draft');
  await context.close();
 }
 console.log('Synthetic cover UI regression completed (mock API; not live authenticated acceptance)');
} finally {await browser.close();}
