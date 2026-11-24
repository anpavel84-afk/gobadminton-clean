import { ParticipationError, sameActor, type Actor } from './participation.ts';
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from './venues.ts';

/** Accepted-web booking note contract bound. */
export const PRIVATE_BOOKING_NOTE_MAX = 500;

export const PRIVATE_CONTACTS_OPEN_FAILURE =
  'Не удалось открыть ссылку. Попробуйте ещё раз.';

export type PrivateVenueContactAction = Readonly<{
  kind: 'phone' | 'website';
  /** Visible label (phone text or serialized website href). */
  text: string;
  /** Validated tel: or http(s) destination only. */
  url: string;
}>;

/** Narrow private projection — never merges into shared Game / public caches. */
export type PrivateGameVenueContacts = Readonly<{
  gameId: string;
  venueId: string;
  phone: PrivateVenueContactAction | null;
  website: PrivateVenueContactAction | null;
  bookingNote: string | null;
}>;

export type PrivateContactsFocus = Readonly<{
  gameId: string;
  venueId: string;
  viewGen: number;
}>;

/** Surface fence for load/retry — does not require a ready projection. */
export type PrivateContactsSurfacePermit = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  venueId: string;
  viewGen: number;
  foregroundGen: number;
}>;

/** Immutable fence captured at render for link handlers (includes readGen + action). */
export type PrivateContactsRenderedPermit = Readonly<PrivateContactsSurfacePermit & {
  readGen: number;
  action: PrivateVenueContactAction;
}>;

export type PrivateContactsPort = {
  read: (gameId: string, venueId: string, permit: () => boolean) => Promise<PrivateGameVenueContacts>;
  /** Injectable open for behavioral tests; production uses Linking.openURL. */
  openUrl?: (url: string) => Promise<void>;
};

export type PrivateContactsSnapshot = {
  actor: Actor | null;
  focus: PrivateContactsFocus | null;
  foreground: boolean;
  foregroundGen: number;
  /** Active read generation while a load is in flight or last settled. */
  readGen: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  projection: PrivateGameVenueContacts | null;
  notice: string | null;
  openFailure: boolean;
};

const initial = (actor: Actor | null = null): PrivateContactsSnapshot => ({
  actor,
  focus: null,
  foreground: true,
  foregroundGen: 0,
  readGen: 0,
  status: 'idle',
  projection: null,
  notice: null,
  openFailure: false,
});

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParticipationError('invalid');
  return value as Record<string, unknown>;
};

/** Accepted-web GameVenueContacts phoneLink parity. */
export function privateContactPhone(value: unknown): PrivateVenueContactAction | null {
  if (typeof value !== 'string' || forbiddenUrlScalars(value)) return null;
  const text = value.trim();
  const digits = text.replace(/[^0-9]/g, '');
  if (text.length > 40 || !/^\+?[0-9 ()-]+$/.test(text) || digits.length < 7 || digits.length > 15) return null;
  return Object.freeze({
    kind: 'phone' as const,
    text,
    url: `tel:${text.startsWith('+') ? '+' : ''}${digits}`,
  });
}

/** Accepted-web GameVenueContacts websiteLink parity (original HTTP(S) authority). */
export function privateContactWebsite(value: unknown): PrivateVenueContactAction | null {
  if (typeof value !== 'string' || value.length > 300 || forbiddenUrlScalars(value)) return null;
  const text = value.trim();
  const url = httpUrlAgreesWithOriginalAuthority(text, forbiddenUrlScalars);
  if (!url || url.href.length > 300) return null;
  return Object.freeze({ kind: 'website' as const, text: url.href, url: url.href });
}

/** Plain multiline note only — never HTML / auto-link. Malformed non-string rejects the read. */
export function privateBookingNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ParticipationError('invalid');
  if (value.length > PRIVATE_BOOKING_NOTE_MAX) throw new ParticipationError('invalid');
  const text = value.trim();
  return text.length ? text : null;
}

export function hasPrivateVenueContacts(projection: PrivateGameVenueContacts | null): boolean {
  return !!projection && !!(projection.phone || projection.website || projection.bookingNote);
}

export function samePrivateAction(
  a: PrivateVenueContactAction | null | undefined,
  b: PrivateVenueContactAction | null | undefined,
): boolean {
  return !!a && !!b && a.kind === b.kind && a.url === b.url && a.text === b.text;
}

