import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("Admin A0a additive upgrade from exact composite 0026", () => {
  it("preserves consumer sessions/identities/email/RBAC defaults and enforces Admin-only schema", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      client = await pool.connect();
    const schema = "a0a_upgrade_" + randomUUID().replaceAll("-", ""),
      root = path.resolve(__dirname, "../../migrations");
    try {
      await client.query("CREATE SCHEMA " + schema);
      await client.query("SET search_path TO " + schema + ",public");
      for (const f of readdirSync(root)
        .filter((f) => f.endsWith(".sql") && f < "0027")
        .sort())
        await client.query(readFileSync(path.join(root, f), "utf8"));
      const u = (
        await client.query<{ id: string }>(
          "INSERT INTO users(display_name) VALUES('Synthetic consumer upgrade') RETURNING id",
        )
      ).rows[0]!.id;
      await client.query(
        "INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,email) VALUES($1,'vk','a0a:upgrade','synthetic','same@example.test')",
        [u],
      );
      await client.query(
        "INSERT INTO app_sessions(user_id,session_hash,csrf_ciphertext,expires_at) VALUES($1,'legacy-consumer-hash','sealed-consumer-csrf',now()+interval '1 day')",
        [u],
      );
      await client.query(
        "INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,'a0a-upgrade@example.test','a0a-upgrade@example.test')",
        [u],
      );
      const snapshot = async () =>
        JSON.stringify(
          (
            await client.query(
              `SELECT row_to_json(u) AS u,row_to_json(e) AS e,row_to_json(s) AS s,row_to_json(m) AS m
     FROM users u JOIN external_identities e ON e.user_id=u.id JOIN app_sessions s ON s.user_id=u.id JOIN email_auth_methods m ON m.user_id=u.id WHERE u.id=$1`,
              [u],
            )
          ).rows,
        );
      const before = await snapshot();
      await client.query(
        readFileSync(
          path.join(root, "0027_admin_identity_rbac_audit.sql"),
          "utf8",
        ),
      );
      expect(await snapshot()).toBe(before);
      for (const t of [
        "admin_principals",
        "admin_sessions",
        "admin_role_grants",
        "admin_bootstrap_state",
        "privileged_audit_events",
      ])
        expect(
          (await client.query("SELECT count(*) AS n FROM " + t)).rows[0]!.n,
        ).toBe("0");
      const p = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",
          [u],
        )
      ).rows[0]!.id;
      expect(
        (
          await client.query(
            "SELECT status FROM admin_principals WHERE id=$1",
            [p],
          )
        ).rows[0]!.status,
      ).toBe("pending_mfa");
      await expect(
        client.query(
          "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'owner','invalid')",
          [p],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext,audience) VALUES($1,'missing','h','c','consumer_browser')",
          [p],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query("INSERT INTO admin_principals(user_id) VALUES($1)", [u]),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("RESET search_path");
      await client.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      client.release();
      await pool.end();
    }
  });
});
