import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import * as Crypto from 'expo-crypto';
import { nativeAuth } from './auth-runtime.ts';
import { publicApi } from './public-api.ts';
import { VenueCommunityCoordinator } from './venue-community-coordinator.ts';
const Context = createContext<VenueCommunityCoordinator | null>(null);
/** Stable above Stack; sheet/schedule/route teardown cannot discard a frozen command. */
export function VenueCommunityProvider({ children }: PropsWithChildren) {
  const [owner] = useState(() => new VenueCommunityCoordinator({
    summary: publicApi.communitySummary, guestComments: publicApi.communityComments,
    own: nativeAuth.communityOwn, comments: nativeAuth.communityComments, send: nativeAuth.communityMutation,
    random: () => Crypto.randomUUID(),
  }));
  useLayoutEffect(() => {
    const sync = () => {
      const auth = nativeAuth.getSnapshot();
      if (auth.status === 'hydrating') return;
      owner.setActor(auth.status === 'authenticated' ? nativeAuth.participation.getSnapshot().actor : null);
    };
    sync(); const unsubscribe = nativeAuth.subscribe(sync);
    return () => { unsubscribe(); owner.setActor(null); owner.detach(); };
  }, [owner]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
export function useVenueCommunity() {
  const owner = useContext(Context); if (!owner) throw new Error('VenueCommunityProvider missing');
  return { owner, state: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
