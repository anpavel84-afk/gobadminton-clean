/** Pure venue comment-photo helpers — mirrors web isPhotoReceipt + lean composer state. */

export const PHOTO_RIGHTS = 'community-photo-rights-v1';
export const MAX_COMMENT_PHOTOS = 4;
export const COMMENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const COMMENT_PHOTO_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'] as const);
export type CommentPhotoMime = (typeof COMMENT_PHOTO_MIMES)[number];

export type VenueCommentPhotoReceipt = {
  id: string;
  venueId: string;
  status: 'ready' | 'withdrawn';
  version: number;
  expiresAt: string;
  width: number;
  height: number;
  previewPath: string | null;
};

function isPhotoId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Mirrors web `isPhotoReceipt` exactly. */
export function isPhotoReceipt(
  value: unknown,
  venueId: string,
  status: 'ready' | 'withdrawn',
  id?: string,
): value is VenueCommentPhotoReceipt {
  if (!value || typeof value !== 'object') return false;
  const row = value as VenueCommentPhotoReceipt;
  return isPhotoId(row.id) && (!id || row.id === id) && row.venueId === venueId
    && row.status === status && row.version === (status === 'ready' ? 1 : 2)
    && Number.isFinite(Date.parse(row.expiresAt))
    && (status !== 'ready' || Date.parse(row.expiresAt) > Date.now())
    && Number.isInteger(row.width) && row.width > 0 && row.width <= 1600
    && Number.isInteger(row.height) && row.height > 0 && row.height <= 1600
    && row.previewPath === (status === 'ready' ? `/v1/me/venue-photo-submissions/${row.id}/content` : null);
}

export function isCommentPhotoMime(value: string): value is CommentPhotoMime {
  return (COMMENT_PHOTO_MIMES as readonly string[]).includes(value);
}

/** Magic-byte mime for JPEG/PNG/WebP; HEIC/other → null (no conversion). */
export function detectCommentPhotoMime(bytes: Uint8Array): CommentPhotoMime | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.byteLength >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.byteLength >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

/** HEIC/HEIF ftyp brand — reject before upload; no conversion on this surface. */
export function isHeicCommentSource(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return ['heic', 'heif', 'mif1', 'msf1', 'heix', 'hevc', 'hevx'].includes(brand);
}

export type PhotoItemState =
  | 'checking'
  | 'ready'
  | 'expired'
  | 'rejected'
  | 'retryable'
  | 'unknown'
  | 'withdrawing'
  | 'withdraw_failed';

/** Publish-time TTL — mirrors API `expires_at > now` / web `Date.parse(expiresAt) > Date.now()`. */
export function receiptUnexpired(
  receipt: Pick<VenueCommentPhotoReceipt, 'expiresAt'>,
  now = Date.now(),
): boolean {
  return Date.parse(receipt.expiresAt) > now;
}

export type PhotoComposerItem = {
  key: string;
  mime: CommentPhotoMime;
  size: number;
  state: PhotoItemState;
  receipt?: VenueCommentPhotoReceipt;
  /** Frozen DELETE idempotency key — retry must reuse, never re-upload. */
  withdrawKey?: string;
  message?: string;
};

export type PhotoComposerAction =
  | { type: 'add'; key: string; mime: CommentPhotoMime; size: number }
  | {
    type: 'patch';
    key: string;
    state: PhotoItemState;
    receipt?: VenueCommentPhotoReceipt;
    withdrawKey?: string;
    message?: string;
  }
  | { type: 'drop'; key: string }
  | { type: 'retireIds'; ids: readonly string[] }
  | { type: 'clear' };

export function photoComposerReducer(
  items: readonly PhotoComposerItem[],
  action: PhotoComposerAction,
): PhotoComposerItem[] {
  switch (action.type) {
    case 'clear':
      return [];
    case 'drop':
      return items.filter(item => item.key !== action.key);
    case 'retireIds': {
      const ids = new Set(action.ids);
      return items.filter(item => !(item.receipt && ids.has(item.receipt.id)));
    }
    case 'add': {
      if (items.length >= MAX_COMMENT_PHOTOS) return [...items];
      if (items.some(item => item.key === action.key)) return [...items];
      return [...items, { key: action.key, mime: action.mime, size: action.size, state: 'checking' }];
    }
    case 'patch': {
      return items.map(item => {
        if (item.key !== action.key) return item;
        return {
          ...item,
          state: action.state,
          message: action.message,
          ...(action.receipt !== undefined ? { receipt: action.receipt } : {}),
          ...(action.withdrawKey !== undefined ? { withdrawKey: action.withdrawKey } : {}),
        };
      });
    }
  }
}

