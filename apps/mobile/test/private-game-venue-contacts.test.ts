import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { parseAuthenticatedGame } from '../src/participation.ts';
import type { Actor } from '../src/participation.ts';
import {
  PRIVATE_BOOKING_NOTE_MAX,
  PrivateGameVenueContactsCoordinator,
  hasPrivateVenueContacts,
  parsePrivateGameVenueContacts,
  privateBookingNote,
  privateContactPhone,
  privateContactWebsite,
  type PrivateContactsRenderedPermit,
  type PrivateGameVenueContacts,
  type PrivateVenueContactAction,
} from '../src/private-game-venue-contacts.ts';
import { websiteMatrixNegative, websiteMatrixPositive } from '../../web/test/fixtures/website-authority-matrix.ts';

const gameId = '10000000-0000-4000-8000-000000000010';
const venueId = '20000000-0000-4000-8000-000000000020';
const otherGame = '10000000-0000-4000-8000-000000000011';
const otherVenue = '20000000-0000-4000-8000-000000000021';
const actor: Actor = Object.freeze({ actorId: 'A', sessionId: 'S', generation: 1 });

const baseGame = {
  id: gameId,
  version: 1,
  title: 'Fixture',
  status: 'published',
  visibility: 'public',
  organizer: { id: 'o', displayName: 'Host', publicContact: 'tg' },
  venue: {
    id: venueId,
    name: 'Hall',
    address: 'Addr',
    cityId: 'c',
    timezone: 'Europe/Moscow',
  },
  startsAt: '2026-12-01T10:00:00.000Z',
  endsAt: '2026-12-01T12:00:00.000Z',
  applicationDeadlineAt: '2026-11-30T10:00:00.000Z',
  timezone: 'Europe/Moscow',
  capacity: 4,
  confirmedCount: 1,
  externalReservedCount: 0,
  availablePlaces: 3,
  formatKey: 'doubles',
  levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
  settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'x' },
  activityKind: 'regular',
  trainingDescription: null,
  trainer: null,
};

