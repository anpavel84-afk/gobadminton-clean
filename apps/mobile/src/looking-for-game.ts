import type { Looking } from './profile.ts';

/** WEB form TTLs only — never fall through to server 1440 default. */
export const LOOKING_TTL_1H = 60 as const;
export const LOOKING_TTL_3H = 180 as const;
export type LookingTtlMinutes = typeof LOOKING_TTL_1H | typeof LOOKING_TTL_3H;
export const LOOKING_TTL_OPTIONS: ReadonlyArray<{ minutes: LookingTtlMinutes; label: string }> = [
  { minutes: LOOKING_TTL_1H, label: '1 час' },
  { minutes: LOOKING_TTL_3H, label: '3 часа' },
];
export const LOOKING_TTL_DEFAULT: LookingTtlMinutes = LOOKING_TTL_3H;

export type LookingPutBody = Readonly<{
  cityId: string;
  areaKey: string | null;
  ttlMinutes: LookingTtlMinutes;
  expectedVersion?: number;
}>;

export function lookingPutWire(body: LookingPutBody): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    cityId: body.cityId,
    areaKey: body.areaKey,
    ttlMinutes: body.ttlMinutes,
  };
  if (body.expectedVersion !== undefined) wire.expectedVersion = body.expectedVersion;
  return wire;
}

/** Empty DELETE body — no invented CAS / expectedVersion. */
export function lookingDeleteWire(): Record<string, never> {
  return {};
}

export function isLookingTtlMinutes(value: unknown): value is LookingTtlMinutes {
  return value === LOOKING_TTL_1H || value === LOOKING_TTL_3H;
}

export function lookingIntentActive(intent: Looking | null | undefined, nowMs = Date.now()): boolean {
  if (!intent || intent.state !== 'active') return false;
  if (intent.expiresAt) {
    const expires = Date.parse(intent.expiresAt);
    if (!Number.isNaN(expires) && expires <= nowMs) return false;
  }
  return true;
}

export function lookingIntentExpired(intent: Looking | null | undefined, nowMs = Date.now()): boolean {
  if (!intent || intent.state !== 'active' || !intent.expiresAt) return false;
  const expires = Date.parse(intent.expiresAt);
  return !Number.isNaN(expires) && expires <= nowMs;
}

export function lookingStatusLabel(intent: Looking | null | undefined, nowMs = Date.now()): string {
  if (lookingIntentActive(intent, nowMs)) {
    const parts: string[] = [];
    if (intent?.areaKey) parts.push(intent.areaKey);
    if (intent?.expiresAt) {
      const expires = Date.parse(intent.expiresAt);
      if (!Number.isNaN(expires)) {
        parts.push(`До ${new Date(expires).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
      }
    }
    return parts.length ? parts.join(' · ') : 'Включено';
  }
  if (lookingIntentExpired(intent, nowMs)) return 'Срок поиска истёк';
  return 'Сейчас выключено';
}

export function lookingAreaDraft(intent: Looking | null | undefined, profileArea: string | null | undefined): string {
  return intent?.areaKey ?? profileArea ?? '';
}
