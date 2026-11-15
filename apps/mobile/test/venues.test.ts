import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVenue, venueGallery, publicContacts, contactUrl, httpsCreditUrl, safeCatalogSource, VenueSchedule } from '../src/venues.ts';
import { createPublicApi, PublicApiError } from '../src/public-api.ts';
import { game } from './fixtures.ts';
const id = '11111111-1111-4111-8111-111111111111', alias = '22222222-2222-4222-8222-222222222222';
const cityId = '33333333-3333-4333-8333-333333333333';
const dto = { id, name: 'Зал', address: 'Улица, 1', cityId, timezone: 'Europe/Berlin', latitude: 52, longitude: 13 };
const photo = `/v1/media/venue-covers/${'a'.repeat(64)}.png`;
const credit = { kind: 'photo', text: 'Фото: Клуб', url: 'https://club.example/photo' };
const now = Date.parse('2026-11-15T00:00:00.000Z');
const response = (body: unknown) => new Response(JSON.stringify(body));
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const venue = parseVenue(dto,id);
const upcoming = { ...game, id: 'upcoming', venue: dto, timezone: dto.timezone, startsAt: new Date(now + 60000).toISOString() };

test('venue identity is canonical only with exact requested alias binding; legacy optional fields project no private data', () => {
  assert.equal(parseVenue({...dto,resolvedFromVenueId:alias},alias).id,id);
  for (const invalid of [{...dto,id:alias}, {...dto,timezone:'bad/time'}, {...dto,cityId:'city'}, {...dto,latitude:91}]) assert.throws(() => parseVenue(invalid,id),PublicApiError);
  assert.throws(() => parseVenue({...dto,resolvedFromVenueId:id},alias),PublicApiError);
  const old = parseVenue({...dto,bookingNote:'private',organizer:{phone:'private'},dataStatus:'verified'},id);
  assert.equal(old.courtCount,null); assert.equal(old.parking,null); assert.deepEqual(old.gallery,[]); assert.deepEqual(old.contacts,[]);
  assert.ok(!('bookingNote' in old) && !('organizer' in old) && !('dataStatus' in old));
  const facts = parseVenue({...dto,profile:{description:'Зал для игры',courtCount:0,amenities:{parking:false,showers:true},updatedAt:'2026-11-14T12:00:00.000Z',provenance:'private'}},id);
  assert.equal(facts.courtCount,0); assert.equal(facts.parking,false); assert.equal(facts.showers,true); assert.equal(facts.updatedAt,'2026-11-14T12:00:00.000Z');
});

test('public contacts retain accepted phone and HTTP/social policy and reject original-authority normalization bypasses', () => {
  assert.deepEqual(publicContacts({phone:'+49 (123) 456-789',website:'https://club.example',messengers:[{kind:'telegram',url:'https://t.me/club'}],bookingPhone:'123456789'}),[
    {label:'+49 (123) 456-789',url:'tel:+49123456789'}, {label:'club.example',url:'https://club.example/'}, {label:'Telegram',url:'https://t.me/club'},
  ]);
  for (const raw of ['https://@t.me/club','https://t.me\\@evil.example/club','https://t.me/%0a','https://t.me:444/club','javascript:alert(1)','https://t.me/%5c','https://bad host/','https://t.me/\n']) assert.equal(contactUrl(raw,'telegram'),null,raw);
  assert.equal(contactUrl('https://evil.example/club','telegram'),null);
  assert.equal(contactUrl('http://t.me/club','telegram'),null);
  assert.equal(contactUrl('https://t.me/','telegram'),null);
  assert.equal(contactUrl('https://t.me:00443/club','telegram'),'https://t.me/club'); // accepted contact policy; credits use stricter spelling
  assert.equal(httpsCreditUrl('https://club.example:00443/photo'),null);
  assert.equal(httpsCreditUrl('https://@club.example/photo'),null);
  assert.deepEqual(publicContacts({phone:'123456789\n',website:'https://@club.example'}),[]);
});

