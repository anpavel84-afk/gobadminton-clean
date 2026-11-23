import type { Actor } from './participation.ts';
import { canonicalPostgamePath } from './native-auth-protocol.ts';

export class PostgameError extends Error {
  readonly kind: 'invalid' | 'network' | 'business' | 'private' | 'stale';
  readonly status: number; readonly code: string;
  constructor(kind: PostgameError['kind'], status = 0, code = '') { super(kind); this.kind=kind; this.status=status; this.code=code; }
}
export type AttendanceValue = 'present' | 'absent' | 'unknown';
export type Attendance = {
  contextId: string; value: AttendanceValue; version: number; late: boolean;
  assertion: { actorDisplay: string | null; source: 'manager_explicit' | 'self_attested' | 'case_reviewer' | null; at: string | null };
  acknowledgedVersion: number | null;
  dispute: { id: string; status: 'open' | 'withdrawn' | 'resolved'; challengedVersion: number; version: number } | null;
  displayName: string;
  allowedActions: { canSetAttendance: boolean; canAcknowledge: boolean; canDispute: boolean; canWithdrawDispute: boolean; canRespondDispute: boolean; canRequestHelp: boolean };
};
export type ResolvedDispute = {
  id: string; resultingVersion: number; status: 'resolved'; contextId: string; attendanceVersion: number;
};
export type AttendanceDisputeHistoryItem = {
  version: number;
  action: 'opened' | 'withdrawn' | 'manager_responded' | 'manager_corrected' | 'party_acknowledged' | 'help_requested' | 'case_linked' | 'reviewer_resolved' | 'left_open_insufficient_evidence';
  explanation: string | null; recordedAt: string;
};
export type AttendanceDispute = {
  id: string; gameId: string; contextId: string; status: 'open' | 'withdrawn' | 'resolved';
  challengedVersion: number; explanation: string; version: number;
  createdAt: string; updatedAt: string;
  withdrawnAt: string | null; withdrawReason: string | null;
  resolvedAt: string | null; resolutionKind: string | null;
  latestManagerResponse: string | null;
  helpProgress: 'requested' | 'case_opened' | 'in_review' | 'awaiting_information' | 'resolved' | 'left_open_insufficient_evidence' | null;
  caseProgress: { linked: boolean; status: AttendanceDispute['helpProgress'] };
  challengedAssertion: { version: number; value: AttendanceValue; late: boolean; source: 'manager_explicit' | 'self_attested' | 'case_reviewer'; actorDisplay: string; recordedAt: string } | null;
  currentAssertion: { value: AttendanceValue; version: number; late: boolean; assertion: Attendance['assertion'] };
  history: AttendanceDisputeHistoryItem[];
  allowedActions: { canWithdraw: boolean; canRespond: boolean; canRequestHelp: boolean; canAcknowledgeCurrent: boolean };
};
export type AttendanceHistoryItem = {
  version: number;
  before: { value: AttendanceValue; late: boolean } | null;
  after: { value: AttendanceValue; late: boolean };
  reason: string | null; source: 'manager_explicit' | 'self_attested' | 'case_reviewer';
  recordedAt: string; actorDisplay: string;
};
export type AttendanceHistoryPage = { items: AttendanceHistoryItem[] };
export type Revision = { version: number; before: { value: 'held' | 'not_held'; reason: string | null } | null; after: { value: 'held' | 'not_held'; reason: string | null }; reason: string | null; source: 'manager_explicit'; recordedAt: string };
/** Own personal note — notes projection only; never public review/report fields. */
export type PersonalNote = {
  gameId: string; contextId: string; subjectDisplay: string; text: string; version: number; updatedAt: string;
  allowedActions: { canEdit: boolean; canDelete: boolean };
};
export type NoteDeleteReceipt = { gameId: string; contextId: string; version: number; deleted: true };
/** Narrow feedback slice consumed by native notes — not full private review surface. */
export type FeedbackNotes = {
  installed: boolean; writesEnabled: boolean;
  capabilities: { canCreateNote: boolean; peerSubjects: { contextId: string; displayName: string }[] };
  myNotes: PersonalNote[];
};
export type Results = {
  gameId: string;
  outcome: { value: 'unknown' | 'held' | 'not_held'; version: number; reason: string | null; provenance: { source: 'manager_explicit'; recordedAt: string; createdAt: string } | null };
  revisions?: Revision[]; revisionsNextCursor?: string | null;
  attendance?: { installed: boolean; writesEnabled: boolean; myAttendance: Attendance | null; roster: Attendance[] | null; rosterNextCursor: string | null;
    summary: { rosterCount: number; marked: number; unknown: number; underClarification: number; agreed: number } | null;
    allowedActions: { canRecordAttendance: boolean; canBulkPresent: boolean } };
  feedback?: FeedbackNotes;
  allowedActions: { canRecordOutcome: boolean; canRecordAttendance?: boolean; canBulkPresent?: boolean };
};
export type OwnResult = { gameId: string; contextId: string; gameTitle: string | null; endsAt: string | null; attendance: Attendance;
  notice: { id: string; attendanceVersion: number; value: AttendanceValue; late: boolean; source: 'manager_explicit' | 'self_attested' | 'case_reviewer'; actorDisplay: string; createdAt: string; acknowledgedAt: string | null } | null };
