"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DiscoveryCityController, DISCOVERY_CITY_KEY, neutralCity } from "../../../lib/discovery-city";
const Context = createContext<DiscoveryCityController | null>(null);
const noop = () => () => {};
export function useDiscoveryCity() {
  const controller = useContext(Context);
  const view = useSyncExternalStore(controller?.subscribe ?? noop, controller?.snapshot ?? (() => neutralCity), () => neutralCity);
  return { controller, ...view };
}
export function DiscoveryCityProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<DiscoveryCityController | null>(null);
  useEffect(() => {
    const c = new DiscoveryCityController(); setController(c); void c.start();
    const session = () => { void c.start(true); };
    const storage = (event: StorageEvent) => { if (event.key === DISCOVERY_CITY_KEY || event.key === null) c.storageChanged(); };
    const foreground = () => { if (!document.hidden) void c.retry(); };
    window.addEventListener("gb-session-changed", session); window.addEventListener("storage", storage); window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground);
    return () => { c.dispose(); window.removeEventListener("gb-session-changed", session); window.removeEventListener("storage", storage); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, []);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function DiscoveryCityNotice() {
  const { notice, unsynced, controller } = useDiscoveryCity();
  return notice ? <div className="gb-discovery-notice" role="status">{notice}{unsynced && <button type="button" onClick={() => void controller?.retry()}>Повторить сохранение</button>}</div> : null;
}
