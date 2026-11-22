import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseAttendance, parseAttendanceDispute, parseAttendanceHistory, parseResolvedDispute,
  mayAcknowledge, mayAcknowledgeCurrent, wire, validateReceipt,
} from '../src/postgame.ts';
import type { Attendance, AttendanceDispute, Intent, Packet, Results } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import { game as publicGame } from './fixtures.ts';

const game = { ...publicGame, version: 1 };
const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const date = '2026-11-14T10:00:00Z';
const row: Attendance = {
  contextId: 'context-a', value: 'unknown', version: 0, late: false,
  assertion: { actorDisplay: null, source: null, at: null }, acknowledgedVersion: null, dispute: null,
  displayName: 'Игрок',
  allowedActions: { canSetAttendance: true, canAcknowledge: false, canDispute: true, canWithdrawDispute: false, canRespondDispute: false, canRequestHelp: false },
};
const marked: Attendance = {
  ...row, value: 'present', version: 1,
  assertion: { actorDisplay: 'Организатор', source: 'manager_explicit', at: date },
  allowedActions: { ...row.allowedActions, canAcknowledge: true, canDispute: true },
};
const result: Results = {
  gameId: game.id, outcome: { value: 'unknown', version: 0, reason: null, provenance: null },
  allowedActions: { canRecordOutcome: true },
  attendance: {
    installed: true, writesEnabled: true, myAttendance: marked, roster: null, rosterNextCursor: null,
    summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
    allowedActions: { canRecordAttendance: true, canBulkPresent: false },
  },
};
const openDispute: AttendanceDispute = {
  id: 'dispute-a', gameId: game.id, contextId: row.contextId, status: 'open', challengedVersion: 1,
  explanation: 'Я был на корте', version: 1, createdAt: date, updatedAt: date,
  withdrawnAt: null, withdrawReason: null, resolvedAt: null, resolutionKind: null,
  latestManagerResponse: null, helpProgress: null, caseProgress: { linked: false, status: null },
  challengedAssertion: { version: 1, value: 'present', late: false, source: 'manager_explicit', actorDisplay: 'Организатор', recordedAt: date },
  currentAssertion: { value: 'present', version: 1, late: false, assertion: marked.assertion },
  history: [{ version: 1, action: 'opened', explanation: 'Я был на корте', recordedAt: date }],
  allowedActions: { canWithdraw: true, canRespond: false, canRequestHelp: true, canAcknowledgeCurrent: true },
};
function packet(intent: Intent): Packet {
  const w = wire(intent);
  return { ...intent, actor, key: 'original-key', method: w.method, path: w.path };
}
function setup(overrides: Partial<AttendanceDispute> = {}) {
  const detail = { ...openDispute, ...overrides, allowedActions: { ...openDispute.allowedActions, ...(overrides.allowedActions ?? {}) },
    currentAssertion: overrides.currentAssertion ?? openDispute.currentAssertion,
    caseProgress: overrides.caseProgress ?? openDispute.caseProgress };
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string) => ({
      ...structuredClone(result), gameId: id,
      attendance: {
        ...result.attendance!,
        myAttendance: { ...marked, dispute: { id: detail.id, status: 'open' as const, challengedVersion: detail.challengedVersion, version: detail.version } },
      },
    }),
    dispute: async () => structuredClone(detail),
    history: async () => ({ items: [{ version: 1, before: null, after: { value: 'present' as const, late: false }, reason: null, source: 'manager_explicit' as const, recordedAt: date, actorDisplay: 'Организатор' }] }),
    send: async (p: Packet): Promise<unknown> => { sent.push(p); throw new PostgameError('network'); },
  };
  const coordinator = new PostgameCoordinator(port, () => `key-${sent.length}`);
  coordinator.setActor(actor);
  return { coordinator, port, sent, detail };
}

test('missing-mark challengedVersion 0 accepted; ordinary parse still rejects resolvedDispute', () => {
  const missing = parseAttendance({
    ...row, dispute: { id: 'dispute-missing', status: 'open', challengedVersion: 0, version: 1 },
  });
  assert.equal(missing.dispute?.challengedVersion, 0);
  assert.throws(() => parseAttendance({ ...marked, resolvedDispute: { id: 'x', resultingVersion: 2, status: 'resolved', contextId: row.contextId, attendanceVersion: 1 } }), PostgameError);
  const dispute = parseAttendanceDispute({ ...openDispute, challengedVersion: 0, challengedAssertion: null, currentAssertion: { value: 'unknown', version: 0, late: false, assertion: { actorDisplay: null, source: null, at: null } } });
  assert.equal(dispute.challengedVersion, 0);
  assert.equal(dispute.currentAssertion.version, 0);
});

