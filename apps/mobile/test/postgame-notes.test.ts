import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseResults, parsePersonalNote, wire, validateReceipt, noteText,
  notesSectionVisible, noteSubjectOptions, collectNotes,
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

test('parse personal note + narrow feedback; reject nested wrong-game; ignore unimplemented review fields', () => {
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
  assert.throws(() => parseResults({
    ...result,
    feedback: { ...feedbackReady, myNotes: [{ ...note, gameId: 'other-game-id' }] },
  }));
  assert.throws(() => parseResults({
    ...result,
    feedback: { ...feedbackReady, myNotes: [note, { ...note, version: 2 }] },
  }));
  // Omitted / installed=false feedback must not break ordinary outcome parse.
  assert.equal(parseResults({ ...result, feedback: undefined }).outcome.value, 'held');
  assert.equal(parseResults({
    ...result,
    feedback: { installed: false, writesEnabled: false, capabilities: { canCreateNote: false, peerSubjects: [] }, myNotes: [] },
  }).feedback?.installed, false);
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

test('create requires selected direct GET absence; list gap is not create grant; off-list GET enables edit', async () => {
  const s = setup({ results: { ...result, feedback: { ...feedbackReady, myNotes: [], capabilities: { ...feedbackReady.capabilities, canCreateNote: false } } } });
  await s.coordinator.loadResults(game.id);
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'no' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0);

  const manager = setup({ note: null, results: { ...result, feedback: { ...feedbackReady, myNotes: [] } } });
  await manager.coordinator.loadResults(game.id);
  // Wrong prior flow: create without selected read must not send.
  manager.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'create' } });
  await manager.coordinator.confirm();
  assert.equal(manager.sent.length, 0, 'create without selected direct GET must not send');

  manager.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextB });
  await manager.coordinator.loadNote(game.id, contextB);
  assert.equal(manager.coordinator.getSnapshot().notes[`${game.id}:${contextB}`]?.status, 'unavailable');
  manager.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'create' } });
  await manager.coordinator.confirm();
  assert.equal(manager.sent.length, 1);
  {
    const packet = manager.sent[0]!;
    assert.ok(packet.kind === 'note-upsert');
    assert.equal(packet.body.expectedVersion, 0);
  }

  // Off-list existing note (bounded myNotes empty) becomes editable after selected GET — not create0.
  const offList: PersonalNote = { ...note, contextId: contextB, version: 7, text: 'off-list v7', subjectDisplay: 'Илья' };
  const edit = setup({ note: null, results: { ...result, feedback: { ...feedbackReady, myNotes: [] } } });
  edit.notes.set(`${game.id}:${contextB}`, offList);
  await edit.coordinator.loadResults(game.id);
  edit.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextB });
  await edit.coordinator.loadNote(game.id, contextB);
  assert.equal(edit.coordinator.getSnapshot().notes[`${game.id}:${contextB}`]?.data?.version, 7);
  edit.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'wrong create' } });
  await edit.coordinator.confirm();
  assert.equal(edit.sent.length, 0, 'existing selected note must not create0');
  edit.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 7, text: 'edit off-list' } });
  await edit.coordinator.confirm();
  assert.equal(edit.sent.length, 1);
  {
    const packet = edit.sent[0]!;
    assert.ok(packet.kind === 'note-upsert');
    assert.equal(packet.body.expectedVersion, 7);
  }
});

test('UNKNOWN retains exact packet; conflict keeps draft; logout wipes private note drafts', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadNote(game.id, contextA);
  // setNoteDraft(selectedContextId) launches a new direct GET — await that authority before write.
  s.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextA, createText: 'draft body' });
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
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
  await conflict.coordinator.loadNote(game.id, contextA);
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
  // Post-ACK typed GET reestablishes version before next write.
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 2);

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
  await s.coordinator.loadNote(game.id, contextA);
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

