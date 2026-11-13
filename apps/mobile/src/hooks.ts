import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { LatestResource } from './resource.ts';
import type { ResourceState } from './resource.ts';

export function useResource<T>(key: string, task: (signal: AbortSignal) => Promise<T>) {
  const [resource] = useState(() => new LatestResource<T>());
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    void resource.load(key, task);
    return () => resource.cancel();
  }, [key, task, resource]);
  // A new key must never expose yesterday's city/game for one render before effect.
  const state: ResourceState<T> = snapshot.key === key ? snapshot : { key, status: 'loading' };
  return { state, retry: () => { void resource.load(key, task); }, resource };
}
export function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduceMotion;
}
