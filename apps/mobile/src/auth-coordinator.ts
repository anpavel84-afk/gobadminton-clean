import { ParticipationCoordinator, ParticipationError, sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { NativeMe } from '@gobadminton/contracts/native-auth';
import type { NativeApi } from './native-api.ts';
import { NATIVE_CLIENT_ID, NATIVE_REDIRECT, SECURE_AUTH_KEY, NativeAuthError, canonicalGamePath,
  parseCallback, parseCredentials, parseNativeMe, parseSecureEnvelope, parseSessions, parseTransaction } from './native-auth-protocol.ts';
import type { PendingLogin, SecureEnvelope, SecureSession, NativeSessionRow } from './native-auth-protocol.ts';

export type AuthSnapshot = {
  status: 'hydrating' | 'guest' | 'signing-in' | 'authenticated' | 'unverifiable';
  me: NativeMe | null; sessions: NativeSessionRow[]; returnPath: string | null;
  notice: 'unavailable' | 'signin' | 'storage' | 'network' | 'cancelled' | 'remote-unconfirmed' | null;
};
type Store = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
export type AuthDependencies = { api: NativeApi; store: Store; random: () => string; challenge: (verifier: string) => Promise<string>; now?: () => number };
/** Sole owner of credentials, pending login and private caches. UI never receives bearer/refresh/verifier. */
export class AuthCoordinator {
  private readonly deps: AuthDependencies;
  private readonly now: () => number;
  private epoch = 0;
  private envelope: SecureEnvelope | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private boot: Promise<void> | null = null;
  private rotation: Promise<void> | null = null;
  private exchange: { pending: PendingLogin; code: string; work: Promise<string | null> } | null = null;
  private validation: Promise<void> | null = null;
  private writable = true;
  private starting: Promise<{ url: string; generation: string } | null> | null = null;
  private snapshot: AuthSnapshot = { status: 'hydrating', me: null, sessions: [], returnPath: null, notice: null };
  readonly participation: ParticipationCoordinator;
  constructor(deps: AuthDependencies) {
    this.deps = deps; this.now = deps.now ?? Date.now;
    this.participation = new ParticipationCoordinator({
      own: cursor => this.participationRead(access => deps.api.ownParticipations(access, cursor)),
      managed: cursor => this.participationRead(access => deps.api.managedGames(access, cursor)),
      send: packet => this.participationRead(access => packet.kind === 'request'
        ? deps.api.requestParticipation(access, packet.gameId, packet.body, packet.key)
        : deps.api.withdrawParticipation(access, packet.participationId, packet.body, packet.key), packet.actor),
    }, deps.random, undefined, id => this.participationRead(access => deps.api.gameDetail(access, id)));
  }
  /** Closed authenticated operations only; never returns access credentials to UI. No mutation retry. */
  private async participationRead<T>(operation: (access: string) => Promise<T>, actor = this.participation.getSnapshot().actor): Promise<T> {
    const epoch = this.epoch;
    if (!actor || !this.matchesActor(actor)) throw new ParticipationError('stale');
    try {
      const token = await this.token(epoch); this.check(epoch);
      if (!this.matchesActor(actor)) throw new ParticipationError('stale');
      const result = await operation(token); this.check(epoch);
      if (!this.matchesActor(actor)) throw new ParticipationError('stale');
      return result;
    } catch (error) {
      if (epoch !== this.epoch) throw new ParticipationError('stale');
      if ((error instanceof ParticipationError && error.kind === 'authority') ||
          (error instanceof NativeAuthError && ['authority', 'expired'].includes(error.kind))) await this.fail(epoch, new NativeAuthError('authority'));
      throw error;
    }
  }
  private matchesActor(actor: Actor) {
    return actor.generation === this.epoch && sameActor(actor, this.participation.getSnapshot().actor);
  }
  getSnapshot = (): AuthSnapshot => this.snapshot;
  refreshDelay = () => Math.max(1, (this.access?.expiresAt ?? this.now()) - this.now() + 1);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private show(patch: Partial<AuthSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (this.snapshot.status === 'authenticated' && this.snapshot.me) {
      this.participation.setActor({ actorId: this.snapshot.me.id, sessionId: this.snapshot.me.session.id, generation: this.epoch });
    } else if (this.snapshot.status !== 'hydrating') {
      // A transient unverifiable identity must also fence callbacks if this session is later validated again.
      if (this.participation.getSnapshot().actor?.generation === this.epoch) this.epoch++;
      this.participation.setActor(null);
    }
    this.listeners.forEach(listener => listener());
  }
  private check(epoch: number) { if (epoch !== this.epoch) throw new NativeAuthError('stale'); }
  private empty(returnPath = this.snapshot.returnPath): SecureEnvelope {
    return { version: 1, generation: this.deps.random(), returnPath };
  }
  /** Serialize secure writes; a logout clear is queued after any already dispatched old write. */
  private persist(value: SecureEnvelope, epoch: number): Promise<void> {
    const work = this.writes.catch(() => {}).then(async () => {
      this.check(epoch);
      if (!this.writable) throw new NativeAuthError('storage');
      try { await this.deps.store.setItem(SECURE_AUTH_KEY, JSON.stringify(value)); }
      catch { throw new NativeAuthError('storage'); }
      this.check(epoch);
    });
    this.writes = work; return work;
  }
  hydrate = (): Promise<void> => {
    if (this.boot) return this.boot;
    const epoch = this.epoch;
    this.boot = (async () => {
      try {
        const raw = await this.deps.store.getItem(SECURE_AUTH_KEY); this.check(epoch);
        this.envelope = parseSecureEnvelope(raw, this.now()) ?? this.empty(null);
        this.show({ returnPath: this.envelope.returnPath });
        if (this.envelope.session) await this.refresh();
        else this.show({ status: this.envelope.pending ? 'signing-in' : 'guest', notice: null });
      } catch (error) {
        if (epoch !== this.epoch) return;
        // Unknown/corrupt future storage is preserved byte-for-byte; do not silently migrate it.
        this.writable = false; this.access = null; this.envelope = null;
        this.show({ status: 'unverifiable', me: null, sessions: [], notice: error instanceof NativeAuthError && error.kind !== 'storage' ? 'signin' : 'storage' });
      }
    })();
    return this.boot;
  };
  private async fail(epoch: number, error: unknown) {
    if (epoch !== this.epoch) return;
    this.epoch++; const next = this.epoch;
    this.access = null; this.rotation = null; this.exchange = null; this.validation = null;
    this.envelope = this.empty();
    const kind = error instanceof NativeAuthError ? error.kind : 'network';
    this.show({ status: kind === 'network' ? 'unverifiable' : 'guest', me: null, sessions: [],
      notice: kind === 'storage' ? 'storage' : kind === 'unavailable' ? 'unavailable' : kind === 'network' ? 'network' : 'signin' });
    try { await this.persist(this.envelope, next); }
    catch { if (next === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); } }
  }
  private async accept(raw: unknown, epoch: number, previous?: SecureSession) {
    this.check(epoch);
    const receivedAt = this.now();
    const credentials = parseCredentials(raw, receivedAt);
    if (previous && credentials.sessionId !== previous.sessionId) throw new NativeAuthError('authority');
    // Access is still private to this work until verified identity and durable rotated refresh commit.
    const me = parseNativeMe(await this.deps.api.me(credentials.accessToken)); this.check(epoch);
    if (me.session.id !== credentials.sessionId || (previous && me.id !== previous.actorId)) throw new NativeAuthError('authority');
    const envelope: SecureEnvelope = { ...this.envelope!, session: {
      refreshToken: credentials.refreshToken, sessionId: credentials.sessionId, actorId: me.id,
      refreshExpiresAt: credentials.refreshExpiresAt, refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt,
    } };
    delete envelope.pending;
    await this.persist(envelope, epoch); this.check(epoch);
    this.envelope = envelope;
    const expiresAt = receivedAt + credentials.expiresIn * 1000 - 30_000;
    if (expiresAt <= this.now()) throw new NativeAuthError('expired');
    this.access = { token: credentials.accessToken, expiresAt };
    this.show({ status: 'authenticated', me, sessions: [], notice: null });
  }
  refresh = (): Promise<void> => {
    if (this.rotation) return this.rotation;
    const epoch = this.epoch, session = this.envelope?.session;
    if (!session) return Promise.resolve();
    const work = (async () => {
      try {
        this.access = null;
        this.show({ status: 'hydrating', me: null, sessions: [] });
        const consumed: SecureEnvelope = { ...this.envelope! }; delete consumed.session;
        this.envelope = consumed;
        await this.persist(consumed, epoch); this.check(epoch);
        if (Date.parse(session.refreshExpiresAt) <= this.now() || Date.parse(session.refreshAbsoluteExpiresAt) <= this.now()) throw new NativeAuthError('expired');
        const raw = await this.deps.api.refresh(session.refreshToken); this.check(epoch);
        await this.accept(raw, epoch, session);
      } catch (error) { await this.fail(epoch, error); }
    })();
    this.rotation = work;
    void work.finally(() => { if (this.rotation === work) this.rotation = null; });
    return work;
  };
  beginLogin = (returnPath?: string | null): Promise<{ url: string; generation: string } | null> => {
    if (this.starting) return this.starting;
    const work = this.startLogin(returnPath); this.starting = work;
    void work.finally(() => { if (this.starting === work) this.starting = null; });
    return work;
  };
  private async startLogin(returnPath?: string | null): Promise<{ url: string; generation: string } | null> {
    await this.hydrate();
    if (!this.writable) return null;
    // Account switch is explicit and fences all old requests before creating the new pending login.
    const before = this.epoch;
    await this.logout(false);
    if (this.epoch !== before + 1 || !this.writable) return null;
    const epoch = this.epoch;
    const intent = canonicalGamePath(returnPath) ?? this.snapshot.returnPath;
    this.envelope = this.empty(intent);
    this.show({ status: 'signing-in', me: null, sessions: [], returnPath: intent, notice: null });
    try {
      const verifier = this.deps.random(), state = this.deps.random();
      const challenge = await this.deps.challenge(verifier); this.check(epoch);
      // Retain intent even if methods or default-off native endpoint is unavailable.
      await this.persist(this.envelope, epoch); this.check(epoch);
      const methods = await this.deps.api.methods(); this.check(epoch);
      if (!methods.some(method => method.available)) throw new NativeAuthError('unavailable');
      const transaction = parseTransaction(await this.deps.api.transaction({ clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
        codeChallenge: challenge, codeChallengeMethod: 'S256', state, ...(intent ? { returnPath: intent } : {}) }), this.now());
      this.check(epoch);
      const pending: PendingLogin = { generation: this.envelope.generation, clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
        verifier, state, transactionId: transaction.transactionId, expiresAt: Date.parse(transaction.expiresAt), returnPath: intent };
      const envelope = { ...this.envelope, pending };
      await this.persist(envelope, epoch); this.check(epoch); this.envelope = envelope;
      return { url: transaction.browserStartUrl, generation: pending.generation };
    } catch (error) { await this.fail(epoch, error); return null; }
  };
  callback = async (raw: string): Promise<string | null> => {
    await this.hydrate();
    const active = this.exchange;
    if (active) {
      try {
        if (parseCallback(raw, active.pending, this.now(), this.envelope!.generation) === active.code) return await active.work;
      } catch { /* Ignore an unrelated delivery without interrupting the legitimate exchange. */ }
      return null;
    }
    const pending = this.envelope?.pending, epoch = this.epoch;
    if (!pending) return null;
    let code: string;
    try { code = parseCallback(raw, pending, this.now(), this.envelope!.generation); }
    catch { this.show({ notice: pending.expiresAt <= this.now() ? 'signin' : this.snapshot.notice }); return null; }
    // Synchronous memory consumption fences duplicate WebBrowser + Linking delivery before the first await.
    const consumed = { ...this.envelope! }; delete consumed.pending; this.envelope = consumed;
    const work = (async () => {
      try {
        await this.persist(consumed, epoch); this.check(epoch);
        const rawCredentials = await this.deps.api.exchange({ clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT, code, verifier: pending.verifier });
        this.check(epoch); await this.accept(rawCredentials, epoch);
        return pending.returnPath ?? '/profile';
      } catch (error) { await this.fail(epoch, error); return null; }
    })();
    this.exchange = { pending, code, work };
    try { return await work; }
    finally { if (this.exchange?.work === work) this.exchange = null; }
  };
  cancelLogin = async (generation?: string) => {
    await this.hydrate();
    if (!this.envelope?.pending || (generation && generation !== this.envelope.generation)) return;
    const epoch = ++this.epoch;
    const envelope = this.empty(); this.envelope = envelope;
    this.show({ status: 'guest', me: null, sessions: [], notice: 'cancelled' });
    try { await this.persist(envelope, epoch); } catch (error) { await this.fail(epoch, error); }
  };
  private async token(epoch: number): Promise<string> {
    if (this.rotation) await this.rotation;
    else if (!this.access || this.access.expiresAt <= this.now()) await this.refresh();
    this.check(epoch);
    if (!this.access || this.access.expiresAt <= this.now()) throw new NativeAuthError('authority');
    return this.access.token;
  }
  validate = (): Promise<void> => {
    if (this.validation) return this.validation;
    const epoch = this.epoch;
    const work = (async () => {
      await this.hydrate();
      if (!this.envelope?.session) return;
      try {
        const access = await this.token(epoch);
        const me = parseNativeMe(await this.deps.api.me(access)); this.check(epoch);
        if (me.id !== this.envelope?.session?.actorId || me.session.id !== this.envelope?.session?.sessionId) throw new NativeAuthError('authority');
        this.show({ status: 'authenticated', me, notice: null });
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error instanceof NativeAuthError && error.kind === 'network') this.show({ status: 'unverifiable', me: null, sessions: [], notice: 'network' });
        else await this.fail(epoch, error);
      }
    })();
    this.validation = work;
    void work.finally(() => { if (this.validation === work) this.validation = null; });
    return work;
  };
  loadSessions = async () => {
    const epoch = this.epoch;
    try {
      const access = await this.token(epoch), rows = parseSessions(await this.deps.api.sessions(access)); this.check(epoch);
      if (!this.envelope?.session) throw new NativeAuthError('authority');
      this.show({ sessions: rows, notice: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof NativeAuthError && error.kind === 'authority') await this.fail(epoch, error);
      else this.show({ sessions: [], notice: 'network' });
    }
  };
  revokeSession = async (id: string | null) => {
    const epoch = this.epoch;
    const current = id !== null && id === this.envelope?.session?.sessionId;
    try {
      const access = await this.token(epoch), key = this.deps.random(); this.check(epoch);
      // No mutation replay, even on ambiguous response; caller can reread actual owned sessions.
      if (id === null) await this.deps.api.revokeOthers(access, key);
      else await this.deps.api.revoke(access, id, key);
      this.check(epoch);
      if (current) await this.logout(false); else await this.loadSessions();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (current || (error instanceof NativeAuthError && error.kind === 'authority')) await this.fail(epoch, error);
      else this.show({ sessions: [], notice: 'remote-unconfirmed' });
    }
  };
  logout = async (report = true) => {
    const refresh = this.envelope?.session?.refreshToken, access = this.access?.token;
    const epoch = ++this.epoch;
    this.rotation = null; this.exchange = null; this.validation = null; this.access = null;
    const envelope = this.empty(); this.envelope = envelope;
    this.show({ status: 'guest', me: null, sessions: [], notice: null });
    // Queue the local clear immediately. Remote revocation is bounded by the API timeout and never persisted/retried.
    const clear = this.persist(envelope, epoch).catch(() => {
      if (epoch === this.epoch) { this.writable = false; this.show({ status: 'unverifiable', notice: 'storage' }); }
    });
    const revoke = refresh || access ? this.deps.api.logout(refresh, access).catch(() => {
      if (report && epoch === this.epoch) this.show({ notice: 'remote-unconfirmed' });
    }) : Promise.resolve();
    await clear;
    // Account-switch caller can continue after local clear; snapshot credentials remain private to this one bounded revoke.
    void revoke;
  };
}