test('late results must not regress newer direct note; late GET after delete must not resurrect', async () => {
  let releaseResults!: (value: Results) => void;
  let releaseNote!: (value: PersonalNote) => void;
  const resultsGate = new Promise<Results>((resolve) => { releaseResults = resolve; });
  const noteGate = new Promise<PersonalNote>((resolve) => { releaseNote = resolve; });
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => resultsGate,
    note: async () => noteGate,
    send: async (p: Packet): Promise<unknown> => {
      sent.push(p);
      if (p.kind === 'note-delete') {
        return { gameId: p.gameId, contextId: p.contextId, version: p.body.expectedVersion + 1, deleted: true as const };
      }
      throw new PostgameError('invalid');
    },
  };
  const c = new PostgameCoordinator(port, () => `key-${sent.length}`);
  c.setActor(actor);

  // Realistic race: results starts with v2, newer direct v3 completes, late results must not regress 3→2.
  const loadResultsP = c.loadResults(game.id);
  const loadNoteP = c.loadNote(game.id, contextA);
  releaseNote({ ...note, version: 3, text: 'direct-v3' });
  await loadNoteP;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 3);
  releaseResults({
    ...result,
    feedback: { ...feedbackReady, myNotes: [{ ...note, version: 2, text: 'stale-results-v2' }] },
  });
  await loadResultsP;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 3);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'direct-v3');

  // LEGAL delete under ready typed current version BEFORE refresh; late GET must not resurrect.
  let lateNote!: (value: PersonalNote) => void;
  const lateGate = new Promise<PersonalNote>((resolve) => { lateNote = resolve; });
  let releaseDelete!: (value: unknown) => void;
  const deleteGate = new Promise<unknown>((resolve) => { releaseDelete = resolve; });
  let deleteEntered!: () => void;
  const deleteStarted = new Promise<void>((resolve) => { deleteEntered = resolve; });
  port.note = async () => lateGate;
  port.results = async () => ({
    ...result,
    feedback: { ...feedbackReady, myNotes: [] },
  });
  port.send = async (p: Packet): Promise<unknown> => {
    sent.push(p);
    if (p.kind === 'note-delete') {
      deleteEntered();
      return deleteGate;
    }
    throw new PostgameError('invalid');
  };
  // Ready typed v3 still grants delete — start real delete before any new refresh.
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 3);
  c.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 3 } });
  const confirmP = c.confirm();
  await deleteStarted;
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.kind, 'note-delete');
  // Direct GET while delete inflight, then valid delete ACK, then fresh EMPTY results, then stale GET.
  const lateGet = c.loadNote(game.id, contextA);
  releaseDelete({ gameId: game.id, contextId: contextA, version: 4, deleted: true as const });
  await confirmP;
  assert.equal(sent.length, 1, 'exactly one DELETE sent');
  await c.loadResults(game.id);
  assert.equal(c.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`], undefined);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data, undefined);
  lateNote({ ...note, version: 1, text: 'Личная заметка' });
  await lateGet;
  assert.equal(c.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`], undefined);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data, undefined);
});

test('private 404 of known own note shadows myNotes and does not unlock create; ACK is not current projection', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  assert.ok(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`]);
  s.notes.delete(`${game.id}:${contextA}`);
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable');
  assert.equal(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`], undefined);
  // Create must stay blocked for tombstoned/known absence even with canCreateNote.
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 0, text: 'resurrect' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0);

  // Historical upsert ACK does not unlock writes until typed GET reestablishes.
  const write = setup({ note: null, results: { ...result, feedback: { ...feedbackReady, myNotes: [] } } });
  await write.coordinator.loadResults(game.id);
  write.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextB });
  await write.coordinator.loadNote(game.id, contextB);
  write.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'new' } });
  let releaseGet!: (value: PersonalNote) => void;
  const getGate = new Promise<PersonalNote>((resolve) => { releaseGet = resolve; });
  write.port.note = async () => getGate;
  const confirmP = write.coordinator.confirm();
  await confirmP;
  assert.equal(write.sent.length, 1);
  // Before post-ACK GET settles, further edit must not use receipt as current.
  write.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 1, text: 'too soon' } });
  await write.coordinator.confirm();
  assert.equal(write.sent.length, 1, 'ACK receipt must not unlock writes before typed GET');
  releaseGet({
    gameId: game.id, contextId: contextB, subjectDisplay: 'Илья', text: 'new', version: 1, updatedAt: date,
    allowedActions: { canEdit: true, canDelete: true },
  });
  await write.coordinator.loadNote(game.id, contextB);
  assert.equal(write.coordinator.getSnapshot().notes[`${game.id}:${contextB}`]?.data?.version, 1);
});

test('reverse race: pending direct v2 must not overwrite newer results v3 (version/text/rights)', async () => {
  let releaseResults!: (value: Results) => void;
  let releaseNote!: (value: PersonalNote) => void;
  const resultsGate = new Promise<Results>((resolve) => { releaseResults = resolve; });
  const noteGate = new Promise<PersonalNote>((resolve) => { releaseNote = resolve; });
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => resultsGate,
    note: async () => noteGate,
    send: async (p: Packet): Promise<unknown> => { sent.push(p); throw new PostgameError('invalid'); },
  };
  const c = new PostgameCoordinator(port, () => `key-${sent.length}`);
  c.setActor(actor);

  // Opposite of late-results test: direct starts first, results wins with v3, stale direct v2 must not regress.
  const loadNoteP = c.loadNote(game.id, contextA);
  const loadResultsP = c.loadResults(game.id);
  releaseResults({
    ...result,
    feedback: {
      ...feedbackReady,
      myNotes: [{
        ...note, version: 3, text: 'results-v3',
        allowedActions: { canEdit: true, canDelete: false },
      }],
    },
  });
  await loadResultsP;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 3);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'results-v3');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.allowedActions.canDelete, false);

  releaseNote({
    ...note, version: 2, text: 'stale-direct-v2',
    allowedActions: { canEdit: true, canDelete: true },
  });
  await loadNoteP;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 3);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'results-v3');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.allowedActions.canDelete, false,
    'stale same-key earlier read must not regrant rights');
});

