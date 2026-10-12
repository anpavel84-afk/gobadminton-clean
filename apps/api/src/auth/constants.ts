export const SESSION_COOKIE = "__Host-gb_session";
export const AUTH_BINDING_COOKIE = "__Host-gb_auth_binding";
export const CONSUMER_AUDIENCE = "consumer_browser" as const;
export const PROVIDER_KEYS = ["vk", "yandex"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export function isProviderKey(value: string): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value);
}
