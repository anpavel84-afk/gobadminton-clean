import { randomUUID } from "node:crypto";
import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importVenuePublicData, main } from "../../src/database/import-venue-covers";
import { validatePublicDataManifest, type PublicDataManifest } from "../../src/venues/venue-public-data-import";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("venue public data import: disposable PostGIS", () => {
  const dbName = "venue_public_" + randomUUID().replaceAll("-", "");
  let admin: Pool | undefined, pool: Pool | undefined, root: string | undefined;
  let actor: string, userId: string;
  let cliEnv: NodeJS.ProcessEnv;
  const city = "a0000000-0000-4000-8000-000000000001";
  function db() {
    if (!pool) throw new Error("Missing disposable DB");
    return pool;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for disposable PostGIS");
    const url = new URL(process.env.DATABASE_URL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Disposable loopback DB required");
    }
    admin = new Pool({ connectionString: url.href });
    await admin.query('CREATE DATABASE "' + dbName + '"');
    url.pathname = "/" + dbName;
    pool = new Pool({ connectionString: url.href });
    await db().query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    const migrations = path.resolve(__dirname, "../../migrations");
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await db().query(await readFile(path.join(migrations, file), "utf8"));
      await db().query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
    }
    root = await mkdtemp(path.join(tmpdir(), "venue-public-import-"));
    cliEnv = {
      NODE_ENV: "test",
      APP_ENV: "stage",
      DATABASE_URL: url.href,
      PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
      PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
      ALLOWED_WEB_ORIGINS: "https://dev.gobadminton.ru",
      AVATAR_MEDIA_ROOT: root,
      AUTH_PEPPER: "synthetic-public-data-import-pepper-32chars",
      CONTENT_MODERATION_PROVIDER: "openai",
      OPENAI_MODERATION_API_KEY: "synthetic-unused-key",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-public-data-fingerprint-32chars",
    };
    const user = (await db().query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic public importer') RETURNING id")).rows[0];
    if (!user) throw new Error("fixture user");
    userId = user.id;
    const principal = (await db().query<{ id: string }>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [userId])).rows[0];
    if (!principal) throw new Error("fixture actor");
    actor = principal.id;
    await db().query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','synthetic')", [actor]);
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS "' + dbName + '"');
      await admin.end();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function venue(opts?: { lifecycle?: string; coverKey?: string | null }) {
    const id = randomUUID();
    await db().query(
      `INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address,contact_phone,contact_website,booking_note,cover_key)
       VALUES($1,$2,'Synthetic Hall','Synthetic Address 1','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$3,$4,$5,$6,'private-phone','https://private.invalid','private-note',$7)`,
      [id, city, userId, opts?.lifecycle ?? "unverified", id, id, opts?.coverKey ?? null],
    );
    return id;
  }

  function manifestFor(id: string, patch: Record<string, unknown> = {}): PublicDataManifest {
    return validatePublicDataManifest({
      schema: "VENUE_PUBLIC_DATA_BATCH_V1",
      batch: "synthetic-public",
      count: 1,
      items: [{
        venueId: id,
        expectedVersion: 1,
        expectedName: "Synthetic Hall",
        expectedAddress: "Synthetic Address 1",
        publicContacts: {
          phone: "+7 999 111-22-33",
          website: "https://example.com/hall",
          messengers: [{ kind: "vk", url: "https://vk.com/hall" }],
        },
        sources: [{
          url: "https://example.com/hall",
          checkedAt: "2026-10-27T12:00:00.000Z",
          note: "reviewed public page",
        }],
        ...patch,
      }],
    });
  }

  async function snapshot(id: string) {
    return (await db().query(
      `SELECT version,name,address,lifecycle_state,contact_phone,contact_website,booking_note,public_contacts,
              court_count,amenity_parking,amenity_showers,cover_key,cover_credit_kind
       FROM venues WHERE id=$1`,
      [id],
    )).rows[0];
  }

  it("dry-run has zero writes; apply patches public fields only; exact replay is SKIPPED", async () => {
    const id = await venue({ coverKey: null });
    const input = manifestFor(id, {
      profile: { courtCount: 2, amenities: { parking: true, showers: false } },
    });
    const counts = async () => (await db().query(
      `SELECT (SELECT count(*)::int FROM privileged_audit_events) audits,
              (SELECT count(*)::int FROM venue_admin_actions) actions,
              (SELECT count(*)::int FROM outbox_events) outbox`,
    )).rows[0];
    const before = await counts();
    const beforeRow = await snapshot(id);
    const lines: object[] = [];
    expect(await importVenuePublicData(db(), input, actor, false, (l) => lines.push(l))).toBe(0);
    expect(await counts()).toEqual(before);
    expect(await snapshot(id)).toEqual(beforeRow);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: id, action: "READY" }));

    expect(await importVenuePublicData(db(), input, actor, true, (l) => lines.push(l))).toBe(0);
    const after = await snapshot(id);
    expect(after).toMatchObject({
      version: 2,
      contact_phone: "private-phone",
      contact_website: "https://private.invalid",
      booking_note: "private-note",
      cover_key: null,
      cover_credit_kind: null,
      court_count: 2,
      amenity_parking: true,
      amenity_showers: false,
      name: "Synthetic Hall",
      address: "Synthetic Address 1",
      lifecycle_state: "unverified",
      public_contacts: input.items[0]!.publicContacts,
    });
    expect((await db().query(
      "SELECT 1 FROM venue_admin_actions WHERE venue_id=$1 AND action='edit'",
      [id],
    )).rowCount).toBe(1);
    const audit = (await db().query<{ after_diff: Record<string, unknown> }>(
      "SELECT after_diff FROM privileged_audit_events WHERE target_id=$1 AND reason_code='venue_public_data_batch_import'",
      [id],
    )).rows[0];
    expect(audit?.after_diff.sources).toEqual(input.items[0]!.sources);
    expect(audit?.after_diff.fingerprint).toEqual(expect.any(String));

    const mid = await counts();
    const midRow = await snapshot(id);
    const replayLines: object[] = [];
    // Identical replay keeps ORIGINAL expectedVersion and is SKIPPED before version gate.
    expect(await importVenuePublicData(db(), input, actor, true, (l) => replayLines.push(l))).toBe(0);
    expect(await counts()).toEqual(mid);
    expect(await snapshot(id)).toEqual(midRow);
    expect(replayLines).toContainEqual(expect.objectContaining({ venueId: id, action: "SKIPPED", reason: "PUBLIC_DATA_REPLAY" }));
    expect(JSON.stringify(lines)).not.toContain("private-phone");
    expect(JSON.stringify(replayLines)).not.toContain("private-note");
  });

  it("refuses conflicting fingerprint and external drift; rolls back failed rows and continues", async () => {
    const versionOnly = await venue();
    const sourceOnly = await venue();
    const drift = await venue();
    const conflict = await venue();
    const missing = randomUUID();
    const retired = await venue({ lifecycle: "retired" });

    expect(await importVenuePublicData(db(), manifestFor(versionOnly), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(sourceOnly), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(drift), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(conflict), actor, true, () => undefined)).toBe(0);
    await db().query(
      "UPDATE venues SET public_contacts=$2::jsonb, version=version+1, updated_at=now() WHERE id=$1",
      [drift, JSON.stringify({ phone: "+7 111 000-00-00", website: null, messengers: [] })],
    );

    const mixed = validatePublicDataManifest({
      schema: "VENUE_PUBLIC_DATA_BATCH_V1",
      batch: "synthetic-public",
      count: 6,
      items: [
        // Version-only change under same key ⇒ CONFLICT (not silent SKIPPED).
        { ...manifestFor(versionOnly).items[0]!, expectedVersion: 2 },
        // Source-only change under same key ⇒ CONFLICT.
        {
          ...manifestFor(sourceOnly).items[0]!,
          venueId: sourceOnly,
          sources: [{
            url: "https://example.com/other-page",
            checkedAt: "2026-10-28T08:00:00.000Z",
            note: "alternate reviewed page",
          }],
        },
        // Same accepted item fingerprint; external field change ⇒ DRIFT (not version-only rewrite).
        { ...manifestFor(drift).items[0]!, venueId: drift },
        {
          ...manifestFor(conflict).items[0]!,
          venueId: conflict,
          publicContacts: {
            phone: "+7 222 333-44-55",
            website: "https://example.com/other",
            messengers: [],
          },
        },
        {
          ...manifestFor(missing).items[0]!,
          venueId: missing,
          expectedName: "Missing",
          expectedAddress: "Missing",
        },
        { ...manifestFor(retired).items[0]!, venueId: retired },
      ],
    });

    const lines: object[] = [];
    expect(await importVenuePublicData(db(), mixed, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: versionOnly, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: sourceOnly, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: drift, action: "FAILED", reason: "PUBLIC_DATA_DRIFT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: conflict, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: missing, action: "FAILED", reason: "VENUE_NOT_FOUND" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: retired, action: "SKIPPED", reason: "VENUE_INELIGIBLE" }));
    expect((await snapshot(conflict)).public_contacts).toEqual(manifestFor(conflict).items[0]!.publicContacts);
    expect((await snapshot(versionOnly)).version).toBe(2);
    expect((await snapshot(sourceOnly)).version).toBe(2);
    expect((await snapshot(sourceOnly)).public_contacts).toEqual(manifestFor(sourceOnly).items[0]!.publicContacts);
  });

  it("CAS mismatch fails without writes; identity mismatch fails; actor guards refuse before writes", async () => {
    const id = await venue();
    const stale = manifestFor(id, { expectedVersion: 99 });
    const before = await snapshot(id);
    const lines: object[] = [];
    expect(await importVenuePublicData(db(), stale, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: id, action: "FAILED", reason: "VENUE_VERSION_CONFLICT" }));
    expect(await snapshot(id)).toEqual(before);

    const renamed = manifestFor(id, { expectedName: "Wrong Name" });
    expect(await importVenuePublicData(db(), renamed, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: id, action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" }));
    expect(await snapshot(id)).toEqual(before);

    const dir = await mkdtemp(path.join(tmpdir(), "venue-public-cli-"));
    try {
      await writeFile(path.join(dir, "batch.json"), JSON.stringify({
        schema: "VENUE_PUBLIC_DATA_BATCH_V1",
        batch: "actor-guards",
        count: 0,
        items: [],
      }));
      const args = ["--public-data", "--dir", dir, "--manifest", "batch.json", "--actor-principal-id", actor, "--apply"];
      const fullSnapshot = async () => (await db().query(`SELECT
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM venues v) venues,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM venue_admin_actions a) actions,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM privileged_audit_events a) audits`)).rows;
      const refused = async () => {
        const prior = await fullSnapshot();
        await expect(main(args, cliEnv)).rejects.toThrow("IMPORT_ACTOR_REFUSED");
        expect(await fullSnapshot()).toEqual(prior);
      };
      for (const [disable, enable] of [
        ["UPDATE admin_role_grants SET active=false WHERE principal_id=$1", "UPDATE admin_role_grants SET active=true WHERE principal_id=$1"],
        ["UPDATE admin_principals SET status='suspended' WHERE id=$1", "UPDATE admin_principals SET status='active' WHERE id=$1"],
      ]) {
        await db().query(disable!, [actor]);
        try { await refused(); }
        finally { await db().query(enable!, [actor]); }
      }
      await db().query("UPDATE users SET status='deletion_pending' WHERE id=$1", [userId]);
      try { await refused(); }
      finally { await db().query("UPDATE users SET status='active' WHERE id=$1", [userId]); }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