/**
 * Parse only the private venue-contact projection from an authenticated game detail body.
 * Validates response game.id and venue.id against the requested/displayed pair; mismatch rejects.
 * Omitted/null/empty contact fields are a successful empty projection.
 */
export function parsePrivateGameVenueContacts(
  value: unknown,
  expectedGameId: string,
  expectedVenueId: string,
): PrivateGameVenueContacts {
  const r = record(value);
  const v = record(r.venue);
  if (typeof r.id !== 'string' || !r.id || r.id !== expectedGameId) throw new ParticipationError('invalid');
  if (typeof v.id !== 'string' || !v.id || v.id !== expectedVenueId) throw new ParticipationError('invalid');
  const phone = Object.prototype.hasOwnProperty.call(v, 'contactPhone')
    ? privateContactPhone(v.contactPhone)
    : null;
  const website = Object.prototype.hasOwnProperty.call(v, 'contactWebsite')
    ? privateContactWebsite(v.contactWebsite)
    : null;
  const bookingNote = Object.prototype.hasOwnProperty.call(v, 'bookingNote')
    ? privateBookingNote(v.bookingNote)
    : null;
  return Object.freeze({
    gameId: expectedGameId,
    venueId: expectedVenueId,
    phone,
    website,
    bookingNote,
  });
}

/**
 * Root-owned read-only private venue contacts. Separate in-memory active projection;
 * no persistence, no rights inference, no shared Game enrichment.
 */
export class PrivateGameVenueContactsCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private readSerial = 0;
  private viewSerial = 0;
  private port: PrivateContactsPort;

  constructor(port: PrivateContactsPort) {
    this.port = port;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private show(patch: Partial<PrivateContactsSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  private current(actor: Actor | null) {
    return sameActor(actor, this.state.actor);
  }

  private readLive(actor: Actor, readGen: number, viewGen: number) {
    return this.current(actor)
      && this.state.foreground
      && this.state.focus?.viewGen === viewGen
      && this.state.readGen === readGen;
  }

  private surfaceLive(permit: PrivateContactsSurfacePermit) {
    return this.current(permit.actor)
      && this.state.foreground
      && this.state.focus?.gameId === permit.gameId
      && this.state.focus?.venueId === permit.venueId
      && this.state.focus?.viewGen === permit.viewGen
      && this.state.foregroundGen === permit.foregroundGen;
  }

  private permitLive(permit: PrivateContactsRenderedPermit) {
    return this.surfaceLive(permit)
      && this.state.readGen === permit.readGen
      && this.state.status === 'ready'
      && !!this.state.projection
      && this.state.projection.gameId === permit.gameId
      && this.state.projection.venueId === permit.venueId
      && samePrivateAction(
        permit.action.kind === 'phone' ? this.state.projection.phone : this.state.projection.website,
        permit.action,
      );
  }

  /** Capture surface fence for load/retry while focused + foreground. */
  surfacePermit = (): PrivateContactsSurfacePermit | null => {
    const { actor, focus, foreground, foregroundGen } = this.state;
    if (!actor || !focus || !foreground) return null;
    return Object.freeze({
      actor: Object.freeze({ ...actor }),
      gameId: focus.gameId,
      venueId: focus.venueId,
      viewGen: focus.viewGen,
      foregroundGen,
    });
  };

  /** Capture rendered actor/game/venue/focus/read/foreground fence for a validated action. */
  renderedPermit = (action: PrivateVenueContactAction): PrivateContactsRenderedPermit | null => {
    const surface = this.surfacePermit();
    const { readGen, status, projection, focus } = this.state;
    if (!surface || !focus || status !== 'ready' || !projection) return null;
    if (projection.gameId !== focus.gameId || projection.venueId !== focus.venueId) return null;
    const live = action.kind === 'phone' ? projection.phone : projection.website;
    if (!samePrivateAction(live, action)) return null;
    return Object.freeze({
      ...surface,
      readGen,
      action: Object.freeze({ ...action }),
    });
  };

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || (!actor && !this.state.actor)) return;
    this.readSerial++;
    this.viewSerial++;
    const foreground = this.state.foreground;
    const foregroundGen = this.state.foregroundGen + 1;
    this.state = {
      ...initial(actor ? Object.freeze({ ...actor }) : null),
      foreground,
      foregroundGen,
    };
    this.show({});
  }

  forget = () => {
    this.readSerial++;
    this.viewSerial++;
    this.state = initial();
    this.show({});
  };

  /**
   * App foreground fence. Background clears private projection and retires in-flight reads.
   * Safe return triggers a fresh GET when focused — never restores obsolete private UI from cache.
   */
  setForeground = (active: boolean) => {
    if (active === this.state.foreground) return;
    this.readSerial++;
    const foregroundGen = this.state.foregroundGen + 1;
    if (!active) {
      this.show({
        foreground: false,
        foregroundGen,
        readGen: this.readSerial,
        status: 'idle',
        projection: null,
        notice: null,
        openFailure: false,
      });
      return;
    }
    this.show({
      foreground: true,
      foregroundGen,
      readGen: this.readSerial,
      status: 'idle',
      projection: null,
      notice: null,
      openFailure: false,
    });
    if (this.state.focus) void this.load();
  };

  /** Bind panel to game+venue. Release retires only this viewGen. */
  focus = (gameId: string, venueId: string): (() => void) => {
    const noop = () => {};
    if (!this.state.actor || !gameId || !venueId) return noop;
    const viewGen = ++this.viewSerial;
    this.readSerial++;
    this.show({
      focus: Object.freeze({ gameId, venueId, viewGen }),
      readGen: this.readSerial,
      status: 'idle',
      projection: null,
      notice: null,
      openFailure: false,
    });
    return () => this.releaseFocus(viewGen);
  };

  releaseFocus = (viewGen: number) => {
    if (!this.state.focus || this.state.focus.viewGen !== viewGen) return;
    this.readSerial++;
    this.show({
      focus: null,
      readGen: this.readSerial,
      status: 'idle',
      projection: null,
      notice: null,
      openFailure: false,
    });
  };

  /**
   * Authenticated detail GET → private projection only.
   * Clears displayed private data before awaiting; late responses after lease/actor change are no-ops.
   */
  load = async (permit?: PrivateContactsSurfacePermit) => {
    const actor = this.state.actor;
    const focus = this.state.focus;
    // A newer load supersedes an in-flight read (refresh clears private data before await).
    if (!actor || !focus) return;
    if (!this.state.foreground) return;
    if (permit && !this.surfaceLive(permit)) return;
    if (permit && (permit.gameId !== focus.gameId || permit.venueId !== focus.venueId || permit.viewGen !== focus.viewGen)) return;
    const readGen = ++this.readSerial;
    const viewGen = focus.viewGen;
    const { gameId, venueId } = focus;
    const live = () => this.readLive(actor, readGen, viewGen);
    // Clear stale private values before the network await.
    this.show({
      status: 'loading',
      readGen,
      projection: null,
      notice: null,
      openFailure: false,
    });
    try {
      const projection = await this.port.read(gameId, venueId, live);
      if (!live()) return;
      this.show({
        status: 'ready',
        projection,
        notice: null,
        openFailure: false,
      });
    } catch {
      if (!live()) return;
      this.show({
        status: 'error',
        projection: null,
        notice: 'Не удалось загрузить контакты площадки. Попробуйте ещё раз.',
        openFailure: false,
      });
    }
  };

  /**
   * Production callback/permit helper: synchronously admit the exact validated URL, then open.
   * Retired permits (refresh/blur/logout/actor/game/venue/A→B→A) are no-ops with zero opens.
   * Late Linking completion must not restore obsolete private UI.
   */
  open = async (permit: PrivateContactsRenderedPermit): Promise<'opened' | 'blocked' | 'failed'> => {
    if (!this.permitLive(permit)) return 'blocked';
    const url = permit.action.url;
    const openUrl = this.port.openUrl;
    if (!openUrl) return 'blocked';
    try {
      await openUrl(url);
      if (!this.permitLive(permit)) return 'opened';
      this.show({ openFailure: false });
      return 'opened';
    } catch {
      if (!this.permitLive(permit)) return 'failed';
      this.show({ openFailure: true });
      return 'failed';
    }
  };

  /**
   * Production link callback factory: captures immutable renderedPermit ON CREATION (not on click).
   * ContactRow and behavioral tests invoke the returned handler; retired handlers open zero URLs
   * even when a later projection shows the same phone/site.
   */
  createContactOpenHandler = (action: PrivateVenueContactAction): (() => void) | null => {
    const permit = this.renderedPermit(action);
    if (!permit) return null;
    return () => {
      this.clearOpenFailure(permit);
      void this.open(permit);
    };
  };

  clearOpenFailure = (permit?: PrivateContactsRenderedPermit) => {
    if (permit && !this.permitLive(permit)) return;
    if (!this.state.openFailure) return;
    this.show({ openFailure: false });
  };
}
