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
export type Revision = { version: number; before: { value: 'held' | 'not_held'; reason: string | null } | null; after: { value: 'held' | 'not_held'; reason: string | null }; reason: string | null; source: 'manager_explicit'; recordedAt: string };
export type Results = {
  gameId: string;
  outcome: { value: 'unknown' | 'held' | 'not_held'; version: number; reason: string | null; provenance: { source: 'manager_explicit'; recordedAt: string; createdAt: string } | null };
  revisions?: Revision[]; revisionsNextCursor?: string | null;
  attendance?: { installed: boolean; writesEnabled: boolean; myAttendance: Attendance | null; roster: Attendance[] | null; rosterNextCursor: string | null;
    summary: { rosterCount: number; marked: number; unknown: number; underClarification: number; agreed: number } | null;
    allowedActions: { canRecordAttendance: boolean; canBulkPresent: boolean } };
  allowedActions: { canRecordOutcome: boolean; canRecordAttendance?: boolean; canBulkPresent?: boolean };
};
export type OwnResult = { gameId: string; contextId: string; gameTitle: string | null; endsAt: string | null; attendance: Attendance;
  notice: { id: string; attendanceVersion: number; value: AttendanceValue; late: boolean; source: 'manager_explicit' | 'self_attested' | 'case_reviewer'; actorDisplay: string; createdAt: string; acknowledgedAt: string | null } | null };
export type OwnResults = { items: OwnResult[]; nextCursor: string | null };
export type Reminder = { id: string; gameId: string; gameTitle: string | null; endsAt: string; ordinal: 1 | 2 | 3; version: number; state: 'visible'; dueAt: string; visibleAt: string; resultsPath: string; allowedActions: { canOpenResults: boolean; canLater: boolean } };
export type Reminders = { items: Reminder[]; writesEnabled: boolean; installed: boolean };
export type ResultsQuery = { revisionsLimit?: number; revisionsCursor?: string; rosterLimit?: number; rosterCursor?: string };
export type Intent =
  | { kind: 'outcome'; gameId: string; body: { expectedVersion: number; outcome: 'held' | 'not_held'; reason?: string } }
  | { kind: 'attendance'; gameId: string; contextId: string; body: { expectedVersion: number; value: AttendanceValue; late?: boolean; correctionReason?: string } }
  | { kind: 'bulk'; gameId: string; body: { items: { contextId: string; expectedVersion: number }[]; confirmedExactSelection: true } }
  | { kind: 'ack'; gameId: string; contextId: string; body: { attendanceVersion: number } }
  | { kind: 'later'; gameId: string; reminderId: string; body: { command: 'later'; expectedVersion: number } };
export type Packet = Readonly<Intent & { actor: Actor; key: string; method: 'PUT' | 'POST'; path: string }>;
export type Receipt = Results | Attendance | { items: Attendance[] } | Reminders;
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
export function cursor(v: unknown): string { const value = str(v); return value.length > 0 && value.length <= 2048 && !/\s/.test(value) && !hasControl(value) ? value : invalid(); }
const sources = ['manager_explicit', 'self_attested', 'case_reviewer'] as const;
const values = ['present', 'absent', 'unknown'] as const;
export function parseAttendance(v: unknown): Attendance {
  const r = object(v), a = object(r.assertion), rights = object(r.allowedActions);
  const dispute = r.dispute === null ? null : object(r.dispute);
  const result: Attendance = { contextId: postgameId(r.contextId), value: choice(r.value, values), version: num(r.version), late: bool(r.late),
    assertion: { actorDisplay: nullable(a.actorDisplay, str), source: nullable(a.source, v => choice(v, sources)), at: nullable(a.at, time) },
    acknowledgedVersion: nullable(r.acknowledgedVersion, v => num(v, 1)), displayName: str(r.displayName),
    dispute: dispute ? { id: postgameId(dispute.id), status: choice(dispute.status, ['open','withdrawn','resolved']), challengedVersion: num(dispute.challengedVersion, 1), version: num(dispute.version, 1) } : null,
    allowedActions: { canSetAttendance: bool(rights.canSetAttendance), canAcknowledge: bool(rights.canAcknowledge), canDispute: bool(rights.canDispute), canWithdrawDispute: bool(rights.canWithdrawDispute), canRespondDispute: bool(rights.canRespondDispute), canRequestHelp: bool(rights.canRequestHelp) } };
  if (result.late && result.value !== 'present' || (result.acknowledgedVersion ?? 0) > result.version || (result.version === 0 && (result.value !== 'unknown' || result.assertion.source !== null))) invalid();
  // This core never resolves a dispute as a side effect of acknowledgement.
  if (r.resolvedDispute !== undefined) invalid();
  return result;
}
function outcomeFact(v: unknown) { const r = object(v); return { value: choice(r.value, ['held','not_held'] as const), reason: nullable(r.reason, str) }; }
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
  // Feedback is a separate owner and is deliberately not retained by this core.
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
export function wire(packet: Intent): { method: 'PUT' | 'POST'; path: string; body: Intent['body'] } {
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
  if (packet.kind === 'ack') { exact(body,['attendanceVersion']); num(body.attendanceVersion,1); return { method:'POST',path:`/games/${gameId}/attendance/${postgameId(packet.contextId)}/acknowledgements`,body:packet.body }; }
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
export const attendanceLabel = (v: AttendanceValue) => v === 'present' ? 'Пришёл' : v === 'absent' ? 'Не пришёл' : 'Не отмечено';
/** Server canAcknowledge encodes source AND actor_user_id=user_id; display names cannot establish authorship. */
export function mayAcknowledge(row: Attendance) { return row.allowedActions.canAcknowledge && row.value !== 'unknown' && row.version > 0 && row.acknowledgedVersion !== row.version && row.dispute?.status !== 'open'; }
export function needsAttention(row: OwnResult) { return !!row.notice && !row.notice.acknowledgedAt && row.notice.source !== 'self_attested' && row.notice.attendanceVersion === row.attendance.version; }
export function validateReceipt(raw: unknown, p: Packet): Receipt {
  if (p.kind === 'outcome') { const r = parseResults(raw); if (r.gameId !== p.gameId || r.outcome.version !== p.body.expectedVersion + 1 || r.outcome.value !== p.body.outcome || r.outcome.reason !== (p.body.reason ?? null)) invalid(); return r; }
  if (p.kind === 'later') { const r = parseReminders(raw); const target = r.items.find(r => r.id === p.reminderId); if (target) invalid(); return r; }
  if (p.kind === 'bulk') {
    const r = object(raw), items = array(r.items,parseAttendance); if (items.length !== p.body.items.length || new Set(items.map(r=>r.contextId)).size !== items.length) invalid();
    for (const wanted of p.body.items) { const row = items.find(r=>r.contextId === wanted.contextId); if (!row || row.version !== wanted.expectedVersion + 1 || row.value !== 'present' || row.late) invalid(); } return {items};
  }
  const r = parseAttendance(raw); if (r.contextId !== p.contextId) invalid();
  if (p.kind === 'ack') { if (r.version !== p.body.attendanceVersion || r.acknowledgedVersion !== p.body.attendanceVersion || r.value === 'unknown' || r.dispute?.status === 'open') invalid(); }
  else if (r.version !== p.body.expectedVersion + 1 || r.value !== p.body.value || r.late !== (p.body.late ?? false)) invalid();
  return r;
}
