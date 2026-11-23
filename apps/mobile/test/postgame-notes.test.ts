import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseResults, parsePersonalNote, wire, validateReceipt, noteText, notesSectionVisible,
} from '../src/postgame.ts';
import type { Intent, Packet, PersonalNote, Results } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import { game as publicGame } from './fixtures.ts';
import type { Game } from '@gobadminton/contracts/game-types';

const game = { ...publicGame, version: 1 } satisfies Game;
const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const date = '2026-11-14T10:00:00Z';
const contextA = 'context-a';
const contextB = 'context-b';

const note: PersonalNote = {
  gameId: game.id, contextId: contextA, subjectDisplay: 'Анна', text: 'Личная заметка',
  version: 1, updatedAt: date, allowedActions: { canEdit: true, canDelete: true },
};

const feedbackReady = {
  installed: true, writesEnabled: true,
  capabilities: {
    canCreateNote: true,
    peerSubjects: [
      { contextId: contextA, displayName: 'Анна' },
      { contextId: contextB, displayName: 'Илья' },
    ],
  },
  myNotes: [note] as PersonalNote[],
};

const result: Results = {
  gameId: game.id,
  outcome: { value: 'held', version: 1, reason: 'ok', provenance: { source: 'manager_explicit', recordedAt: date, createdAt: date } },
  allowedActions: { canRecordOutcome: true },
  attendance: {
    installed: true, writesEnabled: true, myAttendance: null,
    roster: [{
      contextId: contextA, value: 'present', version: 1, late: false,
      assertion: { actorDisplay: 'Org', source: 'manager_explicit', at: date },
      acknowledgedVersion: null, dispute: null, displayName: 'Анна',
      allowedActions: {
        canSetAttendance: true, canAcknowledge: false, canDispute: false,
        canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
      },
    }],
    rosterNextCursor: null,
    summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
    allowedActions: { canRecordAttendance: true, canBulkPresent: false },
  },
  feedback: feedbackReady,
};

function packet(intent: Intent): Packet {
  const w = wire(intent);
  return { ...intent, actor, key: 'original-key', method: w.method, path: w.path };
}

function setup(overrides: Partial<{ results: Results; note: PersonalNote | null }> = {}) {
  const sent: Packet[] = [];
  const notes = new Map<string, PersonalNote>();
  if (overrides.note !== null) notes.set(`${game.id}:${contextA}`, overrides.note ?? note);
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string) => {
      const base = overrides.results ?? result;
      return { ...structuredClone(base), gameId: id };
    },
    note: async (_a: Actor, gameId: string, contextId: string) => {
      const row = notes.get(`${gameId}:${contextId}`);
      if (!row) throw new PostgameError('private', 404);
      return structuredClone(row);
    },
    send: async (p: Packet): Promise<unknown> => {
      sent.push(p);
      if (p.kind === 'note-delete') {
        notes.delete(`${p.gameId}:${p.contextId}`);
        return { gameId: p.gameId, contextId: p.contextId, version: p.body.expectedVersion + 1, deleted: true as const };
      }
      if (p.kind === 'note-upsert') {
        const next: PersonalNote = {
          gameId: p.gameId, contextId: p.contextId, subjectDisplay: 'Анна',
          text: p.body.text, version: p.body.expectedVersion + 1, updatedAt: date,
          allowedActions: { canEdit: true, canDelete: true },
        };
        notes.set(`${p.gameId}:${p.contextId}`, next);
        return next;
      }
      throw new PostgameError('invalid');
    },
  };
  const coordinator = new PostgameCoordinator(port, () => `key-${sent.length}`);
  coordinator.setActor(actor);
  return { coordinator, port, sent, notes };
}

test('parse personal note + narrow feedback; ignore unimplemented review fields', () => {
  assert.deepEqual(parsePersonalNote(note), note);
  const parsed = parseResults({
    ...result,
    feedback: {
      ...feedbackReady,
      gameReviews: [{ id: 'should-be-ignored', kind: 'peer' }],
      capabilities: {
        ...feedbackReady.capabilities,
        canCreatePeer: true,
        canCreateOrganization: false,
        canCreateTraining: false,
        organizationRecipientDisplay: null,
        complaintReuse: 'existing_player_report',
        remaining: [],
      },
    },
  });
  assert.equal(parsed.feedback?.capabilities.canCreateNote, true);
  assert.equal(parsed.feedback?.myNotes.length, 1);
  assert.ok(!('gameReviews' in (parsed.feedback as object)));
  assert.ok(!('canCreatePeer' in parsed.feedback!.capabilities));
  assert.throws(() => parsePersonalNote({ ...note, text: '' }));
  assert.throws(() => noteText('  '));
  assert.equal(noteText('ok'), 'ok');
});

test('wire PUT/DELETE note paths and strict receipts', () => {
  const upsert: Intent = { kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 0, text: 'hello' } };
  const del: Intent = { kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } };
  assert.deepEqual(wire(upsert), { method: 'PUT', path: `/games/${game.id}/notes/${contextA}`, body: upsert.body });
  assert.deepEqual(wire(del), { method: 'DELETE', path: `/games/${game.id}/notes/${contextA}`, body: del.body });
  validateReceipt({ ...note, version: 1, text: 'hello' }, packet(upsert));
  validateReceipt({ gameId: game.id, contextId: contextA, version: 2, deleted: true }, packet(del));
  assert.throws(() => validateReceipt({ ...note, version: 1, text: 'other' }, packet(upsert)));
  assert.throws(() => validateReceipt({ gameId: game.id, contextId: contextA, version: 1, deleted: true }, packet(del)));
});

