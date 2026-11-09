/* global process, console, document, window, getComputedStyle */
// Synthetic loopback fixture against the real application. Run from repository root
// with the parent's built web server and existing .tools Playwright installation.
// One Next SSR root per page; no standalone renderToString roots or fixture product code.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const { chromium } = await import(pathToFileURL(`${process.cwd()}/.tools/node_modules/playwright/index.mjs`));
const city = 'a0000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000001';
const actor = '30000000-0000-4000-8000-000000000001';
const commentId = '20000000-0000-4000-8000-000000000001';
const venue = {id,cityId:city,name:'Synthetic venue',address:'Synthetic address',timezone:'Europe/Moscow',latitude:55.7,longitude:37.6,dataStatus:'verified',provenance:'PUBLIC',cover:{uploadedUrl:null},profile:null,publicContacts:null};
const aggregate = {venueId:id,canonicalVenueId:id,state:'available',average:4.3,count:3};
const comment = {id:commentId,entityKind:'venue',entityId:id,parentCommentId:null,body:'Synthetic server ***** '+ 'x'.repeat(950),deleted:false,version:1,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',edited:false,mine:false,replyCount:0,author:{publicPlayerId:null,displayName:'Synthetic player',avatar:{uploadedUrl:null,providerUrl:null},profilePublic:false}};
const review = {reviewHandle:'synthetic-published',authorLabel:'Участник игры',text:'Synthetic published '+ 'x'.repeat(470),topics:['surface'],publishedRevision:1,publishedAt:'2026-11-01T12:00:00Z'};
const browser = await chromium.launch({headless:true,chromiumSandbox:true});
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    let ownValue=null, ownVersion=0, failVote=true;
    const writes=[];
    const own=()=>({venueId:id,canonicalVenueId:id,value:ownValue,version:ownVersion,withdrawn:false,moderationState:'clear',allowedActions:{upsert:true,update:true,withdraw:true}});
    await context.route('**/*', async route=>{
      const request=route.request(), url=new URL(request.url()), path=url.pathname;
      if(url.origin!==origin) return route.abort();
      if(!path.startsWith('/v1/')) return route.continue();
      const reply=(json,status=200)=>route.fulfill({json,status});
      if(request.method()!=='GET') {
        writes.push({path,method:request.method(),body:request.postDataJSON(),key:request.headers()['idempotency-key']});
        if(path===`/v1/venues/${id}/community-rating`) {
          if(failVote) {failVote=false;return reply({},503);}
          ownValue=request.postDataJSON().value; ownVersion=1;
          return reply({own:own(),summary:aggregate});
        }
        if(path==='/v1/reports') return reply({reportId:'50000000-0000-4000-8000-000000000001',status:'submitted',createdAt:'2026-11-09T12:00:00Z'},201);
        if(path===`/v1/venues/${id}/comments`) return reply({...comment,id:'20000000-0000-4000-8000-000000000002',body:request.postDataJSON().text,mine:true},201);
        throw new Error(`Unexpected synthetic mutation ${path}`);
      }
      if(path==='/v1/me') return reply({id:actor,displayName:'Synthetic actor',csrfToken:'synthetic-only',linkedProviders:[],locale:'ru'});
      if(path==='/v1/cities') return reply({items:[{id:city,nameRu:'Москва',defaultTimezone:'Europe/Moscow'}]});
      if(path==='/v1/me/social-profile') return reply({publicPlayerId:actor,displayName:'Synthetic actor',cityId:city,trainer:false,version:1,avatar:{uploadedUrl:null,providerUrl:null}});
      if(path==='/v1/me/game-preferences') return reply({defaultPublicGameContact:null,version:1});
      if(path==='/v1/me/discovery-city') return reply({cityId:city,version:1});
      if(path==='/v1/venues') return reply({items:[venue],nextCursor:null});
      if(path===`/v1/venues/${id}`) return reply(venue);
      if(path==='/v1/venue-community-summaries') return reply({items:[aggregate]});
      if(path===`/v1/venues/${id}/community-rating/me`) return reply({own:own(),summary:aggregate});
      if(path===`/v1/venues/${id}/experience-reviews`) return reply({venueId:id,publishedCount:1,items:[review],nextCursor:null,canWriteHint:false});
      if(path===`/v1/venues/${id}/comments`) return reply({entityKind:'venue',entityId:id,parentCommentId:null,items:[comment],nextCursor:null,visibleCount:1,canCreate:true});
      return reply({items:[],nextCursor:null});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Restoration intent is validated by the actual current-city catalog, never schedule-only venueId.
    await page.goto(`${origin}/games?view=map&cityId=${city}&day=2026-11-20&activity=regular&selectedVenue=${id}&communityCity=${city}#ratings`);
    const content=page.locator(`[data-venue-community="${id}"]`);
    await content.getByRole('heading',{name:'Оценки сообщества',exact:true}).waitFor();
    await page.evaluate(()=>{
      document.documentElement.style.setProperty('--gb-safe-bottom','34px');
      window.dispatchEvent(new CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}}));
    });
    await content.getByRole('radio',{name:'4 из 5',exact:true}).waitFor();
    await content.getByRole('radio',{name:'4 из 5',exact:true}).click();
    await content.getByRole('button',{name:'Отправить оценку',exact:true}).click();
    await content.getByTestId('venue-community-vote-unknown').waitFor();
    const frozen=writes.find(write=>write.method==='PUT');assert.ok(frozen?.key);
    if(width===390) {
      await page.getByRole('button',{name:'Свернуть площадку',exact:true}).click();
      assert.equal(await page.locator('[data-testid="venue-community-vote-unknown"]').count(),1);
      await page.getByRole('button',{name:'Развернуть площадку',exact:true}).click();
    }
    await page.setViewportSize({width:1024,height:900});
    await page.setViewportSize({width:1280,height:900});
    await page.locator('.gb-venue-sheet .gb-close-button').click();
    assert.equal(await content.count(),1,'UNKNOWN prevents deselection');
    assert.equal(writes.filter(write=>write.method==='PUT').length,1,'no automatic retry on resize or close');
    await content.getByRole('button',{name:'Повторить тот же запрос',exact:true}).click();
    await content.getByRole('button',{name:'Сохранить изменение',exact:true}).waitFor();
    const retried=writes.filter(write=>write.method==='PUT');
    assert.deepEqual(retried[1],frozen,'retry retains exact actor-bound body/key/path');
    await page.setViewportSize({width,height:900});
    const report=content.getByTestId('venue-community-report-aggregate');
    await report.focus(); await page.keyboard.press('Enter');
    await page.getByLabel('Причина',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await report.evaluate(node=>node===document.activeElement),true,'native dialog restores exact trigger');
    assert.equal(await content.count(),1,'nested Escape leaves map selection');
    await report.click();await page.getByTestId('venue-community-report-submit').click();
    await page.getByTestId('venue-community-report-success').waitFor();
    assert.equal(writes.at(-1).body.venueId,id);assert.equal(writes.at(-1).body.subjectKind,'aggregate');
    await page.keyboard.press('Escape');
    await content.getByLabel('Ваш комментарий',{exact:true}).fill('Synthetic in-map comment');
    await content.getByRole('button',{name:'Отправить',exact:true}).click();
    await content.getByText('Synthetic in-map comment',{exact:true}).waitFor();
    await content.getByText(review.text,{exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/games');
    assert.equal(new URL(page.url()).searchParams.get('cityId'),city);
    assert.equal(new URL(page.url()).searchParams.get('activity'),'regular');
    const metrics=await page.evaluate(()=>{
      const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
      const targets=[...document.querySelectorAll('.gb-venue-community .gb-button,.gb-venue-community [role=radio]')].filter(node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
      return {unique:ids.length===new Set(ids).size,overflow:document.documentElement.scrollWidth>window.innerWidth,small:targets.map(node=>({text:node.textContent,rect:node.getBoundingClientRect().toJSON()})).filter(({rect})=>rect.width<43.5||rect.height<43.5)};
    });
    assert.equal(metrics.unique,true);assert.equal(metrics.overflow,false);assert.deepEqual(metrics.small,[]);
    assert.deepEqual(errors,[]);
    // D1 uses the production picker and its independent sibling actions.
    await page.goto(`${origin}/games/create?cityId=${city}`);
    await page.locator('.gb-game-create').waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}})));
    const pickerTrigger=page.locator('.gb-venue-picker-trigger');
    await pickerTrigger.click();
    const picker=page.locator('.gb-venue-picker');
    await picker.getByRole('searchbox',{name:'Поиск площадки'}).fill('Synthetic');
    const option=picker.locator('.gb-venue-picker-option');
    await option.waitFor();
    const row=picker.locator('.gb-venue-picker-option-row');
    const geometry=await row.evaluate(node=>{
      const copy=node.querySelector('.gb-venue-picker-option-copy').getBoundingClientRect();
      const photo=node.querySelector('summary').getBoundingClientRect();
      const link=node.querySelector('.gb-venue-picker-option-community-link').getBoundingClientRect();
      return {copy:copy.left,photo:photo.left,link:link.left,inside:photo.right<=node.getBoundingClientRect().right,nested:!!node.querySelector('.gb-venue-picker-option a,.gb-venue-picker-option summary')};
    });
    assert.ok(Math.abs(geometry.copy-geometry.link)<2);
    assert.ok(geometry.photo>=geometry.copy && geometry.inside);assert.equal(geometry.nested,false);
    await row.locator('summary').click();assert.equal(await picker.isVisible(),true);
    await picker.getByRole('button',{name:'Закрыть выбор площадки'}).click();
    assert.equal(await picker.count(),0);
    await pickerTrigger.click();await picker.locator('.gb-venue-picker-option').click();
    assert.equal(await picker.count(),0);assert.match(await pickerTrigger.innerText(),/Synthetic venue/);
    await context.close();
  }
  console.log('Synthetic shared map fixture complete at 390/1280, 1024 transition and 34px safe inset. No hosted UAT claimed.');
} finally {await browser.close();}
