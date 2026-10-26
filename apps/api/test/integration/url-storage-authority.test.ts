import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

run("0040 external HTTP URL storage on PostGIS", () => {
  it("nulls already stored bad rows, keeps valid rows, and rejects the same class afterwards", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const loopback = ["127", "0", "0", "1"].join(".");
    if (![loopback, "localhost", "::1"].includes(url.hostname)) throw new Error("Disposable loopback PostGIS required");
    const admin = new Pool({ connectionString: url.href });
    const name = `url_storage_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.href });
    const dir = path.resolve(__dirname, "../../migrations");
    const attack = "https://vk.com@evil.example/";
    const keptWebsite = "http://venue.example.invalid:444/book?x=a@b";
    const keptCredit = "https://example.org/@user";
    const keptIdn = "https://пример.рф/path";
    const keptAvatar = "https://example.test/avatar.png";
    const backslash = "https://example.org/a\\b";
    const newline = "https://example.org/\n";
    const c1 = `https://example.org/${String.fromCharCode(133)}`;
    const badCreditPorts = [
      "https://example.org:0443/a",
      "https://example.org:00443/a",
      "https://example.org:/a",
      "https://[::1]:0443/",
      "https://[::1]:/",
    ];
    const keptExactPort = "https://example.org:443/a";
    const keptQueryAt = "https://example.org/path?q=a@b";
    const keptLong = "https://example.org/" + "a".repeat(280);
    try {
      expect(attack.length).toBeLessThanOrEqual(300);
      expect(keptLong).toHaveLength(300);
      for (const file of (await readdir(dir)).filter(item => item.endsWith(".sql") && item < "0040").sort()) {
        await pool.query(await readFile(path.join(dir, file), "utf8"));
      }
      expect((await pool.query("SELECT PostGIS_Version() AS v")).rows[0].v).toBeTruthy();
      const user = randomUUID();
      await pool.query("INSERT INTO users(id, display_name) VALUES ($1, 'Synthetic storage')", [user]);
      const approval = (await pool.query(`INSERT INTO content_moderation_approvals(content_type, surface_key, fingerprint_version, content_fingerprint, policy_version, local_policy_version, provider_key, provider_model, category_flags, decision, checked_at)
        VALUES ('image', 'cover_image', 1, $1, 'avatar-image-v1', 'none', 'fake', 'synthetic', '{}', 'allow', now()) RETURNING id`, ["b".repeat(64)])).rows[0].id as string;
      let key = 0;
      const venue = async (website: string | null, credit: string | null, kind: "photo" | "illustration" | null = credit ? "photo" : null) => {
        const id = randomUUID();
        await pool.query(`INSERT INTO venues(id, city_id, name, address, timezone, location, created_by_user_id, version, lifecycle_state, normalized_name, normalized_address)
          VALUES ($1, 'a0000000-0000-4000-8000-000000000001', 'Synthetic', 'Synthetic address', 'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.6, 55.7), 4326)::geography, $2, 3, 'verified', 'synthetic', 'synthetic address')`, [id, user]);
        if (kind) {
          const cover = `${(key++).toString(16).padStart(64, "0")}.png`;
          await pool.query("UPDATE venues SET cover_key=$2, cover_moderation_approval_id=$3, cover_actor_id=$4, cover_credit_kind=$5, cover_credit_text=$6, cover_credit_url=$7 WHERE id=$1", [
            id, cover, approval, user, kind, kind === "illustration" ? "Иллюстрация" : "Фото: Клуб", credit,
          ]);
        } else if (website) {
          await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [id, website]);
        }
        if (website && kind) await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [id, website]);
        return id;
      };
      const keepWeb = await venue(keptWebsite, null);
      const keepCredit = await venue(keptIdn, keptCredit);
      const keepIllustration = await venue(null, null, "illustration");
      const badWebUserinfo = await venue(attack, null);
      const badWebSlash = await venue(backslash, null);
      const badWebControl = await venue(newline, null);
      const badCreditUserinfo = await venue(null, attack);
      const badCreditControl = await venue(null, c1);
      const badPorts = [];
      for (const credit of badCreditPorts) badPorts.push(await venue(null, credit));
      const keepExact = await venue(null, keptExactPort);
      const keepQuery = await venue(null, keptQueryAt);
      const keepLong = await venue(null, keptLong);
      const identity = async (subject: string, avatar: string) => {
        await pool.query("INSERT INTO external_identities(user_id, provider_key, issuer_namespace, subject, avatar_url) VALUES ($1, 'vk', 'vkid:storage-test', $2, $3)", [user, subject, avatar]);
      };
      await identity("kept", keptAvatar);
      await identity("userinfo", attack);
      await identity("slash", backslash);
      await identity("control", newline);
      await identity("http", "http://sun1-1.userapi.com/photo");

      await pool.query(await readFile(path.join(dir, "0040_external_http_url_storage.sql"), "utf8"));

      const row = async (id: string) => (await pool.query("SELECT contact_website, cover_credit_kind, cover_credit_text, cover_credit_url, cover_key FROM venues WHERE id=$1", [id])).rows[0];
      expect(await row(keepWeb)).toMatchObject({ contact_website: keptWebsite, cover_credit_url: null });
      expect(await row(keepCredit)).toMatchObject({ contact_website: keptIdn, cover_credit_kind: "photo", cover_credit_text: "Фото: Клуб", cover_credit_url: keptCredit });
      expect((await row(keepCredit)).cover_key).toMatch(/\.png$/);
      expect(await row(keepIllustration)).toMatchObject({ cover_credit_kind: "illustration", cover_credit_text: "Иллюстрация", cover_credit_url: null });
      for (const id of [badWebUserinfo, badWebSlash, badWebControl]) expect((await row(id)).contact_website).toBeNull();
      for (const id of [badCreditUserinfo, badCreditControl, ...badPorts]) {
        expect(await row(id)).toMatchObject({ cover_credit_kind: null, cover_credit_text: null, cover_credit_url: null });
        expect((await row(id)).cover_key).toMatch(/\.png$/);
      }
      expect(await row(keepExact)).toMatchObject({ cover_credit_kind: "photo", cover_credit_url: keptExactPort });
      expect(await row(keepQuery)).toMatchObject({ cover_credit_url: keptQueryAt });
      expect(await row(keepLong)).toMatchObject({ cover_credit_url: keptLong });
      const avatars = Object.fromEntries((await pool.query("SELECT subject, avatar_url FROM external_identities WHERE user_id=$1", [user])).rows.map(item => [item.subject, item.avatar_url]));
      expect(avatars).toMatchObject({ kept: keptAvatar, userinfo: null, slash: null, control: null, http: null });

      const fresh = await venue(null, null);
      await expect(pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [fresh, attack])).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [fresh, backslash])).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [fresh, c1])).rejects.toMatchObject({ code: "23514" });
      await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [fresh, keptWebsite]);
      const cover = `${(key++).toString(16).padStart(64, "0")}.png`;
      await pool.query("UPDATE venues SET cover_key=$2, cover_moderation_approval_id=$3, cover_actor_id=$4 WHERE id=$1", [fresh, cover, approval, user]);
      await expect(pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, attack])).rejects.toMatchObject({ code: "23514" });
      for (const credit of badCreditPorts) {
        await expect(pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, credit])).rejects.toMatchObject({ code: "23514" });
      }
      await expect(pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, "https://example.org:444/a"])).rejects.toMatchObject({ code: "23514" });
      await pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, keptCredit]);
      await pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, keptExactPort]);
      await pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, keptLong]);
      await expect(pool.query("INSERT INTO external_identities(user_id, provider_key, issuer_namespace, subject, avatar_url) VALUES ($1, 'yandex', 'yandex:storage-test', 'bad', $2)", [user, attack])).rejects.toMatchObject({ code: "23514" });
      await pool.query("INSERT INTO external_identities(user_id, provider_key, issuer_namespace, subject, avatar_url) VALUES ($1, 'yandex', 'yandex:storage-test', 'good', $2)", [user, "https://sun1-1.userapi.com/photo"]);
      const stored = async (value: string, httpsOnly: boolean, max: number, creditPort: boolean) => (await pool.query(
        "SELECT external_http_url_storage_ok($1, $2, $3, $4) AS ok",
        [value, httpsOnly, max, creditPort],
      )).rows[0].ok;
      expect(await stored(attack, true, 300, true)).toBe(false);
      expect(await stored(keptCredit, true, 300, true)).toBe(true);
      expect(await stored(keptExactPort, true, 300, true)).toBe(true);
      expect(await stored(keptQueryAt, true, 300, true)).toBe(true);
      expect(await stored(keptLong, true, 300, true)).toBe(true);
      expect(await stored(keptIdn, false, 300, false)).toBe(true);
      expect(await stored(keptWebsite, false, 300, false)).toBe(true);
      expect(await stored("https://example.org:444/a", true, 300, true)).toBe(false);
      expect(await stored("https://example.org:444/a", false, 300, false)).toBe(true);
      for (const credit of badCreditPorts) expect(await stored(credit, true, 300, true)).toBe(false);

      await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY)");
      await pool.query("INSERT INTO schema_migrations(id) VALUES('0040_external_http_url_storage') ON CONFLICT DO NOTHING");
      await pool.query(await readFile(path.join(dir, "rollback/0040_external_http_url_storage.sql"), "utf8"));
      expect((await pool.query("SELECT id FROM schema_migrations WHERE id='0040_external_http_url_storage'")).rowCount).toBe(0);
      expect((await pool.query("SELECT to_regprocedure('external_http_url_storage_ok(text,boolean,integer,boolean)') AS name")).rows[0].name).toBeNull();
      expect((await pool.query("SELECT to_regprocedure('external_http_url_storage_ok(text,boolean,integer)') AS name")).rows[0].name).toBeNull();
      expect((await row(badWebUserinfo)).contact_website).toBeNull();
      expect((await row(badPorts[0]!)).cover_credit_url).toBeNull();
      await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [fresh, attack]);
      await pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [fresh, badCreditPorts[0]]);
      expect((await row(fresh)).contact_website).toBe(attack);
      expect((await row(fresh)).cover_credit_url).toBe(badCreditPorts[0]);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  }, 180000);

  it("applies 0040 before contact_website exists and again under another search_path", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const loopback = ["127", "0", "0", "1"].join(".");
    if (![loopback, "localhost", "::1"].includes(url.hostname)) throw new Error("Disposable loopback PostGIS required");
    const admin = new Pool({ connectionString: url.href });
    const name = `url_storage_order_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.href });
    const dir = path.resolve(__dirname, "../../migrations");
    const files = (await readdir(dir)).filter(item => item.endsWith(".sql")).sort();
    try {
      for (const file of files.filter(item => item !== "0036_venue_contacts.sql")) {
        await pool.query(await readFile(path.join(dir, file), "utf8"));
      }
      await pool.query(await readFile(path.join(dir, "0036_venue_contacts.sql"), "utf8"));
      const user = randomUUID();
      await pool.query("INSERT INTO users(id, display_name) VALUES ($1, 'Order storage')", [user]);
      const id = randomUUID();
      await pool.query(`INSERT INTO venues(id, city_id, name, address, timezone, location, created_by_user_id, version, lifecycle_state, normalized_name, normalized_address)
        VALUES ($1, 'a0000000-0000-4000-8000-000000000001', 'Synthetic', 'Synthetic address', 'Europe/Moscow', ST_SetSRID(ST_MakePoint(37.6, 55.7), 4326)::geography, $2, 3, 'verified', 'synthetic', 'synthetic address')`, [id, user]);
      const website = "http://venue.example.invalid:444/book?x=a@b";
      await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [id, website]);
      await pool.query("UPDATE venues SET contact_website=$2 WHERE id=$1", [id, "https://пример.рф/path"]);
      const approval = (await pool.query(`INSERT INTO content_moderation_approvals(content_type, surface_key, fingerprint_version, content_fingerprint, policy_version, local_policy_version, provider_key, provider_model, category_flags, decision, checked_at)
        VALUES ('image', 'cover_image', 1, $1, 'avatar-image-v1', 'none', 'fake', 'synthetic', '{}', 'allow', now()) RETURNING id`, ["c".repeat(64)])).rows[0].id as string;
      const cover = `${"d".repeat(64)}.png`;
      await pool.query("UPDATE venues SET cover_key=$2, cover_moderation_approval_id=$3, cover_actor_id=$4 WHERE id=$1", [id, cover, approval, user]);
      await expect(pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [id, "https://example.org:0443/a"])).rejects.toMatchObject({ code: "23514" });
      await pool.query("UPDATE venues SET cover_credit_kind='photo', cover_credit_text='Фото: Клуб', cover_credit_url=$2 WHERE id=$1", [id, "https://example.org:443/a"]);

      const client = await pool.connect();
      try {
        await client.query("CREATE SCHEMA side");
        await client.query("SET search_path TO side, public");
        for (const file of files) await client.query(await readFile(path.join(dir, file), "utf8"));
        const schemas = (await client.query("SELECT n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = 'external_http_url_storage_ok' ORDER BY 1")).rows.map(row => row.nspname);
        expect(schemas).toEqual(["public", "side"]);
      } finally {
        await client.query("RESET search_path");
        client.release();
      }
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  }, 180000);
});
