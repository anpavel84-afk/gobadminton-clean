import type { NavigationAction } from 'expo-router';

export type IosBackRemoval = { data: { action: NavigationAction }; repeat: () => void };
export type PreventRemoveHook = (preventRemove: boolean, callback: (event: IosBackRemoval) => void) => () => void;
/** `close` receives `release` for layers that must leave the screen themselves (e.g. finishing the story). */
export type IosBackHook = (open: boolean, close: (release: () => void) => void) => void;

/** Only native-stack dismissals (edge swipe / native back) stamp the dismissed route as `source`; router calls never do. */
export function isNativeStackDismiss(action: NavigationAction): boolean {
  return action.type === 'POP' && typeof action.source === 'string';
}

/**
 * iOS has no hardware Back: while `open`, a native swipe-back closes the inner layer instead of popping.
 * Any other removal (router.replace/back/dismissTo, tab navigation) continues unchanged. Off iOS this is a no-op.
 */
export function bindIosBack(os: string, usePreventRemove: PreventRemoveHook): IosBackHook {
  if (os !== 'ios') return () => {};
  return function useIosBack(open, close) {
    const release = usePreventRemove(open, ({ data, repeat }) => {
      if (isNativeStackDismiss(data.action)) close(release);
      else repeat();
    });
  };
}
