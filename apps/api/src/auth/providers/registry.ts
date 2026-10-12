import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppEnv } from "../../config/env";
import { APP_ENV } from "../../tokens";
import { isProviderKey, type ProviderKey, PROVIDER_KEYS } from "../constants";
import { badRequest, serviceUnavailable } from "../problem";
import type { AuthProviderAdapter } from "./types";
import { VkAuthProvider } from "./vk.adapter";
import { YandexAuthProvider } from "./yandex.adapter";

export const AUTH_PROVIDER_OVERRIDES = Symbol("AUTH_PROVIDER_OVERRIDES");

@Injectable()
export class ProviderRegistry {
  private readonly adapters: Map<ProviderKey, AuthProviderAdapter>;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Optional()
    @Inject(AUTH_PROVIDER_OVERRIDES)
    overrides: AuthProviderAdapter[] | null = null,
  ) {
    const defaults: AuthProviderAdapter[] = [
      new VkAuthProvider(env),
      new YandexAuthProvider(env),
    ];
    const list = overrides && overrides.length > 0 ? overrides : defaults;
    this.adapters = new Map(list.map((adapter) => [adapter.key, adapter]));
  }

  listKeys(): ProviderKey[] {
    return [...PROVIDER_KEYS];
  }

  get(key: string): AuthProviderAdapter {
    if (!isProviderKey(key)) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw badRequest("UNKNOWN_PROVIDER", "Неизвестный провайдер входа");
    }
    return adapter;
  }

  getConfiguredOrThrow(key: string): AuthProviderAdapter {
    const adapter = this.get(key);
    if (!adapter.configured) {
      throw serviceUnavailable(
        "PROVIDER_UNAVAILABLE",
        `Провайдер ${key} недоступен`,
        "Provider credentials are not configured for this environment",
      );
    }
    return adapter;
  }
}
