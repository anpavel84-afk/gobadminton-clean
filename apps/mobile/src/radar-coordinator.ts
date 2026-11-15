import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { playerFilterKey } from './players.ts';
import type { PlayerFilters } from './players.ts';
import { RADAR_POLICY, RADAR_WIRE, RadarError, activationDeadline, freshRadarFix, parseRadarConfig, parseRadarStatus, parseRadarSnapshot, parseRadarPreview } from './radar.ts';
import type { RadarConfig, RadarRead, RadarCommand, ForegroundPermission, ForegroundFix, UnifiedRow, UnifiedActivation, UnifiedPreview } from './radar.ts';
import type { UnifiedStatus, UnifiedSnapshot, UnifiedMapSnapshot, UnifiedUpdate, UnifiedQuery } from '../../../packages/contracts/src/unified.generated.ts';
import type { RadarContactContext } from './contact.ts';
export type RadarPorts = {
  read: (operation: RadarRead, actor: Actor) => Promise<unknown>;
  command: (packet: RadarCommand, permit: () => boolean) => Promise<unknown>;
  permission: () => Promise<ForegroundPermission>; requestPermission: () => Promise<ForegroundPermission>;
  services: () => Promise<boolean>; fix: () => Promise<ForegroundFix>;
  random: () => string; now?: () => number;
};
type Phase = 'off' | 'restoring' | 'consent' | 'permission' | 'locating' | 'activating' | 'querying' | 'ready' | 'denied' | 'restricted' | 'services_off' | 'location_error' | 'error' | 'unknown' | 'owned_elsewhere' | 'expired';
export type RadarSnapshot = { actor: Actor | null; config: RadarConfig | null; activation: UnifiedStatus | null; phase: Phase; enabling: boolean;
  rows: UnifiedRow[]; pins: UnifiedRow[]; query: UnifiedSnapshot | null; mapValidUntil: number | null; mapPage: UnifiedMapSnapshot['mapPage'] | null;
  filterKey: string; generation: number; notice: string | null; approximate: boolean; command: RadarCommand | null; busy: boolean };
