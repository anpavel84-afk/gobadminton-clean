export const SESSION_COOKIE = "__Host-gb_session";
export const AUTH_BINDING_COOKIE = "__Host-gb_auth_binding";
export const CONSUMER_AUDIENCE = "consumer_browser" as const;
export const PROVIDER_KEYS = ["vk", "yandex"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export function isProviderKey(value: string): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value);
}

export const NATIVE_AUDIENCE = "consumer_native" as const;
export const CONSUMER_AUDIENCES = [CONSUMER_AUDIENCE, NATIVE_AUDIENCE] as const;
export const NATIVE_BINDING_COOKIE = "__Host-gb_native_binding";
export const NATIVE_POLICY = { transaction: 600, handoff: 60, access: 600, idle: 604800, absolute: 2592000 } as const;
