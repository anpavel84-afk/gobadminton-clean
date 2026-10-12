/* global process, window, document, navigator, innerWidth, console, Node, setTimeout, getComputedStyle, URL, Event, localStorage */
// Author checks only, against production Next with wholly synthetic browser APIs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const { response: legacy, state: legacyState, dm } = await import(pathToFileURL(process.cwd()+'/docs/workbench/product-rebaseline/p1-repair01/legacy-fixture.mjs'));
const origin=process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
const out='docs/workbench/product-rebaseline/p1-repair01/browser';await mkdir(out,{recursive:true});
const M='a0000000-0000-4000-8000-000000000001',P='a0000000-0000-4000-8000-000000000002',G='00000021-1111-4111-8111-111111111111';
const stamp=n=>new Date(Date.now()+n*1000).toISOString();
const cities=[{id:M,nameRu:'Москва',defaultTimezone:'Europe/Moscow'},{id:P,nameRu:'Санкт-Петербург',defaultTimezone:'Europe/Moscow'}];
const venues=id=>[{id:'venue-first',name:'Альфа зал',address:'Тестовая улица, 1',cityId:id,timezone:'Europe/Moscow'},{id:'venue-tail',name:'Янтарный зал',address:'Тестовая улица, 2',cityId:id,timezone:'Europe/Moscow'}];
const game=(id=M)=>({id:G,version:2,title:id===M?'Московская игра':'Петербургская игра',status:'published',visibility:'public',activityKind:'regular',trainer:null,trainingDescription:null,organizer:{id:null,displayName:'Анна Тестовая',publicContact:'telegram:@fixture'},venue:venues(id)[0],startsAt:stamp(86400),endsAt:stamp(93600),applicationDeadlineAt:stamp(80000),timezone:'Europe/Moscow',capacity:8,externalReservedCount:2,confirmedCount:1,availablePlaces:5,formatKey:'doubles',levelRule:{scaleId:'ntrp',scaleVersion:1,allowedLevelIds:['3.0']},settlement:{mode:'external',purpose:'no_trainer_fee',priceMinor:null,currency:null,terms:'Аренду делим. Длинные условия для проверки переноса строк.'}});
const radar=(mode='active')=>mode==='off'?{state:'off',ownerHere:false,policyVersion:'fixture',exposureMode:'live'}:mode==='other'?{state:'owned_elsewhere',ownerHere:false,activationId:'fixture',version:1,expiresAt:stamp(300),policyVersion:'fixture',exposureMode:'live'}:{state:'active',activationId:'fixture',version:1,ownerHere:true,policyVersion:'fixture',regionId:'moscow',radiusBucketKm:5,startedAt:stamp(-10),expiresAt:stamp(3600),hardExpiresAt:stamp(3600),foregroundUntil:stamp(1800),locationValidUntil:stamp(1800),nextLocationUpdateAt:stamp(mode==='due'?-1:900),nextRadiusChangeAt:stamp(600),exposureMode:'live'};
const report={kind:'AUTHOR_CHECKS_NOT_INDEPENDENT_QA',checks:[],requests:[],geometry:[],pageErrors:[],consoleErrors:[],expectedHttpDiagnostics:[],externalRequests:[],failures:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
async function setup(width,opts={}){
 const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU',reducedMotion:'reduce'});
 await context.addInitScript(blocked=>{
  window.__gps=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:()=>{window.__gps++;throw Error('Unexpected GPS');}}});
  if(blocked)Object.defineProperty(window,'localStorage',{get:()=>{throw Error('storage blocked');}});
 },!!opts.blocked);
 const s={...legacyState(),actor:'A',guest:!!opts.guest,prefCity:null,prefVersion:0,contact:'telegram:@saved',contactVersion:2,radar:'active',managed:game(),createStatus:200,rosterStatus:200,actionStatus:200,trainer:false,...opts};
 const calls=[],held=[],heldWrites=[];let holdGames=!!opts.holdGames;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method(),body=req.postData()?req.postDataJSON():null;
  if(url.origin!==origin){report.externalRequests.push(req.url());return route.abort();}
  if(!p.startsWith('/v1/'))return route.continue();
  const call={width,path:p,query:url.search,method,body,csrf:req.headers()['x-csrf-token']??null,key:req.headers()['idempotency-key']??null};calls.push(call);report.requests.push(call);
  let status=200,data;
  if(p==='/v1/discovery/city-hint')data={cityId:opts.hint || M,source:'ip'};
  else if(p==='/v1/me') {status=s.guest?401:200;data=s.guest?{code:'UNAUTHORIZED'}:{id:'actor-'+s.actor,displayName:'Анна '+s.actor,csrfToken:'csrf-'+s.actor,locale:'ru',linkedProviders:[]};}
  else if(p==='/v1/cities')data={items:cities};
  else if(p==='/v1/me/discovery-preference') {
   if(s.preference404){status=404;data={};}
   else {if(method==='PUT'){assert.equal(body.expectedVersion,s.prefVersion);s.prefCity=body.cityId;s.prefVersion++;}data={cityId:s.prefCity,version:s.prefVersion};}
  }
  else if(p==='/v1/me/game-preferences'){if(method==='PATCH'){assert.equal(body.expectedVersion,s.contactVersion);s.contact=body.defaultPublicGameContact;s.contactVersion++;}data={defaultPublicGameContact:s.contact,version:s.contactVersion};}
  else if(p==='/v1/me/trainer-profile'){status=s.trainer?200:404;data=s.trainer?{id:'trainer-A',version:1,displayName:'Анна A',status:'active',declarationSource:'self_declared'}:{};}
  else if(p==='/v1/me/social-profile')data={publicPlayerId:'own-'+s.actor,displayName:'Анна '+s.actor,cityId:M,version:1,bio:null,areaKey:null,level:null,socialEligible:true,directoryVisible:true,contactPolicy:'open',trainer:s.trainer,lookingForGame:null,avatar:{uploadedUrl:null,providerUrl:null}};
  else if(p==='/v1/me/radar/activations/current')data=radar(s.radar);
  else if(p==='/v1/venues')data=url.searchParams.has('cursor')?{items:[venues(url.searchParams.get('cityId'))[1]],nextCursor:null}:{items:[venues(url.searchParams.get('cityId'))[0]],nextCursor:'page2'};
  else if(p==='/v1/games'&&method==='POST'){
   status=s.createStatus;
   if(status===200){s.managed={...game(),...body,id:G,version:1,status:'draft',venue:venues(M).find(v=>v.id===body.venueId),confirmedCount:body.activityKind==='regular'?1:0,availablePlaces:body.capacity-(body.activityKind==='regular'?1:0)};if(body.savePublicContactDefault){assert.equal(body.savePublicContactDefault.expectedVersion,s.contactVersion);s.contact=body.hostPublicContact;s.contactVersion++;}data=s.managed;}
   else data={code:'VERSION_CONFLICT',title:'Synthetic failure'};
  }
  else if(p===`/v1/games/${G}/publish`){s.managed={...s.managed,status:'published',version:2};data=s.managed;}
  else if(p==='/v1/games'){data={items:[game(url.searchParams.get('cityId') || M)],nextCursor:null};if(holdGames&&url.searchParams.get('cityId')===M)await new Promise(r=>held.push(r));}
  else if(p===`/v1/games/${G}`)data=s.managed;
  else if(p==='/v1/me/games')data={items:[{...s.managed,management:{createdByMe:!s.noncreator,relation:s.noncreator?'manager':'owner',role:s.noncreator?'manager':'owner'}}],nextCursor:null};
  else if(p===`/v1/games/${G}/participations`){status=s.rosterStatus;data=status===200?{items:[{id:'creator-seat',gameId:G,userId:'actor-A',status:'confirmed',version:1,attemptNumber:1,requestedAt:stamp(-3600),confirmedAt:stamp(-3500),isCreatorOrganizer:true},{id:'pending-seat',gameId:G,userId:'actor-C',status:'pending',version:1,attemptNumber:1,requestedAt:stamp(-600)}],nextCursor:null}:{};}
  else if(p==='/v1/me/participations')data={items:s.managed.activityKind==='regular'?[{id:'creator-seat',gameId:G,userId:'actor-A',status:'confirmed',isCreatorOrganizer:true,version:1,attemptNumber:1,requestedAt:stamp(-3600),confirmedAt:stamp(-3500)}]:[],nextCursor:null};
  else if(p.startsWith('/v1/participations/')){status=s.actionStatus;data={code:'VERSION_CONFLICT'};if(s.actionDelay)await new Promise(r=>setTimeout(r,s.actionDelay));}
  else {const r=legacy(s,p,method,body);status=r.status;data=r.data;}
  if(s.holdPreferenceWrite && p === "/v1/me/discovery-preference" && method === "PUT") await new Promise(resolve=>heldWrites.push(resolve));
  if(status>=400)report.expectedHttpDiagnostics.push({width,path:p,status});
  return route.fulfill({status,json:data}).catch(()=>{});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.pageErrors.push({width,error:String(e)}));
 page.on('console',msg=>{if(msg.type()==='error'){const error=msg.text();if(error.startsWith('Failed to load resource:'))return;report.consoleErrors.push({width,error});}});
 const go=async path=>{await page.goto(origin+path);await page.evaluate(()=>document.fonts.ready);};
 const shot=async name=>{await page.screenshot({path:`${out}/${width}-${name}.png`,fullPage:true});const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length}));report.geometry.push({name,...geometry});assert.ok(geometry.scrollWidth<=width,`${name}: no overflow ${geometry.scrollWidth}/${width}`);};
 return {context,page,s,calls,held,heldWrites,go,shot,releaseWrites:()=>{s.holdPreferenceWrite=false;heldWrites.splice(0).forEach(r=>r());},release:()=>{holdGames=false;held.splice(0).forEach(r=>r());}};
}
try {
 for(const width of [320,390,430,768,1024,1440]){
  const h=await setup(width);const {page,go,shot,calls,context}=h;
  try {
   await go('/games');await page.getByRole('heading',{name:'Московская игра',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/games');await shot('games');check(`${width} Games first, no mandatory location or GPS`);
   const indicator=page.locator(width<=720?'.gb-bottom-nav .gb-radar-indicator':'.gb-topbar .gb-radar-indicator');await indicator.waitFor();assert.equal(await indicator.getAttribute('data-tone'),'active');assert.equal(await page.locator('.gb-radar-indicator:visible').count(),1);await indicator.locator('a').focus();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').innerText(),/Радар включён/);const rect=await page.getByRole('tooltip').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);check(`${width} Radar confirmed, keyboard tooltip bounded and dismissed`);
   await go('/location');await page.getByRole('button',{name:'Санкт-Петербург',exact:false}).waitFor();await shot('location');const align=await page.evaluate(()=>({content:document.querySelector('.gb-shell-content').getBoundingClientRect().x+parseFloat(getComputedStyle(document.querySelector('.gb-shell-content')).paddingLeft),h1:document.querySelector('h1').getBoundingClientRect().x,picker:document.querySelector('.location-picker').getBoundingClientRect().width}));assert.ok(Math.abs(align.content-align.h1)<1);assert.ok(align.picker<=760);check(`${width} city container left aligned with narrow picker`);
   await page.getByRole('button',{name:'Санкт-Петербург',exact:false}).click();await page.getByRole('heading',{name:'Петербургская игра',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Петербургская игра',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Московская игра',exact:true}).count(),0);check(`${width} manual city acknowledged and retained after reload`);
   // Switch back deliberately; create venue catalog stays scoped to the selected city.
   await go('/location?returnTo=/games/create');await page.getByRole('button',{name:'Москва',exact:false}).click();await page.locator('#contact').waitFor();assert.equal(await page.locator('#contact').inputValue(),'telegram:@saved');await shot('create-form');
   await page.locator('#contact').fill('telegram:@new');await page.getByRole('checkbox',{name:'Сохранить контакт для следующих игр'}).check();await page.locator('#venueId').click();await page.getByRole('searchbox',{name:'Поиск площадки'}).fill('Янтарный');await page.getByRole('button',{name:/Янтарный зал/}).click();await page.getByRole('button',{name:'Завтра',exact:true}).click();await page.locator('#startTime').fill('18:00');await page.locator('#capacity').fill('1');await page.getByRole('button',{name:'Проверить игру',exact:true}).click();await page.getByRole('button',{name:'Опубликовать игру',exact:true}).waitFor();await shot('create-preview');
   const publish=page.getByRole('button',{name:'Опубликовать игру',exact:true});await publish.evaluate(el=>{el.click();el.click();});await page.getByRole('heading',{name:'Игра опубликована',exact:true}).waitFor();await page.getByText('Ваше участие подтверждено.',{exact:true}).waitFor();await shot('create-published');const creates=calls.filter(c=>c.path==='/v1/games'&&c.method==='POST');assert.equal(creates.length,1);assert.equal(calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.deepEqual(creates[0].body.savePublicContactDefault,{expectedVersion:2});assert.equal(creates[0].body.venueId,'venue-tail');assert.ok(creates[0].key&&creates[0].csrf==='csrf-A');await page.getByText('Подтверждено: 1 · Свободно: 0 · Вместимость: 1',{exact:true}).waitFor();check(`${width} saved contact, full venue search, one create/publish, actual capacity=1`);
   await go('/my-games/'+G);await page.locator('.gb-management-summary').waitFor();await page.getByText('Создатель игры · участник',{exact:true}).waitFor();await shot('managed-game');assert.equal(await page.locator('h1').count(),1);const refreshBox=await page.locator('.gb-applicants__heading > button').boundingBox();assert.ok(refreshBox.width>=90);const order=await page.evaluate(()=>{const t=document.querySelector('.gb-game-conditions'),a=document.querySelector('.gb-management-summary'),r=document.querySelector('.gb-applicants');return !!(t.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(a.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING);});assert.ok(order);check(`${width} managed terms → grouped panel → roster, actual creator row`);
   await go('/messages?conversation='+dm);await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();await shot('legacy-thread');await page.locator('.conversation-header .conversation-profile').click();await page.getByRole('link',{name:'← К переписке',exact:true}).waitFor();await page.getByRole('link',{name:'← К переписке',exact:true}).click();await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();check(`${width} legacy accepted thread404 and profile-to-thread return`);
   await go('/profile/settings');await page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true}).inputValue(),'telegram:@new');await shot('contact-settings');await page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true}).fill('telegram:@profile');await page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();await page.getByText('Контакт сохранён для следующих игр.',{exact:true}).waitFor();await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).click();await page.getByText('Сохранённый контакт удалён. Контакты в существующих играх не изменились.',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.path==='/v1/me/game-preferences'&&c.method==='PATCH').length,2);check(`${width} own contact edit/clear without public profile mutation`);
   assert.equal(await page.evaluate(()=>window.__gps),0);
  } finally {h.release();await context.close();}
 }
 // A late old-city feed may finish after a manual choice, but cannot repaint it.
 const race=await setup(390,{guest:true,radar:'off',holdGames:true});
 try {await race.go('/games');for(let i=0;i<100&&!race.held.length;i++)await race.page.waitForTimeout(20);assert.ok(race.held.length);await race.page.getByRole('button',{name:/Сменить город/}).click();await race.page.getByRole('button',{name:'Санкт-Петербург',exact:false}).click();await race.page.getByRole('heading',{name:'Петербургская игра',exact:true}).waitFor();race.release();await race.page.waitForTimeout(150);assert.equal(await race.page.getByRole('heading',{name:'Московская игра',exact:true}).count(),0);await race.shot('city-race');check('late old city response cannot mix feed');}finally{race.release();await race.context.close();}
 const blocked=await setup(390,{guest:true,blocked:true,radar:'off'});
 try {await blocked.go('/location');await blocked.page.getByRole('button',{name:'Санкт-Петербург',exact:false}).click();await blocked.page.getByRole('heading',{name:'Петербургская игра',exact:true}).waitFor();await blocked.page.getByText('Не удалось сохранить город на этом устройстве.',{exact:true}).waitFor();check('storage denied applies manual city in memory and gives honest notice');}finally{await blocked.context.close();}
 const accountRace=await setup(390,{holdPreferenceWrite:true});
 try {
  await accountRace.go('/location');await accountRace.page.getByRole('button',{name:'Санкт-Петербург',exact:false}).click();await accountRace.page.getByRole('heading',{name:'Петербургская игра',exact:true}).waitFor();
  for(let n=0;n<100&&!accountRace.heldWrites.length;n++)await accountRace.page.waitForTimeout(20);assert.ok(accountRace.heldWrites.length);
  accountRace.s.actor='B';accountRace.s.prefCity=M;accountRace.s.prefVersion=5;await accountRace.page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));await accountRace.page.getByRole('heading',{name:'Московская игра',exact:true}).waitFor();accountRace.releaseWrites();await accountRace.page.waitForTimeout(100);assert.equal(await accountRace.page.getByRole('heading',{name:'Петербургская игра',exact:true}).count(),0);
  accountRace.s.guest=true;await accountRace.page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));await accountRace.page.getByRole('heading',{name:'Московская игра',exact:true}).waitFor();const stored=await accountRace.page.evaluate(()=>JSON.parse(localStorage.getItem('gb.consumer.discoveryCity.v2')||'{}'));assert.deepEqual(stored.accounts,{});check('late account-A PUT cannot repaint account B or guest; logout clears account caches');
 } finally {accountRace.releaseWrites();await accountRace.context.close();}
 const trainer=await setup(390,{trainer:true});
 try {await trainer.go('/games/create');await trainer.page.locator('#contact').waitFor();await trainer.page.getByRole('button',{name:'С тренером',exact:true}).click();await trainer.page.locator('#venueId').click();await trainer.page.getByRole('button',{name:/Альфа зал/}).click();await trainer.page.getByRole('button',{name:'Завтра',exact:true}).click();await trainer.page.locator('#startTime').fill('18:00');await trainer.page.locator('#capacity').fill('1');await trainer.page.getByRole('button',{name:'Проверить игру',exact:true}).click();await trainer.page.getByRole('button',{name:'Опубликовать игру',exact:true}).click();await trainer.page.getByText('Тренер не занимает место игрока.',{exact:true}).waitFor();await trainer.page.getByText('Подтверждено: 0 · Свободно: 1 · Вместимость: 1',{exact:true}).waitFor();await trainer.shot('trainer-created');check('trainer-led uses server counts and no automatic player seat');}finally{await trainer.context.close();}
 const manager=await setup(390,{actor:'B',noncreator:true});try{await manager.go('/my-games/'+G);await manager.page.getByText('Управляю',{exact:true}).waitFor();await manager.page.getByRole('button',{name:'Подтвердить',exact:true}).waitFor();await manager.shot('noncreator-manager');check('non-creator manager retains authoritative management access');}finally{await manager.context.close();}
 // Error statuses remain visible; duplicate manager actions never send two commands.
 for(const status of [401,403,409]){
  const h=await setup(390,{actionStatus:status,actionDelay:150});
  try {await h.go('/my-games/'+G);const b=h.page.getByRole('button',{name:'Подтвердить',exact:true});await b.waitFor();await b.evaluate(el=>{el.click();el.click();});await h.page.waitForTimeout(500);assert.equal(h.calls.filter(c=>c.path.includes('/participations/')&&c.method==='POST').length,1);check(`manager ${status} preserved with one mutation and authoritative reread`);}finally{await h.context.close();}
 }
 for(const mode of ['off','other','due']){
  const h=await setup(320,{radar:mode});try{await h.go('/games');await h.page.locator('.gb-discovery-hero').waitFor();await h.page.waitForTimeout(200);const icon=h.page.locator('.gb-bottom-nav .gb-radar-indicator');if(mode==='off')assert.equal(await icon.count(),0);else{assert.equal(await icon.getAttribute('data-tone'),'attention');await icon.locator('a').focus();assert.match(await h.page.getByRole('tooltip').innerText(),mode==='other'?/другом устройстве/:/обновите геопозицию/);}await h.shot('radar-'+mode);assert.equal(await h.page.evaluate(()=>window.__gps),0);check('Radar '+mode+' stays distinct without permission request');}finally{await h.context.close();}
 }
 assert.equal(report.pageErrors.length,0);assert.equal(report.consoleErrors.length,0);assert.equal(report.externalRequests.length,0);check('no JS/page/console errors or external API/GPS access');
} catch(error){report.failures.push(String(error));console.error(error);process.exitCode=1;}
finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
