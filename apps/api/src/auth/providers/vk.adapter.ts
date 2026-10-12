import type { AppEnv } from "../../config/env";
import { serviceUnavailable } from "../problem";
import type {
  AuthProviderAdapter,
  AuthorizationStartInput,
  CodeExchangeInput,
  ProviderTokenSet,
  VerifiedIdentity,
} from "./types";

/** Fixed server-side allowlist — never accept token/userinfo URLs from the client. */
const VK_AUTHORIZE_URL = "https://id.vk.com/authorize";
const VK_TOKEN_URL = "https://id.vk.com/oauth2/auth";
const VK_USERINFO_URL = "https://id.vk.com/oauth2/user_info";
const VK_ISSUER_NAMESPACE = "vkid:app";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function vkUserFields(json: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(json.user);
  return nested ?? json;
}

export class VkAuthProvider implements AuthProviderAdapter {
  readonly key = "vk" as const;

  constructor(private readonly env: AppEnv) {}

  get configured(): boolean {
    return Boolean(
      this.env.VK_CLIENT_ID &&
        this.env.VK_CLIENT_SECRET &&
        this.env.VK_REDIRECT_URI,
    );
  }

  private requireConfigured(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    if (!this.configured) {
      throw serviceUnavailable(
        "PROVIDER_UNAVAILABLE",
        "Провайдер VK недоступен",
        "VK credentials are not configured for this environment",
      );
    }
    return {
      clientId: this.env.VK_CLIENT_ID!,
      clientSecret: this.env.VK_CLIENT_SECRET!,
      redirectUri: this.env.VK_REDIRECT_URI!,
    };
  }

  async startAuthorization(
    input: AuthorizationStartInput,
  ): Promise<{ authorizationUrl: string }> {
    const cfg = this.requireConfigured();
    if (input.redirectUri !== cfg.redirectUri) {
      throw serviceUnavailable(
        "PROVIDER_MISCONFIGURED",
        "Провайдер VK настроен некорректно",
      );
    }
    const url = new URL(VK_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("scope", "vkid.personal_info");
    return { authorizationUrl: url.toString() };
  }

  async exchangeCode(input: CodeExchangeInput): Promise<ProviderTokenSet> {
    const cfg = this.requireConfigured();
    if (input.redirectUri !== cfg.redirectUri) {
      throw serviceUnavailable(
        "PROVIDER_MISCONFIGURED",
        "Провайдер VK настроен некорректно",
      );
    }
    const deviceId = input.deviceId?.trim();
    const state = input.state?.trim();
    if (!deviceId || !state) {
      throw serviceUnavailable(
        "PROVIDER_TOKEN_EXCHANGE_FAILED",
        "Не удалось обменять код VK",
      );
    }

    const url = new URL(VK_TOKEN_URL);
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("code_verifier", input.codeVerifier);
    url.searchParams.set("state", state);
    url.searchParams.set("device_id", deviceId);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: input.code }),
    });
    const json = asRecord(await response.json().catch(() => null));
    const accessToken =
      json && typeof json.access_token === "string" ? json.access_token : null;
    if (
      !response.ok ||
      !json ||
      typeof json.error === "string" ||
      !accessToken
    ) {
      throw serviceUnavailable(
        "PROVIDER_TOKEN_EXCHANGE_FAILED",
        "Не удалось обменять код VK",
      );
    }
    if (typeof json.state === "string" && json.state !== state) {
      throw serviceUnavailable(
        "PROVIDER_TOKEN_EXCHANGE_FAILED",
        "Не удалось обменять код VK",
      );
    }
    return {
      accessToken,
      refreshToken:
        typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      idToken: typeof json.id_token === "string" ? json.id_token : undefined,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
      raw: json,
    };
  }

  async fetchVerifiedIdentity(tokens: ProviderTokenSet): Promise<VerifiedIdentity> {
    const cfg = this.requireConfigured();
    const url = new URL(VK_USERINFO_URL);
    url.searchParams.set("client_id", cfg.clientId);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: tokens.accessToken }),
    });
    const json = asRecord(await response.json().catch(() => null));
    if (!response.ok || !json || typeof json.error === "string") {
      throw serviceUnavailable(
        "PROVIDER_IDENTITY_FAILED",
        "Не удалось получить профиль VK",
      );
    }
    const user = vkUserFields(json);
    const subject = optionalText(user.user_id);
    if (!subject) {
      throw serviceUnavailable(
        "PROVIDER_IDENTITY_FAILED",
        "Не удалось получить профиль VK",
      );
    }
    const displayName = [user.first_name, user.last_name]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" ")
      .trim();
    return {
      provider: "vk",
      issuerNamespace: `${VK_ISSUER_NAMESPACE}:${cfg.clientId}`,
      subject,
      email: optionalText(user.email),
      displayName: displayName || null,
      avatarUrl: optionalText(user.avatar),
    };
  }
}
