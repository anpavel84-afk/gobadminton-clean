import { safetyPeerId } from '../../src/safety-coordinator.ts';
import { NativeSafety } from '../../src/components/safety.tsx';
import { NativeContactAction } from '../../src/components/contact-editor.tsx';
import { PlayerRoleReputation } from '../../src/components/player-role-reputation.tsx';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth.tsx';
import { useResource } from '../../src/hooks.ts';
import { publicApi } from '../../src/public-api.ts';
import { PlayerProfile } from '../../src/components/player-card.tsx';
import { BackLink, ErrorState, Header, Label, Loading, Page, TextButton } from '../../src/components/ui.tsx';

export default function PlayerDetail() {
  const params = useLocalSearchParams<{ publicPlayerId: string }>(), router = useRouter();
  const id = safetyPeerId(params.publicPlayerId);
  const auth = useAuth(), coordinator = auth.players;
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const citiesTask = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const cities = useResource('cities', citiesTask);
  useEffect(() => { if (id && snapshot.scope) void coordinator.loadDetail(id); }, [coordinator, id, snapshot.scope]);
  const detail = snapshot.scope && snapshot.detail.id === id ? snapshot.detail : null;
  const back = () => router.canGoBack() ? router.back() : router.replace('/players');
  const viewScope = `${snapshot.scope}:${id}`;
  return <Page header={<Header />}>
    <BackLink title="← Все игроки" onPress={back} />
    {!id ? <Label>Профиль недоступен.</Label> : auth.status === 'hydrating' || (snapshot.scope && (!detail || detail.status === 'loading'))
      ? <Loading title="Загружаем профиль…" /> : !snapshot.scope
      ? <><Label>Профиль для текущей сессии недоступен. Проверьте вход.</Label><TextButton title="Профиль" onPress={() => router.push('/profile')} /></>
      : detail?.status === 'error' ? <ErrorState error={detail.error} retry={() => { void coordinator.loadDetail(id); }} />
      : detail?.data ? <>
        <PlayerProfile key={`${viewScope}:${detail.data.cover?.uploadedUrl}`} player={detail.data} city={cities.state.data?.find(c => c.id === detail.data?.cityId)?.nameRu} />
        <NativeContactAction target={id} />
        <PlayerRoleReputation key={viewScope} publicPlayerId={id} />
      </> : null}
    {id && auth.status === 'authenticated' &&
      <NativeSafety peerId={id} name={detail?.data?.displayName ?? 'Игрок'} />}
  </Page>;
}