test('pending refresh/error blocks edit/delete; explicit retry restores current rights', async () => {
  let settleNote!: (value: PersonalNote) => void;
  let failNote!: (error: PostgameError) => void;
  let noteGate = new Promise<PersonalNote>((resolve, reject) => {
    settleNote = resolve;
    failNote = reject;
  });
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string) => ({ ...structuredClone(result), gameId: id }),
    note: async () => noteGate,
    send: async (p: Packet): Promise<unknown> => {
      sent.push(p);
      if (p.kind === 'note-upsert') {
        return {
          gameId: p.gameId, contextId: p.contextId, subjectDisplay: 'Анна',
          text: p.body.text, version: p.body.expectedVersion + 1, updatedAt: date,
          allowedActions: { canEdit: true, canDelete: true },
        };
      }
      throw new PostgameError('invalid');
    },
  };
  const c = new PostgameCoordinator(port, () => `key-${sent.length}`);
  c.setActor(actor);
  await c.loadResults(game.id);

  const firstGet = c.loadNote(game.id, contextA);
  settleNote({ ...note, version: 1, text: 'ready-v1', allowedActions: { canEdit: true, canDelete: true } });
  await firstGet;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');

  noteGate = new Promise<PersonalNote>((resolve, reject) => {
    settleNote = resolve;
    failNote = reject;
  });
  port.note = async () => noteGate;
  const pending = c.loadNote(game.id, contextA);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'loading');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'ready-v1');
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'during load' } });
  await c.confirm();
  assert.equal(sent.length, 0, 'edit rejected while direct loading');
  c.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await c.confirm();
  assert.equal(sent.length, 0, 'delete rejected while direct loading');

  failNote(new PostgameError('network', 503));
  await pending;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'error');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'ready-v1');
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'during error' } });
  await c.confirm();
  assert.equal(sent.length, 0, 'edit rejected while direct error');
  c.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await c.confirm();
  assert.equal(sent.length, 0, 'delete rejected while direct error');

  noteGate = new Promise<PersonalNote>((resolve, reject) => {
    settleNote = resolve;
    failNote = reject;
  });
  port.note = async () => noteGate;
  const retry = c.loadNote(game.id, contextA);
  settleNote({
    ...note, version: 1, text: 'ready-v1',
    allowedActions: { canEdit: true, canDelete: true },
  });
  await retry;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'after retry' } });
  await c.confirm();
  assert.equal(sent.length, 1);
  assert.equal((sent[0]!.body as { text: string }).text, 'after retry');
});

test('after confirmed PUT and typed GET failure historical results cannot regrant write authority', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadNote(game.id, contextA);

  let failGet!: (error: PostgameError) => void;
  const getGate = new Promise<PersonalNote>((_, reject) => { failGet = reject; });
  s.port.note = async () => getGate;

  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 1, text: 'saved' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'loading');
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.data, undefined);

  // While awaiting typed GET, no write from receipt/loading.
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 2, text: 'too soon' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'ACK receipt must not unlock writes before typed GET');

  const getFailed = getGate.then(() => {}, () => {});
  failGet(new PostgameError('network', 503));
  await getFailed;
  await Promise.resolve();
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'error');

  // Historical myNotes (still v1 in fixture results) must not become ready write authority.
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'error');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 2, text: 'no fallback' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'no write from historical result fallback after PUT+GET failure');
  s.coordinator.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 2 } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'delete also blocked without typed ready authority');
});

test('same-version rights refresh only under newer read gen; stale earlier read cannot regrant', async () => {
  let releaseEarly!: (value: PersonalNote) => void;
  let releaseLate!: (value: PersonalNote) => void;
  const earlyGate = new Promise<PersonalNote>((resolve) => { releaseEarly = resolve; });
  const lateGate = new Promise<PersonalNote>((resolve) => { releaseLate = resolve; });
  let noteCalls = 0;
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string) => ({
      ...structuredClone(result),
      gameId: id,
      feedback: { ...feedbackReady, myNotes: [] },
    }),
    note: async () => {
      noteCalls += 1;
      return noteCalls === 1 ? earlyGate : lateGate;
    },
    send: async (p: Packet): Promise<unknown> => { sent.push(p); throw new PostgameError('invalid'); },
  };
  const c = new PostgameCoordinator(port, () => `key-${sent.length}`);
  c.setActor(actor);
  await c.loadResults(game.id);

  const early = c.loadNote(game.id, contextA);
  const late = c.loadNote(game.id, contextA);
  // Newer gen settles first with canDelete revoked.
  releaseLate({
    ...note, version: 4, text: 'v4-no-delete',
    allowedActions: { canEdit: true, canDelete: false },
  });
  await late;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.allowedActions.canDelete, false);

  // Stale earlier gen same version tries to regrant canDelete — must remain false.
  releaseEarly({
    ...note, version: 4, text: 'v4-stale-regrant',
    allowedActions: { canEdit: true, canDelete: true },
  });
  await early;
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.version, 4);
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'v4-no-delete');
  assert.equal(c.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.allowedActions.canDelete, false);
  c.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 4 } });
  await c.confirm();
  assert.equal(sent.length, 0, 'stale earlier read must not regrant delete');
});