test('participant open dispute, withdraw does not agree, help stays requested, resolving ACK needs receipt', () => {
  const create = packet({ kind: 'dispute', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 0, explanation: 'Нет отметки' } });
  const created = parseAttendanceDispute({
    ...openDispute, challengedVersion: 0, challengedAssertion: null, explanation: 'Нет отметки',
    currentAssertion: { value: 'unknown', version: 0, late: false, assertion: { actorDisplay: null, source: null, at: null } },
    allowedActions: { canWithdraw: true, canRespond: false, canRequestHelp: true, canAcknowledgeCurrent: false },
  });
  assert.equal(validateReceipt(created, create).status, 'open');

  const withdrawn = packet({ kind: 'withdraw', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1 } });
  assert.equal(validateReceipt({ ...openDispute, status: 'withdrawn', version: 2, withdrawnAt: date }, withdrawn).status, 'withdrawn');
  assert.equal(mayAcknowledge({ ...marked, dispute: { id: 'dispute-a', status: 'withdrawn', challengedVersion: 1, version: 2 }, acknowledgedVersion: null }), true);

  const help = packet({ kind: 'help', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1, explanation: 'Нужна помощь' } });
  const helped = validateReceipt({ ...openDispute, version: 2, helpProgress: 'requested', history: [...openDispute.history, { version: 2, action: 'help_requested', explanation: 'Нужна помощь', recordedAt: date }] }, help);
  assert.equal(helped.helpProgress, 'requested');
  assert.equal(helped.caseProgress.linked, false);

  const resolving: Intent = { kind: 'ack', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 1, resolvingDisputeId: 'dispute-a', expectedDisputeVersion: 1 } };
  assert.throws(() => wire({ ...resolving, body: { attendanceVersion: 1, resolvingDisputeId: 'dispute-a' } }), PostgameError);
  assert.throws(() => validateReceipt({ ...marked, acknowledgedVersion: 1, dispute: null }, packet(resolving)), PostgameError);
  const closed = validateReceipt({
    ...marked, acknowledgedVersion: 1, dispute: null,
    resolvedDispute: { id: 'dispute-a', resultingVersion: 2, status: 'resolved', contextId: row.contextId, attendanceVersion: 1 },
  }, packet(resolving));
  assert.equal(closed.acknowledgedVersion, 1);
  assert.deepEqual(parseResolvedDispute((closed as Attendance & { resolvedDispute: unknown }).resolvedDispute!), {
    id: 'dispute-a', resultingVersion: 2, status: 'resolved', contextId: row.contextId, attendanceVersion: 1,
  });
});

test('manager respond+correction stays open; wrong id/context/version rejected', () => {
  const respond: Intent = {
    kind: 'respond', gameId: game.id, disputeId: 'dispute-a',
    body: {
      expectedVersion: 1, explanation: 'Исправляю',
      correction: { expectedAttendanceVersion: 1, value: 'absent', correctionReason: 'Ошибка' },
    },
  };
  const receipt = validateReceipt({
    ...openDispute, version: 2, latestManagerResponse: 'Исправляю',
    currentAssertion: { value: 'absent', version: 2, late: false, assertion: marked.assertion },
  }, packet(respond));
  assert.equal(receipt.status, 'open');
  assert.equal(receipt.currentAssertion.version, 2);
  assert.throws(() => validateReceipt({ ...openDispute, id: 'other', version: 2, latestManagerResponse: 'Исправляю' }, packet(respond)), PostgameError);
  assert.throws(() => validateReceipt({ ...openDispute, version: 9, latestManagerResponse: 'Исправляю' }, packet(respond)), PostgameError);
});

test('coordinator: open dispute blocks ordinary attendance but allows respond/ack from selected detail', async () => {
  const s = setup({ allowedActions: { canWithdraw: false, canRespond: true, canRequestHelp: false, canAcknowledgeCurrent: true } });
  await s.coordinator.loadResults(game.id);
  s.coordinator.review({ kind: 'attendance', gameId: game.id, contextId: row.contextId, body: { expectedVersion: 1, value: 'absent', correctionReason: 'нет' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0);

  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  assert.equal(s.coordinator.getSnapshot().disputes['dispute-a']?.status, 'ready');
  assert.ok(mayAcknowledgeCurrent(s.coordinator.getSnapshot().disputes['dispute-a']!.data!));

  s.port.send = async p => { s.sent.push(p); return { ...s.detail, version: 2, latestManagerResponse: 'ок' }; };
  s.coordinator.review({ kind: 'respond', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1, explanation: 'ок' } });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]?.path, '/attendance-disputes/dispute-a/responses');
});

