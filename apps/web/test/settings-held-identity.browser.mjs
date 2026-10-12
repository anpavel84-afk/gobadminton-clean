/* global process, window, document, navigator, Event, URL, console, performance, requestAnimationFrame, innerWidth */
// Repair02 author regression derived from the immutable QA ordering; synthetic loopback only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.cwd()+'/.tools/node_modules/playwright/index.mjs'));
const {state,response}=await import(pathToFileURL(process.cwd()+'/docs/workbench/product-rebaseline/p1-repair02/legacy-fixture.mjs'));
const origin='http://127.0.0.1:18989';
const out='docs/workbench/product-rebaseline/p1-repair02/'+(process.env.P1_BASELINE?'before':'focused');
await mkdir(out,{recursive:true});
const report={kind:'AUTHOR_CHECKS_NOT_INDEPENDENT_QA',source:process.env.P1_BASELINE?'composed repair01 web':'repair02 working source',checks:[],failures:[],errors:[],requests:[],responses:[],timelines:[]};
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
async function run(name,width,operation,transition){
 const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
 const s={...state(),actor:'A',token:'qa-A-1',guest:false,hold:null};
 const saved={A:{defaultPublicGameContact:'telegram:@qa-private-A',version:11},B:{defaultPublicGameContact:'telegram:@qa-private-B',version:21}};
 const calls=[],pending=[];
 await context.addInitScript(()=>{window.qaEvents=[];for(const type of ['gb-private-expired','gb-session-changed'])window.addEventListener(type,()=>window.qaEvents.push({type,at:performance.now()}));Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){throw Error('QA forbids GPS');}}});});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==origin){report.errors.push({name,external:req.url()});return route.abort();}
  if(!u.pathname.startsWith('/v1/'))return route.continue();
  const method=req.method(),body=req.postData()?req.postDataJSON():null;
  const call={name,path:u.pathname,method,actor:s.actor,token:s.token,csrf:req.headers()['x-csrf-token']??null,body};calls.push(call);report.requests.push(call);
  let status=200,data;
  const actor=s.actor,token=s.token;
  if(u.pathname==='/v1/me'){status=s.guest?401:200;data=s.guest?{code:'UNAUTHORIZED'}:{id:'qa-'+actor,displayName:'QA '+actor,csrfToken:token,locale:'ru',linkedProviders:[]};}
  else if(u.pathname==='/v1/me/game-preferences'){
   if(s.guest){status=401;data={code:'UNAUTHORIZED'};}
   else {data={...saved[actor]};if(method==='PATCH'){assert.equal(call.csrf,token);assert.equal(body.expectedVersion,saved[actor].version);data={defaultPublicGameContact:body.defaultPublicGameContact,version:saved[actor].version+1};saved[actor]={...data};}}
  }
  else if(u.pathname==='/v1/me/social-profile')data={publicPlayerId:'qa-'+actor,version:1,displayName:'QA '+actor,cityId:null,areaKey:null,bio:null,level:null,socialEligible:true,directoryVisible:false,contactPolicy:'closed',trainer:false,lookingForGame:null,avatar:{uploadedUrl:null,providerUrl:null}};
  else if(u.pathname==='/v1/discovery/city-hint')data={cityId:'a0000000-0000-4000-8000-000000000001',source:'default'};
  else if(u.pathname==='/v1/me/discovery-preference')data={cityId:null,version:0};
  else if(u.pathname==='/v1/me/radar/activations/current')data={state:'off',ownerHere:false};
  else {const r=response(s,u.pathname,method,body);status=r.status;data=r.data;}
  const held=s.hold==='me'&&u.pathname==='/v1/me'&&pending.length===0||s.hold==='read'&&u.pathname==='/v1/me/game-preferences'&&method==='GET'||['save','delete'].includes(s.hold)&&u.pathname==='/v1/me/game-preferences'&&method==='PATCH';
  if(held)await new Promise(resolve=>pending.push({resolve,call,status,data}));
  report.responses.push({name,path:u.pathname,method,status,held});
  await route.fulfill({status,json:data}).catch(()=>{});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push({name,pageerror:String(e)}));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push({name,console:m.text()});});
 const input=page.getByRole('textbox',{name:'Сохранённый контакт для игры',exact:true});
 const ready=async value=>{await page.waitForFunction(v=>document.querySelector('[data-surface="game-contact-preference"] input')?.value===v,value??'');};
 const absent=async()=>{assert.equal(await page.locator('[data-surface="game-contact-preference"]').count(),0);assert.equal(await input.count(),0);assert.equal(await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Выйти',exact:true}).isEnabled(),false);assert.doesNotMatch(await page.locator('body').innerText(),/qa-private-[AB]|QA [AB]|Контакт сохранён|Сохранённый контакт удалён/);};
 const release=()=>{s.hold=null;pending.splice(0).forEach(p=>p.resolve());};
 try{
  await page.goto(origin+'/profile/settings');await ready(saved.A.defaultPublicGameContact);await page.getByRole('link',{name:'Профиль: QA A',exact:true}).waitFor();
  if(operation){s.hold=operation;if(operation==='save'){await input.fill('telegram:@qa-late-A');await page.getByRole('button',{name:'Сохранить контакт',exact:true}).click();}else if(operation==='delete')await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).click();else {await page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));}
   for(let i=0;i<240&&!pending.length;i++)await page.waitForTimeout(10);assert.ok(pending.length,'old response captured before transition');
   s.hold=null;
   // Establish a live header generation for held preference GET before actual HTTP expiry.
   if(operation==='read'||operation==='me')await page.getByRole('link',{name:'Профиль: QA A',exact:true}).waitFor();
  }
  if(transition==='expiry'){
   s.guest=true;
   // Production header focus refresh invokes apiFetch; no direct expiry dispatch.
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await page.getByRole('link',{name:'Профиль',exact:true}).waitFor();
   await page.waitForTimeout(250);
   report.retentionSnapshot={name,events:await page.evaluate(()=>window.qaEvents),headerGuest:await page.getByRole('link',{name:'Профиль',exact:true}).count(),privateContact:await input.count()?await input.inputValue():null,contactForm:await page.locator('[data-surface="game-contact-preference"]').count(),saveEnabled:await page.getByRole('button',{name:'Сохранить контакт',exact:true}).count()?await page.getByRole('button',{name:'Сохранить контакт',exact:true}).isEnabled():false,deleteEnabled:await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).count()?await page.getByRole('button',{name:'Удалить сохранённый контакт',exact:true}).isEnabled():false,actual401:report.responses.filter(r=>r.name===name&&r.path==='/v1/me'&&r.status===401),heldIdentityResponse:pending.map(p=>({call:p.call,status:p.status,data:p.data}))};
   await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await absent();
   assert.equal((await page.evaluate(()=>window.qaEvents)).filter(e=>e.type==='gb-private-expired').length,1,'exactly one production expiry event');
   assert.ok(report.responses.some(r=>r.name===name&&r.path==='/v1/me'&&r.status===401),'real me401 completed');
  }else{
   if(transition==='logout')s.guest=true;
   else if(transition==='B'){s.actor='B';s.token='qa-B-1';}
   else {s.token='qa-A-2';saved.A={defaultPublicGameContact:'telegram:@qa-new-session',version:51};}
   await page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));
   if(s.guest){await page.getByText('Войдите, чтобы управлять своим аккаунтом.',{exact:true}).waitFor();await absent();}
   else await ready(saved[s.actor].defaultPublicGameContact);
  }
  release();await page.waitForTimeout(250);
  if(s.guest)await absent();else {await ready(saved[s.actor].defaultPublicGameContact);assert.equal(await page.getByText('Контакт сохранён для следующих игр.',{exact:true}).count(),0);assert.equal(await page.getByText('Сохранённый контакт удалён. Контакты в существующих играх не изменились.',{exact:true}).count(),0);}
  const mutations=calls.filter(c=>c.method==='PATCH');assert.equal(mutations.length,['save','delete'].includes(operation)?1:0);assert.ok(mutations.every(c=>c.actor==='A'&&c.csrf==='qa-A-1'));
  await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.timelines.push({name,events:await page.evaluate(()=>window.qaEvents),oldResponseOperation:operation,transition,requests:calls.length,privateContactAfterTransition:s.guest?'ABSENT':saved[s.actor].defaultPublicGameContact});
  // A new valid authentication rehydrates authoritative contact, including reload.
  if(s.guest){s.guest=false;s.token='qa-A-relogin';await page.evaluate(()=>window.dispatchEvent(new Event('gb-session-changed')));await ready(saved.A.defaultPublicGameContact);await page.reload();await ready(saved.A.defaultPublicGameContact);}
  report.checks.push(name);console.log('PASS '+name);
 }catch(e){report.failures.push({name,error:String(e),body:await page.locator('body').innerText()});console.log('FAIL '+name+' '+e);}
 finally{release();await context.close();}
}
try{
 for(const width of process.env.P1_BASELINE?[390]:[320,390,430,768,1024,1440])await run('held-identity-real401-'+width,width,'me','expiry');
 if(!process.env.P1_BASELINE)for(const operation of ['me','read','save','delete'])for(const transition of ['logout','B','rotation'])await run('held-'+operation+'-'+transition,390,operation,transition);
 assert.equal(report.errors.length,0);}finally{await browser.close();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n');}
if(report.failures.length)process.exitCode=1;