const empty = (actor: Actor | null = null, generation = 0): RadarSnapshot => ({ actor, config: null, activation: null, phase: 'off', enabling: false, rows: [], pins: [], query: null, mapValidUntil: null, mapPage: null, filterKey: '', generation, notice: null, approximate: false, command: null, busy: false });
const unknownNotice = 'Результат действия неизвестен. Проверьте текущий статус. Исходное действие сохранено и автоматически не повторяется.';
/** One foreground owner. Credentials/GPS/proofs are never persisted. No command replay on lifecycle/read. */
export class RadarCoordinator {
  private state = empty(); private listeners = new Set<() => void>(); private serial = 0; private querySerial = 0;
  private foreground = true; private filters: PlayerFilters = { cityId: null, name: '', looking: false, trainer: false };
  private timer: ReturnType<typeof setTimeout> | undefined; private heartbeatAt = Infinity; private maintenance = false;
  private pendingUnknown: RadarCommand | null = null;
  private unresolved: RadarCommand[] = [];
  private ports: RadarPorts; private now: () => number;
  constructor(ports: RadarPorts) { this.ports = ports; this.now = ports.now ?? Date.now; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(p: Partial<RadarSnapshot>) { this.state = { ...this.state, ...p }; this.listeners.forEach(fn => fn()); this.schedule(); }
  private valid(actor: Actor, serial: number) { return this.foreground && serial === this.serial && sameActor(actor, this.state.actor); }
  private own(): UnifiedActivation | null { const a = this.state.activation; return a?.state === 'active' && a.ownerHere && activationDeadline(a) > this.now() ? a : null; }
  private clearPrivate() { ++this.querySerial; this.show({ rows: [], pins: [], query: null, mapValidUntil: null, mapPage: null, generation: this.state.generation + 1 }); }
  invalidatePrivate = () => { this.clearPrivate(); this.show({ enabling: false, busy: false }); };
  setActor = (actor: Actor | null) => {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    const previous = this.state.actor, owned = this.own();
    const pending = this.state.command ?? this.pendingUnknown;
    ++this.serial; ++this.querySerial; clearTimeout(this.timer);
    // Keep an unresolved packet only for its original app session; no account/session inherits authority.
    this.unresolved = this.unresolved.filter(p => actor && sameActor(actor, p.actor));
    this.pendingUnknown = actor && pending && sameActor(actor, pending.actor) ? pending : null;
    this.state = empty(actor ? Object.freeze({ ...actor }) : null, this.state.generation + 1); this.show({ command: this.pendingUnknown });
    if (previous && owned && !pending) void this.stopCaptured(previous, owned);
    if (actor && this.foreground) void this.restore();
  };
  setForeground = (active: boolean) => {
    if (active === this.foreground) return;
    const actor = this.state.actor, owned = this.own(), pending = this.state.command;
    this.foreground = active; ++this.serial; this.clearPrivate();
    this.show({ enabling: false, busy: false, phase: pending ? 'unknown' : 'off', notice: pending ? unknownNotice : null });
    if (!active && actor && owned && !pending) void this.stopCaptured(actor, owned);
    if (active && actor) void this.restore();
  };
  private async stopCaptured(actor: Actor, activation: UnifiedActivation) {
    const packet: RadarCommand = Object.freeze({ kind: 'stop', actor: Object.freeze({ ...actor }), key: this.ports.random(), activationId: activation.activationId });
    // Native auth port rechecks captured actor/session before dispatch; background stop is the sole permitted offscreen write.
    if (sameActor(actor, this.state.actor)) this.show({ command: packet, busy: true });
    try {
      await this.ports.command(packet, () => true);
      if (sameActor(actor, this.state.actor) && this.state.command === packet) {
        ++this.serial; this.clearPrivate(); this.pendingUnknown = null;
        this.show({ command: null, busy: false, activation: { state: 'off', ownerHere: false, policyVersion: RADAR_POLICY, contractVersion: RADAR_WIRE }, phase: 'off', enabling: false });
      }
    }
    catch { if (sameActor(actor, this.state.actor)) { this.pendingUnknown = packet; this.show({ command: packet, busy: false, phase: 'unknown', notice: unknownNotice }); } }
  }
  restore = async () => {
    const actor = this.state.actor; if (!actor || !this.foreground) return;
    const serial = ++this.serial; this.clearPrivate(); this.show({ phase: 'restoring', enabling: false, busy: true });
    try {
      const config = parseRadarConfig(await this.ports.read({ kind: 'config' }, actor));
      if (!this.valid(actor, serial)) return;
      const activation = parseRadarStatus(await this.ports.read({ kind: 'status' }, actor));
      if (!this.valid(actor, serial)) return;
      this.acceptActivation(activation);
      this.show({ config, busy: false, phase: this.state.command ? 'unknown' : activation.state === 'active' ? 'ready' : activation.state,
        notice: this.state.command ? unknownNotice : null });
      // A read never settles an UNKNOWN command or enables its loader.
      if (!this.state.command && this.own()) await this.query();
    } catch { if (this.valid(actor, serial)) this.show({ phase: this.state.command ? 'unknown' : 'error', busy: false, notice: this.state.command ? unknownNotice : 'Radar недоступен. Можно искать игроков по городу.' }); }
  };
  setFilters = (filters: PlayerFilters) => {
    const key = playerFilterKey(filters); if (key === playerFilterKey(this.filters)) return;
    this.filters = { ...filters }; this.clearPrivate(); this.show({ filterKey: key });
    if (this.own() && !this.state.command) void this.query();
  };
  private cityId() { return this.filters.cityId ?? this.state.config?.cities.find(c => c.regionId === (this.state.activation as UnifiedActivation | null)?.regionId)?.cityId ?? null; }
  consent = async () => {
    if (!this.state.actor || !this.foreground || this.state.command || this.state.busy) return;
    if (!this.state.config) await this.restore();
    if (this.state.config?.enabled && this.state.config.publishing) this.show({ phase: 'consent', notice: null });
  };
  enable = async (acceptedHash: string, takeover = false) => {
    const { actor, config, command, phase } = this.state;
    if (!actor || !config?.enabled || !config.publishing || command || !this.foreground || phase !== 'consent' || acceptedHash !== config.disclosure.sha256) return;
    const previous = this.state.activation;
    if (previous?.state === 'owned_elsewhere' && !takeover) return;
    const serial = ++this.serial; this.clearPrivate(); this.show({ enabling: true, busy: true, phase: 'permission', notice: null });
    try {
      let permission = await this.ports.permission(); if (!this.valid(actor, serial)) return;
      if (!permission.granted && permission.canAskAgain) permission = await this.ports.requestPermission();
      if (!this.valid(actor, serial)) return;
      if (!permission.granted || permission.android?.accuracy === 'none') throw new RadarError(permission.canAskAgain ? 'denied' : 'restricted');
      if (!await this.ports.services()) throw new RadarError('services_off');
      if (!this.valid(actor, serial)) return;
      this.show({ phase: 'locating', approximate: permission.ios?.accuracy === 'reduced' || permission.android?.accuracy === 'coarse' });
      const location = freshRadarFix(await this.boundedFix(), this.now());
      if (!this.valid(actor, serial)) return;
      const body = Object.freeze({ contractVersion: RADAR_WIRE, consentPolicyVersion: RADAR_POLICY,
        consent: Object.freeze({ disclosureId: config.disclosure.id, disclosureHash: config.disclosure.sha256, accepted: true as const }), location });
      const base = { actor: Object.freeze({ ...actor }), key: this.ports.random() };
      const packet: RadarCommand = takeover && previous?.state === 'owned_elsewhere'
        ? Object.freeze({ ...base, kind: 'takeover', body: Object.freeze({ ...body, activationId: previous.activationId, expectedVersion: previous.version, confirm: true }) })
        : Object.freeze({ ...base, kind: 'start', body });
      this.show({ phase: 'activating' });
      if (await this.dispatch(packet, serial)) await this.query(true);
    } catch (error) {
      if (this.valid(actor, serial)) this.show({ enabling: false, busy: false, phase: error instanceof RadarError && ['denied','restricted','services_off','location_error'].includes(error.kind) ? error.kind as Phase : 'error', notice: 'Местоположение недоступно. Выберите город вручную или откройте настройки устройства.' });
    }
  };
  private async boundedFix() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.ports.fix(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RadarError('location_error')), 15_000); })]); }
    finally { clearTimeout(timer); }
  }
  private acceptActivation(a: UnifiedStatus) {
    const old = this.state.activation;
    if (old?.state === 'active' && (a.state !== 'active' || a.activationId !== old.activationId || a.version !== old.version)) this.clearPrivate();
    this.heartbeatAt = a.state === 'active' ? this.now() + Math.max(1000, (Date.parse(a.foregroundUntil) - this.now()) / 2) : Infinity;
    this.show({ activation: a });
  }
  private async dispatch(packet: RadarCommand, serial = this.serial) {
    if (this.state.command || !this.valid(packet.actor, serial)) return false;
    this.show({ command: packet, busy: true });
    try {
      const response = await this.ports.command(packet, () => this.valid(packet.actor, serial) && this.state.command === packet);
      if (!this.valid(packet.actor, serial)) return false;
      if (packet.kind === 'stop') this.acceptActivation({ state: 'off', ownerHere: false, policyVersion: RADAR_POLICY, contractVersion: RADAR_WIRE });
      else this.acceptActivation(parseRadarStatus(response));
      this.pendingUnknown = null; this.show({ command: null, busy: false }); return true;
    } catch (error) {
      if (!this.valid(packet.actor, serial)) return false;
      this.clearPrivate();
      const known = error instanceof RadarError && error.kind === 'business' && !['COMMAND_IN_PROGRESS','IDEMPOTENCY_KEY_REUSED','KEY_REUSED'].includes(error.code);
      if (!known) this.pendingUnknown = packet;
      this.show({ command: known ? null : packet, enabling: false, busy: false, phase: known ? 'error' : 'unknown', notice: known ? 'Действие не принято. Проверьте статус Radar.' : unknownNotice });
      return false;
    }
  }
  cancel = () => { ++this.serial; this.clearPrivate(); this.show({ enabling: false, busy: false, phase: this.state.command ? 'unknown' : this.own() ? 'ready' : 'off', notice: this.state.command ? unknownNotice : null }); };
  stop = async () => {
    const actor = this.state.actor, activation = this.own(); if (!actor || !activation || this.state.busy) { this.cancel(); return; }
    if (this.state.command) { this.unresolved.push(this.state.command); this.pendingUnknown = null; this.show({ command: null }); }
    ++this.serial; this.clearPrivate(); this.show({ enabling: false });
    const packet: RadarCommand = Object.freeze({ kind: 'stop', actor: Object.freeze({ ...actor }), key: this.ports.random(), activationId: activation.activationId });
    if (await this.dispatch(packet)) this.show({ phase: 'off', enabling: false });
  };
  change = async (kind: 'renew' | 'update', radiusBucketKm?: 3 | 5 | 10, refreshLocation = false) => {
    const actor = this.state.actor, a = this.own(); if (!actor || !a || this.state.busy || this.state.command) return;
    this.clearPrivate();
    const serial = this.serial;
    let location: ReturnType<typeof freshRadarFix> | undefined;
    if (kind === 'renew' || refreshLocation) {
      this.show({ busy: true });
      try {
        const permission = await this.ports.permission();
        if (!this.valid(actor, serial)) return;
        if (!permission.granted || !await this.ports.services()) throw new RadarError('location_error');
        if (!this.valid(actor, serial)) return;
        location = freshRadarFix(await this.boundedFix(), this.now());
        if (!this.valid(actor, serial)) return;
      } catch { if (this.valid(actor, serial)) this.show({ busy: false, notice: 'Не удалось обновить местоположение. Сеанс завершится по текущему сроку.' }); return; }
      this.show({ busy: false });
    }
    const common: UnifiedUpdate = { contractVersion: RADAR_WIRE, consentPolicyVersion: RADAR_POLICY, activationId: a.activationId, expectedVersion: a.version,
      ...(location ? { location } : {}), ...(radiusBucketKm !== undefined ? { radiusBucketKm } : {}) };
    const base = { actor: Object.freeze({ ...actor }), key: this.ports.random() };
    const packet: RadarCommand = kind === 'renew'
      ? Object.freeze({ ...base, kind: 'renew', body: Object.freeze({ ...common, extendMinutes: 15 }) })
      : Object.freeze({ ...base, kind: 'update', body: Object.freeze(common) });
    if (await this.dispatch(packet, serial)) await this.query();
  };
  query = async (first = false, more = false) => {
    const actor = this.state.actor, activation = this.own(), cityId = this.cityId(), old = this.state.query;
    if (more && (!old?.page.nextCursor || this.state.busy)) return;
    if (!actor || !activation || !cityId || this.state.command || !this.state.config?.enabled || !this.foreground) { if (first) this.show({ enabling: false, busy: false, phase: 'error' }); return; }
    const serial = this.serial; ++this.querySerial;
    if (!more) this.clearPrivate(); const queryRequest = this.querySerial;
    this.show({ busy: true, ...(first ? { phase: 'querying' as const } : {}) });
    const valid = () => this.valid(actor, serial) && queryRequest === this.querySerial && this.own()?.activationId === activation.activationId;
    try {
      const body: UnifiedQuery = more && old ? { contractVersion: RADAR_WIRE, queryRef: old.query.queryRef, cursor: old.page.nextCursor!, limit: 50 }
        : { contractVersion: RADAR_WIRE, filters: { cityId, name: this.filters.name, areaKey: this.filters.areaKey ?? '', looking: this.filters.looking, trainer: this.filters.trainer }, origin: { kind: 'current_activation' as const, activationId: activation.activationId }, limit: 50 };
      const result = parseRadarSnapshot(await this.ports.read({ kind: 'query', body }, actor), cityId, this.now()) as UnifiedSnapshot;
      if (!valid()) return;
      if (result.exposureMode !== (this.state.config!.exposureMode === 'live' ? 'authenticated_live' : 'synthetic_demo') || result.regionId !== this.state.config!.cities.find(c => c.cityId === cityId)?.regionId) throw new RadarError('invalid');
      if (more && old?.query.queryRef !== result.query.queryRef) throw new RadarError('stale');
      const ids = new Set(this.state.rows.map(r => r.publicPlayerId));
      this.show({ query: result, rows: more ? [...this.state.rows, ...result.items.filter(r => !ids.has(r.publicPlayerId))] : result.items, busy: false, enabling: false, phase: 'ready', filterKey: playerFilterKey(this.filters), notice: null });
    } catch { if (valid()) { this.clearPrivate(); this.show({ enabling: false, busy: false, phase: 'error', notice: 'Не удалось обновить Radar. Обычный список игроков доступен.' }); } }
  };
  map = async (next = false) => {
    const { actor, query } = this.state, cityId = this.cityId();
    if (!actor || !query || !cityId || !this.own() || this.state.busy || !this.foreground || (next && !this.state.mapPage?.nextMapCursor)) return;
    const serial = this.serial, qSerial = this.querySerial, generation = this.state.generation;
    this.show({ pins: [], busy: true });
    try {
      const result = parseRadarSnapshot(await this.ports.read({ kind: 'map', body: { contractVersion: RADAR_WIRE, queryRef: query.query.queryRef,
        ...(next ? { mapCursor: this.state.mapPage!.nextMapCursor! } : {}), limit: 100 } }, actor), cityId, this.now(), true) as UnifiedMapSnapshot;
      if (!this.valid(actor, serial) || qSerial !== this.querySerial || generation !== this.state.generation) return;
      if (result.query.queryRef !== query.query.queryRef || result.exposureMode !== query.exposureMode || result.regionId !== query.regionId || JSON.stringify(result.map) !== JSON.stringify(query.map) || Date.parse(query.validUntil) <= this.now()) throw new RadarError('stale');
      this.show({ pins: result.items.filter(r => r.radar), mapValidUntil: Date.parse(result.validUntil), mapPage: result.mapPage, busy: false });
    } catch { if (this.valid(actor, serial) && qSerial === this.querySerial) { this.clearPrivate(); this.show({ busy: false, notice: 'Карта игроков устарела. Обновите Radar.' }); } }
  };
  contactContext = (row: UnifiedRow): RadarContactContext | null => {
    const { actor, query, generation } = this.state, activation = this.own();
    if (!actor || !query || !activation || !row.radar || !this.foreground || ![...this.state.rows,...this.state.pins].includes(row)) return null;
    const expiresAt = Math.min(Date.parse(row.radar.validUntil), Date.parse(query.validUntil), activationDeadline(activation), this.state.pins.includes(row) ? this.state.mapValidUntil ?? Infinity : Infinity);
    const context: RadarContactContext = Object.freeze({ kind: 'radar', actor: Object.freeze({ ...actor }), target: row.publicPlayerId, resultRef: row.radar.resultRef,
      queryRef: query.query.queryRef, activationId: activation.activationId, generation, expiresAt,
      valid: () => this.foreground && sameActor(actor, this.state.actor) && generation === this.state.generation && this.state.query?.query.queryRef === query.query.queryRef && this.own()?.activationId === activation.activationId && expiresAt > this.now() });
    return context.valid() ? context : null;
  };
  preview = async (context: RadarContactContext): Promise<UnifiedPreview> => {
    if (!context.valid()) throw new RadarError('stale');
    const preview = parseRadarPreview(await this.ports.read({ kind: 'preview', resultRef: context.resultRef, target: context.target }, context.actor), context.target, this.now());
    if (!context.valid() || !preview.player.canRequestContact) throw new RadarError('stale'); return preview;
  };
  private schedule() {
    clearTimeout(this.timer); if (!this.foreground || !this.state.actor) return;
    const a = this.own(); if (!a) return;
    const times = [activationDeadline(a), this.state.mapValidUntil ?? Infinity, this.state.busy || this.state.command ? Infinity : this.heartbeatAt, this.state.query ? Date.parse(this.state.query.validUntil) : Infinity,
      ...this.state.rows.flatMap(r => r.radar ? [Date.parse(r.radar.validUntil)] : []), ...this.state.pins.flatMap(r => r.radar ? [Date.parse(r.radar.validUntil)] : [])];
    this.timer = setTimeout(() => { void this.tick(); }, Math.max(1, Math.min(...times) - this.now()));
  }
  tick = async () => {
    const actor = this.state.actor, a = this.state.activation;
    if (!actor || !this.foreground || a?.state !== 'active') return;
    if (activationDeadline(a) <= this.now()) { ++this.serial; this.clearPrivate(); this.show({ activation: { state: 'expired', ownerHere: false, policyVersion: RADAR_POLICY, contractVersion: RADAR_WIRE }, phase: 'expired', enabling: false, busy: false }); return; }
    if (this.state.mapValidUntil !== null && this.state.mapValidUntil <= this.now()) this.clearPrivate();
    if (this.state.query && (Date.parse(this.state.query.validUntil) <= this.now() || [...this.state.rows,...this.state.pins].some(r => r.radar && Date.parse(r.radar.validUntil) <= this.now()))) this.clearPrivate();
    if (!this.state.command && !this.state.busy && !this.maintenance && this.now() >= this.heartbeatAt) {
      this.maintenance = true; const serial = this.serial;
      const packet: RadarCommand = Object.freeze({ kind: 'heartbeat', actor: Object.freeze({ ...actor }), key: this.ports.random(), body: Object.freeze({ contractVersion: RADAR_WIRE, consentPolicyVersion: RADAR_POLICY, activationId: a.activationId }) });
      await this.dispatch(packet, serial); this.maintenance = false;
    }
    this.schedule();
  };
  dispose = () => { this.setForeground(false); clearTimeout(this.timer); this.listeners.clear(); };
}
