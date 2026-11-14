import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { nativeAuth } from './auth-runtime.ts';
import { NATIVE_REDIRECT, isNativeCallback } from './native-auth-protocol.ts';
import type { MessagesCoordinator } from './messages-coordinator.ts';
import type { PlayersCoordinator } from './players.ts';
import type { ParticipationCoordinator } from './participation.ts';
import type { AuthSnapshot } from './auth-coordinator.ts';

type AuthContext = AuthSnapshot & { players: PlayersCoordinator; messages: MessagesCoordinator; participation: ParticipationCoordinator; signIn: (returnPath?: string | null) => Promise<void>;
  logout: () => Promise<void>; cancel: () => Promise<void>; validate: () => Promise<void>;
  loadSessions: () => Promise<void>; revokeSession: (id: string | null) => Promise<void> };
const Context = createContext<AuthContext | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const snapshot = useSyncExternalStore(nativeAuth.subscribe, nativeAuth.getSnapshot, nativeAuth.getSnapshot);
  const router = useRouter();
  const browserBusy = useRef(false);
  useEffect(() => {
    let active = true;
    void nativeAuth.hydrate();
    const receive = async (url: string) => {
      if (!isNativeCallback(url)) return;
      const path = await nativeAuth.callback(url);
      if (active && path) router.replace(path as '/profile');
    };
    // Raw callbacks stay solely in the coordinator; never become component state/router params.
    const links = Linking.addEventListener('url', event => { void receive(event.url); });
    void Linking.getInitialURL().then(url => { if (active && url) void receive(url); }).catch(() => {});
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void nativeAuth.validate(); });
    return () => { active = false; links.remove(); foreground.remove(); };
  }, [router]);
  useEffect(() => {
    if (snapshot.status !== 'authenticated') return;
    // Rotate only at access expiry while foregrounded; no periodic private polling.
    const timer = setTimeout(() => { if (AppState.currentState === 'active') void nativeAuth.validate(); }, nativeAuth.refreshDelay());
    return () => clearTimeout(timer);
  }, [snapshot.status, snapshot.me]);
  async function signIn(returnPath?: string | null) {
    if (browserBusy.current) return;
    browserBusy.current = true;
    try {
      const start = await nativeAuth.beginLogin(returnPath);
      if (!start) return;
      try {
        const result = await WebBrowser.openAuthSessionAsync(start.url, NATIVE_REDIRECT);
        if (result.type === 'success') {
          const path = await nativeAuth.callback(result.url);
          if (path) router.replace(path as '/profile');
        } else await nativeAuth.cancelLogin(start.generation);
      } catch { await nativeAuth.cancelLogin(start.generation); }
    } finally { browserBusy.current = false; }
  }
  return <Context.Provider value={{ ...snapshot, players: nativeAuth.players, messages: nativeAuth.messages, participation: nativeAuth.participation, signIn, logout: () => nativeAuth.logout(), cancel: () => nativeAuth.cancelLogin(),
    validate: nativeAuth.validate, loadSessions: nativeAuth.loadSessions, revokeSession: nativeAuth.revokeSession }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context); if (!context) throw new Error('AuthProvider missing'); return context;
}
