import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth.tsx';
import { usePlayInterest } from '../../src/play-interest-runtime.tsx';
import type { MatchIdentity } from '../../src/play-interest-coordinator.ts';
import { playerFilterKey } from '../../src/players.ts';
import { publicApi } from '../../src/public-api.ts';
import { useResource } from '../../src/hooks.ts';
import { PlayerBrowse } from '../../src/components/player-browse.tsx';

export default function BrowsePlayers() {
  const auth = useAuth(), router = useRouter(), { owner, state } = usePlayInterest();
  const citiesTask=useCallback((signal:AbortSignal)=>publicApi.cities(signal),[]);
  const cities=useResource('cities',citiesTask);
  const placeLabel=state.filters.cityId ? cities.state.data?.find(c=>c.id===state.filters.cityId)?.nameRu ?? 'Выбранный город' : 'Все города';
  const [focused, setFocused] = useState(false);
  const catalog = useSyncExternalStore(auth.players.subscribe, auth.players.getSnapshot, auth.players.getSnapshot);
  const profile = useSyncExternalStore(auth.profile.subscribe, auth.profile.getSnapshot, auth.profile.getSnapshot);
  const [selfMedia, setSelfMedia] = useState<{scope:string; identity:MatchIdentity} | null>(null);
  const key = playerFilterKey(state.filters), scope = catalog.scope;
  const list = scope && catalog.list.key === key ? catalog.list : null;
  const own = auth.status === 'authenticated' ? profile.profile : null;
  const ownId = own?.publicPlayerId;
  const self: MatchIdentity | null = ownId && own?.displayName ?
    selfMedia?.scope === scope && selfMedia.identity.publicPlayerId === ownId ? {...selfMedia.identity,displayName:own.displayName} : {publicPlayerId:ownId,displayName:own.displayName} : null;
  useFocusEffect(useCallback(() => {
    setFocused(true); owner.enter();
    return () => { setFocused(false); owner.exit(); };
  }, [owner]));
  useEffect(() => {
    if (focused && scope && (!list || list.status === 'idle')) void auth.players.loadList(owner.getSnapshot().filters);
  }, [focused, scope, list?.status, key, auth.players, owner]);
  useLayoutEffect(() => {
    if (focused && scope && list?.status === 'ready') owner.catalog(list.data);
    else if (focused && scope && list?.status === 'error') owner.catalog(null);
  }, [focused, scope, list?.data, list?.status, owner]);
  useEffect(() => {
    if (focused && auth.status === 'authenticated' && profile.status === 'idle') void auth.profile.load();
  }, [focused, auth.status, auth.profile, profile.status]);
  useEffect(() => {
    if (focused && scope && ownId) void auth.players.loadDetail(ownId, true);
  }, [focused, scope, ownId, auth.players]);
  useEffect(() => {
    const detail = catalog.detail;
    if (scope && ownId && detail.id === ownId && detail.status === 'ready' && detail.data) {
      const p = detail.data;
      setSelfMedia({scope,identity:{publicPlayerId:p.publicPlayerId,displayName:own!.displayName,...(p.avatar ? {avatar:p.avatar} : {})}});
    } else if (detail.id === ownId && detail.status === 'error') setSelfMedia(null);
  }, [scope, ownId, own?.displayName, catalog.detail]);
  const close = () => { owner.exit(); if (router.canGoBack()) router.back(); else router.replace('/players'); };
  return <PlayerBrowse owner={owner} state={state} self={self} focused={focused} placeLabel={placeLabel} cities={cities.state.data ?? []}
    status={list?.status ?? (scope ? 'loading' : auth.status === 'signing-in' ? 'ready' : 'error')}
    loadingMore={list?.loadingMore ?? false} moreError={!!list?.moreError}
    onRetry={() => {void auth.players.loadList(state.filters);}}
    onMore={() => {const cursor=list?.data?.nextCursor;if(cursor)void auth.players.loadList(state.filters,cursor);}}
    onClose={close} onLogin={() => {void auth.signIn('/players/browse');}}
    onProfileRetry={() => {void auth.profile.load();}}
    onDetail={id => {void auth.players.loadDetail(id);}}
    detail={catalog.detail} />;
}
