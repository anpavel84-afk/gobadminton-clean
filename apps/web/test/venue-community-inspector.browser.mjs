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
        writes.push({path,method:request.method(),body:request.postDataJSON(),key:request.headers()['idempotency-key']});
        if(path===`/v1/venues/${id}/community-rating`) {
          if(failVote) {failVote=false;return reply({},503);}
          ownValue=request.postDataJSON().value; ownVersion=1;
          return reply({own:own(),summary:aggregate});
        }
        if(path==='/v1/reports') return reply({reportId:'50000000-0000-4000-8000-000000000001',status:'submitted',createdAt:'2026-11-09T12:00:00Z'},201);
        if(path===`/v1/venues/${id}/comments`) {
          commentPending=await page.evaluate(key=>JSON.parse(window.sessionStorage.getItem(key)),`gb-fr04-pending:comments:venue:${id}:${actor}`);
          const created={...comment,id:'20000000-0000-4000-8000-000000000002',body:request.postDataJSON().text,mine:true};
          comments.push(created);
          return reply(created,201);
        }
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
    assert.deepEqual(commentPending,postedComment,'comment body/key/path match the exact actor-bound pending operation');
    assert.ok(commentReadbacks>0,'created comment was returned by a subsequent same-venue GET');
    assert.equal(await content.locator('.gb-comments__count').innerText(),'2');
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
