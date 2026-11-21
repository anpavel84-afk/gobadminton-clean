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
  | 'rejected'
  | 'retryable'
  | 'unknown'
  | 'withdrawing'
  | 'withdraw_failed';

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

/** Ready receipt ids only; withdrawing / withdraw_failed / keyed removals never count. */
export function readyPhotoIds(items: readonly PhotoComposerItem[]): string[] {
  return items
    .filter(item => item.state === 'ready'
      && !item.withdrawKey
      && item.receipt
      && item.receipt.status === 'ready')
    .map(item => item.receipt!.id);
}

export function hasCheckingPhoto(items: readonly PhotoComposerItem[]): boolean {
  return items.some(item => item.state === 'checking' || item.state === 'withdrawing');
}

/** Send when trimmed text is non-empty or ≥1 ready photo; never while a photo is checking. */
export function commentSendReady(text: string, items: readonly PhotoComposerItem[]): boolean {
  if (hasCheckingPhoto(items)) return false;
  const ready = readyPhotoIds(items);
  if (ready.length > MAX_COMMENT_PHOTOS) return false;
  return Boolean(text.trim() || ready.length);
}

export function photoStatusLabel(state: PhotoItemState): string {
  if (state === 'checking') return 'Проверяется…';
  if (state === 'withdrawing') return 'Снимается…';
  if (state === 'ready') return 'Готово';
  if (state === 'rejected') return 'Отклонено';
  if (state === 'retryable') return 'Можно повторить позже';
  if (state === 'withdraw_failed') return 'Снятие не подтверждено';
  return 'Результат пока неизвестен';
}

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
  if ([409, 503].includes(status)) {
    return { state: 'retryable', message: 'Проверка временно недоступна. Повторите позже.' };
  }
  return { state: 'unknown', message: 'Результат пока неизвестен. Повтор использует ту же попытку.' };
}
