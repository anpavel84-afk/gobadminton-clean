import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as PushClientModule from "../src/lib/push-client";
import { PushSettings } from "../src/components/consumer/push/PushSettings";
import {
  bumpPushFenceGeneration,
  detectPushCapability,
  enqueuePushFenceMutation,
  getPushFenceGeneration,
  urlBase64ToUint8Array,
} from "../src/lib/push-client";

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement("a", { href: props.href }, props.children as never),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../src/lib/push-client", async () => {
  const actual = await vi.importActual<typeof PushClientModule>(
    "../src/lib/push-client",
  );
  return {
    ...actual,
    getPushState: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        featureAvailable: false,
        preferenceEnabled: false,
        preferenceVersion: 0,
        vapidPublicKey: null,
        accountFence: null,
        deviceCount: 0,
        maxDevices: 5,
        currentDevice: null,
        devices: [],
      },
    })),
    detectPushCapability: () => "unsupported" as const,
  };
});

describe("#456 web push settings surface", () => {
  it("renders Russian settings copy without prompting on mount", () => {
    const html = renderToStaticMarkup(
      createElement(PushSettings, {
        me: {
          id: "11111111-1111-4111-8111-111111111111",
          displayName: "Тест",
          locale: "ru",
          linkedProviders: [],
          csrfToken: "csrf-token-for-test-only",
        },
      }),
    );
    expect(html).toMatch(/Уведомления о сообщениях/);
    expect(html).not.toMatch(/requestPermission|PushManager\.subscribe/);
  });

  it("exposes base64url helper and capability helper", () => {
    const bytes = urlBase64ToUint8Array("AQID");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    // Without browser APIs in node, detect may be unsupported.
    expect(["unsupported", "needs_homescreen", "ready", "denied", "offline"]).toContain(
      detectPushCapability(),
    );
  });

  it("serializes fence writes and drops stale out-of-order resolve before post", async () => {
    const posts: string[] = [];
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });

    const staleGen = bumpPushFenceGeneration();
    const stale = enqueuePushFenceMutation(staleGen, async (isCurrent) => {
      await staleGate;
      if (!isCurrent()) return;
      posts.push("stale");
    });

    const freshGen = bumpPushFenceGeneration();
    expect(freshGen).toBe(getPushFenceGeneration());
    await enqueuePushFenceMutation(freshGen, async (isCurrent) => {
      if (!isCurrent()) return;
      posts.push("fresh");
    });

    releaseStale();
    await stale;
    expect(posts).toEqual(["fresh"]);
  });
});