/** Operation-key → attached ready photo ids; lives next to drafts (same owner lifetime). */
export type PendingPublishMap = ReadonlyMap<string, readonly string[]>;

export function notePendingPublish(
  pending: PendingPublishMap,
  packetKey: string,
  photoIds: readonly string[],
): Map<string, readonly string[]> {
  const next = new Map(pending);
  next.set(packetKey, Object.freeze([...photoIds]));
  return next;
}

/**
 * When a tracked create becomes confirmed, retire those photo ids.
 * Refused clears the association only — drafts stay; caller rechecks expiry
 * (photoUnavailable / TTL) so expired receipts are marked, not resubmitted.
 * Unknown/pending keep the association across composer remounts.
 */
export function applyPublishOperationUpdates(
  pending: PendingPublishMap,
  operations: readonly { packet: { key: string }; status: string }[],
): { pending: Map<string, readonly string[]>; retireIds: string[]; refusedWithPhotos: boolean } {
  const next = new Map(pending);
  const retireIds: string[] = [];
  let refusedWithPhotos = false;
  for (const [packetKey, photoIds] of pending) {
    const operation = operations.find(o => o.packet.key === packetKey);
    if (!operation) continue;
    if (operation.status === 'confirmed') {
      retireIds.push(...photoIds);
      next.delete(packetKey);
    } else if (operation.status === 'refused') {
      refusedWithPhotos = true;
      next.delete(packetKey);
    }
  }
  return { pending: next, retireIds, refusedWithPhotos };
}

/**
 * Pending-read counter delta applies only while the continuation is still current.
 * Stale completions after a scope/generation reset must not change the new count.
 */
export function applyPendingReadDelta(
  pending: number,
  delta: 1 | -1,
  alive: boolean,
  epoch: number,
  currentGeneration: number,
): number {
  if (!alive || epoch !== currentGeneration) return pending;
  return Math.max(0, pending + delta);
}

/**
 * Ready receipt ids only; withdrawing / withdraw_failed / keyed removals / expired never count.
 * `now` is injectable so expiry tests stay deterministic (web rechecks `expiresAt` at Send time).
 */
export function readyPhotoIds(items: readonly PhotoComposerItem[], now = Date.now()): string[] {
  return items
    .filter(item => item.state === 'ready'
      && !item.withdrawKey
      && item.receipt
      && item.receipt.status === 'ready'
      && receiptUnexpired(item.receipt, now))
    .map(item => item.receipt!.id);
}

export function hasCheckingPhoto(items: readonly PhotoComposerItem[]): boolean {
  return items.some(item => item.state === 'checking' || item.state === 'withdrawing');
}

/**
 * Mirrors web `ready()`: every active (!withdrawKey) draft must be unexpired ready;
 * Send when trimmed text is non-empty or ≥1 such photo; never while checking/withdrawing.
 */
export function commentSendReady(
  text: string,
  items: readonly PhotoComposerItem[],
  now = Date.now(),
): boolean {
  if (hasCheckingPhoto(items)) return false;
  const active = items.filter(item => !item.withdrawKey);
  if (active.length > MAX_COMMENT_PHOTOS) return false;
  const allPublishable = active.every(item => item.state === 'ready'
    && item.receipt
    && item.receipt.status === 'ready'
    && receiptUnexpired(item.receipt, now));
  if (!allPublishable) return false;
  return Boolean(text.trim() || active.length);
}

/** Patch ready drafts whose receipt TTL has elapsed — used after create photoUnavailable refuse. */
export function expireStaleReadyPhotos(
  items: readonly PhotoComposerItem[],
  now = Date.now(),
): PhotoComposerItem[] {
  return items.map(item => {
    if (item.state !== 'ready' || item.withdrawKey || !item.receipt) return item;
    if (receiptUnexpired(item.receipt, now)) return item;
    return {
      ...item,
      state: 'expired' as const,
      message: 'Срок действия истёк. Уберите фото и добавьте снова.',
    };
  });
}

