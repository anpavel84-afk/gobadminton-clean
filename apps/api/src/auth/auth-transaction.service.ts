import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import type { ProviderKey } from "./constants";
import {
  hashSecret,
  openSecret,
  pkceChallengeS256,
  randomToken,
  sealSecret,
  secretsEqual,
} from "./crypto";
import { badRequest, conflict } from "./problem";

export type AuthTransactionPurpose = "login" | "link";

export type AuthTransactionRecord = {
  id: string;
  providerKey: ProviderKey;
  redirectUri: string;
  returnPath: string;
  bindingHash: string;
  pkceVerifier: string;
  purpose: AuthTransactionPurpose;
  boundUserId: string | null;
  boundSessionId: string | null;
  expiresAt: Date;
};

@Injectable()
export class AuthTransactionService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async create(input: {
    providerKey: ProviderKey;
    redirectUri: string;
    returnPath: string;
    bindingSecret: string;
    purpose?: AuthTransactionPurpose;
    boundUserId?: string;
    boundSessionId?: string;
  }): Promise<{ state: string; codeChallenge: string; expiresAt: Date }> {
    const purpose: AuthTransactionPurpose = input.purpose ?? "login";
    if (purpose === "link") {
      if (!input.boundUserId || !input.boundSessionId) {
        throw badRequest(
          "LINK_BINDING_REQUIRED",
          "Привязка провайдера требует активную сессию",
        );
      }
    } else if (input.boundUserId || input.boundSessionId) {
      throw badRequest(
        "LOGIN_MUST_BE_UNBOUND",
        "Обычный вход не привязывается к существующей сессии",
      );
    }

    const state = randomToken(24);
    const verifier = randomToken(48);
    const codeChallenge = pkceChallengeS256(verifier);
    const stateHash = hashSecret(this.env.AUTH_PEPPER, state);
    const bindingHash = hashSecret(this.env.AUTH_PEPPER, input.bindingSecret);
    const expiresAt = new Date(
      Date.now() + this.env.AUTH_TRANSACTION_TTL_SECONDS * 1000,
    );

    await this.pool.query(
      `INSERT INTO auth_transactions
         (state_hash, provider_key, redirect_uri, return_path, binding_hash,
          pkce_verifier_ciphertext, pkce_challenge, purpose,
          bound_user_id, bound_session_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        stateHash,
        input.providerKey,
        input.redirectUri,
        input.returnPath,
        bindingHash,
        sealSecret(this.env.AUTH_PEPPER, verifier),
        codeChallenge,
        purpose,
        purpose === "link" ? input.boundUserId! : null,
        purpose === "link" ? input.boundSessionId! : null,
        expiresAt,
      ],
    );

    return { state, codeChallenge, expiresAt };
  }

  async consume(input: {
    state: string;
    providerKey: ProviderKey;
    bindingSecret: string;
  }): Promise<AuthTransactionRecord> {
    if (!input.state) {
      throw badRequest("INVALID_STATE", "Отсутствует state авторизации");
    }
    const stateHash = hashSecret(this.env.AUTH_PEPPER, input.state);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        provider_key: ProviderKey;
        redirect_uri: string;
        return_path: string;
        binding_hash: string;
        pkce_verifier_ciphertext: string;
        purpose: AuthTransactionPurpose;
        bound_user_id: string | null;
        bound_session_id: string | null;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, provider_key, redirect_uri, return_path, binding_hash,
                pkce_verifier_ciphertext, purpose, bound_user_id, bound_session_id,
                expires_at, consumed_at
         FROM auth_transactions
         WHERE state_hash = $1
         FOR UPDATE`,
        [stateHash],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        throw badRequest("INVALID_STATE", "Неизвестный state авторизации");
      }
      if (row.consumed_at) {
        await client.query("ROLLBACK");
        throw conflict("AUTH_TRANSACTION_REPLAY", "Авторизация уже использована");
      }
      if (row.expires_at.getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        throw badRequest("AUTH_TRANSACTION_EXPIRED", "Срок авторизации истёк");
      }
      if (row.provider_key !== input.providerKey) {
        await client.query("ROLLBACK");
        throw badRequest("PROVIDER_MISMATCH", "Провайдер не совпадает с началом входа");
      }
      const expectedBinding = hashSecret(this.env.AUTH_PEPPER, input.bindingSecret);
      if (!secretsEqual(expectedBinding, row.binding_hash)) {
        await client.query("ROLLBACK");
        throw badRequest("BINDING_MISMATCH", "Привязка браузера не совпадает");
      }

      await client.query(
        `UPDATE auth_transactions SET consumed_at = now() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");

      return {
        id: row.id,
        providerKey: row.provider_key,
        redirectUri: row.redirect_uri,
        returnPath: row.return_path,
        bindingHash: row.binding_hash,
        pkceVerifier: openSecret(this.env.AUTH_PEPPER, row.pkce_verifier_ciphertext),
        purpose: row.purpose,
        boundUserId: row.bound_user_id,
        boundSessionId: row.bound_session_id,
        expiresAt: row.expires_at,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
