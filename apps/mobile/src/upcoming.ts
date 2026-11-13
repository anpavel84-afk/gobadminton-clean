import type { GamePage } from './public-api.ts';

// Same strict future boundary as web futureDiscoveryItems; no date/day filters
// are introduced in M1. Reapply on receipt, page merge and visible cached items.
export function futureItems<T extends { startsAt: string }>(items: readonly T[], now = Date.now()): T[] {
  return items.filter(item => Number.isFinite(Date.parse(item.startsAt)) && Date.parse(item.startsAt) > now);
}

export function appendUpcomingPage(previous: GamePage, page: GamePage, now = Date.now()): GamePage {
  const items = new Map(previous.items.map(item => [item.id, item]));
  page.items.forEach(item => items.set(item.id, item));
  return { items: futureItems([...items.values()], now), nextCursor: page.nextCursor };
}

// One local expiry wake-up, not a polling request or a splash delay. Clamp to
// the JS timer limit for games far in the future; return null for honest empty.
export function nextExpiryDelay(items: readonly { startsAt: string }[], now = Date.now()): number | null {
  const upcoming = futureItems(items, now);
  if (!upcoming.length) return null;
  const next = Math.min(...upcoming.map(item => Date.parse(item.startsAt)));
  return Math.min(2_147_483_647, Math.max(1, next - now));
}
