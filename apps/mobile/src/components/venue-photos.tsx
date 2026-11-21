import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { API_ORIGIN, publicApi } from '../public-api.ts';
import type { CommunityPhoto } from '../venue-community.ts';
import { colors } from '../theme.ts';
import { Label, OutlineButton, styles } from './ui.tsx';

type Phase = 'loading' | 'ready' | 'error';

/** Always-rendered «Фотографии сообщества» — GET /v1/venues/{id}/community-photos (no upload). */
export function VenueCommunityPhotosSection({ venueId }: { venueId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<CommunityPhoto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);

  const load = useCallback((reset: boolean, signal?: AbortSignal) => {
    if (busy.current) return;
    const cursor = reset ? undefined : cursorRef.current ?? undefined;
    if (!reset && cursor === undefined) return;
    const request = ++epoch.current;
    busy.current = true;
    setPhase('loading');
    if (reset) {
      setItems([]);
      cursorRef.current = null;
      setHasMore(false);
    }
    void publicApi.communityPhotos(venueId, cursor, signal).then(page => {
      if (request !== epoch.current) return;
      busy.current = false;
      setItems(prev => reset ? [...page.items] : [...prev, ...page.items]);
      cursorRef.current = page.nextCursor;
      setHasMore(page.nextCursor !== null);
      setPhase('ready');
    }, () => {
      if (request !== epoch.current) return;
      busy.current = false;
      setPhase('error');
    });
  }, [venueId]);

  useEffect(() => {
    const controller = new AbortController();
    load(true, controller.signal);
    return () => {
      controller.abort();
      epoch.current += 1;
      busy.current = false;
    };
  }, [load]);

  return <View style={styles.card} accessibilityLabel="Фотографии сообщества">
    <Label accessibilityRole="header" style={styles.subtitle}>Фотографии сообщества</Label>
    <Label style={{ color: colors.secondary }}>Фотографии из публикаций об этой площадке</Label>
    {items.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((photo, index) => <CommunityPhotoThumb key={photo.id} photo={photo} index={index} />)}
    </View>}
    {phase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем фотографии…</Label>}
    {phase === 'ready' && items.length === 0 && <Label>Пока нет фотографий сообщества.</Label>}
    {phase === 'error' && <>
      <Label accessibilityRole="alert">Не удалось загрузить фотографии.</Label>
      <OutlineButton title="Повторить" onPress={() => load(items.length === 0)} />
    </>}
    {hasMore && phase !== 'error' && (
      <OutlineButton title="Ещё фотографии" disabled={phase === 'loading'} onPress={() => load(false)} />
    )}
  </View>;
}

function CommunityPhotoThumb({ photo, index }: { photo: CommunityPhoto; index: number }) {
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