test('native transport DELETE carries exact body and idempotency key', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createNativeApi(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ gameId: game.id, contextId: contextA, version: 2, deleted: true }), { status: 200 });
  });
  const p = packet({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await api.postgameMutation('secret', p);
  assert.equal(calls[0]!.init.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), p.body);
  assert.equal((calls[0]!.init.headers as Record<string, string>)['Idempotency-Key'], p.key);
});

test('create requires canCreateNote; edit/delete use note rights; absence from list is not create grant', async () => {
  const s = setup({ results: { ...result, feedback: { ...feedbackReady, myNotes: [], capabilities: { ...feedbackReady.capabilities, canCreateNote: false } } } });
  await s.coordinator.loadResults(game.id);
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'no' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0);

  const manager = setup({ results: { ...result, feedback: { ...feedbackReady, myNotes: [] } } });
  await manager.coordinator.loadResults(game.id);
  manager.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'create' } });
  await manager.coordinator.confirm();
  assert.equal(manager.sent.length, 1);
  assert.equal(manager.sent[0]!.body.expectedVersion, 0);
});

test('UNKNOWN retains exact packet; conflict keeps draft; logout wipes private note drafts', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextA, createText: 'draft body' });
  s.port.send = async (p) => { s.sent.push(p); throw new PostgameError('network', 503); };
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'draft body' } });
  await s.coordinator.confirm();
  const original = s.coordinator.getSnapshot().command!.packet;
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  assert.match(s.coordinator.getSnapshot().notice ?? '', /не удалось подтвердить сохранение/i);
  assert.equal(s.coordinator.getSnapshot().noteDrafts[game.id]?.createText, 'draft body');

  s.port.send = async (p) => { s.sent.push(p); return { ...note, version: 2, text: 'draft body' }; };
  await s.coordinator.reconcile(game.id);
  assert.equal(s.sent[1], original);
  assert.equal(s.coordinator.getSnapshot().command, null);

  const conflict = setup();
  await conflict.coordinator.loadResults(game.id);
  conflict.coordinator.setNoteDraft(game.id, contextA, { editText: 'kept on conflict' });
  conflict.port.send = async (p) => {
    conflict.sent.push(p);
    throw new PostgameError('business', 409, 'VERSION_CONFLICT');
  };
  conflict.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'kept on conflict' } });
  await conflict.coordinator.confirm();
  assert.equal(conflict.coordinator.getSnapshot().command, null);
  assert.match(conflict.coordinator.getSnapshot().notice ?? '', /Обновите заметку/);
  assert.equal(conflict.coordinator.getSnapshot().noteDrafts[`${game.id}:${contextA}`]?.editText, 'kept on conflict');

  conflict.coordinator.setActor(null);
  assert.deepEqual(conflict.coordinator.getSnapshot().noteDrafts, {});
  assert.deepEqual(conflict.coordinator.getSnapshot().knownNoteRefs, {});
  assert.deepEqual(conflict.coordinator.getSnapshot().notes, {});
});

test('nonparticipating manager: results denied keeps known own-note GET/edit/delete; create denied; cold no-ref hidden', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  assert.ok(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`]);

  // Simulate revoke: results private, feedback gone — retain known ref + direct GET.
  s.port.results = async () => { throw new PostgameError('private', 403); };
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().games[game.id]?.status, 'unavailable');
  assert.ok(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`]);

  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'Личная заметка');
  assert.equal(
    notesSectionVisible(game.id, undefined, s.coordinator.getSnapshot().notes, s.coordinator.getSnapshot().knownNoteRefs),
    true,
  );

  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'after revoke' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1);
  assert.equal((s.sent[0]!.body as { text: string }).text, 'after revoke');

  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'fresh create' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'create without canCreateNote must not send');

  s.coordinator.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 2 } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1]!.kind, 'note-delete');
  assert.equal(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`], undefined);

  // Different actor never sees prior private refs/text.
  s.coordinator.setActor({ ...actor, actorId: 'actor-b', generation: 2 });
  assert.deepEqual(s.coordinator.getSnapshot().knownNoteRefs, {});
  assert.equal(notesSectionVisible(game.id, undefined, {}, {}), false);

  // Cold start without known contexts cannot discover notes.
  const cold = setup({ note: null });
  cold.port.results = async () => { throw new PostgameError('private', 404); };
  cold.coordinator.setActor(actor);
  await cold.coordinator.loadResults(game.id);
  assert.equal(notesSectionVisible(game.id, undefined, cold.coordinator.getSnapshot().notes, cold.coordinator.getSnapshot().knownNoteRefs), false);
});

test('same-account reauth restores known refs and UNKNOWN without autowrite; installed=false disables notes', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.port.send = async (p) => { s.sent.push(p); throw new PostgameError('network', 503); };
  s.coordinator.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await s.coordinator.confirm();
  const original = s.coordinator.getSnapshot().command!.packet;
  assert.equal(s.sent.length, 1);

  s.coordinator.setActor({ ...actor, sessionId: 'reauth', generation: 3 });
  assert.equal(s.coordinator.getSnapshot().command?.packet, original);
  assert.ok(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`]);
  assert.equal(s.sent.length, 1, 'reauth must not autowrite');

  const disabled = setup({
    results: {
      ...result,
      feedback: { installed: false, writesEnabled: false, capabilities: { canCreateNote: false, peerSubjects: [] }, myNotes: [] },
    },
  });
  await disabled.coordinator.loadResults(game.id);
  assert.equal(
    notesSectionVisible(game.id, disabled.coordinator.getSnapshot().games[game.id]?.data, {}, {}),
    true,
  );
  disabled.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 0, text: 'no' } });
  await disabled.coordinator.confirm();
  assert.equal(disabled.sent.length, 0);
});