export type OwnResults = { items: OwnResult[]; nextCursor: string | null };
export type Reminder = { id: string; gameId: string; gameTitle: string | null; endsAt: string; ordinal: 1 | 2 | 3; version: number; state: 'visible'; dueAt: string; visibleAt: string; resultsPath: string; allowedActions: { canOpenResults: boolean; canLater: boolean } };
export type Reminders = { items: Reminder[]; writesEnabled: boolean; installed: boolean };
export type ResultsQuery = { revisionsLimit?: number; revisionsCursor?: string; rosterLimit?: number; rosterCursor?: string };
export type DisputeCorrection = { expectedAttendanceVersion: number; value: AttendanceValue; late?: boolean; correctionReason: string };
export type Intent =
  | { kind: 'outcome'; gameId: string; body: { expectedVersion: number; outcome: 'held' | 'not_held'; reason?: string } }
  | { kind: 'attendance'; gameId: string; contextId: string; body: { expectedVersion: number; value: AttendanceValue; late?: boolean; correctionReason?: string } }
  | { kind: 'bulk'; gameId: string; body: { items: { contextId: string; expectedVersion: number }[]; confirmedExactSelection: true } }
  | { kind: 'ack'; gameId: string; contextId: string; body: { attendanceVersion: number; resolvingDisputeId?: string; expectedDisputeVersion?: number } }
  | { kind: 'dispute'; gameId: string; contextId: string; body: { attendanceVersion: number; explanation: string } }
  | { kind: 'withdraw'; gameId: string; disputeId: string; body: { expectedVersion: number; reason?: string } }
  | { kind: 'respond'; gameId: string; disputeId: string; body: { expectedVersion: number; explanation: string; correction?: DisputeCorrection } }
  | { kind: 'help'; gameId: string; disputeId: string; body: { expectedVersion: number; explanation: string } }
  | { kind: 'later'; gameId: string; reminderId: string; body: { command: 'later'; expectedVersion: number } }
  | { kind: 'note-upsert'; gameId: string; contextId: string; body: { expectedVersion: number; text: string } }
  | { kind: 'note-delete'; gameId: string; contextId: string; body: { expectedVersion: number } };
