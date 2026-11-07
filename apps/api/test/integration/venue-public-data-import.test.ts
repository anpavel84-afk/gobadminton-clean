import { randomUUID } from "node:crypto";
import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importVenuePublicData, main } from "../../src/database/import-venue-covers";
import {
  resolvePublicDataIdentity,
  validatePublicDataManifest,
  type PublicDataManifest,
} from "../../src/venues/venue-public-data-import";
import { normalizeVenueText, venueDedupeKey } from "../../src/venues/venue-normalize";

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

  /** Each ordinary fixture owns a unique physical identity key (name+address+discriminator). */
  async function venue(opts?: {
    lifecycle?: string;
    coverKey?: string | null;
    name?: string;
    address?: string;
    identityDiscriminator?: string;
  }) {
    const id = randomUUID();
    const tag = id.slice(0, 8);
    const name = opts?.name ?? `Synthetic Arena ${tag}`;
    const address = opts?.address ?? `Synthetic Street ${tag}`;
    const discriminator = opts?.identityDiscriminator ?? "";
    const normalizedName = normalizeVenueText(name);
    const normalizedAddress = normalizeVenueText(address);
    await db().query(
      `INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address,identity_discriminator,contact_phone,contact_website,booking_note,cover_key)
       VALUES($1,$2,$8,$9,'Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$3,$4,$5,$6,$10,'private-phone','https://private.invalid','private-note',$7)`,
      [id, city, userId, opts?.lifecycle ?? "unverified", normalizedName, normalizedAddress, opts?.coverKey ?? null, name, address, discriminator],
    );
    const key = venueDedupeKey({
      cityId: city,
      normalizedName,
      normalizedAddress,
      identityDiscriminator: discriminator,
    });
    await db().query(
      "INSERT INTO venue_identity_keys(dedupe_key,venue_id,normalization_version) VALUES($1,$2,1)",
      [key, id],
    );
    return { id, name, address };
  }

  function manifestFor(
    fixture: { id: string; name: string; address: string },
    patch: Record<string, unknown> = {},
  ): PublicDataManifest {
    return validatePublicDataManifest({
      schema: "VENUE_PUBLIC_DATA_BATCH_V1",
      batch: "synthetic-public",
      count: 1,
      items: [{
        venueId: fixture.id,
        expectedVersion: 1,
        expectedName: fixture.name,
        expectedAddress: fixture.address,
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
      `SELECT version,name,address,lifecycle_state,identity_discriminator,contact_phone,contact_website,booking_note,public_contacts,
              court_count,amenity_parking,amenity_showers,cover_key,cover_credit_kind,
              ST_AsText(location::geometry) AS location_wkt
       FROM venues WHERE id=$1`,
      [id],
    )).rows[0];
  }

  async function identityKeys(id: string) {
    return (await db().query<{ dedupe_key: string }>(
      "SELECT dedupe_key FROM venue_identity_keys WHERE venue_id=$1 ORDER BY created_at, dedupe_key",
      [id],
    )).rows.map((row) => row.dedupe_key);
  }

  it("dry-run has zero writes; apply patches public fields only; exact replay is SKIPPED", async () => {
    const v = await venue({ coverKey: null });
    const input = manifestFor(v, {
      profile: { courtCount: 2, amenities: { parking: true, showers: false } },
    });
    const counts = async () => (await db().query(
      `SELECT (SELECT count(*)::int FROM privileged_audit_events) audits,
              (SELECT count(*)::int FROM venue_admin_actions) actions,
              (SELECT count(*)::int FROM outbox_events) outbox`,
    )).rows[0];
    const before = await counts();
    const beforeRow = await snapshot(v.id);
    const lines: object[] = [];
    expect(await importVenuePublicData(db(), input, actor, false, (l) => lines.push(l))).toBe(0);
    expect(await counts()).toEqual(before);
    expect(await snapshot(v.id)).toEqual(beforeRow);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: v.id, action: "READY" }));

    expect(await importVenuePublicData(db(), input, actor, true, (l) => lines.push(l))).toBe(0);
    const after = await snapshot(v.id);
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
      name: v.name,
      address: v.address,
      lifecycle_state: "unverified",
      public_contacts: input.items[0]!.publicContacts,
    });
    expect((await db().query(
      "SELECT 1 FROM venue_admin_actions WHERE venue_id=$1 AND action='edit'",
      [v.id],
    )).rowCount).toBe(1);
    const audit = (await db().query<{ after_diff: Record<string, unknown> }>(
      "SELECT after_diff FROM privileged_audit_events WHERE target_id=$1 AND reason_code='venue_public_data_batch_import'",
      [v.id],
    )).rows[0];
    expect(audit?.after_diff.sources).toEqual(input.items[0]!.sources);
    expect(audit?.after_diff.fingerprint).toEqual(expect.any(String));

    const mid = await counts();
    const midRow = await snapshot(v.id);
    const replayLines: object[] = [];
    // Identical replay keeps ORIGINAL expectedVersion and is SKIPPED before version gate.
    expect(await importVenuePublicData(db(), input, actor, true, (l) => replayLines.push(l))).toBe(0);
    expect(await counts()).toEqual(mid);
    expect(await snapshot(v.id)).toEqual(midRow);
    expect(replayLines).toContainEqual(expect.objectContaining({ venueId: v.id, action: "SKIPPED", reason: "PUBLIC_DATA_REPLAY" }));
    expect(JSON.stringify(lines)).not.toContain("private-phone");
    expect(JSON.stringify(replayLines)).not.toContain("private-note");
  });

  it("refuses conflicting fingerprint and external drift; rolls back failed rows and continues", async () => {
    const versionOnly = await venue();
    const sourceOnly = await venue();
    const drift = await venue();
    const conflict = await venue();
    const missing = { id: randomUUID(), name: "Missing", address: "Missing" };
    const retired = await venue({ lifecycle: "retired" });

    expect(await importVenuePublicData(db(), manifestFor(versionOnly), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(sourceOnly), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(drift), actor, true, () => undefined)).toBe(0);
    expect(await importVenuePublicData(db(), manifestFor(conflict), actor, true, () => undefined)).toBe(0);
    await db().query(
      "UPDATE venues SET public_contacts=$2::jsonb, version=version+1, updated_at=now() WHERE id=$1",
      [drift.id, JSON.stringify({ phone: "+7 111 000-00-00", website: null, messengers: [] })],
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
          venueId: sourceOnly.id,
          sources: [{
            url: "https://example.com/other-page",
            checkedAt: "2026-10-28T08:00:00.000Z",
            note: "alternate reviewed page",
          }],
        },
        // Same accepted item fingerprint; external field change ⇒ DRIFT (not version-only rewrite).
        { ...manifestFor(drift).items[0]!, venueId: drift.id },
        {
          ...manifestFor(conflict).items[0]!,
          venueId: conflict.id,
          publicContacts: {
            phone: "+7 222 333-44-55",
            website: "https://example.com/other",
            messengers: [],
          },
        },
        {
          ...manifestFor(missing).items[0]!,
          venueId: missing.id,
          expectedName: "Missing",
          expectedAddress: "Missing",
        },
        { ...manifestFor(retired).items[0]!, venueId: retired.id },
      ],
    });

    const lines: object[] = [];
    expect(await importVenuePublicData(db(), mixed, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: versionOnly.id, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: sourceOnly.id, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: drift.id, action: "FAILED", reason: "PUBLIC_DATA_DRIFT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: conflict.id, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: missing.id, action: "FAILED", reason: "VENUE_NOT_FOUND" }));
    expect(lines).toContainEqual(expect.objectContaining({ venueId: retired.id, action: "SKIPPED", reason: "VENUE_INELIGIBLE" }));
    expect((await snapshot(conflict.id)).public_contacts).toEqual(manifestFor(conflict).items[0]!.publicContacts);
    expect((await snapshot(versionOnly.id)).version).toBe(2);
    expect((await snapshot(sourceOnly.id)).version).toBe(2);
    expect((await snapshot(sourceOnly.id)).public_contacts).toEqual(manifestFor(sourceOnly).items[0]!.publicContacts);
  });

  it("CAS mismatch fails without writes; identity mismatch fails; actor guards refuse before writes", async () => {
    const v = await venue();
    const stale = manifestFor(v, { expectedVersion: 99 });
    const before = await snapshot(v.id);
    const lines: object[] = [];
    expect(await importVenuePublicData(db(), stale, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: v.id, action: "FAILED", reason: "VENUE_VERSION_CONFLICT" }));
    expect(await snapshot(v.id)).toEqual(before);

    const renamed = manifestFor(v, { expectedName: "Wrong Name" });
    expect(await importVenuePublicData(db(), renamed, actor, true, (l) => lines.push(l))).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({ venueId: v.id, action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" }));
    expect(await snapshot(v.id)).toEqual(before);

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

  it("renames/addresses existing UUID; keeps geometry/private/lifecycle/keys; exact replay SKIPPED", async () => {
    const v = await venue({ identityDiscriminator: "hall:2" });
    const before = await snapshot(v.id);
    const oldKeys = await identityKeys(v.id);
    expect(oldKeys).toHaveLength(1);

    const rename = manifestFor(v, {
      identity: { name: "ЦЕХ №1 «Старая деревня»" },
      publicContacts: {
        phone: "+7 999 111-22-33",
        website: "https://ceh1-badm.ru",
        messengers: [],
      },
    });
    const dryLines: object[] = [];
    expect(await importVenuePublicData(db(), rename, actor, false, (l) => dryLines.push(l))).toBe(0);
    expect(dryLines).toContainEqual(expect.objectContaining({ venueId: v.id, action: "READY" }));
    expect(await snapshot(v.id)).toEqual(before);
    expect(await identityKeys(v.id)).toEqual(oldKeys);

    expect(await importVenuePublicData(db(), rename, actor, true, () => undefined)).toBe(0);
    const afterRename = await snapshot(v.id);
    expect(afterRename).toMatchObject({
      version: 2,
      name: "ЦЕХ №1 «Старая деревня»",
      address: v.address,
      identity_discriminator: "hall:2",
      lifecycle_state: "unverified",
      contact_phone: "private-phone",
      contact_website: "https://private.invalid",
      booking_note: "private-note",
      location_wkt: before.location_wkt,
      public_contacts: rename.items[0]!.publicContacts,
    });
    const keysAfterRename = await identityKeys(v.id);
    expect(keysAfterRename).toContain(oldKeys[0]);
    const renamedIdentity = resolvePublicDataIdentity({
      name: v.name,
      address: v.address,
      city_id: city,
      identity_discriminator: "hall:2",
    }, { name: "ЦЕХ №1 «Старая деревня»" });
    expect(keysAfterRename).toContain(renamedIdentity.dedupeKey);
    expect(keysAfterRename.length).toBeGreaterThanOrEqual(2);

    const replayLines: object[] = [];
    const mid = await snapshot(v.id);
    const midKeys = await identityKeys(v.id);
    expect(await importVenuePublicData(db(), rename, actor, true, (l) => replayLines.push(l))).toBe(0);
    expect(replayLines).toContainEqual(expect.objectContaining({
      venueId: v.id, action: "SKIPPED", reason: "PUBLIC_DATA_REPLAY",
    }));
    expect(await snapshot(v.id)).toEqual(mid);
    expect(await identityKeys(v.id)).toEqual(midKeys);

    const addressOnly = validatePublicDataManifest({
      schema: "VENUE_PUBLIC_DATA_BATCH_V1",
      batch: "synthetic-public-address",
      count: 1,
      items: [{
        venueId: v.id,
        expectedVersion: 2,
        expectedName: "ЦЕХ №1 «Старая деревня»",
        expectedAddress: v.address,
        identity: { address: "пр. Динамо, 44А" },
        sources: [{
          url: "https://example.com/nord",
          checkedAt: "2026-11-07T09:00:00.000Z",
          note: "official address correction",
        }],
      }],
    });
    expect(await importVenuePublicData(db(), addressOnly, actor, true, () => undefined)).toBe(0);
    const afterAddress = await snapshot(v.id);
    expect(afterAddress).toMatchObject({
      version: 3,
      name: "ЦЕХ №1 «Старая деревня»",
      address: "пр. Динамо, 44А",
      identity_discriminator: "hall:2",
      contact_phone: "private-phone",
      location_wkt: before.location_wkt,
      public_contacts: rename.items[0]!.publicContacts,
    });
    const keysAfterAddress = await identityKeys(v.id);
    expect(keysAfterAddress).toEqual(expect.arrayContaining(midKeys));
    expect(keysAfterAddress.length).toBeGreaterThan(midKeys.length);
  });

  it("legacy contact/profile receipt then external identity change fails IDENTITY_MISMATCH; own rename replay still SKIPPED", async () => {
    const v = await venue();
    const legacy = manifestFor(v, {
      profile: { courtCount: 1, amenities: { parking: false, showers: true } },
    });
    expect(await importVenuePublicData(db(), legacy, actor, true, () => undefined)).toBe(0);
    const afterLegacy = await snapshot(v.id);
    expect(afterLegacy).toMatchObject({
      version: 2,
      name: v.name,
      address: v.address,
      public_contacts: legacy.items[0]!.publicContacts,
      court_count: 1,
      amenity_parking: false,
      amenity_showers: true,
    });
    const auditsBefore = (await db().query(
      "SELECT count(*)::int AS n FROM privileged_audit_events WHERE target_id=$1",
      [v.id],
    )).rows[0]!.n;
    const actionsBefore = (await db().query(
      "SELECT count(*)::int AS n FROM venue_admin_actions WHERE venue_id=$1",
      [v.id],
    )).rows[0]!.n;
    const outboxBefore = (await db().query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id=$1",
      [v.id],
    )).rows[0]!.n;
    const keysBefore = await identityKeys(v.id);

    await db().query(
      "UPDATE venues SET name=$2, address=$3, version=version+1, updated_at=now() WHERE id=$1",
      [v.id, "Externally Renamed Arena", "Externally Changed Street 9"],
    );
    const drifted = await snapshot(v.id);
    const failLines: object[] = [];
    expect(await importVenuePublicData(db(), legacy, actor, true, (l) => failLines.push(l))).toBe(1);
    expect(failLines).toContainEqual(expect.objectContaining({
      venueId: v.id, action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH",
    }));
    expect(await snapshot(v.id)).toEqual(drifted);
    expect((await db().query(
      "SELECT count(*)::int AS n FROM privileged_audit_events WHERE target_id=$1",
      [v.id],
    )).rows[0]!.n).toBe(auditsBefore);
    expect((await db().query(
      "SELECT count(*)::int AS n FROM venue_admin_actions WHERE venue_id=$1",
      [v.id],
    )).rows[0]!.n).toBe(actionsBefore);
    expect((await db().query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id=$1",
      [v.id],
    )).rows[0]!.n).toBe(outboxBefore);
    expect(await identityKeys(v.id)).toEqual(keysBefore);

    const renameTarget = await venue({ identityDiscriminator: "hall:7" });
    const rename = manifestFor(renameTarget, {
      identity: { name: "Post-identity Rename Hall" },
    });
    expect(await importVenuePublicData(db(), rename, actor, true, () => undefined)).toBe(0);
    const postRename = await snapshot(renameTarget.id);
    const postKeys = await identityKeys(renameTarget.id);
    const renameReplay: object[] = [];
    expect(await importVenuePublicData(db(), rename, actor, true, (l) => renameReplay.push(l))).toBe(0);
    expect(renameReplay).toContainEqual(expect.objectContaining({
      venueId: renameTarget.id, action: "SKIPPED", reason: "PUBLIC_DATA_REPLAY",
    }));
    expect(await snapshot(renameTarget.id)).toEqual(postRename);
    expect(await identityKeys(renameTarget.id)).toEqual(postKeys);
  });

  it("refuses foreign identity collision and changed identity manifest atomically", async () => {
    // Same preserved unit discriminator on both UUIDs so a rename of foreign onto
    // target's physical name+address derives the SAME dedupe key target already owns.
    // (Empty-disc "… Hall …" names extract hall:<token> and would miss the stored "" key.)
    const sharedDisc = "hall:2";
    const target = await venue({
      name: "Target Arena Nord",
      address: "Target Street 10",
      identityDiscriminator: sharedDisc,
    });
    const foreign = await venue({
      name: "Foreign Arena South",
      address: "Foreign Street 20",
      identityDiscriminator: sharedDisc,
    });
    const foreignSnap = await snapshot(foreign.id);
    const foreignKeys = await identityKeys(foreign.id);

    const collide = manifestFor(foreign, {
      identity: { name: target.name, address: target.address },
    });
    const collideLines: object[] = [];
    expect(await importVenuePublicData(db(), collide, actor, true, (l) => collideLines.push(l))).toBe(1);
    expect(collideLines).toContainEqual(expect.objectContaining({
      venueId: foreign.id, action: "FAILED", reason: "VENUE_IDENTITY_CONFLICT",
    }));
    expect(await snapshot(foreign.id)).toEqual(foreignSnap);
    expect(await identityKeys(foreign.id)).toEqual(foreignKeys);
    expect(await identityKeys(target.id)).toHaveLength(1);

    expect(await importVenuePublicData(db(), manifestFor(target, {
      identity: { name: "Renamed Target" },
    }), actor, true, () => undefined)).toBe(0);

    const changed = manifestFor(target, {
      expectedVersion: 1,
      identity: { name: "Other New Name" },
    });
    const beforeConflict = await snapshot(target.id);
    const keysBeforeConflict = await identityKeys(target.id);
    const conflictLines: object[] = [];
    expect(await importVenuePublicData(db(), changed, actor, true, (l) => conflictLines.push(l))).toBe(1);
    expect(conflictLines).toContainEqual(expect.objectContaining({
      venueId: target.id, action: "FAILED", reason: "PUBLIC_DATA_CONFLICT",
    }));
    expect(await snapshot(target.id)).toEqual(beforeConflict);
    expect(await identityKeys(target.id)).toEqual(keysBeforeConflict);
  });
});
