import type { ProviderKey } from "../constants";

export type VerifiedIdentity = {
  provider: ProviderKey;
  issuerNamespace: string;
  subject: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type AuthorizationStartInput = {
  state: string;
  codeChallenge: string;
  redirectUri: string;
};

export type CodeExchangeInput = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  state?: string;
  /** VK ID OAuth 2.1 callback `device_id`; unused by Yandex. */
  deviceId?: string;
};

export type ProviderTokenSet = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  raw?: Record<string, unknown>;
};

export interface AuthProviderAdapter {
  readonly key: ProviderKey;
  readonly configured: boolean;
  startAuthorization(input: AuthorizationStartInput): Promise<{ authorizationUrl: string }>;
  exchangeCode(input: CodeExchangeInput): Promise<ProviderTokenSet>;
  fetchVerifiedIdentity(tokens: ProviderTokenSet): Promise<VerifiedIdentity>;
  revoke?(tokens: ProviderTokenSet): Promise<void>;
}
