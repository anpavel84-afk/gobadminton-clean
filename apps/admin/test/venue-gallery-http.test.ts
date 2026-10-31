import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST, PUT } from "../src/app/v1/admin/[...path]/route";

const origin = "http://localhost:18921";
const id = "00000000-0000-4000-8000-000000000001";
const item = "00000000-0000-4000-8000-000000000002";
const gallery = `venues/${id}/gallery`;
const context = (path = gallery) => ({ params: Promise.resolve({ path: path.split("/") }) });
let server: Server | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("Admin gallery BFF allowlist (synthetic loopback; no authenticated DEV evidence)", () => {
  async function start() {
    const seen: { method: string | undefined; url: string | undefined; headers: Record<string, unknown>; body: Buffer }[] = [];
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "VENUE_VERSION_CONFLICT" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No loopback address");
    for (const [name, value] of Object.entries({
      ADMIN_INTERNAL_APP_ENABLED: "1",
      ADMIN_TEST_ORIGIN: origin,
      ADMIN_TEST_API_URL: `http://127.0.0.1:${address.port}`,
      ADMIN_DEV_ENABLED: "0",
      ADMIN_DEV_PATH_ENABLED: "0",
      NEXT_PUBLIC_ADMIN_BASE_PATH: "",
      APP_ENV: "local",
      NODE_ENV: "test",
    })) vi.stubEnv(name, value);
    return seen;
  }

  const base = {
    origin,
    "x-csrf-token": "synthetic-csrf",
    "idempotency-key": "synthetic-replay-key",
    "x-venue-version": "7",
    cookie: "__Host-gb_session=consumer; __Host-gb_admin_session=synthetic-admin",
    authorization: "Bearer consumer",
  };
  const meta = {
    "x-gallery-credit-kind": "photo",
    "x-gallery-credit-text": encodeURIComponent("Фото: Клуб"),
    "x-gallery-credit-url": encodeURIComponent("https://club.example/photo"),
    "x-gallery-source-url": encodeURIComponent("https://club.example/photo"),
    "x-gallery-source-author": "null",
    "x-gallery-permission-basis": encodeURIComponent("Письменное согласие"),
    "x-gallery-source-fingerprint": "null",
  };

  it("allows GET root, POST upload, PUT/DELETE item, POST reorder and POST main with CAS/meta forwarding", async () => {
    const seen = await start();
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 0, 195, 40]);
    expect((await GET(new Request(`${origin}/v1/admin/${gallery}`, { headers: base }), context())).status).toBe(409);
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.url).toBe(`/v1/admin/${gallery}`);
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(seen[0]?.headers.cookie).toBe("__Host-gb_admin_session=synthetic-admin");

    const upload = await POST(new Request(`${origin}/v1/admin/${gallery}`, {
      method: "POST",
      headers: { ...base, ...meta, "content-type": "image/png" },
      body: bytes,
    }), context());
    expect(upload.status).toBe(409);
    expect(seen[1]?.body).toEqual(Buffer.from(bytes));
    expect(seen[1]?.headers).toMatchObject({
      "x-venue-version": "7",
      "x-csrf-token": "synthetic-csrf",
      "idempotency-key": "synthetic-replay-key",
      "x-gallery-credit-text": meta["x-gallery-credit-text"],
      "x-gallery-permission-basis": meta["x-gallery-permission-basis"],
    });
    expect(seen[1]?.headers["x-arbitrary"]).toBeUndefined();

    const itemPath = `${gallery}/${item}`;
    await PUT(new Request(`${origin}/v1/admin/${itemPath}`, {
      method: "PUT",
      headers: { ...base, ...meta, "content-type": "image/webp" },
      body: bytes,
    }), context(itemPath));
    expect(seen[2]?.method).toBe("PUT");

    const removeBody = JSON.stringify({ expectedVersion: 7 });
    await DELETE(new Request(`${origin}/v1/admin/${itemPath}`, {
      method: "DELETE",
      headers: { ...base, "content-type": "application/json" },
      body: removeBody,
    }), context(itemPath));
    expect(seen[3]?.body.toString()).toBe(removeBody);
    expect(seen[3]?.headers["x-gallery-credit-text"]).toBeUndefined();

    const reorder = `${gallery}/reorder`;
    await POST(new Request(`${origin}/v1/admin/${reorder}`, {
      method: "POST",
      headers: { ...base, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 7, orderedIds: [item] }),
    }), context(reorder));
    expect(seen[4]?.url).toBe(`/v1/admin/${reorder}`);

    const main = `${gallery}/${item}/main`;
    await POST(new Request(`${origin}/v1/admin/${main}`, {
      method: "POST",
      headers: { ...base, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 7 }),
    }), context(main));
    expect(seen[5]?.url).toBe(`/v1/admin/${main}`);
  });

  it("rejects malformed/unrelated gallery routes, methods, query, MIME and body limits before upstream", async () => {
    const seen = await start();
    for (const path of [
      `venues/${"-".repeat(36)}/gallery`,
      `${gallery}/arbitrary`,
      `${gallery}/${item}/arbitrary`,
      `venues/${id}/cover/gallery`,
    ]) {
      expect((await GET(new Request(`${origin}/v1/admin/${path}`, { headers: base }), context(path))).status).toBe(404);
    }
    expect((await POST(new Request(`${origin}/v1/admin/${gallery}/${item}`, {
      method: "POST", headers: { ...base, "content-type": "application/json" }, body: "{}",
    }), context(`${gallery}/${item}`))).status).toBe(404);
    expect((await GET(new Request(`${origin}/v1/admin/${gallery}?url=evil`, { headers: base }), context())).status).toBe(400);
    const noOrigin = { ...base }; delete (noOrigin as Partial<typeof base>).origin;
    expect((await POST(new Request(`${origin}/v1/admin/${gallery}`, {
      method: "POST",
      headers: { ...noOrigin, ...meta, "content-type": "image/png", "sec-fetch-site": "same-origin" },
      body: "x",
    }), context())).status).toBe(403);
    expect((await POST(new Request(`${origin}/v1/admin/${gallery}`, {
      method: "POST", headers: { ...base, ...meta, "content-type": "text/plain" }, body: "x",
    }), context())).status).toBe(415);
    expect((await POST(new Request(`${origin}/v1/admin/${gallery}`, {
      method: "POST", headers: { ...base, ...meta, "content-type": "image/png" }, body: new Uint8Array(5 * 1024 * 1024 + 1),
    }), context())).status).toBe(413);
    expect((await POST(new Request(`${origin}/v1/admin/${gallery}/reorder`, {
      method: "POST",
      headers: { ...base, "content-type": "application/json" },
      body: "x".repeat(65537),
    }), context(`${gallery}/reorder`))).status).toBe(413);
    expect(seen).toHaveLength(0);
  });
});
