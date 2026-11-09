/* global process, console, document, window, getComputedStyle */
// Synthetic loopback fixture against the real application. Run from repository root
// with the parent's built web server and existing .tools Playwright installation.
// One Next SSR root per page; no standalone renderToString roots or fixture product code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL, pathToFileURL } from 'node:url';
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const playwrightModule = process.env.P1_PLAYWRIGHT_MODULE || `${process.cwd()}/.tools/node_modules/playwright/index.mjs`;
const { chromium } = await import(pathToFileURL(playwrightModule));

// Parent-host execution only: connect to this owned child's endpoint, with the
// existing sandbox intact. Earlier dependency/sandbox failures remain failures.
async function connectOwnedChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-507-synthetic-'));
  const chrome = spawn('/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell', [
    '--headless', '--no-first-run', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false;
  const exit = new Promise(resolve => {
    const done = () => { exited = true; resolve(); };
    chrome.once('exit', done);
    chrome.once('error', done);
  });
  async function waitForExit() {
    let timer;
    try {
      await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
    } finally { clearTimeout(timer); }
  }
  async function stop() {
    if (!exited) { chrome.kill('SIGTERM'); await waitForExit(); }
    if (!exited) { chrome.kill('SIGKILL'); await waitForExit(); }
    assert.ok(exited, 'Owned Chrome did not exit; its profile is retained');
    fs.rmSync(profile, { recursive: true, force: true });
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => finish(new Error(`Owned Chrome DevTools timeout: ${stderr}`)), 15000);
      const onData = chunk => {
        stderr = (stderr + chunk.toString()).slice(-8192);
        const match = /DevTools listening on (ws:\/\/\S+)\r?\n/.exec(stderr);
        if (match) finish(null, match[1]);
      };
      const onExit = (code, signal) => finish(new Error(`Owned Chrome exited (${code}/${signal}): ${stderr}`));
      const onError = error => finish(error);
      function finish(error, value) {
        clearTimeout(timer);
        chrome.stderr.off('data', onData);
        chrome.stderr.resume();
        chrome.off('exit', onExit);
        chrome.off('error', onError);
        if (error) reject(error); else resolve(value);
      }
      chrome.stderr.on('data', onData);
      chrome.once('exit', onExit);
      chrome.once('error', onError);
    });
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    return { browser, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
const city = 'a0000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000001';
const actor = '30000000-0000-4000-8000-000000000001';
const commentId = '20000000-0000-4000-8000-000000000001';
const venue = {id,cityId:city,name:'Synthetic venue',address:'Synthetic address',timezone:'Europe/Moscow',latitude:55.7,longitude:37.6,dataStatus:'verified',provenance:'PUBLIC',cover:{uploadedUrl:null},profile:null,publicContacts:null};
const aggregate = {venueId:id,canonicalVenueId:id,state:'available',average:4.3,count:3};
const comment = {id:commentId,entityKind:'venue',entityId:id,parentCommentId:null,body:'Synthetic server ***** '+ 'x'.repeat(950),deleted:false,version:1,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',edited:false,mine:false,replyCount:0,author:{publicPlayerId:null,displayName:'Synthetic player',avatar:{uploadedUrl:null,providerUrl:null},profilePublic:false}};
const review = {reviewHandle:'synthetic-published',authorLabel:'Участник игры',text:'Synthetic published '+ 'x'.repeat(470),topics:['surface'],publishedRevision:1,publishedAt:'2026-11-01T12:00:00Z'};
const { browser, stop } = await connectOwnedChrome();
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    let ownValue=null, ownVersion=0, failVote=true;
    let reportFailure=false, reviewFailure=false;
    let releaseReport, releaseReview;
    let reportGate, reviewGate;
    let activeActor=actor, activeCsrf='synthetic-only';
    // The real composer reloads GET after POST; keep its synthetic server state
    // local to this isolated browser context.
    const comments=[comment];
    let commentPending=null, commentReadbacks=0;
    const writes=[];
    const own=()=>({venueId:id,canonicalVenueId:id,value:ownValue,version:ownVersion,withdrawn:false,moderationState:'clear',allowedActions:{upsert:true,update:true,withdraw:true}});
    await context.route('**/*', async route=>{
      const request=route.request(), url=new URL(request.url()), path=url.pathname;
      if(url.origin!==origin) return route.abort();
      if(!path.startsWith('/v1/')) return route.continue();
      const reply=(json,status=200)=>route.fulfill({json,status});
      if(request.method()!=='GET') {
        writes.push({path,method:request.method(),body:request.postDataJSON(),key:request.headers()['idempotency-key'],csrf:request.headers()['x-csrf-token']});
        if(path===`/v1/venues/${id}/community-rating`) {
          if(failVote) {failVote=false;return reply({},503);}
          ownValue=request.postDataJSON().value; ownVersion=1;
          return reply({own:own(),summary:aggregate});
        }
        if(path==='/v1/reports') {
          if(reportFailure) {reportFailure=false;await reportGate;return reply({},503);}
          return reply({reportId:'50000000-0000-4000-8000-000000000001',status:'submitted',createdAt:'2026-11-09T12:00:00Z'},201);
        }
        if(path==='/v1/me/venue-reviews/consent-preview') return reply({consentProjectionHash:'synthetic-projection',authorLabel:'Участник игры'});
        if(path==='/v1/me/venue-reviews') {
          if(reviewFailure) {reviewFailure=false;await reviewGate;return reply({},503);}
          return reply({id:'60000000-0000-4000-8000-000000000001',version:1,status:request.postDataJSON().audience==='self_draft'?'self_draft':'submitted',reviewHandle:'synthetic-new',receiptToken:'synthetic-receipt',publicVisible:false,notBefore:null},201);
        }
        if(path===`/v1/venues/${id}/comments`) {
          commentPending=await page.evaluate(key=>JSON.parse(window.sessionStorage.getItem(key)),`gb-fr04-pending:comments:venue:${id}:${actor}`);
          const created={...comment,id:'20000000-0000-4000-8000-000000000002',body:request.postDataJSON().text,mine:true};
          comments.push(created);
          return reply(created,201);
        }
        throw new Error(`Unexpected synthetic mutation ${path}`);
      }
      if(path==='/v1/me') return reply({id:activeActor,displayName:'Synthetic actor',csrfToken:activeCsrf,linkedProviders:[],locale:'ru'});
      if(path==='/v1/me/venue-reviews/eligibility') return reply({bases:[{gameId:'70000000-0000-4000-8000-000000000001',gameTitle:'Synthetic game',admission:'may_submit',reason:null,outcomeVersion:7,attendanceVersion:12,firstEligibleAt:null,helpHint:null}]});
      if(path==='/v1/cities') return reply({items:[{id:city,nameRu:'Москва',defaultTimezone:'Europe/Moscow'}]});
      if(path==='/v1/me/social-profile') return reply({publicPlayerId:actor,displayName:'Synthetic actor',cityId:city,trainer:false,version:1,avatar:{uploadedUrl:null,providerUrl:null}});
      if(path==='/v1/me/game-preferences') return reply({defaultPublicGameContact:null,version:1});
      if(path==='/v1/me/discovery-city') return reply({cityId:city,version:1});
      if(path==='/v1/venues') return reply({items:[venue],nextCursor:null});
      if(path===`/v1/venues/${id}`) return reply(venue);
      if(path==='/v1/venue-community-summaries') return reply({items:[aggregate]});
      if(path===`/v1/venues/${id}/community-rating/me`) return reply({own:own(),summary:aggregate});
      if(path===`/v1/venues/${id}/experience-reviews`) return reply({venueId:id,publishedCount:1,items:[review],nextCursor:null,canWriteHint:false});
      if(path===`/v1/venues/${id}/comments`) {
        if(comments.length>1) commentReadbacks++;
        return reply({entityKind:'venue',entityId:id,parentCommentId:null,items:comments,nextCursor:null,visibleCount:comments.length,canCreate:true});
      }
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
      window.dispatchEvent(new window.CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}}));
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
    // Real keyboard activation reaches the actual return handler even when the
    // expanded sheet header covers its pointer position on narrow screens.
    const back=page.getByRole('region',{name:'Игры на карте',exact:true})
      .getByRole('button',{name:/^(?:К списку игр|← К списку)$/}).filter({visible:true});
    await back.waitFor({state:'visible'});
    assert.equal(await back.count(),1,'one visible accessible map return control');
    await back.focus();
    assert.equal(await back.evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).searchParams.get('view'),'map');
    assert.equal(await content.count(),1);
    await page.setViewportSize({width:390,height:900});
    await page.getByRole('button',{name:'Свернуть площадку',exact:true}).click();
    await page.keyboard.press('Escape');
    assert.equal(await content.count(),1,'parent Escape cannot unmount the compact UNKNOWN owner');
    const hit=await back.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});
    assert.equal(hit,true,'compact return has a real pointer hit target');
    await back.click();
    assert.equal(new URL(page.url()).searchParams.get('view'),'map');
    assert.equal(await content.count(),1,'real pointer return retains UNKNOWN');
    await page.getByRole('button',{name:'Развернуть площадку',exact:true}).click();
    // Repeated city navigation must retain the old mounted catalog and packet,
    // including when the requested city already matches React state.
    for (let attempt=0;attempt<2;attempt++) {
      await page.evaluate(cityB=>{
        const url=new URL(window.location.href);url.searchParams.set('cityId',cityB);
        window.history.pushState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));
      },'a0000000-0000-4000-8000-000000000002');
      await page.getByText(/Смена города отложена/).waitFor();
      await page.waitForFunction(expected=>new URL(window.location.href).searchParams.get('cityId')===expected,city,{timeout:2000});
      assert.equal(await content.count(),1);
      assert.equal(new URL(page.url()).searchParams.get('cityId'),city,'held city is not silently relabeled');
      const held=new URL(page.url());
      assert.equal(held.searchParams.get('day'),'2026-11-20');
      assert.equal(held.searchParams.get('activity'),'regular');
      assert.equal(held.searchParams.get('selectedVenue'),id);
      assert.equal(held.searchParams.get('communityCity'),city);
      assert.equal(held.hash,'#ratings');
      assert.equal(writes.filter(write=>write.method==='PUT').length,1,'held navigation never retries');
    }
    // Cancel the requested city transition while still unresolved, so the rest of
    // the original same-venue fixture can proceed after this operation settles.
    await page.evaluate(cityA=>{
      const url=new URL(window.location.href);url.searchParams.set('cityId',cityA);
      window.history.pushState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));
    },city);
    await page.getByText(/Смена города отложена/).waitFor({state:'hidden'});
    await content.getByRole('button',{name:'Повторить тот же запрос',exact:true}).click();
    await content.getByRole('button',{name:'Сохранить изменение',exact:true}).waitFor();
    const retried=writes.filter(write=>write.method==='PUT');
    assert.deepEqual(retried[1],frozen,'retry retains exact actor-bound body/key/path');
    await page.setViewportSize({width,height:900});
    const report=content.getByTestId('venue-community-report-aggregate');
    await report.focus(); await page.keyboard.press('Enter');
    const reportDialog=page.getByRole('dialog',{name:'Пожаловаться на сводку оценок',exact:true});
    await reportDialog.getByRole('combobox',{name:/^Причина(?:\s|$)/}).waitFor();
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
    const commentWrites=writes.filter(write=>write.path.endsWith('/comments'));
    assert.equal(commentWrites.length,1,'one comment POST without automatic replay');
    const postedComment=commentWrites[0];
    assert.deepEqual({path:postedComment.path,method:postedComment.method,body:postedComment.body},{
      path:`/v1/venues/${id}/comments`,method:'POST',body:{text:'Synthetic in-map comment',parentCommentId:null},
    });
    assert.ok(postedComment.key,'comment POST has an idempotency key');
    assert.deepEqual(commentPending,{path:postedComment.path,method:postedComment.method,body:postedComment.body,key:postedComment.key},'comment body/key/path match the exact actor-bound pending operation');
    assert.ok(commentReadbacks>0,'created comment was returned by a subsequent same-venue GET');
    assert.equal(await content.locator('.gb-comments__count').innerText(),'2');
    await content.getByText(review.text,{exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/games');
    assert.equal(new URL(page.url()).searchParams.get('cityId'),city);
    assert.equal(new URL(page.url()).searchParams.get('activity'),'regular');
    // Report pending and 503 retain the native dialog and exact packet.
    reportFailure=true;reportGate=new Promise(resolve=>{releaseReport=resolve;});
    await report.click();
    await page.getByTestId('venue-community-report-detail').fill('Synthetic exact report');
    await page.getByTestId('venue-community-report-submit').click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="venue-community-report-submit"]').disabled);
    await page.keyboard.press('Escape');
    assert.equal(await reportDialog.isVisible(),true,'busy report cannot close');
    releaseReport();
    await reportDialog.getByRole('button',{name:'Проверить отправку',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await reportDialog.isVisible(),true,'UNKNOWN report cannot close');
    const reportPacket=writes.filter(write=>write.path==='/v1/reports').at(-1);
    await page.setViewportSize({width:1024,height:900});
    await page.setViewportSize({width,height:900});
    await reportDialog.getByRole('button',{name:'Проверить отправку',exact:true}).click();
    await page.getByTestId('venue-community-report-success').waitFor();
    assert.deepEqual(writes.filter(write=>write.path==='/v1/reports').at(-1),reportPacket);
    await page.keyboard.press('Escape');

    // Review preview is separate from the admitted send. 503 retries preserve
    // actor credentials, game/basis versions, consent projection, body and key.
    reviewFailure=true;reviewGate=new Promise(resolve=>{releaseReview=resolve;});
    await content.getByRole('button',{name:'Поделиться опытом',exact:true}).click();
    const reviewDialog=page.getByRole('dialog',{name:'Как вам площадка?',exact:true});
    await reviewDialog.getByLabel('Ваш опыт на площадке',{exact:true}).fill('Synthetic frozen review');
    await reviewDialog.getByLabel('Всем на странице площадки',{exact:true}).check();
    await reviewDialog.getByRole('checkbox').click();
    await page.waitForFunction(()=>document.querySelector('.gb-venue-reviews__preview input[type="checkbox"]')?.checked === true);
    await reviewDialog.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#venue-review-text').disabled);
    await page.keyboard.press('Escape');
    assert.equal(await reviewDialog.isVisible(),true,'busy review cannot close');
    releaseReview();
    await reviewDialog.getByText('Не удалось подтвердить отправку. Текст сохранён',{exact:true}).waitFor();
    const reviewPacket=writes.filter(write=>write.path==='/v1/me/venue-reviews').at(-1);
    assert.equal(reviewPacket.csrf,'synthetic-only');
    assert.deepEqual(reviewPacket.body.expectedBasisVersions,{outcomeVersion:7,attendanceVersion:12});
    assert.equal(reviewPacket.body.consentProjectionHash,'synthetic-projection');
    assert.equal(await reviewDialog.getByLabel('Ваш опыт на площадке',{exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');
    assert.equal(await reviewDialog.isVisible(),true,'UNKNOWN review cannot close');
    await page.setViewportSize({width:1024,height:900});
    await page.setViewportSize({width,height:900});
    assert.equal(writes.filter(write=>write.path==='/v1/me/venue-reviews').length,1,'no hidden retry');
    await reviewDialog.getByRole('button',{name:'Проверить отправку',exact:true}).click();
    await reviewDialog.getByText(/Публикация — после независимой проверки и паузы 48 часов/).waitFor();
    assert.deepEqual(writes.filter(write=>write.path==='/v1/me/venue-reviews').at(-1),reviewPacket);
    await page.keyboard.press('Escape');

    reviewFailure=true;reviewGate=new Promise(resolve=>{releaseReview=resolve;});
    await content.getByRole('button',{name:'Поделиться опытом',exact:true}).click();
    await reviewDialog.getByLabel('Ваш опыт на площадке',{exact:true}).fill('Synthetic revoked operation');
    await reviewDialog.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#venue-review-text').disabled);
    const beforeFence=writes.filter(write=>write.path==='/v1/me/venue-reviews').length;
    activeActor='30000000-0000-4000-8000-000000000002';activeCsrf='synthetic-new-session';
    await page.evaluate(()=>window.dispatchEvent(new window.CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}})));
    const fencedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/v1/me/venue-reviews' && response.status()===503);
    releaseReview();
    await fencedResponse;
    // Wait for new authorization context through the existing rating own read.
    await content.getByRole('radio',{name:'5 из 5',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Проверить отправку',exact:true}).count(),0,'late old-session 503 cannot restore retry');
    assert.equal(writes.filter(write=>write.path==='/v1/me/venue-reviews').length,beforeFence,'session transition never replays');
    activeActor=actor;activeCsrf='synthetic-only';
    await page.evaluate(()=>window.dispatchEvent(new window.CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}})));

    const metrics=await page.evaluate(()=>{
      const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
      const targets=[...document.querySelectorAll('.gb-venue-community .gb-button,.gb-venue-community [role=radio]')].filter(node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
      return {unique:ids.length===new Set(ids).size,overflow:document.documentElement.scrollWidth>window.innerWidth,small:targets.map(node=>({text:node.textContent,rect:node.getBoundingClientRect().toJSON()})).filter(({rect})=>rect.width<43.5||rect.height<43.5)};
    });
    assert.equal(metrics.unique,true);assert.equal(metrics.overflow,false);assert.deepEqual(metrics.small,[]);
    assert.deepEqual(errors,[]);
    // All operations have settled: the next city navigation must work normally,
    // remove the old owner/catalog, and still allow the ordinary list return.
    const settledWrites=writes.length;
    const nextCity='a0000000-0000-4000-8000-000000000002';
    await page.evaluate(cityB=>{
      const url=new URL(window.location.href);url.searchParams.set('cityId',cityB);
      window.history.pushState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));
    },nextCity);
    await page.waitForFunction(expected=>new URL(window.location.href).searchParams.get('cityId')===expected,nextCity,{timeout:2000});
    await content.waitFor({state:'detached'});
    await page.getByText('В каталоге города пока нет площадок.',{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('cityId'),nextCity);
    assert.equal(await content.count(),0,'settled city transition releases the old owner');
    await back.click();
    await page.getByRole('button',{name:'Где играем: Санкт-Петербург. Сменить город',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'),'list');
    assert.equal(new URL(page.url()).searchParams.get('day'),'2026-11-20');
    assert.equal(new URL(page.url()).searchParams.get('activity'),'regular');
    assert.equal(writes.length,settledWrites,'normal city navigation never autosends');
    assert.deepEqual(errors,[]);
    // D1 uses the production picker and its independent sibling actions.
    await page.goto(`${origin}/games/create?cityId=${city}`);
    await page.locator('.gb-game-create').waitFor();
    await page.evaluate(()=>window.dispatchEvent(new window.CustomEvent('gb-session-changed',{detail:{sessionPresence:'present'}})));
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
} finally {
  try { await browser.close(); }
  finally { await stop(); }
}
