/* global process, Buffer, window, document, URL, setTimeout, Event, localStorage, sessionStorage, getComputedStyle, innerWidth, console */
// Author regression of the actual production React DOM. Synthetic loopback only.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {chromium} = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin=process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
const out='docs/workbench/product-rebaseline/p1-repair01/header006';
await mkdir(out,{recursive:true});
const report={environment:'Production Next.js, Chromium, synthetic localhost fixtures only; author checks, not independent QA',checks:[],geometry:[],requests:[],errors:[]};
const upload=n=>`/v1/media/avatars/${n.repeat(64)}.png`;
const provider='https://avatars.yandex.net/fixture/photo';
let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=','base64');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',reducedMotion:'reduce'});
await context.addInitScript(()=>{
 const listeners=new Map(); window.fixtureListeners=listeners;
 for(const target of [window,document]) {
  const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
  target.addEventListener=(type,fn,...args)=>{if(['gb-profile-changed','focus','visibilitychange'].includes(type)){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);}return add(type,fn,...args);};
  target.removeEventListener=(type,fn,...args)=>{listeners.get(type)?.delete(fn);return remove(type,fn,...args);};
 }
});
let actor='A',name='Анна Альфа',avatar={uploadedUrl:upload('a'),providerUrl:provider},version=1;
let meStatus=200,socialStatus=200,imageFailure=new Set(),held=[],holdSocial=false,unknownWrite=0;
let socialReads=0;
const social=()=>({publicPlayerId:'fixture-'+actor,version,displayName:name,cityId:null,areaKey:null,bio:null,level:null,directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,socialEligible:true,trainer:false,lookingForGame:null,avatar:{...avatar}});
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),p=url.pathname;
 if(url.origin!==origin) {
  report.requests.push({path:request.url(),kind:'image',referer:request.headers().referer??null});
  if(request.resourceType()!=='image') {report.errors.push('Unexpected external request '+url.origin);return route.abort();}
  return imageFailure.has(request.url())?route.abort():route.fulfill({contentType:'image/png',body:png});
 }
 if(p.startsWith('/v1/media/avatars/')){report.requests.push({path:p,kind:'image'});return imageFailure.has(p)?route.abort():route.fulfill({contentType:'image/png',body:png});}
 if(!p.startsWith('/v1/'))return route.continue();
 const method=request.method(); report.requests.push({path:p,method,kind:'api'});
 const reply=(json,status=200)=>route.fulfill({status,json});
 if(p==='/v1/discovery/city-hint')return reply({cityId:'a0000000-0000-4000-8000-000000000001',source:'default'});
 if(p==='/v1/me/discovery-preference')return reply({},404);
 if(p==='/v1/me/game-preferences')return reply({defaultPublicGameContact:null,version:0});
 if(p==='/v1/me')return reply({id:actor,displayName:name,csrfToken:'fixture-'+actor,locale:'ru',linkedProviders:[]},meStatus);
 if(p==='/v1/me/social-profile') {
  if(method==='PATCH'){name=request.postDataJSON().displayName;version++;return reply(social());}
  socialReads++;const body=social(),status=socialStatus;
  if(holdSocial) return new Promise(resolve=>held.push(async()=>{await reply(body,status);resolve();}));
  return reply(body,status);
 }
 if(p==='/v1/me/avatar') {
  version++;avatar={uploadedUrl:method==='DELETE'?null:upload('b'),providerUrl:provider};
  return unknownWrite?reply({code:'TIMEOUT'},unknownWrite):reply({version,avatar});
 }
 if(p==='/v1/auth/logout'){actor='guest';meStatus=401;return reply(null);}
 if(p==='/v1/me/inbox/counts')return reply({pendingRequestCount:2,pendingInvitationCount:1,dmUnread:4,gameChatUnread:0});
 if(p==='/v1/me/trainer-profile')return reply({},404);
 if(p==='/v1/auth/providers')return reply({providers:['vk','yandex']});
 if(p==='/v1/cities')return reply({items:[]});
 if(p==='/v1/me/participations'||p==='/v1/me/games'||p==='/v1/players'||p==='/v1/games')return reply({items:[],nextCursor:null});
 if(p.includes('/radar/'))return reply({items:[],nextCursor:null},404);
 report.errors.push(`Unhandled fixture ${method} ${p}`);return reply({},404);
});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
const header=page.locator('.gb-header-profile');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(name,value=true)=>{assert.ok(value,name);report.checks.push(name);console.log('CHECK '+name);};
const event=type=>page.evaluate(type=>window.dispatchEvent(new Event(type)),type);
async function named(value){await assertEventually(async()=>assert.equal(await header.getAttribute('aria-label'),'Профиль: '+value));}
async function assertEventually(fn){let last;for(let n=0;n<100;n++){try{await fn();return;}catch(e){last=e;await wait(30);}}throw last;}
async function image(src){await assertEventually(async()=>assert.equal(await header.locator('img').getAttribute('src'),src));}
async function neutral(){await assertEventually(async()=>{assert.equal(await header.getAttribute('aria-label'),'Профиль');assert.equal(await header.locator('img').count(),0);assert.equal(await header.locator('.gb-header-avatar').textContent(),'?');});}
async function settled(){await wait(300);}
async function refresh(){const before=socialReads;await event('gb-profile-changed');await assertEventually(()=>assert.ok(socialReads>before));await settled();}
async function release(){const all=held.splice(0);for(const fn of all)await fn();}
async function go(path){await page.goto(origin+path);await header.waitFor();await page.evaluate(()=>document.fonts.ready);}
try {
 await go('/help');
 png=Buffer.from(await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext('2d');g.fillStyle='#803fff';g.fillRect(0,0,64,64);g.fillStyle='#ccff00';g.beginPath();g.arc(32,32,19,0,2*Math.PI);g.fill();return Array.from(new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer()));}));
 await named(name);await image(upload('a'));check('M17 uploaded wins');
 avatar.uploadedUrl=null;await refresh();await image(provider);check('M17 removal uses provider');
 avatar.uploadedUrl=upload('c');imageFailure=new Set([upload('c'),provider]);await refresh();
 await assertEventually(async()=>{assert.equal(await header.locator('img').count(),0);assert.equal(await header.locator('.gb-header-avatar').textContent(),'АА');});
 const failures=report.requests.filter(r=>r.kind==='image'&&[upload('c'),provider].includes(r.path)).length;await settled();
 check('M17 failures are bounded through provider then initials',report.requests.filter(r=>r.kind==='image'&&[upload('c'),provider].includes(r.path)).length===failures);
 imageFailure.clear();avatar.uploadedUrl=upload('d');await refresh();await image(upload('d'));check('M17 changed URL resets failure');
 imageFailure=new Set([upload('d')]);await refresh();await image(provider);check('M17 upload failure uses provider once');imageFailure.clear();
 avatar={uploadedUrl:null,providerUrl:'https://sun9.userapi.com/fixture/photo'};await refresh();await image(avatar.providerUrl);check('M22 VK allowed');
 for(const denied of ['https://avatars.yandex.net.evil.test/photo','https://x:secret@avatars.yandex.net/photo','https://avatars.yandex.net:8443/photo','https://evil.test/photo']){
  avatar.providerUrl=denied;await refresh();await assertEventually(async()=>assert.equal(await header.locator('img').count(),0));check('M22 denied '+denied,!report.requests.some(r=>r.path===denied));
 }
 check('M22 images omit Referer',report.requests.filter(r=>r.kind==='image'&&r.path.startsWith('https:')).every(r=>r.referer===null));
 avatar={uploadedUrl:upload('a'),providerUrl:provider};await refresh();await image(upload('a'));
 socialStatus=503;await refresh();await image(upload('a'));check('same established session retains confirmed photo on transient social GET failure');
 socialStatus=200;
 // Events in one foreground burst share a read. No competing identity polling.
 await header.focus();await refresh();check('M21 profile keeps keyboard focus through authority refresh',await header.evaluate(e=>document.activeElement===e));
 const before=socialReads;await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('gb-profile-changed'));});await settled();
 check('M20 focus/visible/profile burst coalesces',socialReads===before+1);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 const hidden=socialReads;await event('focus');await event('gb-profile-changed');await settled();check('M20 hidden tab adds no reads',socialReads===hidden);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await settled();check('M20 visible resume refreshes',socialReads===hidden+1);
 // Delayed A may never repaint after B, even when B GET fails.
 holdSocial=true;await event('gb-profile-changed');await assertEventually(()=>{assert.ok(held.length>0);});holdSocial=false;
 actor='B';name='Борис Бета';meStatus=503;await event('gb-session-changed');await neutral();await settled();await release();await settled();await neutral();check('M19 late A rejected when B GET fails');
 meStatus=200;socialStatus=503;await event('gb-session-changed');await named(name);assert.equal(await header.locator('img').count(),0);check('M19 B social GET failure cannot retain A photo');socialStatus=200;avatar={uploadedUrl:upload('b'),providerUrl:null};await event('gb-session-changed');await named(name);await image(upload('b'));check('M19 B uses only confirmed B');
 holdSocial=true;await event('gb-profile-changed');await assertEventually(()=>assert.ok(held.length>0));holdSocial=false;
 actor='guest';meStatus=401;await event('gb-session-changed');await neutral();await release();await settled();await neutral();check('M19 delayed response after logout cannot repaint');
 actor='A';name='Анна Альфа';meStatus=200;avatar={uploadedUrl:upload('a'),providerUrl:provider};await event('gb-session-changed');await named(name);
 holdSocial=true;await event('gb-profile-changed');await assertEventually(()=>assert.ok(held.length>0));holdSocial=false;
 await event('gb-private-expired');await neutral();await release();await settled();await neutral();check('M19 expiry clears and fences in-flight authority');
 await event('gb-session-changed');await named(name);
 // A successful write during an older read schedules fresh authority; old data is discarded.
 holdSocial=true;await event('gb-profile-changed');await assertEventually(()=>assert.ok(held.length>0));holdSocial=false;
 name='Анна Новая';avatar.uploadedUrl=upload('b');await event('gb-profile-changed');await release();await named(name);await image(upload('b'));check('M18 write during read reconciles latest identity');
 // Actual profile controls and existing AvatarEditor uncertainty handling.
 await go('/profile');await named(name);await page.locator('.own-profile-intro button').click();
 await page.locator('input[maxlength="80"]').fill('Анна Сохранённая');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await named('Анна Сохранённая');check('M18 name save updates header without navigation');
 await page.locator('.own-profile-intro button').click();
 const imageBytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').fillRect(0,0,32,32);return Array.from(new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer()));});
 avatar.uploadedUrl=upload('a');await refresh();
 await page.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(imageBytes)});await image(upload('b'));check('M18 actual successful avatar save updates header');
 await page.getByRole('button',{name:'Удалить фото',exact:true}).click();await image(provider);check('M18 actual successful delete updates header');
 unknownWrite=504;
 await page.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(imageBytes)});await image(upload('b'));
 await page.getByRole('alert').filter({hasText:'Не удалось подтвердить сохранение фото'}).waitFor();check('M18 unknown 504 outcome authoritatively reconciles header');
 check('M18 no automatic PUT retry',report.requests.filter(r=>r.path==='/v1/me/avatar'&&r.method==='PUT').length===2);
 unknownWrite=0;
 await page.locator('.profile-dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.waitForURL('**/games');await neutral();check('M19 actual logout dispatch clears header');
 actor='A';name='Анна Альфа';meStatus=200;avatar={uploadedUrl:upload('b'),providerUrl:provider};await event('gb-session-changed');await named(name);
 // Reload clears any local component picture and reads new authority.
 await page.reload();await named(name);await image(upload('b'));check('M19 reload reads authority, no browser identity store');
 check('M19 no private browser storage',await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].every(k=>!/(avatar|identity|profile)/i.test(k))));
 // Geometry and navigation scenarios are repeated for all six assigned widths.
 if(process.env.HEADER_CASES !== 'behavior') for(const width of [320,390,430,768,1024,1440]) {
  await page.setViewportSize({width,height:900});await go('/games');await named(name);
  for(const state of ['guest','uploaded','provider','failure','name-overflow']) {
   meStatus=state==='guest'?401:200;name=state==='name-overflow'?'ОченьДлинноеИмя'.repeat(6):'Анна Альфа';
   avatar={uploadedUrl:state==='provider'?null:upload('a'),providerUrl:provider};
   imageFailure=state==='failure'?new Set([upload('a'),provider]):new Set();
   await event('gb-session-changed');if(state==='guest')await neutral();else await named(name);await settled();
   const data=await header.evaluate(e=>{const a=e.querySelector('.gb-header-avatar'),img=a.querySelector('img'),r=a.getBoundingClientRect(),er=e.getBoundingClientRect();return {circle:{x:r.x,y:r.y,width:r.width,height:r.height},image:img?{width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,fit:getComputedStyle(img).objectFit,alt:img.alt,referrerPolicy:img.referrerPolicy}:null,profileRight:er.right,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(data.circle.width,42);assert.equal(data.circle.height,42);assert.ok(data.profileRight<=width);assert.equal(data.overflow,false);
   if(data.image){assert.equal(data.image.width,36);assert.equal(data.image.height,36);assert.equal(data.image.fit,'cover');assert.equal(data.image.alt,'');assert.equal(data.image.referrerPolicy,'no-referrer');}
   report.geometry.push({width,state,...data});await page.screenshot({path:`${out}/${width}-${state}.png`});
  }
  imageFailure.clear();meStatus=200;await event('gb-session-changed');await named(name);
  await header.focus();check(`M21 ${width} profile keyboard target`,await header.evaluate(e=>document.activeElement===e));assert.equal(await header.getAttribute('href'),'/profile');
  if(width<=720){await page.locator('.gb-bottom-nav .gb-message-count').waitFor();assert.equal(await page.locator('.gb-bottom-nav .gb-message-count').textContent(),'7');assert.deepEqual(await page.locator('.gb-bottom-nav a').evaluateAll(es=>es.map(e=>e.getAttribute('href'))),['/games','/players','/my-games','/messages']);await page.locator('.gb-bottom-nav a[href="/messages"]').waitFor({state:'visible'});check(`WEB94 ${width} four mobile destinations`);}
  if(width===768||width===1024){const trigger=page.getByRole('button',{name:/Меню/});await trigger.focus();await page.keyboard.press('Enter');await page.locator('.gb-compact-menu').waitFor();assert.equal(await page.locator('.gb-compact-menu a').count(),3);check(`WEB94 ${width} menu first link focus`,await page.locator('.gb-compact-menu a').first().evaluate(e=>document.activeElement===e));await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');check(`WEB94 ${width} Escape returns trigger focus`,await trigger.evaluate(e=>document.activeElement===e));}
  if(width>720){await page.locator('.gb-header-message .gb-message-count').waitFor();assert.equal(await page.locator('.gb-header-message .gb-message-count').textContent(),'7');assert.deepEqual(await page.locator('.gb-desktop-nav a').evaluateAll(es=>es.map(e=>e.getAttribute('href'))),['/games','/players','/my-games']);check(`WEB94 ${width} desktop primary sections`);}
 }
 if(process.env.HEADER_CASES !== 'behavior') check('M21 fixed circle geometry for all states and widths',report.geometry.length===30);
 await page.locator('.gb-brand-link').first().click();await page.waitForURL('**/games');await named(name);check('M20 route refresh preserves profile and WEB94 navigation');
 holdSocial=true;await event('gb-profile-changed');await assertEventually(()=>assert.ok(held.length>0));holdSocial=false;
 actor='B';name='Борис После Перехода';avatar={uploadedUrl:upload('b'),providerUrl:null};
 await header.click();await page.waitForURL('**/profile');await named(name);await release();await settled();await named(name);await image(upload('b'));
 check('M20 route teardown fences old callbacks and leaves one listener',await page.evaluate(()=>window.fixtureListeners.get('gb-profile-changed')?.size===1));
 const clean=socialReads;await event('gb-profile-changed');await event('focus');await settled();check('M20 remount has one coalesced updater',socialReads===clean+1);
 check('no unhandled component errors',report.errors.length===0);
} finally {
 await writeFile(`${out}/${process.env.HEADER_CASES === 'behavior' ? 'behavior-results' : 'browser-results'}.json`,JSON.stringify(report,null,2)+'\n');await browser.close();
}
console.log(JSON.stringify({checks:report.checks.length,geometry:report.geometry.length,errors:report.errors},null,2));
