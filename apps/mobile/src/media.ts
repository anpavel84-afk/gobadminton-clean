import type { PublicGame } from './public-api.ts';
import { API_ORIGIN } from './public-api.ts';

// Port of accepted web GameCover.gameCoverUrl / VenueCover.venueCoverUrl.
// Accept server projections only, never arbitrary remote URLs or provider images.
export function publicCoverPath(value: unknown, kind: 'game' | 'venue'): string | null {
  if (typeof value !== 'string') return null;
  const venue = /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/;
  const game = /^\/v1\/media\/game-covers\/[a-f0-9]{64}\.png$/;
  return venue.test(value) || (kind === 'game' && game.test(value)) ? value : null;
}
export function gameCoverSources(game: PublicGame): string[] {
  const paths = [publicCoverPath(game.cover?.uploadedUrl, 'game'), publicCoverPath(game.venue.cover?.uploadedUrl, 'venue')];
  return [...new Set(paths.filter((path): path is string => path !== null))].map(path => `${API_ORIGIN}${path}`);
}