test('gallery preserves ordered max8 and attributed legacy cover, with honest illustration/logo distinctions', () => {
  const items = Array.from({length:10},(_,i) => ({id:`photo-${i}`,url:photo,credit}));
  assert.equal(venueGallery({gallery:{coverage:'ordered',items}},null).length,8);
  assert.deepEqual(venueGallery(null,{uploadedUrl:photo}),[]);
  assert.equal(venueGallery(null,{uploadedUrl:photo,credit:{...credit,url:'javascript:no'}})[0]?.credit.url,null);
  assert.equal(venueGallery({gallery:{coverage:'ordered',items:[{url:photo,credit:{kind:'illustration',text:'Иллюстрация',url:null}}]}},null)[0]?.credit.kind,'illustration');
  assert.equal(venueGallery({gallery:{coverage:'ordered',items:[{url:photo,credit:{kind:'logo',text:'Логотип: Клуб',url:credit.url}}]}},null)[0]?.credit.kind,'logo');
  for (const url of ['https://stock.example/photo.png',photo.toUpperCase(),'/v1/media/game-covers/'+ 'a'.repeat(64)+'.png']) assert.deepEqual(venueGallery(null,{uploadedUrl:url,credit}),[]);
  assert.deepEqual(venueGallery({gallery:{coverage:'ordered',items:[{url:photo,credit:{...credit,url:'https://@club.example'}}]}},null),[]);
});

test('all valid catalog clubs retain credit; club ids and URLs must agree', () => {
  const source = {provider:'badminton4u.ru',venueId:'B4U-V-ABCDEF12',clubs:[{id:'B4U-C-12',name:'Первый',url:'https://badminton4u.ru/clubs/12/'},{id:'B4U-C-34',name:'Второй',url:'https://badminton4u.ru/clubs/34'}]};
  assert.equal(safeCatalogSource(source)?.clubs.length,2);
  assert.equal(safeCatalogSource({...source,clubs:[{...source.clubs[0],url:'https://badminton4u.ru/clubs/34'}]}),null);
  assert.equal(safeCatalogSource({...source,clubs:[{...source.clubs[0],url:'https://@badminton4u.ru/clubs/12'}]}),null);
});

test('schedule preserves cursor on expired-empty receipt, freezes refresh time, dedupes, expires and rejects cursor loops', async () => {
  let time = now, page = 0; const urls: string[] = [];
  const api = createPublicApi(async url => {
    urls.push(String(url)); page++;
    if (page === 1) return response({items:[{...upcoming,id:'expired',startsAt:new Date(now).toISOString()}],nextCursor:'A'});
    if (page === 2) return response({items:[upcoming,upcoming],nextCursor:'B'});
    return response({items:[],nextCursor:'A'});
  }, () => time);
  const schedule = new VenueSchedule(api,venue,() => time);
  await schedule.refresh(); assert.deepEqual(schedule.state.data?.items,[]); assert.equal(schedule.state.data?.nextCursor,'A');
  time += 1000; await schedule.more(); assert.equal(schedule.state.data?.items.length,1); assert.equal(schedule.state.data?.nextCursor,'B');
  assert.ok(urls.every(url => url.includes('startsFrom=2026-11-15T00%3A00%3A00.000Z')));
  await schedule.more(); assert.equal(schedule.state.status,'error'); assert.equal(schedule.state.data?.nextCursor,'B');
  time += 60000; page = 1; await schedule.refresh(); assert.deepEqual(schedule.state.data?.items,[]);
});

test('refresh/cancel fences late pagination even when transport ignores AbortSignal', async () => {
  const delayed = deferred<{items:typeof upcoming[];nextCursor:string|null}>(); let calls = 0;
  const schedule = new VenueSchedule({venueGames: async () => { calls++; return calls === 2 ? delayed.promise : {items:calls === 1 ? [upcoming] : [],nextCursor:calls === 1 ? 'A' : null}; }},venue,() => now);
  await schedule.refresh(); const more = schedule.more(); await schedule.refresh();
  delayed.resolve({items:[upcoming],nextCursor:'old'}); await more;
  assert.deepEqual(schedule.state.data?.items,[]); assert.equal(schedule.state.data?.nextCursor,null);
  const routeRead = deferred<{items:typeof upcoming[];nextCursor:null}>();
  const other = new VenueSchedule({venueGames:() => routeRead.promise},venue,() => now);
  const read = other.refresh(); other.cancel(); routeRead.resolve({items:[upcoming],nextCursor:null}); await read;
  assert.equal(other.state.status,'loading'); assert.equal(other.state.data,undefined);
});
