/* global process, window, document, Event, URL, console */
// Author checks: actual HTTP/transport outcomes in built React, synthetic loopback only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const { state, response } = await import(pathToFileURL(process.cwd()+'/docs/workbench/product-rebaseline/p1-repair02/legacy-fixture.mjs'));
const origin='http://127.0.0.1:18989',out='docs/workbench/product-rebaseline/p1-repair02/boundaries';
await mkdir(out,{recursive:true});
const report={kind:'AUTHOR_CHECKS_NOT_INDEPENDENT_QA',checks:[],failures:[],errors:[],requests:[]};
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 for(const name of ['first-guest401','focus-offline','focus403','focus429','focus503','synchronous-old-logout-B','synchronous-old-logout-rotation']) {
  const context=await browser.newContext({viewport:{width:390,height:900}});
  const s={...state(),actor:'A',token:'csrf-A',guest:name==='first-guest401',meStatus:name==='first-guest401'?401:200};
  const calls=[];
  await context.addInitScript(()=>{window.expiryEvents=0;window.addEventListener('gb-private-expired',()=>window.expiryEvents++);});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==origin){report.errors.push({name,external:req.url()});return route.abort();}
   if(!u.pathname.startsWith('/v1/'))return route.continue();
   const call={name,path:u.pathname,method:req.method(),csrf:req.headers()['x-csrf-token']??null};calls.push(call);report.requests.push(call);
   let r;
   if(u.pathname==='/v1/me') {if(s.meStatus===0)return route.abort();r={status:s.meStatus,data:s.meStatus===200?{id:'test-'+s.actor,displayName:'Тест '+s.actor,csrfToken:s.token,locale:'ru',linkedProviders:[]}:{code:'SYNTHETIC_ERROR'}};}
   else if(u.pathname==='/v1/me/game-preferences')r={status:200,data:{defaultPublicGameContact:'telegram:@boundary-'+s.actor,version:1}};
   else if(u.pathname==='/v1/me/social-profile')r={status:200,data:{publicPlayerId:'test-'+s.actor,displayName:'Тест '+s.actor,avatar:{uploadedUrl:null,providerUrl:null}}};
   else if(u.pathname==='/v1/discovery/city-hint')r={status:200,data:{cityId:'a0000000-0000-4000-8000-000000000001',source:'default'}};
   else if(u.pathname==='/v1/me/discovery-preference')r={status:200,data:{cityId:null,version:0}};
   else r=response(s,u.pathname,req.method(),req.postData()?req.postDataJSON():null);
   await route.fulfill({status:r.status,json:r.data}).catch(()=>{});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>report.errors.push({name,error:String(e)}));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push({name,error:m.text()});});
  const input=page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true});
  const ready=async actor=>{await page.waitForFunction(v=>document.querySelector('[data-surface="game-contact-preference"] input')?.value===v,'telegram:@boundary-'+actor);};
  try {
   await page.goto(origin+'/profile/settings');
   if(s.guest) {
    await page.getByText('Войдите, чтобы управлять своим аккаунтом.',{exact:true}).waitFor();
    assert.equal(await input.count(),0);assert.equal(await page.getByRole('button',{name:'Выйти',exact:true}).isEnabled(),false);
    assert.equal(calls.filter(c=>c.path==='/v1/me/game-preferences').length,0);
   } else {
    await ready('A');await page.getByRole('link',{name:'Профиль: Тест A',exact:true}).waitFor();
    if(name.startsWith('synchronous-old-logout')) {
     s.actor=name.endsWith('-B')?'B':'A';s.token=name.endsWith('-B')?'csrf-B':'csrf-A-rotated';
     await page.evaluate(()=>{const old=[...document.querySelectorAll('button')].find(b=>b.textContent==='Выйти');window.dispatchEvent(new Event('gb-session-changed'));old.click();});
     await ready(s.actor);assert.equal(calls.filter(c=>c.path==='/v1/auth/logout').length,0);
    } else {
     s.meStatus=name==='focus-offline'?0:Number(name.slice(5));
     const before=calls.filter(c=>c.path==='/v1/me').length;
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     await page.getByRole('link',{name:'Профиль',exact:true}).waitFor();
     assert.ok(calls.filter(c=>c.path==='/v1/me').length>before);
     await ready('A');assert.equal(await page.getByRole('button',{name:'Выйти',exact:true}).isEnabled(),true);
     s.meStatus=200;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     await page.getByRole('link',{name:'Профиль: Тест A',exact:true}).waitFor();
    }
   }
   assert.equal(await page.evaluate(()=>window.expiryEvents),0);
   await page.screenshot({path:out+'/'+name+'.png',fullPage:true});report.checks.push(name);console.log('PASS '+name);
  }catch(e){report.failures.push({name,error:String(e)});console.log('FAIL '+name+' '+e);}
  finally{await context.close();}
 }
 assert.equal(report.errors.length,0);
}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
if(report.failures.length)process.exitCode=1;
