import { useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { resourceKey } from '../messages-coordinator.ts';
import type { GameInvitation, MessageResource } from '../messages.ts';
import { invitationCopy, InvitationDecisionBody } from './messages.tsx';
import { isInviteClockExpired, isPendingInvite } from '../my-games.ts';
import { Label, PrimaryButton, TextButton, styles } from './ui.tsx';

/** One deliberately active inline invitation panel — shares root MessagesCoordinator focus/command lease. */
export function MyGameInvitations({
  invitations,
  activeId,
  onActive,
}: {
  invitations: GameInvitation[];
  activeId: string | null;
  onActive: (id: string | null) => void;
}) {
  const auth = useAuth(), messages = auth.messages;
  const state = useSyncExternalStore(messages.subscribe, messages.getSnapshot, messages.getSnapshot);
  // Unresolved original packet must remain reachable from the associated card.
  useEffect(() => {
    const unresolved = Object.keys(state.pending).find(key => key.startsWith('invitation:'));
    if (!unresolved) return;
    const id = unresolved.slice('invitation:'.length);
    if (invitations.some(invite => invite.id === id) && activeId !== id) onActive(id);
  }, [state.pending, invitations, activeId, onActive]);
  return <View style={{ gap: 8 }}>
    {invitations.map(invite => {
      const pending = isPendingInvite(invite);
      const clockExpired = isInviteClockExpired(invite);
      // Any server-pending row stays openable (clock-expired + unparseable expiresAt → refresh).
      const openable = invite.status === 'pending';
      const selected = activeId === invite.id;
      const collapsedLabel = pending ? 'Приглашение в игру' : clockExpired ? invitationCopy.expired : invitationCopy[invite.status];
      const a11y = pending ? 'Приглашение в игру, ожидает решения' : `Приглашение: ${clockExpired ? invitationCopy.expired : invitationCopy[invite.status]}`;
      return <View key={`${invite.id}:${invite.version}`} style={styles.card} accessibilityLabel={a11y}>
        {!selected ? <Label style={{ fontWeight: '700' }}>{collapsedLabel}</Label> : null}
        {!selected && invite.status === 'accepted' ? <Label>Актуальный статус участия указан отдельно.</Label> : null}
        {openable && !selected ? <TextButton title={clockExpired ? 'Обновить приглашение' : 'Условия и решение'} onPress={() => onActive(invite.id)} /> : null}
        {selected ? <InlineInvitationPanel invitationId={invite.id} listInvite={invite} onClose={() => onActive(null)} /> : null}
      </View>;
    })}
  </View>;
}

function InlineInvitationPanel({ invitationId, listInvite, onClose }: {
  invitationId: string; listInvite: GameInvitation; onClose: () => void;
}) {
  const auth = useAuth(), owner = auth.messages, router = useRouter();
  const resource: MessageResource = { kind: 'invitation', id: invitationId };
  const key = resourceKey(resource);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const detail = state.detail && resourceKey(state.detail.resource) === key ? state.detail : null;
  const pending = state.pending[key];
  const invitation = detail?.status === 'ready' && detail.header && 'status' in detail.header ? detail.header : null;
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const release = owner.leaseFocus(resource);
    return () => { release(); };
  }, [owner, invitationId, auth.status]);
  return <View style={{ gap: 8 }}>
    {state.notice ? <Label accessibilityRole="alert">{state.notice}</Label> : null}
    {pending?.state === 'unknown' ? <PrimaryButton title="Проверить тем же запросом" onPress={() => { void owner.retry(resource, state.viewGeneration, state.actor); }} /> : null}
    {pending?.state === 'sending' ? <Label accessibilityLiveRegion="polite">Отправляем…</Label> : null}
    {!detail || detail.status === 'loading' ? <Label>Загружаем условия приглашения…</Label> : null}
    {detail?.status === 'error' ? <><Label>{detail.error ?? 'Приглашение недоступно.'}</Label>
      <TextButton title="Обновить приглашение" onPress={() => { void owner.loadDetail(resource); }} /></> : null}
    {invitation ? <InvitationDecisionBody
      invitation={invitation}
      ownId={detail?.ownId ?? null}
      pending={!!pending}
      onAccept={() => { void owner.act(resource, 'accept', undefined, state.viewGeneration, state.actor); }}
      onDecline={() => { if (!pending) void owner.act(resource, 'decline', undefined, state.viewGeneration, state.actor); }}
      onOpenGame={invitation.status === 'accepted' && invitation.participationId
        ? () => router.push(`/games/${invitation.gameId}` as '/games') : undefined}
    /> : listInvite.status === 'pending' && detail?.status === 'ready' ? <Label>Условия сейчас недоступны. Обновите приглашение.</Label> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <TextButton title="Обновить приглашение" onPress={() => { void owner.loadDetail(resource); }} />
      {!pending ? <TextButton title="Скрыть решение" onPress={onClose} /> : null}
    </View>
  </View>;
}
