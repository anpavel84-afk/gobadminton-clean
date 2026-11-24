import { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  communityRatingCountLabel,
  communitySummaryResourceKey,
  compactSummaryPhase,
  formatCommunityAverage,
  loadGameVenueCommunitySummary,
  venueCommunityNavParams,
} from '../game-venue-community-summary.ts';
import { useResource } from '../hooks.ts';
import { publicApi } from '../public-api.ts';
import { colors } from '../theme.ts';
import { Label, TextButton, styles } from './ui.tsx';

/**
 * Compact public venue community rating on game detail — accepted-web GameVenueContacts
 * summary section. Credential-omit GET; independent of private contacts / NativeVenueCommunity.
 * Signed-in visibility is owned by the game-detail host.
 */
export function GameVenueCommunitySummaryPanel({ venueId }: { venueId: string }) {
  const router = useRouter();
  const task = useCallback(
    (signal: AbortSignal) => loadGameVenueCommunitySummary(venueId, publicApi.communitySummary, signal),
    [venueId],
  );
  const { state, retry } = useResource(communitySummaryResourceKey(venueId), task);
  const summary = state.status === 'ready' ? state.data : undefined;
  const phase = compactSummaryPhase(state.status, summary);

  return <View style={styles.card} accessibilityLabel="Оценки площадки">
    <Label accessibilityRole="header" style={styles.subtitle}>Оценки сообщества</Label>
    <Label style={{ color: colors.secondary }}>
      Впечатления пользователей об этой площадке · не отзывы после игры
    </Label>
    {phase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем оценки…</Label>}
    {phase === 'error' && <>
      <Label accessibilityRole="alert">Не удалось загрузить оценки</Label>
      <TextButton title="Повторить загрузку оценок" onPress={retry} />
    </>}
    {phase === 'unavailable' && <Label>Сводка оценок недоступна</Label>}
    {phase === 'empty' && <Label>Пока нет оценок</Label>}
    {phase === 'available' && summary?.state === 'available' && summary.average !== null && summary.count !== null && (
      <View
        accessible
        accessibilityLabel={`${formatCommunityAverage(summary.average)} из 5 · ${communityRatingCountLabel(summary.count)}`}
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
      >
        <Label accessible={false} style={{ fontSize: 40, lineHeight: 48, fontWeight: '700' }}>
          {formatCommunityAverage(summary.average)}
        </Label>
        <View accessible={false} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Label accessible={false} style={{ color: colors.purple }}>★</Label>
          <Label accessible={false}>
            {communityRatingCountLabel(summary.count)}
            {summary.count < 10 ? ' · пока небольшая выборка' : ''}
          </Label>
        </View>
      </View>
    )}
    <TextButton
      title="Оценки и обсуждение"
      onPress={() => router.push({ pathname: '/venues/[id]', params: venueCommunityNavParams(venueId) })}
    />
  </View>;
}
