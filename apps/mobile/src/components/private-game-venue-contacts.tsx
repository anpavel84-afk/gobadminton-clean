import { useCallback, useRef, useSyncExternalStore } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import {
  PRIVATE_CONTACTS_OPEN_FAILURE,
  hasPrivateVenueContacts,
  type PrivateVenueContactAction,
} from '../private-game-venue-contacts.ts';
import { colors } from '../theme.ts';
import { Label, Loading, TextButton, styles } from './ui.tsx';

/**
 * Accepted-web «Контакты площадки» — separate authenticated private GET even when public
 * game read already succeeded. Server omission is authoritative; no frontend rights inference.
 * Successful empty omits the section; loading/error never advertise old private values.
 */
export function PrivateGameVenueContactsPanel({
  gameId,
  venueId,
}: {
  gameId: string;
  venueId: string;
}) {
  const auth = useAuth();
  const owner = auth.privateGameVenueContacts;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const leaseRef = useRef<number | null>(null);
  const focused = state.focus?.gameId === gameId
    && state.focus.venueId === venueId
    && state.focus.viewGen === leaseRef.current;

  useFocusEffect(useCallback(() => {
    if (auth.status !== 'authenticated' || !gameId || !venueId) {
      leaseRef.current = null;
      return;
    }
    const release = owner.focus(gameId, venueId);
    leaseRef.current = owner.getSnapshot().focus?.viewGen ?? null;
    owner.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', next => {
      owner.setForeground(next === 'active');
    });
    void owner.load();
    return () => {
      sub.remove();
      release();
      leaseRef.current = null;
    };
  }, [
    owner, auth.status, gameId, venueId,
    state.actor?.actorId, state.actor?.sessionId, state.actor?.generation,
  ]));

  if (auth.status !== 'authenticated') return null;
  if (!focused) return null;

  const surface = owner.surfacePermit();
  const projection = state.status === 'ready' ? state.projection : null;
  const showContacts = hasPrivateVenueContacts(projection);

  if (state.status === 'ready' && !showContacts && !state.openFailure) return null;
  if (state.status === 'idle' && !state.projection) return null;

  return <View style={styles.card} accessibilityLabel="Контакты площадки для игры">
    <Label accessibilityRole="header" style={styles.subtitle}>Контакты площадки</Label>
    {state.status === 'loading' && <Loading title="Загружаем контакты площадки…" />}
    {state.status === 'error' && <>
      <Label accessibilityLiveRegion="polite">
        {state.notice ?? 'Не удалось загрузить контакты площадки. Попробуйте ещё раз.'}
      </Label>
      <TextButton title="Повторить" onPress={() => { if (surface) void owner.load(surface); }} />
    </>}
    {showContacts && projection && <>
      {projection.phone ? <ContactRow label="Телефон" action={projection.phone} owner={owner} /> : null}
      {projection.website ? <ContactRow label="Сайт" action={projection.website} owner={owner} /> : null}
      {projection.bookingNote ? <View style={{ gap: 4, minWidth: 0 }}>
        <Label style={{ color: colors.secondary, fontSize: 13 }}>Информация о бронировании</Label>
        <Label>{projection.bookingNote}</Label>
      </View> : null}
    </>}
    {state.openFailure
      ? <Label accessibilityRole="alert">{PRIVATE_CONTACTS_OPEN_FAILURE}</Label>
      : null}
  </View>;
}

function ContactRow({
  label,
  action,
  owner,
}: {
  label: string;
  action: PrivateVenueContactAction;
  owner: typeof nativeAuth.privateGameVenueContacts;
}) {
  // Immutable permit captured at render — not re-acquired inside onPress.
  const onPress = owner.createContactOpenHandler(action) ?? undefined;
  return <View style={{ gap: 4, minWidth: 0 }}>
    <Label style={{ color: colors.secondary, fontSize: 13 }}>{label}</Label>
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${action.text}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textButton,
        pressed && { backgroundColor: colors.paper },
        { alignSelf: 'flex-start', maxWidth: '100%' },
      ]}
    >
      <Label style={{ color: colors.ink }}>{action.text}</Label>
    </Pressable>
  </View>;
}