function contactsBody(extra: Record<string, unknown> = {}) {
  return {
    ...baseGame,
    venue: {
      ...baseGame.venue,
      contactPhone: '+7 (999) 123-45-67',
      contactWebsite: 'https://example.org/booking',
      bookingNote: 'Инструкция <img src=x>',
      ...extra,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setup(overrides: {
  read?: (gameId: string, venueId: string) => Promise<PrivateGameVenueContacts>;
  openUrl?: (url: string) => Promise<void>;
} = {}) {
  const reads: { gameId: string; venueId: string }[] = [];
  const opens: string[] = [];
  const owner = new PrivateGameVenueContactsCoordinator({
    read: async (id, venue, permit) => {
      if (!permit()) throw new Error('stale-permit');
      reads.push({ gameId: id, venueId: venue });
      if (overrides.read) return overrides.read(id, venue);
      return parsePrivateGameVenueContacts(contactsBody(), id, venue);
    },
    openUrl: async url => {
      opens.push(url);
      if (overrides.openUrl) await overrides.openUrl(url);
    },
  });
  owner.setActor(actor);
  return { owner, reads, opens };
}

function capturePhonePermit(owner: PrivateGameVenueContactsCoordinator): PrivateContactsRenderedPermit {
  const phone = owner.getSnapshot().projection?.phone;
  assert.ok(phone);
  const permit = owner.renderedPermit(phone);
  assert.ok(permit);
  return permit;
}

test('phone/website/note validators: accepted-web positives and unsafe rejection', () => {
  const phone = privateContactPhone('+7 (999) 123-45-67');
  assert.deepEqual(phone, {
    kind: 'phone',
    text: '+7 (999) 123-45-67',
    url: 'tel:+79991234567',
  });
  assert.equal(privateContactPhone('123'), null);
  assert.equal(privateContactPhone('x'.repeat(41)), null);
  assert.equal(privateContactPhone('javascript:alert(1)'), null);
  assert.equal(privateContactPhone('+7\n999'), null);

  // Accepted-web websiteLink parity against the same fixture (skip WHATWG-invalid / control-prefixed rows).
  let acceptedWebsiteCases = 0;
  for (const [input, href] of websiteMatrixPositive) {
    if (typeof input !== 'string' || input.length > 300) continue;
    try { void new URL(input.trim()); } catch { continue; }
    const action = privateContactWebsite(input);
    if (!action) continue;
    assert.equal(action.url, href, input);
    acceptedWebsiteCases += 1;
    if (acceptedWebsiteCases >= 20) break;
  }
  assert.ok(acceptedWebsiteCases >= 10);
  for (const bad of websiteMatrixNegative) {
    assert.equal(privateContactWebsite(bad), null, String(bad));
  }
  assert.equal(privateContactWebsite('ftp://venue.example.invalid'), null);
  assert.equal(privateContactWebsite('https://user:pass@example.org/'), null);

  assert.equal(privateBookingNote('  Инструкция  '), 'Инструкция');
  assert.equal(privateBookingNote('   '), null);
  assert.equal(privateBookingNote(null), null);
  assert.throws(() => privateBookingNote(1));
  assert.throws(() => privateBookingNote('x'.repeat(PRIVATE_BOOKING_NOTE_MAX + 1)));
});

test('parser validates game/venue ids, isolates projection, markup note stays text', () => {
  const projection = parsePrivateGameVenueContacts(contactsBody(), gameId, venueId);
  assert.equal(projection.gameId, gameId);
  assert.equal(projection.venueId, venueId);
  assert.equal(projection.phone?.url, 'tel:+79991234567');
  assert.equal(projection.website?.url, 'https://example.org/booking');
  assert.equal(projection.bookingNote, 'Инструкция <img src=x>');
  assert.equal(hasPrivateVenueContacts(projection), true);

  assert.throws(() => parsePrivateGameVenueContacts(contactsBody(), otherGame, venueId));
  assert.throws(() => parsePrivateGameVenueContacts(contactsBody(), gameId, otherVenue));
  assert.throws(() => parsePrivateGameVenueContacts({
    ...contactsBody(),
    venue: { ...contactsBody().venue, bookingNote: { html: true } },
  }, gameId, venueId));

  const empty = parsePrivateGameVenueContacts({
    ...baseGame,
    venue: { ...baseGame.venue, contactPhone: null, contactWebsite: null, bookingNote: '  ' },
  }, gameId, venueId);
  assert.equal(hasPrivateVenueContacts(empty), false);

  const omitted = parsePrivateGameVenueContacts(baseGame, gameId, venueId);
  assert.equal(hasPrivateVenueContacts(omitted), false);

  // Invalid phone suppresses only that action; valid website/note remain.
  const partial = parsePrivateGameVenueContacts(contactsBody({ contactPhone: 'bad' }), gameId, venueId);
  assert.equal(partial.phone, null);
  assert.ok(partial.website);
  assert.ok(partial.bookingNote);
});

test('shared Game parser and public projection never retain the three private fields', () => {
  const raw = contactsBody({ contactPhone: 'PRIVATE_PHONE', contactWebsite: 'https://private.example', bookingNote: 'PRIVATE_NOTE' });
  const game = parseAuthenticatedGame(raw);
  assert.equal('contactPhone' in game.venue, false);
  assert.equal('contactWebsite' in game.venue, false);
  assert.equal('bookingNote' in game.venue, false);
  const json = JSON.stringify(game);
  assert.equal(json.includes('PRIVATE_PHONE'), false);
  assert.equal(json.includes('PRIVATE_NOTE'), false);
  assert.equal(json.includes('private.example'), false);
});

test('native transport: exact GET URL, bearer, credentials omit; never gameDetail shared parser', async () => {
  const wires: {
    path: string;
    method?: string;
    auth?: string;
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
  }[] = [];
  const body = contactsBody();
  const api = createNativeApi(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/v1/, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    wires.push({
      path,
      method: init?.method,
      auth: headers.Authorization,
      credentials: init?.credentials,
      redirect: init?.redirect,
    });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const projection = await api.privateGameVenueContacts('access-token', gameId, venueId);
  assert.equal(wires.length, 1);
  assert.equal(wires[0]!.path, `/games/${gameId}`);
  assert.equal(wires[0]!.method, 'GET');
  assert.equal(wires[0]!.auth, 'Bearer access-token');
  assert.equal(wires[0]!.credentials, 'omit');
  assert.equal(wires[0]!.redirect, 'error');
  assert.equal(projection.phone?.text, '+7 (999) 123-45-67');

  const shared = await api.gameDetail('access-token', gameId);
  assert.equal('contactPhone' in shared.venue, false);
  assert.equal('bookingNote' in shared.venue, false);
});

test('lifecycle: refresh clears before await; out-of-order completion; blur/refocus; A→B→A; logout', async () => {
  const gate1 = deferred<PrivateGameVenueContacts>();
  const gate2 = deferred<PrivateGameVenueContacts>();
  let round = 0;
  const first = setup({
    read: async () => {
      round += 1;
      return round === 1 ? gate1.promise : gate2.promise;
    },
  });
  first.owner.focus(gameId, venueId);
  const load1 = first.owner.load();
  assert.equal(first.owner.getSnapshot().status, 'loading');
  assert.equal(first.owner.getSnapshot().projection, null);

  // Newer refresh clears again; stale first completion must not paint.
  const load2 = first.owner.load();
  assert.equal(first.owner.getSnapshot().projection, null);
  gate1.resolve(parsePrivateGameVenueContacts(contactsBody({ bookingNote: 'STALE' }), gameId, venueId));
  await load1;
  assert.equal(first.owner.getSnapshot().projection, null);
  gate2.resolve(parsePrivateGameVenueContacts(contactsBody({ bookingNote: 'FRESH' }), gameId, venueId));
  await load2;
  assert.equal(first.owner.getSnapshot().projection?.bookingNote, 'FRESH');

  const phonePermit = capturePhonePermit(first.owner);
  first.owner.releaseFocus(first.owner.getSnapshot().focus!.viewGen);
  assert.equal(await first.owner.open(phonePermit), 'blocked');
  assert.equal(first.opens.length, 0);

  // A → B → A retires old A handlers.
  const aba = setup();
  const releaseA1 = aba.owner.focus(gameId, venueId);
  await aba.owner.load();
  const oldA = capturePhonePermit(aba.owner);
  aba.owner.focus(otherGame, otherVenue);
  await aba.owner.load();
  assert.equal(await aba.owner.open(oldA), 'blocked');
  assert.equal(aba.opens.length, 0);
  releaseA1();
  aba.owner.focus(gameId, venueId);
  await aba.owner.load();
  assert.equal(await aba.owner.open(oldA), 'blocked');
  const current = capturePhonePermit(aba.owner);
  assert.equal(await aba.owner.open(current), 'opened');
  assert.deepEqual(aba.opens, ['tel:+79991234567']);

  // Logout / forget clears private data; saved handlers stay blocked.
  aba.owner.forget();
  assert.equal(aba.owner.getSnapshot().actor, null);
  assert.equal(aba.owner.getSnapshot().projection, null);
  assert.equal(await aba.owner.open(current), 'blocked');
  assert.equal(aba.opens.length, 1);

  // Actor switch clears projection.
  const switched = setup();
  switched.owner.focus(gameId, venueId);
  await switched.owner.load();
  const before = capturePhonePermit(switched.owner);
  switched.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 2 });
  assert.equal(switched.owner.getSnapshot().projection, null);
  assert.equal(await switched.owner.open(before), 'blocked');
});

test('foreground return refreshes; background clears private UI; delayed open failure cannot paint another panel', async () => {
  const opens = setup();
  opens.owner.focus(gameId, venueId);
  await opens.owner.load();
  assert.equal(opens.reads.length, 1);
  const permit = capturePhonePermit(opens.owner);
  opens.owner.setForeground(false);
  assert.equal(opens.owner.getSnapshot().projection, null);
  assert.equal(await opens.owner.open(permit), 'blocked');
  opens.owner.setForeground(true);
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(opens.reads.length >= 2);
  assert.equal(opens.owner.getSnapshot().status, 'ready');

  const failGate = deferred<void>();
  const failing = setup({
    openUrl: () => failGate.promise,
  });
  failing.owner.focus(gameId, venueId);
  await failing.owner.load();
  const openPermit = capturePhonePermit(failing.owner);
  const work = failing.owner.open(openPermit);
  failing.owner.focus(otherGame, otherVenue);
  failGate.reject(new Error('os-fail'));
  assert.equal(await work, 'failed');
  assert.equal(failing.owner.getSnapshot().openFailure, false);
  assert.notEqual(failing.owner.getSnapshot().focus?.gameId, gameId);
});

test('omitted/null/empty fields clear previous data; denied/error never keep old private values', async () => {
  let body = contactsBody();
  const s = setup({
    read: async (id, venue) => parsePrivateGameVenueContacts(body, id, venue),
  });
  s.owner.focus(gameId, venueId);
  await s.owner.load();
  assert.ok(hasPrivateVenueContacts(s.owner.getSnapshot().projection));
  body = { ...baseGame, venue: { ...baseGame.venue, contactPhone: null, contactWebsite: null, bookingNote: null } };
  await s.owner.load();
  assert.equal(hasPrivateVenueContacts(s.owner.getSnapshot().projection), false);
  assert.equal(s.owner.getSnapshot().status, 'ready');

  let failNext = false;
  const mixed = setup({
    read: async (id, venue) => {
      if (failNext) throw new Error('boom');
      return parsePrivateGameVenueContacts(contactsBody(), id, venue);
    },
  });
  mixed.owner.focus(gameId, venueId);
  await mixed.owner.load();
  failNext = true;
  await mixed.owner.load();
  assert.equal(mixed.owner.getSnapshot().status, 'error');
  assert.equal(mixed.owner.getSnapshot().projection, null);
});

test('current valid handler opens exact URL once; retired handlers never open', async () => {
  const s = setup();
  s.owner.focus(gameId, venueId);
  await s.owner.load();
  const phone = s.owner.getSnapshot().projection!.phone!;
  const website = s.owner.getSnapshot().projection!.website!;
  const phonePermit = s.owner.renderedPermit(phone)!;
  const sitePermit = s.owner.renderedPermit(website)!;
  assert.equal(await s.owner.open(phonePermit), 'opened');
  assert.equal(await s.owner.open(sitePermit), 'opened');
  assert.deepEqual(s.opens, ['tel:+79991234567', 'https://example.org/booking']);

  // Forge an action that is not in the ready projection — blocked.
  const forged: PrivateVenueContactAction = Object.freeze({
    kind: 'phone',
    text: '+79990001122',
    url: 'tel:+79990001122',
  });
  const forgedPermit = Object.freeze({
    ...phonePermit,
    action: forged,
  });
  assert.equal(await s.owner.open(forgedPermit), 'blocked');
  assert.equal(s.opens.length, 2);
});

test('source mounts private panel on authenticated game detail and documents private lifetime', () => {
  const read = (rel: string) => readFileSync(new NodeURL(rel, import.meta.url), 'utf8');
  const route = read('../app/games/[id].tsx');
  assert.match(route, /PrivateGameVenueContactsPanel/);
  assert.match(route, /venueId=\{game\.venue\.id\}/);
  const ownerSrc = read('../src/private-game-venue-contacts.ts');
  assert.match(ownerSrc, /parsePrivateGameVenueContacts/);
  assert.match(ownerSrc, /PrivateContactsRenderedPermit/);
  const api = read('../src/native-api.ts');
  assert.match(api, /privateGameVenueContacts/);
  assert.match(api, /parsePrivateGameVenueContacts/);
  assert.doesNotMatch(api, /privateGameVenueContacts:[\s\S]*gameDetail\(/);
  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /privateGameVenueContacts\.setActor/);
  assert.match(auth, /privateGameVenueContacts\.forget/);
  const readme = read('../README.md');
  assert.match(readme, /APK49/);
  assert.match(readme, /private game venue contacts|контакты площадки/i);
});