export type Packet = Readonly<Intent & { actor: Actor; key: string; method: 'PUT' | 'POST' | 'DELETE'; path: string }>;
/** ACK mutation receipt; resolvedDispute is ACK-only proof, never an ordinary Attendance read field. */
export type AckReceipt = Attendance & { resolvedDispute?: ResolvedDispute };
export type Receipt = Results | AckReceipt | AttendanceDispute | PersonalNote | NoteDeleteReceipt | { items: Attendance[] } | Reminders;
const invalid = (): never => { throw new PostgameError('invalid'); };
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function str(v: unknown): string { return typeof v === 'string' ? v : invalid(); }
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : invalid(); }
function num(v: unknown, min = 0): number { return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647 ? v : invalid(); }
function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null { return v === null ? null : parse(v); }
function choice<T extends string>(v: unknown, values: readonly T[]): T { for (const item of values) if (v === item) return item; return invalid(); }
function array<T>(v: unknown, parse: (v: unknown) => T): T[] { return Array.isArray(v) ? v.map(parse) : invalid(); }
function time(v: unknown): string { const value = str(v); return Number.isFinite(Date.parse(value)) ? value : invalid(); }
export function postgameId(v: unknown): string { const id = str(v); return /^[A-Za-z0-9_-]{1,128}$/.exec(id)?.[0] === id ? id : invalid(); }
function hasControl(value: string): boolean { return Array.from(value).some(char => { const code = char.charCodeAt(0); return code <= 31 || code === 127; }); }
/** Adapt ordinary multiline form input before review; retain other controls for wire rejection. */
export function normalizeFormReason(value: string): string {
  const normalized = value.replace(/\r\n|\r|\n/g, ' ');
  // trim() would silently remove leading/trailing tabs and some other C0 characters.
  return hasControl(normalized) ? normalized : normalized.trim();
}
export function cursor(v: unknown): string { const value = str(v); return value.length > 0 && value.length <= 2048 && !/\s/.test(value) && !hasControl(value) ? value : invalid(); }
const sources = ['manager_explicit', 'self_attested', 'case_reviewer'] as const;
const values = ['present', 'absent', 'unknown'] as const;
const helpStates = ['requested', 'case_opened', 'in_review', 'awaiting_information', 'resolved', 'left_open_insufficient_evidence'] as const;
const disputeActions = ['opened', 'withdrawn', 'manager_responded', 'manager_corrected', 'party_acknowledged', 'help_requested', 'case_linked', 'reviewer_resolved', 'left_open_insufficient_evidence'] as const;
function assertion(v: unknown): Attendance['assertion'] {
  const a = object(v);
  return { actorDisplay: nullable(a.actorDisplay, str), source: nullable(a.source, v => choice(v, sources)), at: nullable(a.at, time) };
}
export function parseResolvedDispute(v: unknown): ResolvedDispute {
  const r = object(v);
  return { id: postgameId(r.id), resultingVersion: num(r.resultingVersion, 1), status: choice(r.status, ['resolved'] as const),
    contextId: postgameId(r.contextId), attendanceVersion: num(r.attendanceVersion, 1) };
}
export function parseAttendance(v: unknown): Attendance {
  const r = object(v), rights = object(r.allowedActions);
  const dispute = r.dispute === null ? null : object(r.dispute);
  const result: Attendance = { contextId: postgameId(r.contextId), value: choice(r.value, values), version: num(r.version), late: bool(r.late),
    assertion: assertion(r.assertion),
    acknowledgedVersion: nullable(r.acknowledgedVersion, v => num(v, 1)), displayName: str(r.displayName),
    // Missing-mark clarifications use challengedVersion 0 from the authoritative server row.
    dispute: dispute ? { id: postgameId(dispute.id), status: choice(dispute.status, ['open','withdrawn','resolved']), challengedVersion: num(dispute.challengedVersion), version: num(dispute.version, 1) } : null,
    allowedActions: { canSetAttendance: bool(rights.canSetAttendance), canAcknowledge: bool(rights.canAcknowledge), canDispute: bool(rights.canDispute), canWithdrawDispute: bool(rights.canWithdrawDispute), canRespondDispute: bool(rights.canRespondDispute), canRequestHelp: bool(rights.canRequestHelp) } };
  if (result.late && result.value !== 'present' || (result.acknowledgedVersion ?? 0) > result.version || (result.version === 0 && (result.value !== 'unknown' || result.assertion.source !== null))) invalid();
  // Ordinary reads/mutations never carry ACK-only resolvedDispute receipts.
  if (r.resolvedDispute !== undefined) invalid();
  return result;
}
function parseAttendanceAckBody(v: unknown, expectResolved: boolean): AckReceipt {
  const r = object(v);
  const resolved = r.resolvedDispute;
  if (expectResolved) {
    if (resolved === undefined) invalid();
    // Strip ACK-only proof before ordinary Attendance parse (which still rejects resolvedDispute).
    const rest: Record<string, unknown> = { ...r };
    delete rest.resolvedDispute;
    return { ...parseAttendance(rest), resolvedDispute: parseResolvedDispute(resolved) };
  }
  if (resolved !== undefined) invalid();
  return parseAttendance(r);
}
export function parseAttendanceDispute(v: unknown): AttendanceDispute {
  const r = object(v), rights = object(r.allowedActions), caseProgress = object(r.caseProgress);
  const challenged = r.challengedAssertion === null ? null : object(r.challengedAssertion);
  const current = object(r.currentAssertion);
  const result: AttendanceDispute = {
    id: postgameId(r.id), gameId: postgameId(r.gameId), contextId: postgameId(r.contextId),
    status: choice(r.status, ['open','withdrawn','resolved']), challengedVersion: num(r.challengedVersion),
    explanation: str(r.explanation), version: num(r.version, 1),
    createdAt: time(r.createdAt), updatedAt: time(r.updatedAt),
    withdrawnAt: nullable(r.withdrawnAt, time), withdrawReason: nullable(r.withdrawReason, str),
    resolvedAt: nullable(r.resolvedAt, time), resolutionKind: nullable(r.resolutionKind, str),
    latestManagerResponse: nullable(r.latestManagerResponse, str),
    helpProgress: nullable(r.helpProgress, v => choice(v, helpStates)),
    caseProgress: { linked: bool(caseProgress.linked), status: nullable(caseProgress.status, v => choice(v, helpStates)) },
    challengedAssertion: challenged ? {
      version: num(challenged.version, 1), value: choice(challenged.value, values), late: bool(challenged.late),
      source: choice(challenged.source, sources), actorDisplay: str(challenged.actorDisplay), recordedAt: time(challenged.recordedAt),
    } : null,
    currentAssertion: { value: choice(current.value, values), version: num(current.version), late: bool(current.late), assertion: assertion(current.assertion) },
    history: array(r.history, item => {
      const h = object(item);
      return { version: num(h.version, 1), action: choice(h.action, disputeActions), explanation: nullable(h.explanation, str), recordedAt: time(h.recordedAt) };
    }),
    allowedActions: { canWithdraw: bool(rights.canWithdraw), canRespond: bool(rights.canRespond), canRequestHelp: bool(rights.canRequestHelp), canAcknowledgeCurrent: bool(rights.canAcknowledgeCurrent) },
  };
  if (result.currentAssertion.late && result.currentAssertion.value !== 'present') invalid();
  if (result.challengedVersion === 0 && result.challengedAssertion !== null) invalid();
  if (result.challengedVersion > 0 && result.challengedAssertion && result.challengedAssertion.version !== result.challengedVersion) invalid();
  // version 0 only encodes a missing mark; a saved unknown row keeps its positive version.
  if (result.currentAssertion.version === 0 && (result.currentAssertion.value !== 'unknown' || result.currentAssertion.assertion.source !== null)) invalid();
  return result;
}
export function parseAttendanceHistory(v: unknown): AttendanceHistoryPage {
  const r = object(v);
  return { items: array(r.items, item => {
    const h = object(item);
    const after = object(h.after);
    return {
      version: num(h.version, 1),
      before: nullable(h.before, b => { const row = object(b); return { value: choice(row.value, values), late: bool(row.late) }; }),
      after: { value: choice(after.value, values), late: bool(after.late) },
      reason: nullable(h.reason, str), source: choice(h.source, sources), recordedAt: time(h.recordedAt), actorDisplay: str(h.actorDisplay),
    };
  }) };
}
function outcomeFact(v: unknown) { const r = object(v); return { value: choice(r.value, ['held','not_held'] as const), reason: nullable(r.reason, str) }; }
export function parsePersonalNote(v: unknown): PersonalNote {
  const r = object(v), rights = object(r.allowedActions);
  const note: PersonalNote = {
    gameId: postgameId(r.gameId), contextId: postgameId(r.contextId), subjectDisplay: str(r.subjectDisplay),
    text: str(r.text), version: num(r.version, 1), updatedAt: time(r.updatedAt),
    allowedActions: { canEdit: bool(rights.canEdit), canDelete: bool(rights.canDelete) },
  };
  if (!note.subjectDisplay.trim() || note.subjectDisplay.length > 80) invalid();
  if (!note.text.trim() || note.text.length > 500 || hasControl(note.text)) invalid();
  return note;
}
export function parseNoteDeleteReceipt(v: unknown): NoteDeleteReceipt {
  const r = object(v);
  if (r.deleted !== true) invalid();
  return { gameId: postgameId(r.gameId), contextId: postgameId(r.contextId), version: num(r.version, 1), deleted: true };
}
function parseFeedbackNotes(v: unknown, gameId: string): FeedbackNotes {
  const r = object(v), caps = object(r.capabilities);
  // Consume only notes caps/projection — ignore unimplemented review/report fields.
  const myNotes = array(r.myNotes ?? [], parsePersonalNote);
  const seen = new Set<string>();
  for (const note of myNotes) {
    // Nested wrong-game or duplicate context is malformed under the current contract.
    if (note.gameId !== gameId || seen.has(note.contextId)) invalid();
    seen.add(note.contextId);
  }
  return {
    installed: bool(r.installed), writesEnabled: bool(r.writesEnabled),
    capabilities: {
      canCreateNote: bool(caps.canCreateNote),
      peerSubjects: array(caps.peerSubjects ?? [], item => {
        const s = object(item);
        const displayName = str(s.displayName);
        if (!displayName.trim() || displayName.length > 80) invalid();
        return { contextId: postgameId(s.contextId), displayName };
      }),
    },
    myNotes,
  };
}
export function parseResults(v: unknown): Results {
  const r = object(v), o = object(r.outcome), a = object(r.allowedActions), p = o.provenance === null ? null : object(o.provenance);
  const result: Results = { gameId: postgameId(r.gameId), outcome: { value: choice(o.value, ['held','not_held','unknown']), version: num(o.version), reason: nullable(o.reason, str), provenance: p ? { source: choice(p.source, ['manager_explicit']), recordedAt: time(p.recordedAt), createdAt: time(p.createdAt) } : null },
    allowedActions: { canRecordOutcome: bool(a.canRecordOutcome), ...(a.canRecordAttendance === undefined ? {} : { canRecordAttendance: bool(a.canRecordAttendance) }), ...(a.canBulkPresent === undefined ? {} : { canBulkPresent: bool(a.canBulkPresent) }) } };
  if ((result.outcome.version === 0) !== (result.outcome.value === 'unknown') || (result.outcome.version > 0 && !p)) invalid();
  if (r.revisions !== undefined) result.revisions = array(r.revisions, v => { const r = object(v); return { version: num(r.version,1), before: nullable(r.before,outcomeFact), after: outcomeFact(r.after), reason: nullable(r.reason,str), source: choice(r.source,['manager_explicit']), recordedAt: time(r.recordedAt) }; });
  if (r.revisionsNextCursor !== undefined) result.revisionsNextCursor = nullable(r.revisionsNextCursor,cursor);
  if (r.attendance !== undefined) {
    const t = object(r.attendance), rights = object(t.allowedActions), s = t.summary === null ? null : object(t.summary);
    result.attendance = { installed: bool(t.installed), writesEnabled: bool(t.writesEnabled), myAttendance: nullable(t.myAttendance,parseAttendance), roster: nullable(t.roster,v => array(v,parseAttendance)), rosterNextCursor: nullable(t.rosterNextCursor,cursor),
      summary: s ? { rosterCount: num(s.rosterCount), marked: num(s.marked), unknown: num(s.unknown), underClarification: num(s.underClarification), agreed: num(s.agreed) } : null,
      allowedActions: { canRecordAttendance: bool(rights.canRecordAttendance), canBulkPresent: bool(rights.canBulkPresent) } };
  }
  // Older servers may omit feedback; absent/installed=false disables Notes honestly without breaking outcome/attendance.
  if (r.feedback !== undefined) result.feedback = parseFeedbackNotes(r.feedback, result.gameId);
  return result;
}
export function parseOwnResults(v: unknown): OwnResults {
  const r = object(v); return { nextCursor: nullable(r.nextCursor,cursor), items: array(r.items,v => {
    const r = object(v), attendance = parseAttendance(r.attendance), n = r.notice === null ? null : object(r.notice);
    const contextId = postgameId(r.contextId); if (attendance.contextId !== contextId) invalid();
    return { gameId: postgameId(r.gameId), contextId, gameTitle: nullable(r.gameTitle,str), endsAt: nullable(r.endsAt,time), attendance,
      notice: n ? { id: postgameId(n.id), attendanceVersion: num(n.attendanceVersion,1), value: choice(n.value,values), late: bool(n.late), source: choice(n.source,sources), actorDisplay: str(n.actorDisplay), createdAt: time(n.createdAt), acknowledgedAt: nullable(n.acknowledgedAt,time) } : null };
  }) };
}
export function parseReminders(v: unknown): Reminders {
  const r = object(v); return { writesEnabled: bool(r.writesEnabled), installed: bool(r.installed), items: array(r.items,v => {
    const r = object(v), a = object(r.allowedActions), gameId = postgameId(r.gameId), resultsPath = str(r.resultsPath);
    if (resultsPath !== `/my-games/${gameId}/results` || !canonicalPostgamePath(resultsPath)) invalid();
    const ordinal = num(r.ordinal,1); if (ordinal !== 1 && ordinal !== 2 && ordinal !== 3) return invalid();
    return { id: postgameId(r.id), gameId, gameTitle: nullable(r.gameTitle,str), endsAt: time(r.endsAt), ordinal, version: num(r.version,1), state: choice(r.state,['visible']), dueAt: time(r.dueAt), visibleAt: time(r.visibleAt), resultsPath,
      allowedActions: { canOpenResults: bool(a.canOpenResults), canLater: bool(a.canLater) } };
  }) };
}
function exact(r: Record<string,unknown>, keys: string[]) { if (Object.keys(r).some(k => !keys.includes(k))) invalid(); }
function reason(v: unknown): string { const s = str(v); return s === s.trim() && s.length > 0 && s.length <= 500 && !hasControl(s) ? s : invalid(); }
export function noteText(v: unknown): string {
  const s = str(v);
  return s === s.trim() && s.length > 0 && s.length <= 500 && !hasControl(s) ? s : invalid();
}
export function wire(packet: Intent): { method: 'PUT' | 'POST' | 'DELETE'; path: string; body: Intent['body'] } {
  if (packet.kind === 'note-upsert' || packet.kind === 'note-delete') {
    const gameId = postgameId(packet.gameId), contextId = postgameId(packet.contextId), body = object(packet.body);
    if (packet.kind === 'note-upsert') {
      exact(body, ['expectedVersion', 'text']); num(body.expectedVersion); noteText(body.text);
      return { method: 'PUT', path: `/games/${gameId}/notes/${contextId}`, body: packet.body };
    }
    exact(body, ['expectedVersion']); num(body.expectedVersion, 1);
    return { method: 'DELETE', path: `/games/${gameId}/notes/${contextId}`, body: packet.body };
  }
  if (packet.kind === 'withdraw' || packet.kind === 'respond' || packet.kind === 'help') {
    const disputeId = postgameId(packet.disputeId), body = object(packet.body);
    if (packet.kind === 'withdraw') {
      exact(body,['expectedVersion','reason']); num(body.expectedVersion,1); if (body.reason !== undefined) reason(body.reason);
      return { method:'POST', path:`/attendance-disputes/${disputeId}/withdraw`, body:packet.body };
    }
    if (packet.kind === 'help') {
      exact(body,['expectedVersion','explanation']); num(body.expectedVersion,1); reason(body.explanation);
      return { method:'POST', path:`/attendance-disputes/${disputeId}/help`, body:packet.body };
    }
    exact(body,['expectedVersion','explanation','correction']); num(body.expectedVersion,1); reason(body.explanation);
    if (body.correction !== undefined) {
      const c = object(body.correction); exact(c,['expectedAttendanceVersion','value','late','correctionReason']);
      num(c.expectedAttendanceVersion); choice(c.value,values); if (c.late !== undefined) bool(c.late);
      if (c.late && c.value !== 'present') invalid(); reason(c.correctionReason);
    }
    return { method:'POST', path:`/attendance-disputes/${disputeId}/responses`, body:packet.body };
  }
  const gameId = postgameId(packet.gameId), body = object(packet.body);
  if (packet.kind === 'outcome') {
    exact(body,['expectedVersion','outcome','reason']); num(body.expectedVersion); choice(body.outcome,['held','not_held']);
    if (body.reason !== undefined) reason(body.reason); if ((Number(body.expectedVersion) > 0 || body.outcome === 'not_held') && !body.reason) invalid();
    return { method:'PUT', path:`/games/${gameId}/outcome`, body:packet.body };
  }
  if (packet.kind === 'attendance') {
    exact(body,['expectedVersion','value','late','correctionReason']); const version = num(body.expectedVersion); choice(body.value,values);
    if (body.late !== undefined) bool(body.late); if (body.late && body.value !== 'present' || body.value === 'unknown' && version === 0) invalid();
    if (version > 0) reason(body.correctionReason); else if (body.correctionReason !== undefined) invalid();
    return { method:'PUT', path:`/games/${gameId}/attendance/${postgameId(packet.contextId)}`, body:packet.body };
  }
  if (packet.kind === 'bulk') {
    exact(body,['items','confirmedExactSelection']); const items = body.items;
    if (body.confirmedExactSelection !== true || !Array.isArray(items) || items.length < 1 || items.length > 100) return invalid();
    const seen = new Set<string>(); for (const item of items) { const r = object(item); exact(r,['contextId','expectedVersion']); const id = postgameId(r.contextId); num(r.expectedVersion); if (seen.has(id)) invalid(); seen.add(id); }
    return { method:'POST',path:`/games/${gameId}/attendance/bulk-present`,body:packet.body };
  }
  if (packet.kind === 'ack') {
    exact(body,['attendanceVersion','resolvingDisputeId','expectedDisputeVersion']); num(body.attendanceVersion,1);
    const hasId = body.resolvingDisputeId !== undefined, hasVer = body.expectedDisputeVersion !== undefined;
    if (hasId !== hasVer) invalid();
    if (hasId) { postgameId(body.resolvingDisputeId); num(body.expectedDisputeVersion,1); }
    return { method:'POST',path:`/games/${gameId}/attendance/${postgameId(packet.contextId)}/acknowledgements`,body:packet.body };
  }
  if (packet.kind === 'dispute') {
    exact(body,['attendanceVersion','explanation']); num(body.attendanceVersion); reason(body.explanation);
    return { method:'POST',path:`/games/${gameId}/attendance/${postgameId(packet.contextId)}/disputes`,body:packet.body };
  }
  exact(body,['command','expectedVersion']); if (packet.kind !== 'later' || body.command !== 'later') invalid(); num(body.expectedVersion,1);
  return { method:'POST',path:`/me/postgame-reminders/${postgameId(packet.reminderId)}`,body:packet.body };
}
export function resultsQuery(query: ResultsQuery = {}): string {
  exact(object(query),['revisionsLimit','revisionsCursor','rosterLimit','rosterCursor']);
  const p = new URLSearchParams();
  for (const name of ['revisionsLimit','rosterLimit'] as const) if (query[name] !== undefined) { const n = num(query[name],1); if (n > (name === 'rosterLimit' ? 100 : 50)) invalid(); p.set(name,String(n)); }
  for (const name of ['revisionsCursor','rosterCursor'] as const) if (query[name] !== undefined) p.set(name,cursor(query[name]));
  return p.size ? `?${p}` : '';
}
export function historyQuery(limit?: number): string {
  if (limit === undefined) return '';
  const n = num(limit, 1); if (n > 50) invalid();
  return `?limit=${n}`;
}
export const attendanceLabel = (v: AttendanceValue) => v === 'present' ? 'Пришёл' : v === 'absent' ? 'Не пришёл' : 'Не отмечено';
/** Server canAcknowledge encodes source AND actor_user_id=user_id; display names cannot establish authorship. */
export function mayAcknowledge(row: Attendance) { return row.allowedActions.canAcknowledge && row.value !== 'unknown' && row.version > 0 && row.acknowledgedVersion !== row.version && row.dispute?.status !== 'open'; }
/** Closing an open dispute requires the dispute projection rights, not the roster summary alone. */
export function mayAcknowledgeCurrent(dispute: AttendanceDispute) {
  return dispute.status === 'open' && dispute.allowedActions.canAcknowledgeCurrent
    && dispute.currentAssertion.value !== 'unknown' && dispute.currentAssertion.version > 0;
}
export function needsAttention(row: OwnResult) { return !!row.notice && !row.notice.acknowledgedAt && row.notice.source !== 'self_attested' && row.notice.attendanceVersion === row.attendance.version; }
/**
 * Resolving-ACK consent must mirror the frozen body against authoritative dispute detail
 * (attendanceVersion + resolvingDisputeId + expectedDisputeVersion + game/context).
 * Stale roster rows are never a substitute; mismatch/unavailable → null (honest refresh, no confirm).
 */
