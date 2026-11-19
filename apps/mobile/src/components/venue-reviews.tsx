import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { publicApi } from '../public-api.ts';
import type { PublicVenueReviewItem } from '../venue-reviews.ts';
import { TOPIC_LABEL } from '../venue-reviews.ts';
import { colors } from '../theme.ts';
import { Label, OutlineButton, styles } from './ui.tsx';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Read-only public «Отзывы после игры» panel (no review write flows). */
export function VenueReviewsSection({ venueId }: { venueId: string }) {
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<PublicVenueReviewItem[]>([]);
  const epoch = useRef(0);

  const reload = useCallback((signal?: AbortSignal) => {
    const request = ++epoch.current;
    setState('loading');
    void publicApi.experienceReviews(venueId, undefined, 5, signal).then(summary => {
      if (request !== epoch.current) return;
      setItems(summary.items);
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
      <View key={item.reviewHandle} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}>
        <Label style={{ color: colors.secondary, fontSize: 14, lineHeight: 20 }}>
          {item.authorLabel}
          {item.topics.length
            ? ` · ${item.topics.map(t => TOPIC_LABEL[t] ?? t).join(', ')}`
            : ''}
        </Label>
        <Label>{item.text}</Label>
      </View>
    ))}
  </View>;
}
