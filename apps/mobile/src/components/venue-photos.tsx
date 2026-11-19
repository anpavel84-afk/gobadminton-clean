import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { API_ORIGIN } from '../public-api.ts';
import type { Photo } from '../venue-community.ts';
import { colors } from '../theme.ts';
import { Label, styles } from './ui.tsx';

/** Community photos from already-loaded comment photos only — no new photo endpoints. */
export function VenueCommunityPhotosSection({ photos }: { photos: readonly Photo[] }) {
  if (!photos.length) return null;
  return <View style={styles.card} accessibilityLabel="Фотографии сообщества">
    <Label accessibilityRole="header" style={styles.subtitle}>Фотографии сообщества</Label>
    <Label style={{ color: colors.secondary }}>Фотографии из публикаций об этой площадке</Label>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {photos.map((photo, index) => <CommunityPhotoThumb key={photo.id} photo={photo} index={index} />)}
    </View>
  </View>;
}

function CommunityPhotoThumb({ photo, index }: { photo: Photo; index: number }) {
  const [failed, setFailed] = useState(false);
  return <Pressable accessibilityRole="image" accessibilityLabel={`Фото сообщества ${index + 1}`}
    style={{ width: '47%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.paper }}>
    {failed
      ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        <Label style={{ fontSize: 12, lineHeight: 16, textAlign: 'center' }}>Фото недоступно</Label>
      </View>
      : <Image source={{ uri: `${API_ORIGIN}${photo.url}` }} accessibilityLabel={`Фото сообщества ${index + 1}`}
        resizeMode="cover" onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />}
  </Pressable>;
}

/** Collect unique comment photos already present in loaded community threads. */
export function commentPhotosFromThreads(
  roots: { pages: { page: { items: { photos: Photo[] }[] } }[] },
  replies: Record<string, { pages: { page: { items: { photos: Photo[] }[] } }[] }>,
): Photo[] {
  const seen = new Set<string>();
  const out: Photo[] = [];
  const visit = (items: { photos: Photo[] }[]) => {
    for (const comment of items) {
      for (const photo of comment.photos) {
        if (seen.has(photo.id)) continue;
        seen.add(photo.id);
        out.push(photo);
      }
    }
  };
  for (const page of roots.pages) visit(page.page.items);
  for (const thread of Object.values(replies)) {
    for (const page of thread.pages) visit(page.page.items);
  }
  return out;
}
