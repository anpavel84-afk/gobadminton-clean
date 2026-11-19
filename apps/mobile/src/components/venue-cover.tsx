import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { API_ORIGIN } from '../public-api.ts';
import { colors } from '../theme.ts';
import {
  VENUE_ILLUSTRATION_ALT,
  VENUE_ILLUSTRATION_BADGE,
  venueCoverChoice,
  venueIllustrationKey,
  type VenueIllustrationKey,
} from '../venue-illustration.ts';
import { Label } from './ui.tsx';

// Metro needs literal requires to bundle native image assets.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const racketIllustration: ImageSourcePropType = require('../../assets/racket-v1.webp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const handIllustration: ImageSourcePropType = require('../../assets/hand-v1.webp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shuttlesIllustration: ImageSourcePropType = require('../../assets/shuttles-v1.webp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pairIllustration: ImageSourcePropType = require('../../assets/pair-v1.webp');
const illustrationSources: Record<VenueIllustrationKey, ImageSourcePropType> = {
  'racket-v1': racketIllustration,
  'hand-v1': handIllustration,
  'shuttles-v1': shuttlesIllustration,
  'pair-v1': pairIllustration,
};

export function venueIllustrationSource(venueId: string): ImageSourcePropType {
  return illustrationSources[venueIllustrationKey(venueId)];
}

/** Shared cover/thumbnail: photo when available; load failure and absence → per-venue illustration + badge. */
export function VenueCover({
  venueId,
  name,
  photoUrl = null,
  size = 'thumb',
}: {
  venueId: string;
  name: string;
  photoUrl?: string | null;
  size?: 'thumb' | 'sheet' | 'page';
}) {
  const choice = venueCoverChoice(venueId, photoUrl);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  useEffect(() => { setFailedPhoto(null); }, [photoUrl, venueId]);
  const showPhoto = choice.kind === 'photo' && failedPhoto !== choice.url;
  const illustrationKey = choice.kind === 'illustration' ? choice.key : venueIllustrationKey(venueId);
  const frame = size === 'thumb'
    ? { width: 64 as const, height: 64 as const, borderRadius: 12 }
    : { width: '100%' as const, aspectRatio: 16 / 9, borderRadius: 12 };
  const badge = size === 'thumb'
    ? { position: 'absolute' as const, bottom: 0, left: 0, right: 0, fontSize: 10, lineHeight: 14, backgroundColor: colors.card, textAlign: 'center' as const }
    : { position: 'absolute' as const, bottom: 8, left: 8, fontSize: 12, lineHeight: 16, backgroundColor: colors.card, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' as const };
  return <View style={{ ...frame, backgroundColor: colors.paper, overflow: 'hidden' }}>
    {showPhoto
      ? <Image
          key={choice.url}
          source={{ uri: `${API_ORIGIN}${choice.url}` }}
          resizeMode="cover"
          accessibilityLabel={`Обложка: ${name}`}
          onError={() => setFailedPhoto(choice.url)}
          style={size === 'thumb' ? { width: 64, height: 64 } : { width: '100%', aspectRatio: 16 / 9 }}
        />
      : <Image
          source={illustrationSources[illustrationKey]}
          resizeMode="cover"
          accessibilityLabel={VENUE_ILLUSTRATION_ALT}
          style={size === 'thumb' ? { width: 64, height: 64 } : { width: '100%', aspectRatio: 16 / 9 }}
        />}
    {!showPhoto && <Label accessible={false} style={badge}>{VENUE_ILLUSTRATION_BADGE}</Label>}
  </View>;
}
