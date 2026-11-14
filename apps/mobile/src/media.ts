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

/** Same uploaded media authorities as accepted WEB ProfileComposition / CoverEditor. */
export function playerMediaUrl(value: unknown, kind: 'avatar' | 'cover'): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const uploaded = kind === 'avatar' ? /^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/ : /^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/;
  if (uploaded.test(value)) return `${API_ORIGIN}${value}`;
  if (kind !== 'avatar') return null;
  // Reject normalization tricks, empty userinfo, escaped authorities and control characters before URL parsing.
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#]|$)/i.test(value) || /[\u0000-\u0020\u007f-\u009f\\\ud800-\udfff]/u.test(value)) return null;
  try {
    if (/[\u0000-\u001f\u007f-\u009f\\]/u.test(decodeURIComponent(value))) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'avatars.yandex.net' || url.hostname.endsWith('.userapi.com')) ? url.href : null;
  } catch { return null; }
}
