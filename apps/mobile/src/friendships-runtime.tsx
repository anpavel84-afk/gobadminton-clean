import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { nativeAuth } from './auth-runtime.ts';
import { FriendshipsCoordinator } from './friendships-coordinator.ts';

const Context = createContext<FriendshipsCoordinator | null>(null);

/** Mounted once above the Stack. Route/card teardown never owns an in-flight packet. */
export function FriendshipsProvider({ children }: PropsWithChildren) {
  const [owner] = useState(() => new FriendshipsCoordinator({
    capabilities: nativeAuth.socialCapabilities,
    list: nativeAuth.listFriendships,
    states: nativeAuth.friendshipStates,
    ownProfile: nativeAuth.friendshipsOwnProfile,
    send: nativeAuth.friendshipMutation,
    random: () => Crypto.randomUUID(),
  }));
  useLayoutEffect(() => {
    const sync = () => {
      const auth = nativeAuth.getSnapshot();
      if (auth.status === 'hydrating') return;
      owner.setActor(auth.status === 'authenticated' ? nativeAuth.participation.getSnapshot().actor : null);
    };
    owner.setForeground(AppState.currentState === 'active');
    sync();
    const auth = nativeAuth.subscribe(sync);
    const lifecycle = AppState.addEventListener('change', state => owner.setForeground(state === 'active'));
    // Verified block/unblock retires friendship grants before any new action.
    const safety = nativeAuth.contact.subscribeRadarInvalidation(owner.invalidate);
    return () => { auth(); lifecycle.remove(); safety(); owner.setActor(null); };
  }, [owner]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}

export function useFriendships() {
  const owner = useContext(Context);
  if (!owner) throw new Error('FriendshipsProvider missing');
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
