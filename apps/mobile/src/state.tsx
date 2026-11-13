import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { completeStory, emptyPreferences, parsePreferences } from './entry.ts';
import type { Preferences } from './entry.ts';

const STORAGE_KEY = 'gobadminton.mobile.m1.preferences';
type State = {
  preferences: Preferences; hydrated: boolean; storageError: boolean;
  finishStory: () => void; chooseCity: (id: string) => void;
};
const Context = createContext<State | null>(null);
export function PreferencesProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<Preferences>(emptyPreferences);
  const current = useRef(preferences);
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!mounted || revision.current !== 0) return;
      current.current = parsePreferences(raw);
      setPreferences(current.current);
    }).catch(() => { if (mounted) setStorageError(true); })
      .finally(() => { if (mounted) setHydrated(true); });
    return () => { mounted = false; };
  }, []);
  function save(value: Preferences) {
    revision.current++;
    current.current = value;
    setPreferences(value);
    // Preserve the latest selection when native storage completes out of order.
    writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value)))
      .then(() => setStorageError(false)).catch(() => setStorageError(true));
  }
  return <Context.Provider value={{ preferences, hydrated, storageError,
    finishStory: () => save(completeStory(current.current)),
    chooseCity: id => save({ storyCompleted: true, cityId: id }),
  }}>{children}</Context.Provider>;
}
export function usePreferences() {
  const state = useContext(Context);
  if (!state) throw new Error('PreferencesProvider missing');
  return state;
}
