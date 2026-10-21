'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.style={}; this._text=''; }
  appendChild(n) { this.children.push(n); n.parentNode=this; return n; }
  removeChild(n) { this.children.splice(this.children.indexOf(n),1); }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this._text=String(v); this.children=[]; }
  get textContent() { return this._text+this.children.map(x=>x.textContent).join(' '); }
  addEventListener() {}
}
async function render(snapshot) {
  const ids={};
  for(const id of ['now','backlog','infra','paused','next','done','doneall','outside','fresh','banner','pipeline','updated','pinform','logout','login','app']) ids[id]=new Element('section');
  const document={hidden:false,getElementById:id=>ids[id] || null,createElement:tag=>new Element(tag),createTextNode:t=>Object.assign(new Element('#text'),{textContent:t}),addEventListener(){}};
  vm.runInNewContext(source,{document,Node:Element,Date,JSON,Math,setTimeout:()=>1,clearTimeout(){},fetch:async()=>({status:200,json:async()=>snapshot})});
  await new Promise(resolve=>setImmediate(resolve));
  return ids;
}
(async()=>{
  const base={available:true,stale:false,age_s:16,source_ok:true,source_mode:'legacy',server_utc:'2026-10-21T15:35:00Z',changed_utc:'2026-10-21T12:35:00Z',executor:{running:true},pipeline:{available:true,runs:[]}};
  const done=await render({...base,claim:{issue:147,phase:'done',attempt:3,max_attempts:3,head_sha:'9d3e092cc30796ffc0096c50584a771e60c18ef3'}});
  assert.match(done.now.textContent,/Состояние исполнителя/);
  assert.match(done.now.textContent,/Активной задачи нет/);
  assert.match(done.now.textContent,/последней завершённой задачи/);
  assert.doesNotMatch(done.now.textContent,/Сейчас выполняется/);
  assert.match(done.fresh.textContent,/Снимок обновлён/);
  const active=await render({...base,claim:{issue:151,phase:'developing',attempt:1,max_attempts:3}});
  assert.match(active.now.textContent,/Сейчас выполняется/);
  assert.doesNotMatch(active.now.textContent,/Активной задачи нет/);
  const idle=await render({...base,claim:null});
  assert.match(idle.now.textContent,/Исполнитель свободен/);
  const slots=await render({...base,source_mode:'slots',claim:null,slots:[{slot:'slot1',status:'FRESH',claim:null}]});
  assert.match(slots.now.textContent,/Состояние слотов/);
  assert.match(slots.now.textContent,/Состояние службы неизвестно/);
  const rich=await render({...base,source_mode:'slots',claim:null,slots:[{slot:'slot1',status:'FRESH',process:{active:'active',sub:'running',pid:123},claim:{issue:151,phase:'ci',head_sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',requested_model:'gpt-6.1-sol',requested_effort:'high',qa:{verdict:'PASS',reviewed_sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},ci:{result:'PASS',passed:7,total:7,sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},pr:153},checkpoint_age_s:90}]});
  assert.match(rich.now.textContent,/Служба: active \/ running · PID 123/);
  assert.match(rich.now.textContent,/PASS · 7\/7/);
  assert.match(rich.now.textContent,/Запрошенная модель/);
  const flatten=n=>[n,...n.children.flatMap(flatten)];
  const bar=flatten(rich.now).find(n=>n.className==='steps');
  assert.ok(bar);assert.equal(bar.children.length,7);
  assert.equal(bar.children.filter(n=>n.className==='done').length,4);
  assert.equal(bar.children[4].className,'cur');
  const blockedSlot=await render({...base,source_mode:'slots',slots:[{slot:'slot2',status:'FRESH',claim:{issue:152,phase:'blocked',resume_phase:'ci'}}]});
  const failedBar=flatten(blockedSlot.now).find(n=>n.className==='steps');
  assert.equal(failedBar.children[4].className,'fail');

  const idleSlot=await render({...base,source_mode:'slots',slots:[{slot:'slot2',status:'FRESH',process:{active:'active',sub:'running',pid:124},claim:null}]});
  assert.match(idleSlot.now.textContent,/Исполнитель запущен; активной задачи нет/);
  const staleSlot=await render({...base,source_mode:'slots',slots:[{slot:'slot2',status:'STALE',process:{active:'active',sub:'running',pid:124},claim:null}]});
  assert.match(staleSlot.now.textContent,/последнее наблюдение/);
  assert.doesNotMatch(staleSlot.now.textContent,/Исполнитель запущен; активной задачи нет/);
  const doneSlot=await render({...base,source_mode:'slots',slots:[{slot:'slot1',status:'FRESH',process:{active:'active',sub:'running',pid:123},claim:{issue:147,phase:'done'}}]});
  assert.match(doneSlot.now.textContent,/Последний завершённый результат/);
  console.log('PASS: completed, active, idle and slot-publication states; snapshot freshness does not claim task progress');
})().catch(error=>{console.error(error);process.exitCode=1;});
