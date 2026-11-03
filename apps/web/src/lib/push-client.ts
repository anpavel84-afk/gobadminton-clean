import { apiFetch } from "./api-client";

export type PushDevice = {
  id: string;
  current: boolean;
  createdAt: string;
};

export type PushState = {
  featureAvailable: boolean;
  preferenceEnabled: boolean;
  preferenceVersion: number;
  vapidPublicKey: string | null;
  accountFence: string | null;
  deviceCount: number;
  maxDevices: number;
  currentDevice: PushDevice | null;
  devices: PushDevice[];
};

export type PushCapability =
  | "unsupported"
  | "needs_homescreen"
  | "ready"
  | "denied"
  | "offline";

const SW_PATH = "/sw-push.js";
const SW_SCOPE = "/";

/** Single process-wide fence write/clear chain (login/logout/settings/private-expired). */
let fenceWriteChain: Promise<void> = Promise.resolve();
/** Bumped to invalidate in-flight async SW registration/update before postMessage. */
let fenceWriteGeneration = 0;

/** Invalidate in-flight fence writers; return the new generation token. */
export function bumpPushFenceGeneration(): number {
  return ++fenceWriteGeneration;
}

export function getPushFenceGeneration(): number {
  return fenceWriteGeneration;
}

/**
 * Serialize a fence mutation. Generation is re-checked inside the writer after
 * every await and immediately before the actual SW postMessage.
 */
export function enqueuePushFenceMutation(
  generation: number,
  mutate: (isCurrent: () => boolean) => Promise<void>,
): Promise<void> {
  const isCurrent = () => generation === fenceWriteGeneration;
  const run = async () => {
    if (!isCurrent()) return;
    await mutate(isCurrent);
  };
  const next = fenceWriteChain.then(run, run);
  fenceWriteChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Pure base64url → ArrayBuffer-backed bytes (PushManager BufferSource compatible). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = globalThis.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

/** Feature detection — not UA-only. iPhone needs Home Screen standalone PWA. */
export function detectPushCapability(): PushCapability {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
  const isiOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isiOS && !standalone) return "needs_homescreen";
  if (!navigator.onLine) return "offline";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

export function getPushState(signal?: AbortSignal) {
  return apiFetch<PushState>("/v1/me/push", { signal });
}

export function setPushPreference(
  input: { enabled: boolean; expectedVersion: number },
  csrfToken: string,
) {
  return apiFetch<{ preferenceEnabled: boolean; preferenceVersion: number }>(
    "/v1/me/push/preference",
    {
      method: "PUT",
      body: JSON.stringify(input),
      csrfToken,
      idempotent: true,
    },
  );
}

export function registerPushSubscription(
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
  csrfToken: string,
) {
  return apiFetch<{ id: string; accountFence: string; deviceCount: number }>(
    "/v1/me/push/subscriptions",
    {
      method: "POST",
      body: JSON.stringify(input),
      csrfToken,
      idempotent: true,
    },
  );
}

export function unsubscribePushDevice(subscriptionId: string, csrfToken: string) {
  return apiFetch<{ unbound: true }>(`/v1/me/push/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    csrfToken,
    idempotent: true,
  });
}

export function unsubscribeCurrentPushEndpoint(endpoint: string, csrfToken: string) {
  return apiFetch<{ unbound: true }>("/v1/me/push/subscriptions/current/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
    csrfToken,
    idempotent: true,
  });
}

export async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing) {
    await existing.update();
    return existing;
  }
  return navigator.serviceWorker.register(SW_PATH, {
    scope: SW_SCOPE,
    updateViaCache: "none",
  });
}

/**
 * Set or clear the SW account fence. Pass an existing generation to keep a
 * multi-step sync (clear→fetch→set) coherent; otherwise bumps a new generation.
 * Stale async SW registration/update cannot post after a newer account write.
 */
export async function setServiceWorkerFence(
  fence: string | null,
  generation: number = bumpPushFenceGeneration(),
): Promise<void> {
  return enqueuePushFenceMutation(generation, async (isCurrent) => {
    if (!isCurrent()) return;
    const reg =
      (await ensurePushServiceWorker()) ??
      (await navigator.serviceWorker.getRegistration(SW_SCOPE));
    if (!isCurrent()) return;
    if (!reg) return;
    let worker = reg.active ?? reg.waiting ?? reg.installing;
    if (!worker) return;
    if (!reg.active && worker.state !== "activated") {
      await new Promise<void>((resolve) => {
        const onChange = () => {
          if (worker!.state === "activated" || worker!.state === "redundant") {
            worker!.removeEventListener("statechange", onChange);
            resolve();
          }
        };
        worker!.addEventListener("statechange", onChange);
        if (worker!.state === "activated" || worker!.state === "redundant") {
          worker!.removeEventListener("statechange", onChange);
          resolve();
        }
      });
      if (!isCurrent()) return;
      worker = reg.active ?? worker;
    }
    // Final generation check immediately before the actual SW postMessage.
    if (!isCurrent()) return;
    if (fence) worker.postMessage({ type: "gb-push-set-fence", fence });
    else worker.postMessage({ type: "gb-push-clear" });
  });
}

export async function clearPushLocalBinding(
  generation: number = bumpPushFenceGeneration(),
): Promise<void> {
  try {
    await setServiceWorkerFence(null, generation);
  } catch {
    /* never block logout */
  }
  try {
    if (generation !== fenceWriteGeneration) return;
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (generation !== fenceWriteGeneration) return;
    const notes = await reg?.getNotifications();
    if (generation !== fenceWriteGeneration) return;
    if (notes) for (const n of notes) n.close();
  } catch {
    /* ignore */
  }
}

/**
 * Prefetch SW + public key before the gesture; call requestPermission/subscribe
 * IMMEDIATELY from the user gesture (do not await unrelated network in between).
 */
export async function prefetchPushEnablement(vapidPublicKey: string | null): Promise<{
  registration: ServiceWorkerRegistration | null;
  applicationServerKey: Uint8Array<ArrayBuffer> | null;
}> {
  const registration = await ensurePushServiceWorker();
  const applicationServerKey = vapidPublicKey
    ? urlBase64ToUint8Array(vapidPublicKey)
    : null;
  return { registration, applicationServerKey };
}

export async function subscribeFromGesture(input: {
  registration: ServiceWorkerRegistration;
  applicationServerKey: Uint8Array<ArrayBuffer>;
}): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("PERMISSION_DENIED");
  }
  return input.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: input.applicationServerKey,
  });
}

export function subscriptionToPayload(sub: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("SUBSCRIPTION_INCOMPLETE");
  }
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}
