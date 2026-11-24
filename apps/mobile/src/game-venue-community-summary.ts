import { parseSummaries, type CommunityRatingSummary } from './venue-community.ts';

/** Venue-keyed public summary read — independent of private contacts / community owner. */
export function communitySummaryResourceKey(venueId: string): string {
  return `game-venue-community-summary:${venueId}`;
}

export function communityRatingCountLabel(count: number): string {
  const mod10 = count % 10, mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? 'оценка' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'оценки' : 'оценок'}`;
}

export function formatCommunityAverage(average: number): string {
  return average.toFixed(1).replace('.', ',');
}

export type CompactSummaryPhase = 'loading' | 'error' | 'unavailable' | 'empty' | 'available';

/** Honest presentation phase — never fabricates available scores from omission. */
export function compactSummaryPhase(
  status: 'idle' | 'loading' | 'ready' | 'error',
  summary: CommunityRatingSummary | undefined,
): CompactSummaryPhase {
  if (status === 'loading' || status === 'idle') return 'loading';
  if (status === 'error') return 'error';
  if (!summary || summary.state === 'unavailable') return 'unavailable';
  if (summary.state === 'empty') return 'empty';
  return 'available';
}

export function venueCommunityNavParams(venueId: string): { id: string; from: 'game' } {
  return { id: venueId, from: 'game' };
}

export async function loadGameVenueCommunitySummary(
  venueId: string,
  summary: (venueId: string, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<CommunityRatingSummary> {
  return parseSummaries(await summary(venueId, signal), venueId);
}
