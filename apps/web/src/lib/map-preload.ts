import { MOSCOW_BUNDLE } from "./radar-map-assets";

/** Browser signals that gate the optional Games map warm. */
export type MapPreloadEnv = {
  cityId: string | null | undefined;
  origin: string;
  online?: boolean;
  saveData?: boolean;
  hidden?: boolean;
};

const DEV_ORIGIN = new URL(MOSCOW_BUNDLE.prefix).origin;
const STYLE_URL = `${MOSCOW_BUNDLE.prefix}style-dev.json`;

type WarmOutcome = "ok" | "fail";

let moduleDone = false;
let moduleInflight: Promise<WarmOutcome> | null = null;
let styleDoneKey: string | null = null;
let styleInflightKey: string | null = null;
let styleInflight: Promise<WarmOutcome> | null = null;

/** Test-only: clear in-memory dedupe without touching HTTP/module caches. */
export function resetMapPreloadStateForTests() {
  moduleDone = false;
  moduleInflight = null;
  styleDoneKey = null;
  styleInflightKey = null;
  styleInflight = null;
}

/** Moscow + exact DEV origin only; skip saveData, offline, and hidden tabs. */
export function mapPreloadEligible(env: MapPreloadEnv): boolean {
  return env.cityId === MOSCOW_BUNDLE.cityId
    && env.origin === DEV_ORIGIN
    && env.online !== false
    && env.saveData !== true
    && env.hidden !== true;
}

export function readMapPreloadBrowserEnv(cityId: string | null | undefined): MapPreloadEnv {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return {
    cityId,
    origin: window.location.origin,
    online: navigator.onLine,
    saveData: connection?.saveData === true,
    hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
  };
}

/** One idle callback (or short timeout); cancellable. Not a scheduler framework. */
export function scheduleMapPreloadIdle(run: () => void): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const id = idleWindow.requestIdleCallback(run, { timeout: 2500 });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 1);
  return () => clearTimeout(id);
}

export type MapPreloadResult = "skipped" | "done" | "aborted" | "failed";

/**
 * Bounded optional warm: existing GamesVenueMap JS module + public style JSON.
 * Does not create MapLibre/WebGL/workers, fetch PMTiles, or touch private APIs.
 * Live map fetch/hash validation remains the authority in GamesVenueMap.
 */
export async function preloadGamesMapAssets(options: {
  env: MapPreloadEnv;
  warmModule: () => Promise<unknown>;
  fetchStyle?: typeof fetch;
  signal?: AbortSignal;
}): Promise<MapPreloadResult> {
  const { env, warmModule, signal } = options;
  if (!mapPreloadEligible(env)) return "skipped";
  if (signal?.aborted) return "aborted";

  const fetchImpl = options.fetchStyle ?? fetch;
  const styleKey = `${env.cityId}:${STYLE_URL}`;

  const moduleOutcome = await warmModuleOnce(warmModule, signal);
  if (moduleOutcome === "aborted") return "aborted";

  const styleOutcome = await warmStyleOnce(styleKey, fetchImpl, signal);
  if (styleOutcome === "aborted") return "aborted";

  if (moduleOutcome === "fail" || styleOutcome === "fail") return "failed";
  return "done";
}

async function warmModuleOnce(
  warmModule: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<WarmOutcome | "aborted"> {
  if (moduleDone) return "ok";
  if (signal?.aborted) return "aborted";
  if (!moduleInflight) {
    moduleInflight = Promise.resolve()
      .then(() => warmModule())
      .then(() => {
        moduleDone = true;
        return "ok" as const;
      })
      .catch(() => {
        moduleInflight = null;
        return "fail" as const;
      });
  }
  const outcome = await moduleInflight;
  if (signal?.aborted) return "aborted";
  return outcome;
}

async function warmStyleOnce(
  styleKey: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<WarmOutcome | "aborted"> {
  if (styleDoneKey === styleKey) return "ok";
  if (signal?.aborted) return "aborted";
  if (!styleInflight || styleInflightKey !== styleKey) {
    styleInflightKey = styleKey;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      signal.removeEventListener("abort", onAbort);
      return "aborted";
    }
    styleInflight = (async (): Promise<WarmOutcome> => {
      try {
        const response = await fetchImpl(STYLE_URL, { credentials: "omit", signal: controller.signal });
        if (!response.ok) throw new Error(`style preload ${response.status}`);
        // Drain the body so the normal HTTP cache can serve the live map fetch.
        await response.arrayBuffer();
        styleDoneKey = styleKey;
        return "ok";
      } catch {
        styleInflight = null;
        styleInflightKey = null;
        return "fail";
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    })();
  }
  const outcome = await styleInflight;
  if (signal?.aborted) return "aborted";
  return outcome;
}
