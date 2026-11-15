import type { UnifiedActivation, UnifiedFilters, UnifiedSnapshot, UnifiedMapSnapshot, UnifiedRow, UnifiedPreview, UnifiedGeo, UnifiedDistance, UnifiedStatus, UnifiedQuery, UnifiedMapQuery, UnifiedStart, UnifiedTakeover, UnifiedUpdate, UnifiedRenew, UnifiedHeartbeat } from '../../../packages/contracts/src/unified.generated.ts';
import type { Actor } from './participation.ts';
import type { PublicPlayer } from './players.ts';
import { parsePlayer } from './players.ts';
export type { UnifiedRow, UnifiedPreview, UnifiedActivation, UnifiedFilters };
export const RADAR_WIRE = 'players-unified-radar-v1' as const;
export const RADAR_POLICY = 'radar-geographic-sharing-v2' as const;
export const DISCLOSURE_ID = 'radar-geographic-sharing-v2.ru.v1' as const;
export const DISCLOSURE_HASH = '4db62187f338a24b05cecd1a379da01e64027161e3171043c1c6233546fac19f' as const;
const disclosureText = 'Включая Radar, вы временно показываете авторизованным пользователям GoBadminton своё примерное местоположение и расстояние до вас. При точной геолокации используется ячейка около 100 м, при неточной — около 1 км; точность зависит от устройства. Расстояние приблизительное, по прямой. Вы можете выключить Radar в любой момент. В фоне передача прекращается, сеанс ограничен по времени.';
export class RadarError extends Error {
  readonly kind: 'invalid' | 'network' | 'denied' | 'restricted' | 'services_off' | 'location_error' | 'stale' | 'business';
  readonly status: number; readonly code: string;
  constructor(kind: RadarError['kind'], status = 0, code = '') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
const invalid = (): never => { throw new RadarError('invalid'); };
export const radarRecord = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown, max = 4096): string => typeof v === 'string' && v.length > 0 && v.length <= max ? v : invalid();
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : invalid();
const instant = (v: unknown): string => Number.isFinite(Date.parse(text(v))) ? v as string : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const positive = (v: unknown): number => Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : invalid();
const nullable = (v: unknown) => v === null ? null : text(v);
export const resultProof = (v: unknown): string => text(v).startsWith('u1.') ? v as string : invalid();
export type RadarConfig = { exposureMode: 'live' | 'synthetic_demo'; enabled: boolean; publishing: boolean;
  disclosure: { id: typeof DISCLOSURE_ID; sha256: typeof DISCLOSURE_HASH; text: string };
  cities: { cityId: string; regionId: string; map: { availability: string; mapId: string | null; version: string | null } }[] };
