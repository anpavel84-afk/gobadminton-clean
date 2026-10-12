import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { VkAuthProvider } from "../auth/providers/vk.adapter";
import { YandexAuthProvider } from "../auth/providers/yandex.adapter";
import type { AuthProviderAdapter } from "../auth/providers/types";
import { serviceUnavailable } from "../auth/problem";
export const ADMIN_PROVIDER_OVERRIDES = Symbol("ADMIN_PROVIDER_OVERRIDES");
@Injectable()
export class AdminProviders {
  private readonly adapters: AuthProviderAdapter[];
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional()
    @Inject(ADMIN_PROVIDER_OVERRIDES)
    overrides: AuthProviderAdapter[] | null = null,
  ) {
    if (overrides && (!env.ADMIN_INTERNAL_ENABLED || env.NODE_ENV !== "test"))
      throw new Error("Admin test adapter outside internal test");
    this.adapters = overrides ?? [
      new VkAuthProvider({
        ...env,
        VK_REDIRECT_URI: env.ADMIN_VK_REDIRECT_URI,
      }),
      new YandexAuthProvider({
        ...env,
        YANDEX_REDIRECT_URI: env.ADMIN_YANDEX_REDIRECT_URI,
      }),
    ];
  }
  get(key: string) {
    const redirectUri =
      key === "vk"
        ? this.env.ADMIN_VK_REDIRECT_URI
        : key === "yandex"
          ? this.env.ADMIN_YANDEX_REDIRECT_URI
          : undefined;
    const adapter = this.adapters.find((a) => a.key === key);
    if (!adapter?.configured || !redirectUri)
      throw serviceUnavailable(
        "ADMIN_PROVIDER_UNAVAILABLE",
        "Admin provider unavailable",
      );
    return { adapter, redirectUri };
  }
}