export function resolvingAckAssertion(
  intent: Extract<Intent, { kind: 'ack' }>,
  detail: AttendanceDispute | null | undefined,
): { value: AttendanceValue; late: boolean; version: number; disputeId: string; disputeVersion: number } | null {
  const disputeId = intent.body.resolvingDisputeId;
  const expectedDisputeVersion = intent.body.expectedDisputeVersion;
  if (disputeId === undefined || expectedDisputeVersion === undefined) return null;
  if (!detail) return null;
  if (detail.id !== disputeId || detail.gameId !== intent.gameId || detail.contextId !== intent.contextId) return null;
  if (detail.version !== expectedDisputeVersion) return null;
  if (detail.currentAssertion.version !== intent.body.attendanceVersion) return null;
  return {
    value: detail.currentAssertion.value,
    late: detail.currentAssertion.late,
    version: detail.currentAssertion.version,
    disputeId: detail.id,
    disputeVersion: detail.version,
  };
}
/**
 * Attendance history entry points: own card is independent of open/withdrawn/resolved disputes
 * (accepted WEB parity). Clarification remains an extra lane for a selected open dispute.
 */
export function attendanceHistoryLanes(
  results: Results,
  openSelection: { gameId: string; contextId: string } | null,
): { own: { gameId: string; contextId: string } | null; clarification: { gameId: string; contextId: string } | null } {
  const my = results.attendance?.installed ? results.attendance.myAttendance : null;
  return {
    own: my ? { gameId: results.gameId, contextId: my.contextId } : null,
    clarification: openSelection && openSelection.gameId === results.gameId
      ? { gameId: openSelection.gameId, contextId: openSelection.contextId }
      : null,
  };
}
/**
 * Notes section: installed=false shows honest disable; canCreateNote or own notes
 * (results list or known direct GET) show the lane. Absent feedback stays hidden.
 * Missing/idle known own refs must still mount so the recovery effect can direct-GET.
 */