test('same-actor reauth with denied results mounts recovery via visibility selector and direct GET', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadNote(game.id, contextA);
  assert.ok(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`]);

  // Manager revocation: results denied; known owned note still GET-able.
  s.port.results = async () => { throw new PostgameError('private', 403); };
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().games[game.id]?.status, 'unavailable');

  // Same-account logout → new session: refs restore, notes projection clears.
  s.coordinator.setActor(null);
  s.coordinator.setActor({ ...actor, sessionId: 'session-reauth', generation: 4 });
  const snap = s.coordinator.getSnapshot();
  assert.ok(snap.knownNoteRefs[`${game.id}:${contextA}`]);
  assert.deepEqual(snap.notes, {});
  // Actual visibility selector must mount recovery lane for missing/idle known refs.
  assert.equal(
    notesSectionVisible(game.id, undefined, snap.notes, snap.knownNoteRefs),
    true,
    'denied results + restored known refs must mount notes recovery lane',
  );

  // Effect path: idle/missing → actual loadNote direct GET restores private text.
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, 'Личная заметка');
  assert.equal(
    notesSectionVisible(
      game.id, undefined,
      s.coordinator.getSnapshot().notes,
      s.coordinator.getSnapshot().knownNoteRefs,
    ),
    true,
  );
});

test('note subject selector prefers roster over nonempty narrower peerSubjects', () => {
  const absent = 'context-absent';
  const disputed = 'context-disputed';
  const peerOnly = 'context-peer';
  const rosterRows = [
    {
      contextId: contextA, value: 'present' as const, version: 1, late: false,
      assertion: { actorDisplay: 'Org', source: 'manager_explicit' as const, at: date },
      acknowledgedVersion: null, dispute: null, displayName: 'Анна',
      allowedActions: {
        canSetAttendance: true, canAcknowledge: false, canDispute: false,
        canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
      },
    },
    {
      contextId: absent, value: 'absent' as const, version: 1, late: false,
      assertion: { actorDisplay: 'Org', source: 'manager_explicit' as const, at: date },
      acknowledgedVersion: null, dispute: null, displayName: 'Отсутствует',
      allowedActions: {
        canSetAttendance: true, canAcknowledge: false, canDispute: false,
        canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false,
      },
    },
    {
      contextId: disputed, value: 'present' as const, version: 2, late: false,
      assertion: { actorDisplay: 'Org', source: 'manager_explicit' as const, at: date },
      acknowledgedVersion: null,
      dispute: { id: 'dispute-1', status: 'open' as const, challengedVersion: 1, version: 1 },
      displayName: 'Спор',
      allowedActions: {
        canSetAttendance: false, canAcknowledge: false, canDispute: false,
        canWithdrawDispute: false, canRespondDispute: true, canRequestHelp: false,
      },
    },
  ];
  // Narrower peerSubjects (one eligible peer) must not replace full roster for personal notes.
  const data: Results = {
    ...result,
    attendance: {
      ...result.attendance!,
      roster: rosterRows,
      rosterNextCursor: 'page-2',
      summary: { rosterCount: 3, marked: 3, unknown: 0, underClarification: 1, agreed: 1 },
    },
    feedback: {
      ...feedbackReady,
      myNotes: [],
      capabilities: {
        canCreateNote: true,
        peerSubjects: [{ contextId: peerOnly, displayName: 'Только peer' }],
      },
    },
  };
  const subjects = noteSubjectOptions(data);
  assert.deepEqual(
    subjects.map(s => s.contextId),
    [contextA, absent, disputed],
    'roster-first: absent/disputed roster contexts remain selectable',
  );
  assert.ok(!subjects.some(s => s.contextId === peerOnly), 'peerSubjects must not replace roster');
  // Empty roster falls back to peerSubjects; pagination cursor presence does not change selector.
  assert.deepEqual(
    noteSubjectOptions({
      ...data,
      attendance: { ...data.attendance!, roster: [], rosterNextCursor: 'page-2' },
    }).map(s => s.contextId),
    [peerOnly],
  );
});

test('tombstone fence persists through select/pending GET/error — collectNotes hides deleted text', async () => {
  const deletedText = 'SECRET-DELETED-TEXT';
  const s = setup({
    note: { ...note, text: deletedText },
    results: {
      ...result,
      feedback: { ...feedbackReady, myNotes: [{ ...note, text: deletedText }] },
    },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.data?.text, deletedText);

  s.coordinator.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await s.coordinator.confirm();
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable');
  assert.equal(s.coordinator.getSnapshot().knownNoteRefs[`${game.id}:${contextA}`], undefined);

  // Results refresh retains prior myNotes on failure (stale private text still in projection).
  const staleResults = s.coordinator.getSnapshot().games[game.id]!.data!;
  assert.equal(staleResults.feedback?.myNotes[0]?.text, deletedText);
  s.port.results = async () => { throw new PostgameError('network', 503); };
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().games[game.id]?.status, 'error');
  assert.equal(s.coordinator.getSnapshot().games[game.id]?.data?.feedback?.myNotes[0]?.text, deletedText);

  // Same UI composition: fence must suppress stale myNotes after confirmed DELETE.
  assert.deepEqual(
    collectNotes(game.id, s.coordinator.getSnapshot().games[game.id]?.data, s.coordinator.getSnapshot().notes, s.coordinator.getSnapshot().knownNoteRefs),
    [],
  );

  // Select deleted context starts deferred GET — fence stays through pending + error.
  let failGet!: (error: PostgameError) => void;
  const getGate = new Promise<PersonalNote>((_, reject) => { failGet = reject; });
  s.port.note = async () => getGate;
  s.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextA });
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable',
    'must not replace tombstone with loading');
  assert.deepEqual(
    collectNotes(game.id, s.coordinator.getSnapshot().games[game.id]?.data, s.coordinator.getSnapshot().notes, s.coordinator.getSnapshot().knownNoteRefs),
    [],
    'no deleted text during pending GET',
  );
  assert.equal(s.sent.length, 1, 'no new create/edit/delete while fenced');

  const pending = getGate.then(() => {}, () => {});
  failGet(new PostgameError('network', 503));
  await pending;
  await Promise.resolve();
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable',
    'tombstone fence persists after read error');
  const listed = collectNotes(
    game.id,
    s.coordinator.getSnapshot().games[game.id]?.data,
    s.coordinator.getSnapshot().notes,
    s.coordinator.getSnapshot().knownNoteRefs,
  );
  assert.ok(!listed.some(n => n.text === deletedText), 'no text resurrection after GET error');
  assert.deepEqual(listed, []);
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextA, body: { expectedVersion: 0, text: 'resurrect' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'no create after tombstone');
  s.coordinator.review({ kind: 'note-delete', gameId: game.id, contextId: contextA, body: { expectedVersion: 1 } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1, 'no further delete without ready authority');
});

test('fresh never-owned GET404 refresh: loading blocks create0; error rejects; retry 404 restores; late v7 enables edit', async () => {
  const key = `${game.id}:${contextB}`;
  const emptyFeedback = { ...feedbackReady, myNotes: [] as PersonalNote[] };
  const s = setup({ note: null, results: { ...result, feedback: emptyFeedback } });
  await s.coordinator.loadResults(game.id);

  // Eligible NEW unowned context: fresh selected GET404 → create0 admitted.
  s.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextB });
  await s.coordinator.loadNote(game.id, contextB);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'unavailable');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'eligible create' } });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'note-upsert');
  s.coordinator.cancelReview();

  // Next direct GET pending: must transition loading and reject create0 (not tomb-fence fresh absence).
  let failNote!: (error: PostgameError) => void;
  let noteGate: Promise<PersonalNote> = new Promise<PersonalNote>((_, reject) => { failNote = reject; });
  s.port.note = async () => noteGate;
  const pendingFail = s.coordinator.loadNote(game.id, contextB);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'loading');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'during pending' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0, 'create0 rejected while fresh-absence refresh is loading');

  failNote(new PostgameError('network', 503));
  await pendingFail;
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'error');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'during error' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0, 'create0 rejected while fresh-absence refresh errored');

  // Explicit retry fresh404 restores create eligibility (no send — cancel after admitted review).
  s.port.note = async () => { throw new PostgameError('private', 404); };
  await s.coordinator.loadNote(game.id, contextB);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'unavailable');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'after retry 404' } });
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'note-upsert', 'fresh404 retry restores create eligibility');
  s.coordinator.cancelReview();
  assert.equal(s.sent.length, 0);

  // Separately: deferred GET that finds existing v7 enables edit7, not create0.
  let settleV7!: (value: PersonalNote) => void;
  noteGate = new Promise<PersonalNote>((resolve) => { settleV7 = resolve; });
  s.port.note = async () => noteGate;
  const pendingV7 = s.coordinator.loadNote(game.id, contextB);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'loading');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'create during v7 pending' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0, 'create0 still rejected while pending before v7');
  settleV7({
    gameId: game.id, contextId: contextB, subjectDisplay: 'Илья', text: 'off-list v7',
    version: 7, updatedAt: date, allowedActions: { canEdit: true, canDelete: true },
  });
  await pendingV7;
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().notes[key]?.data?.version, 7);
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'wrong create0' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0, 'existing v7 must not create0');
  s.coordinator.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 7, text: 'edit v7' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1);
  assert.equal((s.sent[0]!.body as { expectedVersion: number }).expectedVersion, 7);
});

test('stale deferred GET404/network must not tombstone or downgrade newer results-owned note; current 404 still hides', async () => {
  const key = `${game.id}:${contextB}`;
  const ownedV1: PersonalNote = {
    gameId: game.id, contextId: contextB, subjectDisplay: 'Илья', text: 'web-created-v1',
    version: 1, updatedAt: date, allowedActions: { canEdit: true, canDelete: true },
  };
  let failOlder!: (error: PostgameError) => void;
  const olderGate = new Promise<PersonalNote>((_, reject) => { failOlder = reject; });
  let releaseResults!: (value: Results) => void;
  const resultsGate = new Promise<Results>((resolve) => { releaseResults = resolve; });
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async () => resultsGate,
    note: async () => olderGate,
    send: async (p: Packet): Promise<unknown> => {
      sent.push(p);
      if (p.kind === 'note-upsert') {
        return {
          gameId: p.gameId, contextId: p.contextId, subjectDisplay: 'Илья',
          text: p.body.text, version: p.body.expectedVersion + 1, updatedAt: date,
          allowedActions: { canEdit: true, canDelete: true },
        };
      }
      throw new PostgameError('invalid');
    },
  };
  const c = new PostgameCoordinator(port, () => `key-${sent.length}`);
  c.setActor(actor);

  // Initial unowned contextB: older direct GET begins (will 404) before external web create.
  const older404 = c.loadNote(game.id, contextB);
  assert.equal(c.getSnapshot().notes[key]?.status, 'loading');

  // Newer results returns own note1 after that GET started; apply ready authority.
  const newerResults = c.loadResults(game.id);
  releaseResults({
    ...result,
    feedback: { ...feedbackReady, myNotes: [ownedV1] },
  });
  await newerResults;
  assert.equal(c.getSnapshot().notes[key]?.status, 'ready');
  assert.equal(c.getSnapshot().notes[key]?.data?.version, 1);
  assert.equal(c.getSnapshot().notes[key]?.data?.text, 'web-created-v1');
  assert.equal(c.getSnapshot().notes[key]?.data?.allowedActions.canEdit, true);
  assert.equal(c.getSnapshot().notes[key]?.data?.allowedActions.canDelete, true);

  // Late older private404 must not tombstone/hide the newer owned projection; create0 stays blocked.
  failOlder(new PostgameError('private', 404));
  await older404;
  assert.equal(c.getSnapshot().notes[key]?.status, 'ready');
  assert.equal(c.getSnapshot().notes[key]?.data?.version, 1);
  assert.equal(c.getSnapshot().notes[key]?.data?.text, 'web-created-v1');
  assert.equal(c.getSnapshot().notes[key]?.data?.allowedActions.canEdit, true);
  assert.equal(c.getSnapshot().notes[key]?.data?.allowedActions.canDelete, true);
  assert.ok(c.getSnapshot().knownNoteRefs[key]);
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'stale-create0' } });
  await c.confirm();
  assert.equal(sent.length, 0, 'late 404 must not unlock create0 over ready owned note');

  // Same race with older network error: must not downgrade ready rights.
  // Actor logout/rebind clears applied gens; protections stay on the new session.
  let failNet!: (error: PostgameError) => void;
  const netGate = new Promise<PersonalNote>((_, reject) => { failNet = reject; });
  let releaseResults2!: (value: Results) => void;
  const resultsGate2 = new Promise<Results>((resolve) => { releaseResults2 = resolve; });
  port.note = async () => netGate;
  port.results = async () => resultsGate2;
  c.setActor(null);
  c.setActor({ ...actor, sessionId: 'session-net-race', generation: 2 });
  assert.deepEqual(c.getSnapshot().notes, {});
  const olderNet = c.loadNote(game.id, contextB);
  const newerResults2 = c.loadResults(game.id);
  releaseResults2({
    ...result,
    feedback: { ...feedbackReady, myNotes: [ownedV1] },
  });
  await newerResults2;
  assert.equal(c.getSnapshot().notes[key]?.status, 'ready');
  failNet(new PostgameError('network', 503));
  await olderNet;
  assert.equal(c.getSnapshot().notes[key]?.status, 'ready', 'late network must not downgrade ready');
  assert.equal(c.getSnapshot().notes[key]?.data?.version, 1);
  assert.equal(c.getSnapshot().notes[key]?.data?.text, 'web-created-v1');
  assert.equal(c.getSnapshot().notes[key]?.data?.allowedActions.canEdit, true);
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 1, text: 'edit after late net' } });
  assert.equal(c.getSnapshot().review?.kind, 'note-upsert', 'ready rights preserved after late network');
  c.cancelReview();
  assert.equal(sent.length, 0);

  // Genuinely current private404 of known own note still shadows/clears and tombstones.
  port.note = async () => { throw new PostgameError('private', 404); };
  await c.loadNote(game.id, contextB);
  assert.equal(c.getSnapshot().notes[key]?.status, 'unavailable');
  assert.equal(c.getSnapshot().knownNoteRefs[key], undefined);
  assert.equal(c.getSnapshot().notes[key]?.data, undefined);
  c.review({ kind: 'note-upsert', gameId: game.id, contextId: contextB, body: { expectedVersion: 0, text: 'after current 404' } });
  await c.confirm();
  assert.equal(sent.length, 0, 'current known-note 404 must not unlock create0');
});

test('historical PUT ACK after UNKNOWN + owned GET404 tombstone settles without restoring projection', async () => {
  const secret = 'HISTORICAL-PUT-PRIVATE-TEXT';
  const key = `${game.id}:${contextA}`;
  const s = setup({
    note: { ...note, text: 'before-put', version: 1 },
    results: {
      ...result,
      feedback: { ...feedbackReady, myNotes: [{ ...note, text: 'before-put', version: 1 }] },
    },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'ready');

  // PUT commits server-side but ACK is lost → UNKNOWN with exact original packet retained.
  s.port.send = async (p) => {
    s.sent.push(p);
    if (p.kind !== 'note-upsert') throw new PostgameError('invalid');
    const next: PersonalNote = {
      gameId: p.gameId, contextId: p.contextId, subjectDisplay: 'Анна',
      text: p.body.text, version: p.body.expectedVersion + 1, updatedAt: date,
      allowedActions: { canEdit: true, canDelete: true },
    };
    s.notes.set(`${p.gameId}:${p.contextId}`, next);
    throw new PostgameError('network', 503);
  };
  s.coordinator.review({
    kind: 'note-upsert', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 1, text: secret },
  });
  await s.coordinator.confirm();
  const original = s.coordinator.getSnapshot().command!.packet;
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  assert.equal(original.kind, 'note-upsert');
  assert.equal(original.method, 'PUT');
  assert.equal(original.key, 'key-0');
  assert.equal(original.actor.actorId, actor.actorId);
  assert.ok(original.kind === 'note-upsert');
  assert.equal(original.body.text, secret);
  assert.equal(original.body.expectedVersion, 1);

  // External DELETE + current owned GET404 establishes tombstone while UNKNOWN command is retained.
  s.notes.delete(key);
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'unavailable');
  assert.equal(s.coordinator.getSnapshot().knownNoteRefs[key], undefined);
  assert.equal(s.coordinator.getSnapshot().command?.packet, original);

  // Stale results still hold prior private myNotes — collectNotes must keep them shadowed.
  assert.equal(
    s.coordinator.getSnapshot().games[game.id]?.data?.feedback?.myNotes[0]?.text,
    'before-put',
  );
  const listedBefore = collectNotes(
    game.id,
    s.coordinator.getSnapshot().games[game.id]?.data,
    s.coordinator.getSnapshot().notes,
    s.coordinator.getSnapshot().knownNoteRefs,
  );
  assert.ok(!listedBefore.some(n => n.text === secret || n.text === 'before-put'));
  assert.equal(listedBefore.length, 0);

  // Defer follow-up typed GET from reconcile so we can assert while pending.
  let failFollowup!: (error: PostgameError) => void;
  const followupGate = new Promise<PersonalNote>((_, reject) => { failFollowup = reject; });
  s.port.note = async () => followupGate;
  s.port.send = async (p) => {
    s.sent.push(p);
    // Actual historical PUT receipt for the exact original packet (version/text), not synthetic UNKNOWN injection.
    assert.equal(p, original);
    return {
      gameId: game.id, contextId: contextA, subjectDisplay: 'Анна',
      text: secret, version: 2, updatedAt: date,
      allowedActions: { canEdit: true, canDelete: true },
    };
  };
  await s.coordinator.reconcile(game.id);
  assert.equal(s.coordinator.getSnapshot().command, null, 'original command must settle');
  assert.equal(s.sent[1], original, 'reconcile retains exact original packet');
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'unavailable',
    'must not replace tombstone with loading');
  assert.equal(s.coordinator.getSnapshot().knownNoteRefs[key], undefined, 'no known ref restored');
  assert.equal(s.coordinator.getSnapshot().notes[key]?.data, undefined, 'no private text/version restored');
  const listedPending = collectNotes(
    game.id,
    s.coordinator.getSnapshot().games[game.id]?.data,
    s.coordinator.getSnapshot().notes,
    s.coordinator.getSnapshot().knownNoteRefs,
  );
  assert.ok(!listedPending.some(n => n.text === secret || n.text === 'before-put'),
    'collectNotes hides private text while follow-up GET pending');
  assert.equal(listedPending.length, 0);
  s.coordinator.review({
    kind: 'note-upsert', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 0, text: 'no-create-after-tomb' },
  });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 2, 'no new create while tombstoned');
  s.coordinator.review({
    kind: 'note-upsert', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 2, text: 'no-edit' },
  });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 2, 'no edit grant from historical ACK');
  s.coordinator.review({
    kind: 'note-delete', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 2 },
  });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 2, 'no delete grant from historical ACK');

  const followupDone = followupGate.then(() => {}, () => {});
  failFollowup(new PostgameError('network', 503));
  await followupDone;
  await Promise.resolve();
  assert.equal(s.coordinator.getSnapshot().notes[key]?.status, 'unavailable',
    'tombstone persists after follow-up GET error');
  const listedAfter = collectNotes(
    game.id,
    s.coordinator.getSnapshot().games[game.id]?.data,
    s.coordinator.getSnapshot().notes,
    s.coordinator.getSnapshot().knownNoteRefs,
  );
  assert.ok(!listedAfter.some(n => n.text === secret || n.text === 'before-put'));
  assert.equal(listedAfter.length, 0);

  // Positive post-ACK typed GET recovery + version floor still work when no tombstone.
  const recovery = setup();
  await recovery.coordinator.loadResults(game.id);
  await recovery.coordinator.loadNote(game.id, contextA);
  let releaseTyped!: (value: PersonalNote) => void;
  const typedGate = new Promise<PersonalNote>((resolve) => { releaseTyped = resolve; });
  recovery.port.note = async () => typedGate;
  recovery.coordinator.review({
    kind: 'note-upsert', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 1, text: 'recovered-body' },
  });
  await recovery.coordinator.confirm();
  assert.equal(recovery.sent.length, 1);
  assert.equal(recovery.coordinator.getSnapshot().notes[key]?.status, 'loading');
  releaseTyped({
    ...note, version: 2, text: 'recovered-body',
    allowedActions: { canEdit: true, canDelete: true },
  });
  await typedGate;
  await Promise.resolve();
  assert.equal(recovery.coordinator.getSnapshot().notes[key]?.status, 'ready');
  assert.equal(recovery.coordinator.getSnapshot().notes[key]?.data?.version, 2);
  assert.equal(recovery.coordinator.getSnapshot().notes[key]?.data?.text, 'recovered-body');
  recovery.coordinator.review({
    kind: 'note-upsert', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 2, text: 'after-typed' },
  });
  await recovery.coordinator.confirm();
  assert.equal(recovery.sent.length, 2, 'typed ready restores write authority');
});

test('confirmed delete clears selected createText prefill; unrelated context draft preserved', async () => {
  const deletedText = 'DELETE-PREFILL-PRIVATE';
  const s = setup({
    note: { ...note, text: deletedText },
    results: {
      ...result,
      feedback: { ...feedbackReady, myNotes: [{ ...note, text: deletedText }] },
    },
  });
  await s.coordinator.loadResults(game.id);
  // Select existing note → loadNote prefills createText via actual direct GET.
  s.coordinator.setNoteDraft(game.id, null, { selectedContextId: contextA });
  await s.coordinator.loadNote(game.id, contextA);
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'ready');
  assert.equal(s.coordinator.getSnapshot().noteDrafts[game.id]?.selectedContextId, contextA);
  assert.equal(s.coordinator.getSnapshot().noteDrafts[game.id]?.createText, deletedText);

  s.coordinator.review({
    kind: 'note-delete', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 1 },
  });
  await s.coordinator.confirm();
  assert.equal(s.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable');
  const draftAfter = s.coordinator.getSnapshot().noteDrafts[game.id];
  assert.equal(draftAfter?.selectedContextId, undefined, 'selection cleared');
  assert.equal(draftAfter?.createText ?? '', '', 'createText cleared — no retained private prefill');
  // Fresh results omit the note; deleted privacy text must still disappear from collectNotes.
  s.port.results = async (_a, id) => ({
    ...structuredClone(result),
    gameId: id,
    feedback: { ...feedbackReady, myNotes: [] },
  });
  await s.coordinator.loadResults(game.id);
  const listed = collectNotes(
    game.id,
    s.coordinator.getSnapshot().games[game.id]?.data,
    s.coordinator.getSnapshot().notes,
    s.coordinator.getSnapshot().knownNoteRefs,
  );
  assert.ok(!listed.some(n => n.text === deletedText), 'deleted privacy text must disappear');
  assert.equal(listed.length, 0);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.kind, 'note-delete');

  // Separate fixture: selected B dirty createText remains when A is deleted.
  const other = setup({
    note: { ...note, text: deletedText },
    results: {
      ...result,
      feedback: {
        ...feedbackReady,
        myNotes: [
          { ...note, text: deletedText },
          {
            ...note, contextId: contextB, subjectDisplay: 'Илья', text: 'other-owned',
            version: 3, allowedActions: { canEdit: true, canDelete: true },
          },
        ],
      },
    },
  });
  other.notes.set(`${game.id}:${contextB}`, {
    ...note, contextId: contextB, subjectDisplay: 'Илья', text: 'other-owned',
    version: 3, allowedActions: { canEdit: true, canDelete: true },
  });
  await other.coordinator.loadResults(game.id);
  await other.coordinator.loadNote(game.id, contextA);
  other.coordinator.setNoteDraft(game.id, null, {
    selectedContextId: contextB, createText: 'unrelated-dirty-B',
  });
  await other.coordinator.loadNote(game.id, contextB);
  assert.equal(other.coordinator.getSnapshot().noteDrafts[game.id]?.createText, 'unrelated-dirty-B');
  other.coordinator.review({
    kind: 'note-delete', gameId: game.id, contextId: contextA,
    body: { expectedVersion: 1 },
  });
  await other.coordinator.confirm();
  assert.equal(other.coordinator.getSnapshot().notes[`${game.id}:${contextA}`]?.status, 'unavailable');
  assert.equal(other.coordinator.getSnapshot().noteDrafts[game.id]?.selectedContextId, contextB);
  assert.equal(other.coordinator.getSnapshot().noteDrafts[game.id]?.createText, 'unrelated-dirty-B',
    'unrelated selected context draft must remain');
  assert.equal(other.coordinator.getSnapshot().notes[`${game.id}:${contextB}`]?.status, 'ready');
  assert.equal(other.coordinator.getSnapshot().notes[`${game.id}:${contextB}`]?.data?.text, 'other-owned');
});
