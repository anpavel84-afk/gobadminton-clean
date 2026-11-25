import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import * as Crypto from 'expo-crypto';
import { nativeAuth } from './auth-runtime.ts';
import { publicApi } from './public-api.ts';
import { GameCommentsCoordinator } from './game-comments-coordinator.ts';

const Context = createContext<GameCommentsCoordinator | null>(null);

/** Stable above Stack; route teardown cannot discard a frozen command. */
export function GameCommentsProvider({ children }: PropsWithChildren) {
  const [owner] = useState(() => new GameCommentsCoordinator({
    guestComments: publicApi.gameComments,
    comments: nativeAuth.gameComments,
    send: nativeAuth.gameCommentMutation,
    random: () => Crypto.randomUUID(),
  }));
  useLayoutEffect(() => {
    const sync = () => {
      const auth = nativeAuth.getSnapshot();
      if (auth.status === 'hydrating') return;
      owner.setActor(auth.status === 'authenticated' ? nativeAuth.participation.getSnapshot().actor : null);
    };
    sync();
    const unsubscribe = nativeAuth.subscribe(sync);
    return () => { unsubscribe(); owner.setActor(null); owner.detach(); };
  }, [owner]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}

export function useGameComments() {
  const owner = useContext(Context);
  if (!owner) throw new Error('GameCommentsProvider missing');
  return { owner, state: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