export function notesSectionVisible(
  gameId: string,
  data: Results | undefined,
  notes: Record<string, { status: string; data?: PersonalNote }>,
  known: Record<string, { gameId: string; contextId: string }>,
): boolean {
  const feedback = data?.feedback;
  if (feedback?.installed === false) return true;
  if (feedback?.capabilities.canCreateNote) return true;
  if ((feedback?.myNotes.length ?? 0) > 0) return true;
  for (const ref of Object.values(known)) {
    if (ref.gameId !== gameId) continue;
    const source = notes[`${ref.gameId}:${ref.contextId}`];
    if (source?.status === 'ready' && source.data) return true;
    if (source?.status === 'loading' || source?.status === 'error') return true;
    // Same-account reauth restores refs with notes{}; mount recovery before GET settles.
    if (!source || source.status === 'idle') return true;
  }
  return false;
}
/**
 * Own-note subject choices: prefer current attendance roster (accepted web parity).
 * peerSubjects stay peer-review eligibility — nonempty peers must not hide absent/disputed roster rows.
 * Empty roster falls back to peerSubjects; does not widen server create/review caps.
 */
export function noteSubjectOptions(
  data: Results | undefined,
): { contextId: string; displayName: string }[] {
  const roster = data?.attendance?.roster ?? [];
  if (roster.length > 0) {
    return roster.map(r => ({ contextId: r.contextId, displayName: r.displayName }));
  }
  return data?.feedback?.capabilities.peerSubjects ?? [];
}
/**
 * Per-note conflict/error refresh visibility — used by NoteCard outside the editing branch
 * so DELETE VERSION_CONFLICT can recover while reviewing (editing=false, typed ready).
 */
