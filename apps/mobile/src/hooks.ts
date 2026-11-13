import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { LatestResource } from './resource.ts';
import type { ResourceState } from './resource.ts';
import { futureItems, nextExpiryDelay } from './upcoming.ts';

export function useUpcomingItems<T extends { startsAt: string }>(items: readonly T[]) {
  const [revision, setRevision] = useState(0);
  const renderedAt = Date.now();
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const delay = nextExpiryDelay(items, renderedAt);
    // If a start boundary passes between render and effect, wake immediately.
    const timer = delay === null ? undefined : setTimeout(refresh, Math.max(1, delay - (Date.now() - renderedAt)));
    // Native timers can pause in the background; recheck on returning to app.
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [items, revision, renderedAt]);
  return futureItems(items, renderedAt);
}

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
