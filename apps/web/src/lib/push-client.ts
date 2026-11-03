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

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
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

export async function setServiceWorkerFence(fence: string | null): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const worker = reg?.active ?? reg?.waiting ?? reg?.installing;
  if (!worker) return;
  if (fence) worker.postMessage({ type: "gb-push-set-fence", fence });
  else worker.postMessage({ type: "gb-push-clear" });
}

export async function clearPushLocalBinding(): Promise<void> {
  try {
    await setServiceWorkerFence(null);
  } catch {
    /* never block logout */
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const notes = await reg?.getNotifications();
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
  applicationServerKey: Uint8Array | null;
}> {
  const registration = await ensurePushServiceWorker();
  const applicationServerKey =
    vapidPublicKey && typeof window !== "undefined"
      ? urlBase64ToUint8Array(vapidPublicKey)
      : null;
  return { registration, applicationServerKey };
}

export async function subscribeFromGesture(input: {
  registration: ServiceWorkerRegistration;
  applicationServerKey: Uint8Array;
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
