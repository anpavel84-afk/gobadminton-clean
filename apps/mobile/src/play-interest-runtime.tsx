import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { nativeAuth } from './auth-runtime.ts';
import { PlayInterestCoordinator } from './play-interest-coordinator.ts';

const Context = createContext<PlayInterestCoordinator | null>(null);
/** Mounted once above the Stack. Route/card teardown never owns an in-flight packet. */
export function PlayInterestProvider({ children }: PropsWithChildren) {
  const [owner] = useState(() => new PlayInterestCoordinator({
    read: nativeAuth.playInterestStates, send: nativeAuth.playInterestMutation,
    random: () => Crypto.randomUUID(),
  }));
  useLayoutEffect(() => {
    const sync = () => {
      const auth = nativeAuth.getSnapshot();
      // Access rotation keeps the already verified actor until the existing auth gate
      // either accepts that same session or retires it. No new authority is created here.
      if (auth.status === 'hydrating') return;
      owner.setActor(auth.status === 'authenticated' ? nativeAuth.participation.getSnapshot().actor : null);
    };
    owner.setForeground(AppState.currentState === 'active'); sync();
    const auth = nativeAuth.subscribe(sync);
    const lifecycle = AppState.addEventListener('change', state => owner.setForeground(state === 'active'));
    // Existing verified block notifications also retire ordinary match capabilities.
    const safety = nativeAuth.contact.subscribeRadarInvalidation(owner.invalidate);
    return () => { auth(); lifecycle.remove(); safety(); owner.exit(); };
  }, [owner]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
export function usePlayInterest() {
  const owner = useContext(Context); if (!owner) throw new Error('PlayInterestProvider missing');
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
