import { PublicApiError } from './public-api.ts';
import { isVenueId } from './venues.ts';

export type VenueReviewTopic = 'surface' | 'lighting' | 'amenities';

export type PublicVenueReviewItem = {
  reviewHandle: string;
  authorLabel: 'Участник игры';
  text: string;
  topics: VenueReviewTopic[];
  publishedRevision: number;
  publishedAt: string;
};

export type VenueReviewsSummary = {
  venueId: string;
  publishedCount: number;
  items: PublicVenueReviewItem[];
  nextCursor: string | null;
  canWriteHint: boolean;
};

const TOPICS = new Set<string>(['surface', 'lighting', 'amenities']);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicApiError('invalid');
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

/** Closed parser for GET /v1/venues/{id}/experience-reviews — public read only. */
export function parseVenueReviewsSummary(value: unknown, venueId: string): VenueReviewsSummary {
  if (!isVenueId(venueId)) throw new PublicApiError('invalid');
  const row = object(value);
  if (!isVenueId(row.venueId) || row.venueId !== venueId) throw new PublicApiError('invalid');
  if (!Number.isInteger(row.publishedCount) || Number(row.publishedCount) < 0) throw new PublicApiError('invalid');
  if (!(row.nextCursor === null || text(row.nextCursor) && row.nextCursor.length > 0 && row.nextCursor.length <= 4096)) {
    throw new PublicApiError('invalid');
  }
  if (typeof row.canWriteHint !== 'boolean') throw new PublicApiError('invalid');
  if (!Array.isArray(row.items)) throw new PublicApiError('invalid');
  const items = row.items.map(item => {
    const entry = object(item);
    if (!text(entry.reviewHandle) || entry.reviewHandle.length !== 32) throw new PublicApiError('invalid');
    if (entry.authorLabel !== 'Участник игры') throw new PublicApiError('invalid');
    if (!text(entry.text) || entry.text.length < 1 || entry.text.length > 500) throw new PublicApiError('invalid');
    if (!Array.isArray(entry.topics) || entry.topics.length > 3 || entry.topics.some(t => !TOPICS.has(String(t)))) {
      throw new PublicApiError('invalid');
    }
    if (!Number.isInteger(entry.publishedRevision) || Number(entry.publishedRevision) < 1) throw new PublicApiError('invalid');
    if (!date(entry.publishedAt)) throw new PublicApiError('invalid');
    return {
      reviewHandle: entry.reviewHandle,
      authorLabel: 'Участник игры' as const,
      text: entry.text,
      topics: entry.topics as VenueReviewTopic[],
      publishedRevision: entry.publishedRevision as number,
      publishedAt: entry.publishedAt,
    };
  });
  return {
    venueId,
    publishedCount: row.publishedCount as number,
    items,
    nextCursor: row.nextCursor as string | null,
    canWriteHint: row.canWriteHint,
  };
}

export const TOPIC_LABEL: Record<VenueReviewTopic, string> = {
  surface: 'Покрытие',
  lighting: 'Свет',
  amenities: 'Удобства',
};
