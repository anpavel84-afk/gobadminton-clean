import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowseGesture, browseDragRotationDeg, browseExitDurationMs, browseExitTranslationPx, classifyPointerGesture, swipeThresholdPx, swipeMinTravelPx, tutorialStorageKey, fullscreenPlayerBrowse, browseCatalogIdentity } from '../src/player-browse.ts';
import { readFileSync } from 'node:fs';
test('accepted measured-dp thresholds, axis locking, minimum flick travel and release ratio',()=>{
  assert.deepEqual([200,360,600].map(swipeThresholdPx),[72,86.39999999999999,112]);
  assert.deepEqual([200,360,600].map(swipeMinTravelPx),[18,21.599999999999998,28]);
  const c=(dx:number,dy:number,velocity=0)=>classifyPointerGesture({dx,dy,width:360,phase:'release',velocity});
  assert.equal(c(90,0),'request');assert.equal(c(-90,0),'skip');assert.equal(c(7,0,2),'none');
  assert.equal(c(30,0,.7),'request');assert.equal(c(20,0,2.5),'none');assert.equal(c(100,90),'none');
  assert.equal(classifyPointerGesture({dx:100,dy:90,width:360,phase:'release',lockedAxis:'horizontal'}),'none');
});
test('native samples are dp/ms; pause and fresh reversal veto distance, cancel cannot click/send',()=>{
  const g=new BrowseGesture('peer',1,1000);g.move(100,0,1100);g.move(80,0,1200);
  assert.equal(g.release(80,0,1201,300,600).result,'none');assert.equal(g.dragged,true);
  const paused=new BrowseGesture('peer',1,1000);paused.move(30,0,1020);
  assert.equal(paused.release(30,0,1200,360,600).result,'none');
  const flick=new BrowseGesture('peer',1,1000);flick.move(30,0,1020);
  assert.equal(flick.release(30,0,1021,360,600).result,'request');
  flick.cancel();assert.equal(flick.release(100,0,1022,360,600).result,'none');
});
test('Reduce Motion removes transforms only; geometry exit and bounded animation preserve semantics',()=>{
  assert.equal(browseDragRotationDeg(100,300,true),0);assert.equal(browseDragRotationDeg(600,300),12);
  assert.ok(browseExitTranslationPx({dir:1,width:360,height:600,rotationDeg:12})>384);
  assert.equal(browseExitDurationMs(1,10),140);assert.equal(browseExitDurationMs(1000,0),300);
  assert.equal(classifyPointerGesture({dx:0,dy:-150,width:360,height:500,phase:'release'}),'vertical-up');
});
test('catalog identity retains selected peer across page append and filters use all public dimensions',()=>{
  const filters={cityId:'city',name:'Ann',areaKey:'north',looking:true,trainer:false};
  const players=[{publicPlayerId:'a'},{publicPlayerId:'b'}] as never;
  assert.equal(browseCatalogIdentity(filters,'b',players).index,1);
  assert.notEqual(browseCatalogIdentity(filters,'a',players).key,browseCatalogIdentity({...filters,areaKey:'south'},'a',players).key);
  assert.notEqual(tutorialStorageKey('a'),tutorialStorageKey('b'));assert.notEqual(tutorialStorageKey(null),tutorialStorageKey('a'));
});
test('chrome hides only exact bare browse and actual navigation imports the owning predicate',()=>{
  assert.equal(fullscreenPlayerBrowse('/players/browse'),true);
  for(const path of ['/players','/players/a','/players/browse/','/players/browse?x=1','/players/browse\n'])assert.equal(fullscreenPlayerBrowse(path),false);
  const nav=readFileSync(new URL('../src/components/main-navigation.tsx',import.meta.url),'utf8');
  assert.match(nav,/!fullscreenPlayerBrowse\(path\)/);assert.match(nav,/\{children\}/);
});
