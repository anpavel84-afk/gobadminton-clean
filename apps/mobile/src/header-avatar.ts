import { playerMediaUrl } from './media.ts';
import { playerInitials } from './presentation.ts';
import type { OwnProfile } from './profile.ts';

/** Header avatar presentation: uploaded /v1/media/avatars/<64hex>.png only, never providerUrl. */
export function headerAvatarPresentation(input: {
  authenticated: boolean;
  meDisplayName: string | null | undefined;
  profile: OwnProfile | null;
  failedUri?: string | null;
}): { uri: string | null; initials: string } {
  if (!input.authenticated) return { uri: null, initials: '?' };

  const fromProfile = input.profile?.displayName.trim() ?? '';
  const initials = fromProfile
    ? playerInitials(fromProfile)
    : playerInitials(input.meDisplayName ?? '');

  let uri: string | null = null;
  if (input.profile) {
    const candidate = playerMediaUrl(input.profile.avatar.uploadedUrl, 'avatar');
    // Own header uses uploaded media paths only; playerMediaUrl also admits provider hosts elsewhere.
    if (candidate && /\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(candidate)) uri = candidate;
  }
  if (uri != null && uri === input.failedUri) uri = null;
  return { uri, initials };
}
