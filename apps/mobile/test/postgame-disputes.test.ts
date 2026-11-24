import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import {
  PostgameError, parseAttendance, parseAttendanceDispute, parseAttendanceHistory, parseResolvedDispute,
  mayAcknowledge, mayAcknowledgeCurrent, wire, validateReceipt,
  resolvingAckAssertion, attendanceHistoryLanes, attendanceLabel,
} from '../src/postgame.ts';
import type { AckReceipt, Attendance, AttendanceDispute, Intent, Packet, Receipt, Results, ResultsQuery } from '../src/postgame.ts';
import type { Actor } from '../src/participation.ts';
import { game as publicGame } from './fixtures.ts';

const read = (path: string) => readFileSync(new NodeURL(path, import.meta.url), 'utf8');

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
function asDisputeReceipt(raw: unknown, p: Packet): AttendanceDispute {
  const r: Receipt = validateReceipt(raw, p);
  if (!('history' in r) || !('helpProgress' in r) || !('caseProgress' in r)) throw new PostgameError('invalid');
  return r;
}
function asAckReceipt(raw: unknown, p: Packet): AckReceipt {
  const r: Receipt = validateReceipt(raw, p);
  if (!('acknowledgedVersion' in r) || !('displayName' in r) || 'history' in r) throw new PostgameError('invalid');
  return r;
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
    results: async (_a: Actor, id: string): Promise<Results> => ({
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
  assert.equal(asDisputeReceipt(created, create).status, 'open');

  const withdrawn = packet({ kind: 'withdraw', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1 } });
  assert.equal(asDisputeReceipt({ ...openDispute, status: 'withdrawn', version: 2, withdrawnAt: date }, withdrawn).status, 'withdrawn');
  assert.equal(mayAcknowledge({ ...marked, dispute: { id: 'dispute-a', status: 'withdrawn', challengedVersion: 1, version: 2 }, acknowledgedVersion: null }), true);

  const help = packet({ kind: 'help', gameId: game.id, disputeId: 'dispute-a', body: { expectedVersion: 1, explanation: 'Нужна помощь' } });
  const helped = asDisputeReceipt({ ...openDispute, version: 2, helpProgress: 'requested', history: [...openDispute.history, { version: 2, action: 'help_requested', explanation: 'Нужна помощь', recordedAt: date }] }, help);
  assert.equal(helped.helpProgress, 'requested');
  assert.equal(helped.caseProgress.linked, false);

  const resolving: Intent = { kind: 'ack', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 1, resolvingDisputeId: 'dispute-a', expectedDisputeVersion: 1 } };
  assert.throws(() => wire({ ...resolving, body: { attendanceVersion: 1, resolvingDisputeId: 'dispute-a' } }), PostgameError);
  assert.throws(() => validateReceipt({ ...marked, acknowledgedVersion: 1, dispute: null }, packet(resolving)), PostgameError);
  const closed = asAckReceipt({
    ...marked, acknowledgedVersion: 1, dispute: null,
    resolvedDispute: { id: 'dispute-a', resultingVersion: 2, status: 'resolved', contextId: row.contextId, attendanceVersion: 1 },
  }, packet(resolving));
  assert.equal(closed.acknowledgedVersion, 1);
  assert.deepEqual(parseResolvedDispute(closed.resolvedDispute!), {
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
  const receipt = asDisputeReceipt({
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
  s.port.results = async (_a: Actor, id: string, query?: ResultsQuery): Promise<Results> => ({
    ...structuredClone(result), gameId: id,
    attendance: {
      ...result.attendance!,
      myAttendance: { ...marked, dispute: { id: 'dispute-a', status: 'open' as const, challengedVersion: 1, version: 1 } },
      roster: query?.rosterCursor ? [second] : [{ ...marked, dispute: { id: 'dispute-a', status: 'open' as const, challengedVersion: 1, version: 1 } }],
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

test('resolving ACK success stays distinct from followup GET failure; no fake resolved metadata; refresh operable', async () => {
  const s = setup({ allowedActions: { canWithdraw: false, canRespond: false, canRequestHelp: false, canAcknowledgeCurrent: true } });
  await s.coordinator.loadResults(game.id);
  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  assert.equal(s.coordinator.getSnapshot().disputes['dispute-a']?.status, 'ready');

  s.port.send = async (p: Packet): Promise<unknown> => {
    s.sent.push(p);
    return {
      ...marked, acknowledgedVersion: 1, dispute: null,
      resolvedDispute: { id: 'dispute-a', resultingVersion: 2, status: 'resolved', contextId: row.contextId, attendanceVersion: 1 },
    };
  };
  s.port.dispute = async () => { throw new PostgameError('network'); };

  s.coordinator.review({
    kind: 'ack', gameId: game.id, contextId: row.contextId,
    body: { attendanceVersion: 1, resolvingDisputeId: 'dispute-a', expectedDisputeVersion: 1 },
  });
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 1);
  assert.equal(s.coordinator.getSnapshot().command, null);

  // Follow-up loadDispute is fire-and-forget after ACK; wait for the distinct read failure.
  for (let i = 0; i < 20 && s.coordinator.getSnapshot().disputes['dispute-a']?.status !== 'error'; i += 1) {
    await new Promise<void>(r => setImmediate(r));
  }
  const afterAck = s.coordinator.getSnapshot().disputes['dispute-a'];
  // ACK settled; follow-up read failed separately — never synthesize 1970/resolvedAt or regress rights from receipt.
  assert.equal(afterAck?.status, 'error');
  assert.notEqual(afterAck?.data?.resolvedAt, new Date(0).toISOString());
  assert.notEqual(afterAck?.data?.status, 'resolved');

  s.port.dispute = async (): Promise<AttendanceDispute> => ({
    ...openDispute, status: 'resolved', version: 2, resolvedAt: date, resolutionKind: 'party_acknowledged',
    allowedActions: { canWithdraw: false, canRespond: false, canRequestHelp: false, canAcknowledgeCurrent: false },
  });
  await s.coordinator.loadDispute('dispute-a');
  const refreshed = s.coordinator.getSnapshot().disputes['dispute-a'];
  assert.equal(refreshed?.status, 'ready');
  assert.equal(refreshed?.data?.status, 'resolved');
  assert.equal(refreshed?.data?.resolvedAt, date);
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

test('resolving ACK review selector uses matching detail not stale roster; later mismatch cannot confirm', async () => {
  const absentV1: Attendance = {
    ...marked, value: 'absent', version: 1,
    dispute: { id: 'dispute-a', status: 'open', challengedVersion: 1, version: 1 },
  };
  const detailPresentV2: AttendanceDispute = {
    ...openDispute, version: 2,
    currentAssertion: { value: 'present', version: 2, late: false, assertion: marked.assertion },
    history: [...openDispute.history, { version: 2, action: 'manager_corrected', explanation: 'исправил', recordedAt: date }],
    allowedActions: { canWithdraw: false, canRespond: false, canRequestHelp: false, canAcknowledgeCurrent: true },
  };
  const frozen: Intent = {
    kind: 'ack', gameId: game.id, contextId: row.contextId,
    body: { attendanceVersion: 2, resolvingDisputeId: 'dispute-a', expectedDisputeVersion: 2 },
  };
  // Stale roster says absent v1; authoritative matching detail says present v2 — consent must follow detail.
  assert.equal(absentV1.value, 'absent');
  assert.equal(attendanceLabel(absentV1.value), 'Не пришёл');
  const match = resolvingAckAssertion(frozen, detailPresentV2);
  assert.deepEqual(match, { value: 'present', late: false, version: 2, disputeId: 'dispute-a', disputeVersion: 2 });
  assert.equal(attendanceLabel(match!.value), 'Пришёл');
  assert.equal(resolvingAckAssertion(frozen, openDispute), null);
  assert.equal(resolvingAckAssertion(frozen, undefined), null);
  assert.equal(resolvingAckAssertion({
    kind: 'ack', gameId: game.id, contextId: row.contextId, body: { attendanceVersion: 1 },
  }, detailPresentV2), null);

  const s = setup({
    ...detailPresentV2,
    allowedActions: detailPresentV2.allowedActions,
    currentAssertion: detailPresentV2.currentAssertion,
    history: detailPresentV2.history,
  });
  s.port.results = async (_a: Actor, id: string): Promise<Results> => ({
    ...structuredClone(result), gameId: id,
    attendance: {
      ...result.attendance!,
      myAttendance: absentV1,
      roster: [absentV1],
      rosterNextCursor: null,
    },
  });
  await s.coordinator.loadResults(game.id);
  s.coordinator.selectDispute({ gameId: game.id, contextId: row.contextId, disputeId: 'dispute-a' });
  await new Promise<void>(r => setImmediate(r));
  assert.equal(s.coordinator.getSnapshot().disputes['dispute-a']?.data?.currentAssertion.value, 'present');
  s.coordinator.review(frozen);
  assert.equal(s.coordinator.getSnapshot().review?.kind, 'ack');
  assert.deepEqual(
    resolvingAckAssertion(s.coordinator.getSnapshot().review as Extract<Intent, { kind: 'ack' }>, s.coordinator.getSnapshot().disputes['dispute-a']!.data),
    match,
  );

  // Detail advances after freeze — projection no longer matches; confirm must not send wrong fact.
  const detailV3 = {
    ...detailPresentV2, version: 3,
    currentAssertion: { value: 'absent' as const, version: 3, late: false, assertion: marked.assertion },
  };
  s.port.dispute = async () => structuredClone(detailV3);
  await s.coordinator.loadDispute('dispute-a');
  assert.equal(resolvingAckAssertion(frozen, s.coordinator.getSnapshot().disputes['dispute-a']!.data), null);
  s.port.send = async p => { s.sent.push(p); return marked; };
  await s.coordinator.confirm();
  assert.equal(s.sent.length, 0);
  assert.equal(s.coordinator.getSnapshot().review, null);
});

test('manager page-two draft survives first-page refresh then reload', async () => {
  const page1 = { ...marked, contextId: 'context-page1', displayName: 'Участник 1', dispute: null,
    allowedActions: { ...marked.allowedActions, canRespondDispute: true } };
  const page2 = {
    ...marked, contextId: 'context-b', displayName: 'Участник 2',
    dispute: { id: 'dispute-b', status: 'open' as const, challengedVersion: 1, version: 1 },
    allowedActions: { ...marked.allowedActions, canRespondDispute: true, canSetAttendance: false },
  };
  const detailB: AttendanceDispute = {
    ...openDispute, id: 'dispute-b', contextId: 'context-b',
    allowedActions: { canWithdraw: false, canRespond: true, canRequestHelp: false, canAcknowledgeCurrent: false },
  };
  const sent: Packet[] = [];
  const port = {
    own: async () => ({ items: [], nextCursor: null }),
    reminders: async () => ({ items: [], installed: true, writesEnabled: true }),
    invitations: async () => ({ items: [], nextCursor: null }),
    results: async (_a: Actor, id: string, query?: ResultsQuery): Promise<Results> => ({
      ...structuredClone(result), gameId: id,
      attendance: {
        ...result.attendance!,
        // Manager projection: no own row hiding the page-two gap.
        myAttendance: null,
        roster: query?.rosterCursor ? [page2] : [page1],
        rosterNextCursor: query?.rosterCursor ? null : 'roster-2',
        summary: { rosterCount: 2, marked: 2, unknown: 0, underClarification: 1, agreed: 0 },
        allowedActions: { canRecordAttendance: true, canBulkPresent: false },
      },
    }),
    dispute: async () => structuredClone(detailB),
    history: async () => ({ items: [] }),
    send: async (p: Packet): Promise<unknown> => { sent.push(p); throw new PostgameError('network'); },
  };
  const coordinator = new PostgameCoordinator(port, () => `key-${sent.length}`);
  coordinator.setActor(actor);
  await coordinator.loadResults(game.id);
  await coordinator.loadResults(game.id, { rosterCursor: 'roster-2', rosterLimit: 50 }, 'roster');
  assert.equal(coordinator.getSnapshot().games[game.id]?.data?.attendance?.roster?.length, 2);
  coordinator.selectDispute({ gameId: game.id, contextId: 'context-b', disputeId: 'dispute-b' });
  await new Promise<void>(r => setImmediate(r));
  coordinator.setDraft(game.id, 'context-b', 'dispute-b', { respondExplanation: 'ответ со второй страницы' });
  assert.equal(coordinator.getSnapshot().drafts[`${game.id}:context-b:dispute-b`]?.respondExplanation, 'ответ со второй страницы');

  // First-page refresh omits page-two row — draft and selection must survive.
  await coordinator.loadResults(game.id);
  assert.equal(coordinator.getSnapshot().games[game.id]?.data?.attendance?.roster?.map(r => r.contextId).join(','), 'context-page1');
  assert.equal(coordinator.getSnapshot().drafts[`${game.id}:context-b:dispute-b`]?.respondExplanation, 'ответ со второй страницы');
  assert.equal(coordinator.getSnapshot().selection?.disputeId, 'dispute-b');

  await coordinator.loadResults(game.id, { rosterCursor: 'roster-2', rosterLimit: 50 }, 'roster');
  assert.equal(coordinator.getSnapshot().games[game.id]?.data?.attendance?.roster?.length, 2);
  assert.equal(coordinator.getSnapshot().drafts[`${game.id}:context-b:dispute-b`]?.respondExplanation, 'ответ со второй страницы');
  assert.equal(coordinator.getSnapshot().selection?.disputeId, 'dispute-b');
});

test('own attendance history lane stays reachable after closed dispute; core history read works', async () => {
  const closedOwn: Attendance = {
    ...marked,
    dispute: { id: 'dispute-a', status: 'withdrawn', challengedVersion: 1, version: 2 },
  };
  const closedResults: Results = {
    ...result,
    attendance: {
      ...result.attendance!,
      myAttendance: closedOwn,
      roster: null,
      rosterNextCursor: null,
      summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
    },
  };
  const lanes = attendanceHistoryLanes(closedResults, null);
  assert.deepEqual(lanes.own, { gameId: game.id, contextId: row.contextId });
  assert.equal(lanes.clarification, null);
  // Open selection on another context still keeps own lane (composition reachability, not string mirror).
  const withOther = attendanceHistoryLanes(closedResults, { gameId: game.id, contextId: 'context-b' });
  assert.deepEqual(withOther.own, { gameId: game.id, contextId: row.contextId });
  assert.deepEqual(withOther.clarification, { gameId: game.id, contextId: 'context-b' });

  const s = setup();
  s.port.results = async (_a: Actor, id: string): Promise<Results> => ({ ...structuredClone(closedResults), gameId: id });
  await s.coordinator.loadResults(game.id);
  assert.equal(s.coordinator.getSnapshot().games[game.id]?.data?.attendance?.myAttendance?.dispute?.status, 'withdrawn');
  s.port.history = async () => ({
    items: [{
      version: 1, before: null, after: { value: 'present' as const, late: false },
      reason: null, source: 'manager_explicit' as const, recordedAt: date, actorDisplay: 'Организатор',
    }],
  });
  await s.coordinator.loadHistory(game.id, row.contextId, 20);
  const history = s.coordinator.getSnapshot().histories[`${game.id}:${row.contextId}`];
  assert.equal(history?.status, 'ready');
  assert.equal(history?.data?.items.length, 1);
  assert.equal(history?.data?.items[0]?.after.value, 'present');
});

test('#522 APK42 ClarificationSection layout reveal wiring — no measure loop; open/closed availability from fresh results', () => {
  const ui = read('../src/components/postgame-disputes.tsx');
  const results = read('../app/my-games/[gameId]/results.tsx');
  assert.match(ui, /export function ClarificationSection/);
  assert.match(ui, /sectionRef\?:/);
  assert.match(ui, /onSectionLayout\?:/);
  assert.match(ui, /collapsable=\{false\}/);
  assert.match(ui, /onLayout=\{reportSectionLayout\}/);
  assert.match(ui, /accessibilityRole="header"/);
  assert.match(ui, /Нет открытого уточнения по вашей отметке/);
  assert.doesNotMatch(ui, /measureLayout/);
  assert.doesNotMatch(ui, /requestAnimationFrame/);
  // Section never auto-writes disputes — only selectDispute for single open row.
  assert.match(ui, /owner\.selectDispute/);
  assert.doesNotMatch(ui, /owner\.review\(\{[\s\S]*kind: 'dispute'/);

  assert.match(results, /ClarificationSection key=\{`\$\{actor\}:\$\{gameId\}:clarify`\}/);
  assert.match(results, /sectionRef=\{clarificationAnchor\}/);
  assert.match(results, /onSectionLayout=\{onClarificationLayout\}/);
  assert.match(results, /showClarification=\!\!data\?\.attendance\?\.installed/);
  // Fresh results decide availability — route params never carry disputeId/contextId.
  assert.doesNotMatch(results, /params\.disputeId|params\.contextId/);
  assert.doesNotMatch(results, /section=clarification.*ACK|auto.*withdraw/i);
});
