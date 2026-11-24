import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ComponentRef, type RefObject,
} from 'react';
import { Pressable, View } from 'react-native';
import { publicApi } from '../public-api.ts';
import {
  PUBLIC_VENUE_REVIEWS_PREVIEW_LIMIT,
  PublicVenueReviewsGallery,
  shouldOpenPublicVenueReviewsGallery,
  TOPIC_LABEL,
  type PublicVenueReviewItem,
} from '../venue-reviews.ts';
import { colors } from '../theme.ts';
import { DiscoverySheet, Label, OutlineButton, styles } from './ui.tsx';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type FocusTarget = ComponentRef<typeof Pressable>;

function ReviewCard({ item }: { item: PublicVenueReviewItem }) {
  return (
    <View style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}>
      <Label style={{ color: colors.secondary, fontSize: 14, lineHeight: 20 }}>
        {item.authorLabel}
        {item.topics.length
          ? ` · ${item.topics.map(t => TOPIC_LABEL[t] ?? t).join(', ')}`
          : ''}
      </Label>
      <Label>{item.text}</Label>
    </View>
  );
}

/** Full-list sheet — independent first20 + exact nextCursor via production gallery owner. */
function VenueReviewsGallerySheet({
  gallery,
  visible,
  onClose,
  returnFocusRef,
}: {
  gallery: PublicVenueReviewsGallery;
  visible: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<FocusTarget | null>;
}) {
  const s = useSyncExternalStore(gallery.subscribe, gallery.getSnapshot, gallery.getSnapshot);
  return (
    <DiscoverySheet
      visible={visible}
      title="Отзывы о площадке"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      {s.phase === 'loading' && s.items.length === 0 && (
        <Label accessibilityLiveRegion="polite">Загружаем…</Label>
      )}
      {s.phase === 'error' && s.items.length === 0 && (
        <>
          <Label accessibilityRole="alert">Не удалось загрузить отзывы.</Label>
          <OutlineButton title="Повторить" onPress={() => gallery.retryFirst()} />
        </>
      )}
      {s.items.map(item => <ReviewCard key={item.reviewHandle} item={item} />)}
      {s.moreError && s.nextCursor ? (
        <>
          <Label accessibilityRole="alert">
            Не удалось загрузить следующие отзывы. Уже загруженные сохранены.
          </Label>
          <OutlineButton
            title="Повторить"
            disabled={s.loadingMore}
            onPress={() => gallery.loadMore()}
          />
        </>
      ) : s.nextCursor ? (
        s.loadingMore
          ? <Label accessibilityLiveRegion="polite">Загружаем…</Label>
          : <OutlineButton title="Ещё" disabled={s.loadingMore} onPress={() => gallery.loadMore()} />
      ) : null}
    </DiscoverySheet>
  );
}

/** Read-only public «Отзывы после игры» panel (no review write flows). */
export function VenueReviewsSection({ venueId }: { venueId: string }) {
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<PublicVenueReviewItem[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const epoch = useRef(0);
  const galleryTrigger = useRef<FocusTarget | null>(null);
  const gallery = useMemo(
    () => new PublicVenueReviewsGallery({
      experienceReviews: (id, cursor, limit, signal) =>
        publicApi.experienceReviews(id, cursor, limit, signal),
    }),
    [],
  );

  const reload = useCallback((signal?: AbortSignal) => {
    const request = ++epoch.current;
    setState('loading');
    void publicApi.experienceReviews(
      venueId,
      undefined,
      PUBLIC_VENUE_REVIEWS_PREVIEW_LIMIT,
      signal,
    ).then(summary => {
      if (request !== epoch.current) return;
      setItems(summary.items);
      setPublishedCount(summary.publishedCount);
      setState('ready');
    }, () => {
      if (request !== epoch.current) return;
      setState('error');
    });
  }, [venueId]);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => { controller.abort(); epoch.current += 1; };
  }, [reload]);

  // Venue change retires an open gallery so late pages cannot cross venues.
  useEffect(() => {
    setGalleryOpen(false);
    gallery.close();
  }, [venueId, gallery]);

  const openGallery = () => {
    setGalleryOpen(true);
    gallery.open(venueId);
  };

  const closeGallery = () => {
    setGalleryOpen(false);
    gallery.close();
  };

  const showAll = state === 'ready'
    && shouldOpenPublicVenueReviewsGallery(publishedCount, items.length);

  return <View style={styles.card} accessibilityLabel="Отзывы после игры">
    <Label style={{
      alignSelf: 'flex-start', fontSize: 12, lineHeight: 16, fontWeight: '600',
      color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.4,
    }}>После игры</Label>
    <Label accessibilityRole="header" style={styles.subtitle}>Отзывы после игры</Label>
    <Label style={{ color: colors.secondary }}>
      Публичные отзывы — от участников с подтверждённым посещением. Автор показан как «Участник
      игры», без профиля и деталей встречи.
    </Label>
    {state === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем отзывы…</Label>}
    {state === 'error' && <>
      <Label accessibilityRole="alert">Не удалось загрузить отзывы.</Label>
      <OutlineButton title="Повторить" onPress={() => reload()} />
    </>}
    {state === 'ready' && items.length === 0 && (
      <Label accessibilityLiveRegion="polite">Отзывы после игр появятся здесь</Label>
    )}
    {state === 'ready' && items.map(item => (
      <ReviewCard key={item.reviewHandle} item={item} />
    ))}
    {showAll && (
      <Pressable
        ref={galleryTrigger}
        accessibilityRole="button"
        accessibilityLabel={`Все отзывы · ${publishedCount}`}
        onPress={openGallery}
        style={({ pressed }) => [{
          alignSelf: 'flex-start' as const,
          minHeight: 48,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.lineDark,
          backgroundColor: pressed ? colors.paper : colors.card,
          justifyContent: 'center' as const,
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginTop: 4,
        }]}
      >
        <Label style={{ fontWeight: '700', textAlign: 'left' }}>
          {`Все отзывы · ${publishedCount}`}
        </Label>
      </Pressable>
    )}
    <VenueReviewsGallerySheet
      gallery={gallery}
      visible={galleryOpen}
      onClose={closeGallery}
      returnFocusRef={galleryTrigger}
    />
  </View>;
}
