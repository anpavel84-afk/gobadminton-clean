import type { AppEnv } from "../../config/env";
import { serviceUnavailable } from "../problem";
import type {
  AuthProviderAdapter,
  AuthorizationStartInput,
  CodeExchangeInput,
  ProviderTokenSet,
  VerifiedIdentity,
} from "./types";

const YANDEX_AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_USERINFO_URL = "https://login.yandex.ru/info";
const YANDEX_ISSUER_NAMESPACE = "yandex:oauth";

export class YandexAuthProvider implements AuthProviderAdapter {
  readonly key = "yandex" as const;

  constructor(private readonly env: AppEnv) {}

  get configured(): boolean {
    return Boolean(
      this.env.YANDEX_CLIENT_ID &&
        this.env.YANDEX_CLIENT_SECRET &&
        this.env.YANDEX_REDIRECT_URI,
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
        "Провайдер Яндекс недоступен",
        "Yandex credentials are not configured for this environment",
      );
    }
    return {
      clientId: this.env.YANDEX_CLIENT_ID!,
      clientSecret: this.env.YANDEX_CLIENT_SECRET!,
      redirectUri: this.env.YANDEX_REDIRECT_URI!,
    };
  }

  async startAuthorization(
    input: AuthorizationStartInput,
  ): Promise<{ authorizationUrl: string }> {
    const cfg = this.requireConfigured();
    if (input.redirectUri !== cfg.redirectUri) {
      throw serviceUnavailable(
        "PROVIDER_MISCONFIGURED",
        "Провайдер Яндекс настроен некорректно",
      );
    }
    const url = new URL(YANDEX_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("force_confirm", "yes");
    return { authorizationUrl: url.toString() };
  }

  async exchangeCode(input: CodeExchangeInput): Promise<ProviderTokenSet> {
    const cfg = this.requireConfigured();
    if (input.redirectUri !== cfg.redirectUri) {
      throw serviceUnavailable(
        "PROVIDER_MISCONFIGURED",
        "Провайдер Яндекс настроен некорректно",
      );
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const response = await fetch(YANDEX_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw serviceUnavailable(
        "PROVIDER_TOKEN_EXCHANGE_FAILED",
        "Не удалось обменять код Яндекс",
      );
    }
    const json = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof json.access_token === "string" ? json.access_token : null;
    if (!accessToken) {
      throw serviceUnavailable(
        "PROVIDER_TOKEN_EXCHANGE_FAILED",
        "Не удалось обменять код Яндекс",
      );
    }
    return {
      accessToken,
      refreshToken:
        typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
      raw: json,
    };
  }

  async fetchVerifiedIdentity(tokens: ProviderTokenSet): Promise<VerifiedIdentity> {
    const cfg = this.requireConfigured();
    const response = await fetch(`${YANDEX_USERINFO_URL}?format=json`, {
      headers: { authorization: `OAuth ${tokens.accessToken}` },
    });
    if (!response.ok) {
      throw serviceUnavailable(
        "PROVIDER_IDENTITY_FAILED",
        "Не удалось получить профиль Яндекс",
      );
    }
    const json = (await response.json()) as {
      id?: string | number;
      default_email?: string;
      login?: string;
      display_name?: string;
      real_name?: string;
      default_avatar_id?: string;
      is_avatar_empty?: boolean;
    };
    const subject = json.id !== undefined ? String(json.id) : "";
    if (!subject) {
      throw serviceUnavailable(
        "PROVIDER_IDENTITY_FAILED",
        "Не удалось получить профиль Яндекс",
      );
    }
    let avatarUrl: string | null = null;
    if (json.default_avatar_id && json.is_avatar_empty === false) {
      avatarUrl = `https://avatars.yandex.net/get-yapic/${json.default_avatar_id}/islands-200`;
    }
    return {
      provider: "yandex",
      issuerNamespace: `${YANDEX_ISSUER_NAMESPACE}:${cfg.clientId}`,
      subject,
      email: json.default_email ?? null,
      displayName: json.display_name || json.real_name || json.login || null,
      avatarUrl,
    };
  }
}