test('selection change retires other draft; roster append keeps selection; late dispute read is fenced', async () => {
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.coordinator.setDraft(game.id, row.contextId, 'dispute-a', { respondExplanation: 'черновик A' });
  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  s.coordinator.selectDispute({ gameId: game.id, contextId: 'context-b', disputeId: 'dispute-b' });
  assert.equal(s.coordinator.getSnapshot().drafts[`${game.id}:${row.contextId}:dispute-a`], undefined);

  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  const second = { ...marked, contextId: 'context-b', displayName: 'Другой' };
  s.port.results = async (_a, id, query) => ({
    ...structuredClone(result), gameId: id,
    attendance: {
      ...result.attendance!,
      myAttendance: { ...marked, dispute: { id: 'dispute-a', status: 'open', challengedVersion: 1, version: 1 } },
      roster: query?.rosterCursor ? [second] : [{ ...marked, dispute: { id: 'dispute-a', status: 'open', challengedVersion: 1, version: 1 } }],
      rosterNextCursor: query?.rosterCursor ? null : 'roster-2',
    },
  });
  await s.coordinator.loadResults(game.id);
  await s.coordinator.loadResults(game.id, { rosterCursor: 'roster-2' }, 'roster');
  assert.equal(s.coordinator.getSnapshot().selection?.disputeId, 'dispute-a');

  const deferred = (() => { let resolve!: (v: AttendanceDispute) => void; const promise = new Promise<AttendanceDispute>(r => { resolve = r; }); return { resolve, promise }; })();
  s.port.dispute = async () => deferred.promise;
  const stale = s.coordinator.loadDispute('dispute-a');
  s.coordinator.setActor({ ...actor, actorId: 'actor-b', generation: 2 });
  deferred.resolve(openDispute);
  await stale;
  assert.deepEqual(s.coordinator.getSnapshot().disputes, {});
});

test('UNKNOWN exact retry, no autowrite, draft preserved across cancel/reauth', async () => {
  const s = setup({ allowedActions: { canWithdraw: true, canRespond: false, canRequestHelp: false, canAcknowledgeCurrent: false } });
  await s.coordinator.loadResults(game.id);
  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  s.coordinator.setDraft(game.id, row.contextId, 'dispute-a', { respondExplanation: 'сохранить' });
  s.port.send = async p => { s.sent.push(p); throw new PostgameError('network'); };
  s.coordinator.review({ kind: 'withdraw', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1 } });
  const originalReview = s.coordinator.getSnapshot().review;
  s.coordinator.cancelReview();
  assert.equal(s.coordinator.getSnapshot().drafts[`${game.id}:${row.contextId}:dispute-a`]?.respondExplanation, 'сохранить');
  s.coordinator.review(originalReview!);
  await s.coordinator.confirm();
  const original = s.sent[0]!;
  assert.equal(s.coordinator.getSnapshot().command?.status, 'unknown');
  s.coordinator.setActor(null);
  s.coordinator.setActor({ ...actor, sessionId: 'session-b', generation: 2 });
  assert.equal(s.coordinator.getSnapshot().command?.packet, original);
  assert.equal(s.sent.length, 1);
  s.port.send = async p => { s.sent.push(p); return { ...openDispute, status: 'withdrawn', version: 2, withdrawnAt: date }; };
  await s.coordinator.reconcile(game.id);
  assert.equal(s.sent[1], original);
});

test('history bounded page; private error stays retryable; wire rejects incomplete resolving pair', async () => {
  assert.deepEqual(parseAttendanceHistory({ items: [] }), { items: [] });
  const s = setup();
  await s.coordinator.loadResults(game.id);
  s.port.history = async () => { throw new PostgameError('private', 404); };
  await s.coordinator.loadHistory(game.id, row.contextId, 20);
  assert.equal(s.coordinator.getSnapshot().histories[`${game.id}:${row.contextId}`]?.status, 'unavailable');
  s.port.history = async () => ({ items: [] });
  await s.coordinator.loadHistory(game.id, row.contextId, 20);
  assert.equal(s.coordinator.getSnapshot().histories[`${game.id}:${row.contextId}`]?.status, 'ready');

  const api = createNativeApi(async () => new Response(JSON.stringify(openDispute), { status: 201 }));
  const p = packet({ kind: 'dispute', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 1, explanation: 'спор' } });
  const body = await api.postgameMutation('token', p);
  assert.equal(parseAttendanceDispute(body).id, 'dispute-a');
  assert.throws(() => wire({ kind: 'ack', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 1, expectedDisputeVersion: 1 } }), PostgameError);
});

test('ordinary ACK still rejects open dispute and self-authored cannot use mayAcknowledgeCurrent alone', () => {
  assert.equal(mayAcknowledge({ ...marked, dispute: { id: 'dispute-a', status: 'open', challengedVersion: 1, version: 1 } }), false);
  const self = parseAttendanceDispute({
    ...openDispute,
    currentAssertion: { value: 'present', version: 1, late: false, assertion: { actorDisplay: 'Я', source: 'self_attested', at: date } },
    allowedActions: { canWithdraw: true, canRespond: false, canRequestHelp: true, canAcknowledgeCurrent: false },
  });
  assert.equal(mayAcknowledgeCurrent(self), false);
  assert.equal(mayAcknowledgeCurrent(openDispute), true);
});
