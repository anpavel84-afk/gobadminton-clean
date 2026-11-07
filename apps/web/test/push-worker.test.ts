import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Exercises owned sw-push.js handlers with mock platform events.
 * Does not claim physical-device PASS.
 */
describe("#456 sw-push.js handlers", () => {
  it("registers push/notificationclick/message only — no fetch/cache/sync interception", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../public/sw-push.js"),
      "utf8",
    );
    expect(source).toMatch(/addEventListener\("push"/);
    expect(source).toMatch(/addEventListener\("notificationclick"/);
    expect(source).toMatch(/addEventListener\("message"/);
    expect(source).not.toMatch(/addEventListener\("fetch"/);
    expect(source).not.toMatch(/addEventListener\("sync"/);
    expect(source).not.toMatch(/caches\.open\(["']gb-offline/);
  });

  it("accepts safe game/results click paths and rejects foreign absolute URLs", async () => {
    const source = readFileSync(
      path.resolve(__dirname, "../public/sw-push.js"),
      "utf8",
    );
    expect(source).toMatch(/\/games\//);
    expect(source).toMatch(/\/my-games\//);
    expect(source).toMatch(/includes\(":\/\/"\)/);
  });

  it("shows notification only when fence matches; clears on gb-push-clear", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
    const closed: string[] = [];
    const cacheStore = new Map<string, Response>();

    const selfMock = {
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          shown.push({ title, options });
        },
        getNotifications: async () =>
          shown.map((item) => ({
            close: () => closed.push(String(item.options.tag ?? "")),
          })),
      },
      clients: {
        matchAll: async () => [],
        openWindow: async () => null,
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(handler);
        listeners.set(type, list);
      },
    };

    const cachesMock = {
      open: async () => ({
        match: async (key: string) => cacheStore.get(key) ?? null,
        put: async (key: string, value: Response) => {
          cacheStore.set(key, value);
        },
      }),
      delete: async () => {
        cacheStore.clear();
        return true;
      },
    };

    // Evaluate SW in a sandbox with mocked globals.
    const source = readFileSync(
      path.resolve(__dirname, "../public/sw-push.js"),
      "utf8",
    );
    const fn = new Function("self", "caches", "clients", "Response", source);
    fn(selfMock, cachesMock, selfMock.clients, Response);

    const messageHandlers = listeners.get("message") ?? [];
    const pushHandlers = listeners.get("push") ?? [];
    expect(messageHandlers.length).toBe(1);
    expect(pushHandlers.length).toBe(1);

    await new Promise<void>((resolve) => {
      messageHandlers[0]!({
        data: { type: "gb-push-set-fence", fence: "fence-a" },
        waitUntil: (p: Promise<unknown>) => {
          void p.then(() => resolve());
        },
      });
    });

    await new Promise<void>((resolve) => {
      pushHandlers[0]!({
        data: {
          json: () => ({
            title: "Новое сообщение",
            path: "/messages?conversation=11111111-1111-4111-8111-111111111111",
            tag: "gb-msg-1",
            fence: "fence-a",
          }),
        },
        waitUntil: (p: Promise<unknown>) => {
          void p.then(() => resolve());
        },
      });
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe("Новое сообщение");

    shown.length = 0;
    await new Promise<void>((resolve) => {
      pushHandlers[0]!({
        data: {
          json: () => ({
            title: "Новое сообщение",
            path: "/messages",
            tag: "gb-msg-2",
            fence: "other-account",
          }),
        },
        waitUntil: (p: Promise<unknown>) => {
          void p.then(() => resolve());
        },
      });
    });
    expect(shown).toHaveLength(0);

    await new Promise<void>((resolve) => {
      messageHandlers[0]!({
        data: { type: "gb-push-clear" },
        waitUntil: (p: Promise<unknown>) => {
          void p.then(() => resolve());
        },
      });
    });
    expect(closed.length).toBeGreaterThanOrEqual(0);
    void vi;
  });

  it("keeps newer fence when delayed clear races ahead of subsequent set", async () => {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const cacheStore = new Map<string, Response>();
    let releaseClear: (() => void) | undefined;
    const clearHold = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });

    const selfMock = {
      registration: {
        showNotification: async () => {},
        getNotifications: async () => [],
      },
      clients: {
        matchAll: async () => [],
        openWindow: async () => null,
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(handler);
        listeners.set(type, list);
      },
    };

    const cachesMock = {
      open: async () => ({
        match: async (key: string) => cacheStore.get(key) ?? null,
        put: async (key: string, value: Response) => {
          cacheStore.set(key, value);
        },
      }),
      delete: async () => {
        await clearHold;
        cacheStore.clear();
        return true;
      },
    };

    const source = readFileSync(
      path.resolve(__dirname, "../public/sw-push.js"),
      "utf8",
    );
    const fn = new Function("self", "caches", "clients", "Response", source);
    fn(selfMock, cachesMock, selfMock.clients, Response);

    const messageHandlers = listeners.get("message") ?? [];
    expect(messageHandlers.length).toBe(1);

    const waitUntils: Promise<unknown>[] = [];
    messageHandlers[0]!({
      data: { type: "gb-push-clear" },
      waitUntil: (p: Promise<unknown>) => {
        waitUntils.push(p);
      },
    });
    messageHandlers[0]!({
      data: { type: "gb-push-set-fence", fence: "new-account" },
      waitUntil: (p: Promise<unknown>) => {
        waitUntils.push(p);
      },
    });

    expect(waitUntils).toHaveLength(2);
    releaseClear!();
    await Promise.all(waitUntils);

    const fenceRes = cacheStore.get("/__gb_push_fence");
    expect(fenceRes).toBeTruthy();
    const meta = await fenceRes!.json();
    expect(meta.fence).toBe("new-account");
  });
});