/**
 * Nearest future `expiresAt` among currently-ready (publishable) drafts.
 * Used to schedule a one-shot UI refresh when the next receipt TTL elapses.
 */
export function nextReadyPhotoExpiresAt(
  items: readonly PhotoComposerItem[],
  now = Date.now(),
): number | null {
  let nearest: number | null = null;
  for (const item of items) {
    if (item.state !== 'ready' || item.withdrawKey || !item.receipt) continue;
    if (item.receipt.status !== 'ready') continue;
    const at = Date.parse(item.receipt.expiresAt);
    if (!Number.isFinite(at) || at <= now) continue;
    if (nearest === null || at < nearest) nearest = at;
  }
  return nearest;
}

/**
 * Send press-time decision (web onSubmit recheck): use CURRENT ready ids at `now`,
 * not a render-cached readyIds array. Photo-only with zero currently-ready ids
 * must not submit and should refresh expiry presentation.
 */
export function evaluateCommentCreateAtPress(
  text: string,
  items: readonly PhotoComposerItem[],
  options: { textValid: boolean; checking: boolean; now?: number },
): { submit: false; refreshExpiry: boolean } | { submit: true; photoIds: string[] } {
  const now = options.now ?? Date.now();
  if (options.checking) return { submit: false, refreshExpiry: false };
  const photoIds = readyPhotoIds(items, now);
  const trimmed = text.trim();
  if (trimmed) {
    if (!options.textValid) return { submit: false, refreshExpiry: false };
    return { submit: true, photoIds };
  }
  if (photoIds.length === 0) return { submit: false, refreshExpiry: true };
  return { submit: true, photoIds };
}

export function photoStatusLabel(state: PhotoItemState): string {
  if (state === 'checking') return 'Проверяется…';
  if (state === 'withdrawing') return 'Снимается…';
  if (state === 'ready') return 'Готово';
  if (state === 'expired') return 'Срок истёк';
  if (state === 'rejected') return 'Отклонено';
  if (state === 'retryable') return 'Можно повторить позже';
  if (state === 'withdraw_failed') return 'Снятие не подтверждено';
  return 'Результат пока неизвестен';
}

/** Status line + derived expiry when state is still `ready` but TTL elapsed (web Send recheck). */
export function photoItemStatusLabel(item: PhotoComposerItem, now = Date.now()): string {
  if (
    item.state === 'ready'
    && item.receipt
    && !item.withdrawKey
    && !receiptUnexpired(item.receipt, now)
  ) {
    return 'Срок истёк';
  }
  return photoStatusLabel(item.state);
}

export function photoItemMessage(item: PhotoComposerItem, now = Date.now()): string | undefined {
  if (
    item.state === 'ready'
    && item.receipt
    && !item.withdrawKey
    && !receiptUnexpired(item.receipt, now)
  ) {
    return 'Срок действия истёк. Уберите фото и добавьте снова.';
  }
  if (item.state === 'expired') {
    return item.message ?? 'Срок действия истёк. Уберите фото и добавьте снова.';
  }
  return item.message;
}

/**
 * Upload outcome mapping — mirrors web `perform()`:
 * final reject: 400/403/404/413/415/422; retryable: 429; unknown: 409/503/network.
 */
export function mapUploadFailure(status: number, code: string): { state: PhotoItemState; message: string } {
  if (status === 422 || code === 'PUBLIC_IMAGE_CONTENT_REJECTED') {
    return { state: 'rejected', message: 'Фото отклонено. Удалите его из публикации.' };
  }
  if ([400, 403, 404, 413, 415].includes(status)) {
    return { state: 'rejected', message: 'Фото недоступно или не принято. Удалите его из публикации.' };
  }
  if (status === 429) {
    return { state: 'retryable', message: 'Проверка временно недоступна. Повторите позже.' };
  }
  // 409 / 503 / other — web keeps UNKNOWN (same idempotency key on retry), not a fresh upload.
  return { state: 'unknown', message: 'Результат пока неизвестен. Повтор использует ту же попытку.' };
}
