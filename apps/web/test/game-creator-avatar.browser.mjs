/* global process, Buffer, URL, console, document, innerWidth */
// Independent QA may run against a prebuilt local Web server; never starts/deploys services.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic loopback only');
const id = '00000021-1111-4111-8111-111111111111';
const city = 'a0000000-0000-4000-8000-000000000001';
const photo = key => `/v1/media/avatars/${key.repeat(64)}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=','base64');
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 for (const width of [390, 1440]) {
  const context = await browser.newContext({viewport:{width,height:900}});
  let mode = 'photo';
  const game = () => ({id,version:1,title:'Synthetic creator avatar',status:'published',visibility:'public',activityKind:'regular',trainer:null,trainingDescription:null,
   organizer:{id:null,displayName:'Анна Автор',publicContact:'',avatar:{uploadedUrl:mode==='removed'||mode==='private'?null:photo(mode==='replacement'?'b':'a'),providerUrl:null}},
   venue:{id:'venue',cityId:city,name:'Synthetic court',address:'Fixture',timezone:'Europe/Moscow'},
   startsAt:'2035-01-01T16:00:00Z',endsAt:'2035-01-01T18:00:00Z',applicationDeadlineAt:'2035-01-01T15:00:00Z',timezone:'Europe/Moscow',capacity:8,confirmedCount:1,externalReservedCount:0,availablePlaces:7,
   formatKey:'doubles',levelRule:{scaleId:'ntrp',scaleVersion:1,allowedLevelIds:['3.0']},settlement:{mode:'external',purpose:'no_trainer_fee',priceMinor:null,currency:null,terms:'Fixture'}});
  await context.route('**/*', async route => {
   const url = new URL(route.request().url()), p = url.pathname;
   if (url.origin !== origin) return route.abort();
   if (p.startsWith('/v1/media/avatars/')) return mode==='broken'?route.abort():route.fulfill({contentType:'image/png',body:png});
   if (!p.startsWith('/v1/')) return route.continue();
   const reply = (json,status=200) => route.fulfill({json,status});
   if (p==='/v1/me') return reply({id:'synthetic-viewer',displayName:'Viewer',csrfToken:'fixture',locale:'ru',linkedProviders:[]});
   if (p==='/v1/cities') return reply({items:[{id:city,nameRu:'Москва',timezone:'Europe/Moscow'}]});
   if (p==='/v1/discovery/city-hint') return reply({cityId:city,source:'default'});
   if (p==='/v1/me/discovery-preference') return reply({cityId:city,version:1});
   if (p==='/v1/games') return reply({items:[game()],nextCursor:null});
   if (p===`/v1/games/${id}`) return reply(game());
   if (p==='/v1/me/games') return reply({items:[{...game(),management:{role:'owner',createdByMe:true}}],nextCursor:null});
   if (p==='/v1/me/participations') return reply({items:[{id:'part',gameId:id,userId:'synthetic-viewer',status:'confirmed',version:1,attemptNumber:1,requestedAt:'2034-01-01T00:00:00Z'}],nextCursor:null});
   if (p==='/v1/me/inbox/counts') return reply({pendingRequestCount:0,pendingInvitationCount:0,dmUnread:0,gameChatUnread:0});
   return reply({},404);
  });
  const page = await context.newPage();
  for (const [path, selector] of [['/games','.gb-discovery-card'],['/my-games?tab=created','.gb-personal-card'],['/my-games','.gb-personal-card'],[`/games/${id}`,'.gb-game-facts'],[`/my-games/${id}`,'.gb-game-facts']]) {
   for (mode of ['photo','replacement','removed','private','broken']) {
    await page.goto(origin+path);
    const avatar = page.locator(selector+' .gb-discovery-avatar').first();
    await avatar.waitFor();
    if (['removed','private','broken'].includes(mode)) {
     await page.waitForFunction(selector => { const avatar=document.querySelector(selector+' .gb-discovery-avatar'); return avatar?.textContent==='АА' && !avatar.querySelector('img'); }, selector);
    } else {
     assert.equal(await avatar.locator('img').getAttribute('src'),photo(mode==='replacement'?'b':'a'));
     await avatar.locator('img').evaluate(img => img.decode());
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${path} overflow`);
   }
  }
  await context.close();
 }
 console.log('Synthetic creator avatar browser regression completed');
} finally { await browser.close(); }