export function parseRadarConfig(v: unknown): RadarConfig {
  const r = radarRecord(v), u = radarRecord(r.unifiedDirectory), p = radarRecord(r.publishingV2), d = radarRecord(u.disclosure);
  if (u.contractVersion !== RADAR_WIRE || u.policyVersion !== RADAR_POLICY || d.id !== DISCLOSURE_ID || d.sha256 !== DISCLOSURE_HASH || d.text !== disclosureText || !['live','synthetic_demo'].includes(String(r.exposureMode)) || !Array.isArray(r.cities)) return invalid();
  return { exposureMode: r.exposureMode as RadarConfig['exposureMode'], enabled: bool(u.enabled), publishing: bool(p.enabled),
    disclosure: { id: DISCLOSURE_ID, sha256: DISCLOSURE_HASH, text: disclosureText }, cities: r.cities.map(v => {
      const c = radarRecord(v), m = radarRecord(c.map);
      return { cityId: text(c.cityId), regionId: text(c.regionId), map: { availability: text(m.availability), mapId: m.mapId == null ? null : text(m.mapId), version: m.version == null ? null : text(m.version) } };
    }) };
}
export function parseRadarStatus(v: unknown): UnifiedStatus {
  const r = radarRecord(v);
  // Empty legacy status may be returned before the first unified activation. Never adopt legacy ACTIVE.
  if (r.state === 'off' || r.state === 'expired') return { state: r.state, ownerHere: bool(r.ownerHere), policyVersion: RADAR_POLICY, contractVersion: RADAR_WIRE };
  if (r.updateRequired === true || r.contractVersion !== RADAR_WIRE || r.policyVersion !== RADAR_POLICY || !['active','owned_elsewhere'].includes(String(r.state)) || !['live','synthetic_demo'].includes(String(r.exposureMode)) || ![3,5,10].includes(Number(r.radiusBucketKm)) ||
    !((r.model === 'regional_grid_100m_v1' && r.gridSizeMeters === 100) || (r.model === 'regional_grid_1000m_v1' && r.gridSizeMeters === 1000)) ||
    (r.state === 'active') !== (r.ownerHere === true)) return invalid();
  for (const k of ['startedAt','expiresAt','hardExpiresAt','foregroundUntil','locationValidUntil','nextLocationUpdateAt','nextRadiusChangeAt']) instant(r[k]);
  text(r.activationId); positive(r.version); text(r.regionId);
  return { state: r.state, contractVersion: RADAR_WIRE, policyVersion: RADAR_POLICY, activationId: r.activationId, version: r.version, ownerHere: r.ownerHere,
    regionId: r.regionId, model: r.model, gridSizeMeters: r.gridSizeMeters, degradedReason: r.degradedReason,
    radiusBucketKm: r.radiusBucketKm, startedAt: r.startedAt, expiresAt: r.expiresAt, hardExpiresAt: r.hardExpiresAt,
    foregroundUntil: r.foregroundUntil, locationValidUntil: r.locationValidUntil, nextLocationUpdateAt: r.nextLocationUpdateAt,
    nextRadiusChangeAt: r.nextRadiusChangeAt, exposureMode: r.exposureMode } as UnifiedActivation;
}
export function activationDeadline(a: UnifiedActivation) { return Math.min(...[a.expiresAt,a.hardExpiresAt,a.foregroundUntil,a.locationValidUntil].map(Date.parse)); }
function geo(v: unknown): UnifiedGeo {
  const g = radarRecord(v);
  if (Math.abs(num(g.latitude)) > 90 || Math.abs(num(g.longitude)) > 180 || g.crs !== 'EPSG:4326' ||
    !((g.model === 'regional_grid_100m_v1' && g.gridSizeMeters === 100) || (g.model === 'regional_grid_1000m_v1' && g.gridSizeMeters === 1000)) ||
    num(g.uncertaintyMeters) < 0 || num(g.sourceAgeSeconds) < 0 || !['approximate','degraded'].includes(String(g.quality))) return invalid();
  return { latitude: g.latitude, longitude: g.longitude, crs: g.crs, model: g.model, gridSizeMeters: g.gridSizeMeters,
    uncertaintyMeters: g.uncertaintyMeters, quality: g.quality, sourceTimestampBucket: instant(g.sourceTimestampBucket), sourceAgeSeconds: g.sourceAgeSeconds } as UnifiedGeo;
}
function distance(v: unknown): UnifiedDistance | null {
  if (v === null) return null;
  const d = radarRecord(v);
  if (d.basis !== 'published_centers_geodesic' || d.approximate !== true || ![100,500,1000].includes(Number(d.roundingStepMeters)) || num(d.uncertaintyMeters) < 0 ||
    !(d.kind === 'estimate' && num(d.roundedMeters) >= 0 && d.lowerMeters === null && d.upperMeters === null || d.kind === 'range' && d.roundedMeters === null && d.lowerMeters === 0 && num(d.upperMeters) >= 0)) return invalid();
  return { kind: d.kind, roundedMeters: d.roundedMeters, roundingStepMeters: d.roundingStepMeters, uncertaintyMeters: d.uncertaintyMeters,
    lowerMeters: d.lowerMeters, upperMeters: d.upperMeters, basis: d.basis, approximate: true } as UnifiedDistance;
}
function radar(v: unknown, now: number) {
  const r = radarRecord(v), validUntil = instant(r.validUntil);
  if (r.consentPolicyVersion !== RADAR_POLICY || Date.parse(validUntil) <= now) return invalid();
  return { consentPolicyVersion: RADAR_POLICY, geo: geo(r.geo), validUntil, distance: distance(r.distance) };
}
export function radarPlayer(row: UnifiedRow): PublicPlayer { return parsePlayer({ ...row.player, bio: row.player.bio ?? null, lookingForGame: row.player.lookingForGame ?? false }); }
function unifiedRow(v: unknown, now: number): UnifiedRow {
  const r = radarRecord(v), p = radarRecord(r.player), id = text(r.publicPlayerId);
  if (p.publicPlayerId !== id || !['directory','radar_public'].includes(String(r.projection))) return invalid();
  const player = parsePlayer({ ...p, bio: p.bio ?? null, lookingForGame: p.lookingForGame ?? false });
  if (typeof p.canRequestContact !== 'boolean') return invalid();
  const rr = r.radar === null ? null : radarRecord(r.radar);
  if (r.projection === 'radar_public' && !rr) return invalid();
  return { publicPlayerId: id, projection: r.projection as UnifiedRow['projection'], player: { ...player, avatar: player.avatar ?? { uploadedUrl: null, providerUrl: null }, canRequestContact: p.canRequestContact },
    radar: rr ? { ...radar(rr, now), resultId: text(rr.resultId), resultRef: resultProof(rr.resultRef) } : null };
}
export function parseRadarSnapshot(v: unknown, cityId: string, now: number, map = false): UnifiedSnapshot | UnifiedMapSnapshot {
  const r = radarRecord(v), q = radarRecord(r.query), m = radarRecord(r.map), t = radarRecord(r.totals), pg = radarRecord(map ? r.mapPage : r.page);
  if (r.contractVersion !== RADAR_WIRE || r.policyVersion !== RADAR_POLICY || r.cityId !== cityId || !['authenticated_live','synthetic_demo'].includes(String(r.exposureMode)) ||
    Date.parse(instant(r.validUntil)) <= now || !Array.isArray(r.items) || r.items.length > (map ? 100 : 50) ||
    !['radar_distance_then_directory','radar_city_then_directory'].includes(String(q.ordering)) || !['authorized','none'].includes(String(q.originState)) ||
    !['missing','dev_preview'].includes(String(m.availability)) || t.completeness !== 'exact_at_asOf') return invalid();
  for (const k of ['matchingTotal','radarTotal','ordinaryOnlyTotal']) if (!Number.isSafeInteger(t[k]) || Number(t[k]) < 0) return invalid();
  const items = r.items.map(v => unifiedRow(v, now));
  if (new Set(items.map(x => x.publicPlayerId)).size !== items.length || pg.returnedCount !== items.length || typeof pg.hasMore !== 'boolean') return invalid();
  const cursor = nullable(map ? pg.nextMapCursor : pg.nextCursor);
  if (pg.hasMore !== (cursor !== null)) return invalid();
  return { contractVersion: RADAR_WIRE, policyVersion: RADAR_POLICY, exposureMode: r.exposureMode, cityId, regionId: text(r.regionId), generatedAt: instant(r.generatedAt), validUntil: r.validUntil,
    refreshAfterSeconds: 30, query: { queryRef: text(q.queryRef), asOf: instant(q.asOf), ordering: q.ordering, originState: q.originState, originRef: nullable(q.originRef) },
    totals: { matchingTotal: t.matchingTotal, radarTotal: t.radarTotal, ordinaryOnlyTotal: t.ordinaryOnlyTotal, completeness: t.completeness },
    map: { availability: m.availability, mapId: nullable(m.mapId), version: nullable(m.version) }, items,
    [map ? 'mapPage' : 'page']: { returnedCount: items.length, rankStart: pg.rankStart === null ? null : positive(pg.rankStart), rankEnd: pg.rankEnd === null ? null : positive(pg.rankEnd), hasMore: pg.hasMore, [map ? 'nextMapCursor' : 'nextCursor']: cursor } } as UnifiedSnapshot | UnifiedMapSnapshot;
}
export function parseRadarPreview(v: unknown, target: string, now: number): UnifiedPreview {
  const r = radarRecord(v), p = radarRecord(r.player);
  if (p.publicPlayerId !== target || r.proximityBand !== null || !Array.isArray(r.upcomingGames)) return invalid();
  const player = parsePlayer({ ...p, cityId: null, areaKey: null, bio: null, lookingForGame: false });
  return { player: { publicPlayerId: player.publicPlayerId, displayName: player.displayName, trainer: player.trainer, level: player.level, avatar: player.avatar, canRequestContact: bool(p.canRequestContact) },
    proximityBand: null, radar: radar(r.radar, now), upcomingGames: [] };
}
export type RadarCommand = Readonly<{ actor: Readonly<Actor>; key: string } & (
  { kind: 'start'; body: Readonly<UnifiedStart> } | { kind: 'takeover'; body: Readonly<UnifiedTakeover> } |
  { kind: 'update'; body: Readonly<UnifiedUpdate> } | { kind: 'renew'; body: Readonly<UnifiedRenew> } | { kind: 'heartbeat'; body: Readonly<UnifiedHeartbeat> } |
  { kind: 'stop'; activationId: string }
)>;
export type RadarRead = { kind: 'config' | 'status' } | { kind: 'query'; body: UnifiedQuery } | { kind: 'map'; body: UnifiedMapQuery } | { kind: 'preview'; resultRef: string; target: string };
export type ForegroundPermission = { granted: boolean; canAskAgain: boolean; ios?: { accuracy: 'full' | 'reduced' }; android?: { accuracy: 'fine' | 'coarse' | 'none' } };
export type ForegroundFix = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number | null } };
export function freshRadarFix(fix: ForegroundFix, now: number) {
  const { latitude, longitude, accuracy } = fix.coords;
  if (!Number.isFinite(fix.timestamp) || now - fix.timestamp > 30_000 || fix.timestamp > now + 5_000 || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1000) throw new RadarError('location_error');
  return Object.freeze({ latitude, longitude, accuracyMeters: accuracy, capturedAt: new Date(fix.timestamp).toISOString() });
}
/** Preserve server ordering. Public catalog remains visible after this private window. */
export function mergeRadarPlayers(ordinary: PublicPlayer[], rows: readonly UnifiedRow[]) {
  const nearby = rows.filter(r => r.radar !== null), ids = new Set(nearby.map(r => r.publicPlayerId));
  return { nearby, ordinary: ordinary.filter(p => !ids.has(p.publicPlayerId)) };
}
