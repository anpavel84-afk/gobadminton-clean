import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { publicApi } from '../public-api.ts';
import type { PublicGame } from '../public-api.ts';
import {
  RoleReputationCoordinator,
  compactHistoryLabel,
  heldHistoryLabel,
  publishedReviewsLabel,
  reviewReplyLabel,
  roleSectionTitle,
  roleTitle,
  ROLE_TOPIC_LABEL,
} from '../role-reputation.ts';
import type { RoleKind, RoleLaneState } from '../role-reputation.ts';
import { colors } from '../theme.ts';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { Label, OutlineButton, TextButton } from './ui.tsx';

function createCardCoordinator() {
  return new RoleReputationCoordinator({
    gameRole: (gameId, role, signal) => publicApi.gameRoleReputation(gameId, role, signal),
    byHandle: (roleHandle, query, signal) => publicApi.roleReputation(roleHandle, query, signal),
  });
}

/**
 * Inline public role-history disclosure for discovery cards — read-only, expand-gated.
 * Composition: toggle → optional actions slot → expanded body (canonical trainer card order).
 */
export function GameRoleReputationDisclosure({
  game,
  actions,
}: {
  game: PublicGame;
  /** Placed after the underline toggle and before the expanded review body. */
  actions?: ReactNode;
}) {
  const [coordinator] = useState(createCardCoordinator);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const wantTraining = game.activityKind === 'trainer_led';

  useEffect(() => {
    coordinator.bind(game.id, { wantTraining });
    return () => { coordinator.collapse(); };
  }, [coordinator, game.id, wantTraining]);

  const expanded = state.expanded && state.gameId === game.id;

  return <View style={styles.wrap}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`Отзывы и история: ${game.title}`}
      onPress={() => coordinator.toggle()}
      style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
    >
      <Label style={styles.toggleLabel}>{expanded ? 'Свернуть' : 'Отзывы и история'}</Label>
      <View style={expanded ? styles.chevronExpanded : styles.chevron} accessible={false}>
        <DiscoveryIcon name="chevron" />
      </View>
    </Pressable>
    {actions}
    {expanded ? <View style={styles.details} accessibilityLiveRegion="polite">
      {wantTraining ? <RoleLaneView lane={state.training} onRetry={() => coordinator.retry('training')}
        onMore={() => coordinator.loadMore('training')} /> : null}
      <RoleLaneView lane={state.organization} onRetry={() => coordinator.retry('organization')}
        onMore={() => coordinator.loadMore('organization')} />
    </View> : null}
  </View>;
}

function RoleLaneView({
  lane,
  onRetry,
  onMore,
}: {
  lane: RoleLaneState;
  onRetry: () => void;
  onMore: () => void;
}) {
  const role: RoleKind = lane.role;
  return <View style={styles.section} accessibilityLabel={roleSectionTitle(role)}>
    <Label style={styles.eyebrow}>{roleTitle(role)}</Label>
    <Label accessibilityRole="header" style={styles.sectionTitle}>{roleSectionTitle(role)}</Label>
    {lane.phase === 'loading' ? <Label>Загружаем отзывы о роли…</Label> : null}
    {lane.phase === 'error' ? <>
      <Label accessibilityRole="alert">Не удалось загрузить отзывы о роли.</Label>
      <OutlineButton title="Повторить" onPress={onRetry} />
    </> : null}
    {lane.phase === 'unavailable' ? <Label>
      Публичная история этой роли сейчас недоступна. Это не значит, что человек «никогда не проводил»
      встречи — подтверждённая история может отсутствовать.
    </Label> : null}
    {lane.phase === 'ready' && lane.summary ? <ReadyRoleBody lane={lane} onMore={onMore} /> : null}
  </View>;
}

function ReadyRoleBody({ lane, onMore }: { lane: RoleLaneState; onMore: () => void }) {
  const summary = lane.summary!;
  const history = lane.role === 'organization'
    ? (compactHistoryLabel(summary.heldGamesCount, summary.historyMayBeIncomplete)
      ?? heldHistoryLabel(summary.heldGamesCount, summary.historyMayBeIncomplete))
    : null;
  return <>
    {history ? <Label style={styles.history}>{history}</Label> : null}
    <Label style={styles.secondary}>{publishedReviewsLabel(summary.publishedReviewCount)}</Label>
    {summary.items.length === 0 ? (
      <Label style={styles.secondary}>Пока нет опубликованных отзывов.</Label>
    ) : summary.items.map(item => (
      <View key={item.reviewHandle} style={styles.review}>
        <Label style={styles.meta}>
          {item.authorLabel}
          {item.experienceState === 'basis_under_review' ? ' · Основание на проверке' : ''}
          {item.topics.length
            ? ` · ${item.topics.map(topic => ROLE_TOPIC_LABEL[topic] ?? topic).join(', ')}`
            : ''}
        </Label>
        <Label>{item.text}</Label>
        {item.reply ? <Label style={styles.reply}>{reviewReplyLabel(item.role, item.reply.text)}</Label> : null}
      </View>
    ))}
    {lane.moreError ? <>
      <Label accessibilityRole="alert">Не удалось загрузить следующие отзывы. Уже загруженные сохранены.</Label>
      <OutlineButton title="Повторить" onPress={onMore} />
    </> : summary.nextCursor ? (
      lane.loadingMore
        ? <Label>Загружаем ещё отзывы…</Label>
        : <TextButton title="Ещё отзывы" onPress={onMore} />
    ) : null}
  </>;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 8, marginTop: 4 },
  // Canonical web discovery.css disclosure (327–343 + mobile 597–600):
  // border:0, transparent, underline, min-height 44; mobile stretch / space-between / padding 8 0.
  toggle: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    minWidth: 44,
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  togglePressed: { opacity: 0.72 },
  toggleLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textDecorationColor: colors.ink,
  },
  chevron: { transform: [{ rotate: '0deg' }] },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  details: { width: '100%', gap: 14, paddingTop: 4 },
  section: { width: '100%', gap: 6 },
  eyebrow: {
    alignSelf: 'flex-start',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  history: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  secondary: { color: colors.secondary, fontSize: 13, lineHeight: 19 },
  review: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  meta: { color: colors.secondary, fontSize: 13, lineHeight: 18 },
  reply: { color: colors.secondary, fontSize: 13, lineHeight: 19 },
});
