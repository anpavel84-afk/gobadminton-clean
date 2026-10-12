/* global process, window, document, navigator, Event, URL, console */
// Author checks of built production React; synthetic API only. No independent QA claim.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const { response: legacy, state: legacyState } = await import(pathToFileURL(process.cwd()+'/docs/workbench/product-rebaseline/p1-repair01/legacy-fixture.mjs'));
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18987';
const out = 'docs/workbench/product-rebaseline/p1-repair01/privacy';
await mkdir(out, {recursive:true});
const report = {kind:'AUTHOR_CHECKS', checks:[], failures:[], requests:[], errors:[], geometry:[]};
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function scenario(name, fn, width=390, cold=false) {
 const context = await browser.newContext({viewport:{width,height:900},locale:'ru-RU',reducedMotion:'reduce'});
 const s = {...legacyState(),actor:'A',token:'csrf-A',guest:false,hold:cold?'me':null,readStatus:200,patchStatus:200,logoutStatus:204,holdLogout:false};
 const contacts = {A:{defaultPublicGameContact:'telegram:@private-A',version:2},B:{defaultPublicGameContact:'telegram:@private-B',version:7}};
 const held=[],calls=[];
 await context.addInitScript(()=>{window.__expiry=0;window.addEventListener('gb-private-expired',()=>window.__expiry++);Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:()=>{throw Error('GPS forbidden');}}});});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname,method=req.method();
  if(u.origin!==origin){report.errors.push({name,external:req.url()});return route.abort();}
  if(!path.startsWith('/v1/'))return route.continue();
  const body=req.postData()?req.postDataJSON():null;
  const call={name,path,method,actor:s.actor,token:s.token,csrf:req.headers()['x-csrf-token']??null,body};calls.push(call);report.requests.push(call);
  const actor=s.actor, token=s.token; let status=200,data,hold=null;
  if(path==='/v1/me'){status=s.guest?401:200;data=s.guest?{code:'UNAUTHORIZED'}:{id:'actor-'+actor,displayName:'Анна '+actor,csrfToken:token,locale:'ru',linkedProviders:[]};if(s.hold==='me')hold='me';}
  else if(path==='/v1/me/game-preferences'){
   status=s.guest?401:method==='GET'?s.readStatus:s.patchStatus;
   if(status===200){if(method==='PATCH'){assert.equal(req.headers()['x-csrf-token'],token);assert.equal(body.expectedVersion,contacts[actor].version);contacts[actor]={defaultPublicGameContact:body.defaultPublicGameContact,version:contacts[actor].version+1};}data={...contacts[actor]};}else data={code:'SYNTHETIC_ERROR'};
   if((s.hold==='read'&&method==='GET')||(s.hold==='save'&&method==='PATCH'&&body.defaultPublicGameContact!==null)||(s.hold==='delete'&&method==='PATCH'&&body.defaultPublicGameContact===null))hold=s.hold;
  }
  else if(path==='/v1/auth/logout'){status=s.logoutStatus;data=status===204?null:{code:'SYNTHETIC_ERROR'};if(status===204)s.guest=true;if(s.holdLogout)hold='logout';}
  else if(path==='/v1/me/social-profile'){data={publicPlayerId:'own-'+actor,version:1,displayName:'Анна '+actor,cityId:null,areaKey:null,bio:null,level:null,socialEligible:true,directoryVisible:false,contactPolicy:'closed',trainer:false,lookingForGame:null,avatar:{uploadedUrl:null,providerUrl:null}};}
  else if(path==='/v1/discovery/city-hint')data={cityId:'a0000000-0000-4000-8000-000000000001',source:'default'};
  else if(path==='/v1/me/discovery-preference')data={cityId:null,version:0};
  else if(path==='/v1/me/radar/activations/current')data={state:'off',ownerHere:false};
  else {const r=legacy(s,path,method,body);status=r.status;data=r.data;}
  if(hold)await new Promise(resolve=>held.push({kind:hold,resolve}));
  if(status===0)await route.abort();else await route.fulfill({status,...(status===204?{}:{json:data})}).catch(()=>{});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>report.errors.push({name,pageError:String(error)}));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push({name,console:m.text()});});
 const input=page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true});
 const release=()=>{s.hold=null;s.holdLogout=false;held.splice(0).forEach(h=>h.resolve());};
 const waitHeld=async()=>{await page.waitForFunction(()=>true);for(let i=0;i<200&&!held.length;i++)await page.waitForTimeout(10);assert.ok(held.length,'controlled response is pending');};
 const ready=async(value='telegram:@private-A')=>{await input.waitFor();await page.waitForFunction(v=>document.querySelector('[data-surface="game-contact-preference"] input')?.value===v,value);};
 const absent=async()=>{assert.equal(await input.count(),0);assert.equal(await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).count(),0);assert.equal(await page.locator('[data-surface="game-contact-preference"]').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Контакт сохранён для следующих игр\.|Сохранённый контакт удалён\.|telegram:@private-A/);};
 const transition=async kind=>{
  s.hold=null;
  if(kind==='expiry'){s.guest=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>window.__expiry>0);await page.evaluate(()=>new Promise(resolve=>window.requestAnimationFrame(resolve)));await absent();}
  else {if(kind==='logout')s.guest=true;else if(kind==='B'){s.actor='B';s.token='csrf-B';}else s.token='csrf-A-rotated';await page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));if(kind==='logout'){await page.getByText('Войдите, чтобы управлять своим аккаунтом.',{exact:true}).waitFor();await absent();}else await ready(contacts[s.actor].defaultPublicGameContact??'');}
 };
 const shot=async()=>{await page.screenshot({path:out+'/'+name+'.png',fullPage:true});const g=await page.evaluate(()=>({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}));report.geometry.push({name,...g});assert.ok(g.scrollWidth<=width);};
 try {
  await page.goto(origin+'/profile/settings');
  if(!cold){await ready();await page.getByRole('link',{name:'Профиль: Анна A',exact:true}).waitFor();}
  await fn({page,s,contacts,calls,held,input,release,waitHeld,ready,absent,transition,shot});
  report.checks.push(name);console.log('PASS '+name);
 }catch(error){report.failures.push({name,error:String(error),body:await page.locator('body').innerText()});console.log('FAIL '+name+' '+error);}
 finally{release();await context.close();}
}
try {
 for(const width of [320,390,430,768,1024,1440])await scenario('actual-me401-'+width,async h=>{
  await h.transition('expiry');assert.ok(h.calls.filter(c=>c.path==='/v1/me').length>=2);await h.shot();
  h.s.guest=false;h.s.token='csrf-A-relogin';await h.page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));await h.ready();await h.page.reload();await h.ready();
 },width);
 for(const operation of ['read','save','delete'])for(const kind of ['expiry','logout','B','rotation'])await scenario('late-'+operation+'-'+kind,async h=>{
  h.s.hold=operation;
  if(operation==='read') {await h.page.reload();await h.waitHeld();h.s.hold=null;} // captured successful A response precedes the changed status
  else {if(operation==='save'){await h.input.fill('telegram:@new-A');await h.page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();}else await h.page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).click();await h.waitHeld();}
  // During a held read the header must establish the private generation before real expiry.
  await h.page.getByRole('link',{name:'Профиль: Анна A',exact:true}).waitFor();
  if(kind==='rotation')h.contacts.A={defaultPublicGameContact:'telegram:@rotated-authority',version:20};
  await h.transition(kind);h.release();await h.page.waitForTimeout(150);
  if(kind==='expiry'||kind==='logout')await h.absent();else {await h.ready(h.contacts[h.s.actor].defaultPublicGameContact??'');assert.equal(await h.page.getByText('Контакт сохранён для следующих игр.',{exact:true}).count(),0);assert.equal(await h.page.getByText('Сохранённый контакт удалён. Контакты в существующих играх не изменились.',{exact:true}).count(),0);if(kind==='B'){assert.equal(h.contacts.B.defaultPublicGameContact,'telegram:@private-B');assert.ok(h.calls.filter(c=>c.method==='PATCH').every(c=>c.csrf==='csrf-A'));await h.input.fill('telegram:@updated-B');await h.page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();await h.page.getByText('Контакт сохранён для следующих игр.',{exact:true}).waitFor();assert.equal(h.calls.filter(c=>c.method==='PATCH').at(-1).csrf,'csrf-B');}}
  await h.shot();
 });
 for(const kind of ['expiry','logout','B','rotation'])await scenario('late-me-'+kind,async h=>{
  await h.waitHeld();h.s.hold=null;
  if(kind==='expiry'){h.s.guest=true;await h.page.evaluate(()=>window.dispatchEvent(new Event('gb-private-expired')));await h.page.getByText('Войдите, чтобы управлять своим аккаунтом.',{exact:true}).waitFor();}
  else await h.transition(kind);
  h.release();await h.page.waitForTimeout(200);
  if(kind==='expiry'||kind==='logout')await h.absent();else await h.ready(kind==='B'?'telegram:@private-B':'telegram:@private-A');
  // B is checked against its own contact, never the cold held A identity.
 },390,true);
 for(const kind of ['B','rotation'])await scenario('synchronous-old-control-'+kind,async h=>{
  await h.input.fill('telegram:@stale-action');h.s.actor=kind==='B'?'B':'A';h.s.token=kind==='B'?'csrf-B':'csrf-A-rotated';
  await h.page.evaluate(()=>{const oldButton=[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить контакт');window.dispatchEvent(new Event('gb-session-changed'));oldButton.click();});
  await h.ready(kind==='B'?'telegram:@private-B':'telegram:@private-A');assert.equal(h.calls.filter(c=>c.method==='PATCH').length,0);
 });
 await scenario('valid-save-delete-reload',async h=>{
  await h.input.fill('telegram:@new-A');const b=h.page.getByRole('button',{name:'Сохранить контакт',exact:true});await b.evaluate(el=>{el.click();el.click();});await h.page.getByText('Контакт сохранён для следующих игр.',{exact:true}).waitFor();assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);
  await h.page.reload();await h.ready('telegram:@new-A');await h.page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).click();await h.page.getByText('Сохранённый контакт удалён. Контакты в существующих играх не изменились.',{exact:true}).waitFor();await h.page.reload();await h.ready('');
 });
 for(const status of [0,401,403,409,503])await scenario('patch-error-'+status,async h=>{
  h.s.patchStatus=status;await h.input.fill('telegram:@edit');await h.page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();
  if(status===401){await h.page.getByText('Войдите, чтобы управлять своим аккаунтом.',{exact:true}).waitFor();await h.absent();}
  else {await h.page.getByText('Проверьте сохранённый контакт',{exact:true}).waitFor();assert.equal(await h.page.evaluate(()=>window.__expiry),0);h.s.patchStatus=200;await h.page.getByRole('button',{name:'Повторить',exact:true}).click();await h.ready();await h.input.fill('telegram:@retry');await h.page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();await h.page.getByText('Контакт сохранён для следующих игр.',{exact:true}).waitFor();}
  assert.equal(h.calls.filter(c=>c.method==='PATCH').length,status===401?1:2);
 });
 for(const status of [0,403,503])await scenario('read-retry-'+status,async h=>{
  h.s.readStatus=status;await h.page.reload();await h.page.getByText('Проверьте сохранённый контакт',{exact:true}).waitFor();assert.equal(await h.page.evaluate(()=>window.__expiry),0);h.s.readStatus=200;await h.page.getByRole('button',{name:'Повторить',exact:true}).click();await h.ready();
 });
 await scenario('explicit-logout',async h=>{await h.page.getByRole('button',{name:'Выйти',exact:true}).click();await h.page.waitForURL(origin+'/games');assert.equal(h.calls.filter(c=>c.path==='/v1/auth/logout').length,1);assert.equal(await h.page.getByRole('link',{name:'Профиль: Анна A',exact:true}).count(),0);});
 await scenario('logout-error-retry',async h=>{h.s.logoutStatus=503;await h.page.getByRole('button',{name:'Выйти',exact:true}).click();await h.page.getByText('Не удалось подтвердить выход. Проверьте соединение и попробуйте ещё раз.',{exact:true}).waitFor();await h.ready();h.s.logoutStatus=204;await h.page.getByRole('button',{name:'Выйти',exact:true}).click();await h.page.waitForURL(origin+'/games');});
 for(const kind of ['B','rotation','expiry'])await scenario('late-logout-'+kind,async h=>{h.s.holdLogout=true;await h.page.getByRole('button',{name:'Выйти',exact:true}).click();await h.waitHeld();h.s.guest=false;await h.transition(kind);h.release();await h.page.waitForTimeout(150);assert.equal(new URL(h.page.url()).pathname,'/profile/settings');if(kind==='expiry')await h.absent();else await h.ready(kind==='B'?'telegram:@private-B':'telegram:@private-A');});
 assert.equal(report.errors.length,0);
} finally {await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
if(report.failures.length)process.exitCode=1;
