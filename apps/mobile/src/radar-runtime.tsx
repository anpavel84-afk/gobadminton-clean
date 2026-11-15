import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { nativeAuth } from './auth-runtime.ts';
import { RadarCoordinator } from './radar-coordinator.ts';
const Context = createContext<RadarCoordinator | null>(null);
export function RadarProvider({ children }: PropsWithChildren) {
  const [owner] = useState(() => new RadarCoordinator({
    read: nativeAuth.radarRead, command: nativeAuth.radarCommand,
    random: () => Crypto.randomUUID(),
    permission: Location.getForegroundPermissionsAsync, requestPermission: Location.requestForegroundPermissionsAsync,
    services: Location.hasServicesEnabledAsync,
    fix: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }),
  }));
  useLayoutEffect(() => {
    const sync = () => {
      const auth = nativeAuth.getSnapshot();
      owner.setActor(auth.status === 'authenticated' ? nativeAuth.participation.getSnapshot().actor : null);
    };
    owner.setForeground(AppState.currentState === 'active'); sync();
    const auth = nativeAuth.subscribe(sync);
    const lifecycle = AppState.addEventListener('change', state => {
      owner.setForeground(state === 'active');
      if (state !== 'active') nativeAuth.contact.invalidateRadar();
    });
    const invalidation = nativeAuth.contact.subscribeRadarInvalidation(owner.invalidatePrivate);
    let generation = owner.getSnapshot().generation;
    const privateViews = owner.subscribe(() => {
      const next = owner.getSnapshot().generation;
      if (next !== generation) { generation = next; nativeAuth.contact.invalidateRadar(); }
    });
    return () => { auth(); lifecycle.remove(); invalidation(); privateViews(); owner.dispose(); };
  }, [owner]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
export function useRadar() {
  const owner = useContext(Context); if (!owner) throw new Error('RadarProvider missing');
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { owner, state };
}