export function noteConflictRefreshVisible(
  notice: string | null | undefined,
  directStatus: string | undefined,
): boolean {
  return !!(notice && /Обновите заметку/i.test(notice)) || directStatus === 'error';
}
/**
 * Display composition for NotesSection — definitive unavailable shadows stale myNotes;
 * ready/loading/error direct data may show retained private text (writes still typed-ready only).
 */
export function collectNotes(
  gameId: string,
  data: Results | undefined,
  notes: Record<string, { status: string; data?: PersonalNote }>,
  known: Record<string, { gameId: string; contextId: string }>,
): PersonalNote[] {
  const byContext = new Map<string, PersonalNote>();
  for (const note of data?.feedback?.myNotes ?? []) {
    const direct = notes[`${gameId}:${note.contextId}`];
    // Definitive unavailable/denied shadows stale bounded myNotes for that context.
    if (direct?.status === 'unavailable') continue;
    byContext.set(note.contextId, note);
  }
  for (const ref of Object.values(known)) {
    if (ref.gameId !== gameId) continue;
    const source = notes[`${ref.gameId}:${ref.contextId}`];
    // Ready is authoritative; loading/error may retain private text for display only (no write grant).
    if (source?.data && (source.status === 'ready' || source.status === 'loading' || source.status === 'error')) {
      byContext.set(source.data.contextId, source.data);
    }
  }
  return [...byContext.values()];
}
export function validateReceipt(raw: unknown, p: Packet): Receipt {
  if (p.kind === 'note-upsert') {
    const r = parsePersonalNote(raw);
    if (r.gameId !== p.gameId || r.contextId !== p.contextId || r.version !== p.body.expectedVersion + 1 || r.text !== p.body.text) invalid();
    return r;
  }
  if (p.kind === 'note-delete') {
    const r = parseNoteDeleteReceipt(raw);
    // Fresh delete returns expectedVersion+1; already-tombstoned success returns the current
    // tomb version without increment (may be higher after concurrent web edit/delete).
    // parseNoteDeleteReceipt already enforces deleted:true and strict positive bounded version.
    if (r.gameId !== p.gameId || r.contextId !== p.contextId || r.deleted !== true || r.version < p.body.expectedVersion + 1) invalid();
    return r;
  }
  if (p.kind === 'outcome') { const r = parseResults(raw); if (r.gameId !== p.gameId || r.outcome.version !== p.body.expectedVersion + 1 || r.outcome.value !== p.body.outcome || r.outcome.reason !== (p.body.reason ?? null)) invalid(); return r; }
  if (p.kind === 'later') { const r = parseReminders(raw); const target = r.items.find(r => r.id === p.reminderId); if (target) invalid(); return r; }
  if (p.kind === 'bulk') {
    const r = object(raw), items = array(r.items,parseAttendance); if (items.length !== p.body.items.length || new Set(items.map(r=>r.contextId)).size !== items.length) invalid();
    for (const wanted of p.body.items) { const row = items.find(r=>r.contextId === wanted.contextId); if (!row || row.version !== wanted.expectedVersion + 1 || row.value !== 'present' || row.late) invalid(); } return {items};
  }
  if (p.kind === 'dispute' || p.kind === 'withdraw' || p.kind === 'respond' || p.kind === 'help') {
    const r = parseAttendanceDispute(raw);
    if (p.kind === 'dispute') {
      if (r.gameId !== p.gameId || r.contextId !== p.contextId || r.status !== 'open' || r.challengedVersion !== p.body.attendanceVersion || r.explanation !== p.body.explanation || r.version !== 1) invalid();
      return r;
    }
    if (r.id !== p.disputeId || r.version !== p.body.expectedVersion + 1) invalid();
    if (p.kind === 'withdraw') { if (r.status !== 'withdrawn') invalid(); }
    else if (p.kind === 'respond') { if (r.status !== 'open' || r.latestManagerResponse !== p.body.explanation) invalid(); }
    else if (r.status !== 'open' || r.helpProgress !== 'requested') invalid();
    return r;
  }
  const resolving = p.kind === 'ack' && p.body.resolvingDisputeId !== undefined && p.body.expectedDisputeVersion !== undefined;
  if (p.kind === 'ack') {
    const r = parseAttendanceAckBody(raw, resolving);
    if (r.contextId !== p.contextId) invalid();
    if (r.version !== p.body.attendanceVersion || r.acknowledgedVersion !== p.body.attendanceVersion || r.value === 'unknown') invalid();
    if (resolving) {
      const receipt = r.resolvedDispute!;
      if (receipt.id !== p.body.resolvingDisputeId || receipt.resultingVersion !== p.body.expectedDisputeVersion! + 1
        || receipt.status !== 'resolved' || receipt.contextId !== p.contextId || receipt.attendanceVersion !== p.body.attendanceVersion
        || r.dispute?.status === 'open') invalid();
    } else if (r.dispute?.status === 'open' || r.resolvedDispute) invalid();
    return r;
  }
  const r = parseAttendance(raw); if (r.contextId !== p.contextId) invalid();
  if (r.version !== p.body.expectedVersion + 1 || r.value !== p.body.value || r.late !== (p.body.late ?? false)) invalid();
  return r;
}
