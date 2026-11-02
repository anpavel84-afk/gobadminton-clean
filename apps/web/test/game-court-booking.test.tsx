import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as React from "react";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    const slots = hooks.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [slots[index], (next: T | ((old: T) => T)) => {
      slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
    }];
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    return hooks.slots[i] ??= { current: initial };
  },
  useMemo(fn: () => unknown) {
    return fn();
  },
  useEffect() {
    hooks.cursor++;
  },
}));

const mutation = vi.hoisted(() => ({
  busy: false,
  pending: false,
  notice: "",
  code: "",
  run: vi.fn(() => true),
  retry: vi.fn(),
  options: undefined as undefined | {
    validateSuccess?: (data: unknown, pending?: { body: object }) => boolean;
    validatePending?: (pending: { path: string; method: string; body: object }) => boolean;
  },
}));

vi.mock("../src/components/consumer/messages/useSocialMutation", () => ({
  useSocialMutation: (_scope: string, _csrf: string, _ok: unknown, _refresh: unknown, _persist?: boolean, options?: {
    validateSuccess?: (data: unknown, pending?: { body: object }) => boolean;
    validatePending?: (pending: { path: string; method: string; body: object }) => boolean;
  }) => {
    mutation.options = options;
    return mutation;
  },
}));

vi.mock("../src/lib/api-client", () => ({
  getGameCourtBooking: vi.fn(),
}));

import { GameCourtBookingPanel } from "../src/components/consumer/games/GameCourtBooking";
import type { GameCourtBooking } from "../src/lib/consumer-types";

const gameId = "10000000-0000-4000-8000-000000000001";
const managerBooking: GameCourtBooking = {
  gameId,
  status: "unspecified",
  version: 0,
  updatedAt: null,
  declarationSource: "organizer_declared",
  allowedActions: { canUpdate: true },
};
const participantBooking: GameCourtBooking = {
  ...managerBooking,
  status: "arranging",
  version: 1,
  updatedAt: "2026-11-02T06:00:00.000Z",
  allowedActions: { canUpdate: false },
};

/** Hook order in GameCourtBookingPanel: booking, loadState, draftStatus, localNotice, savedFlash, epoch, liveGame, reload-effect, session-effect. */
function seed(booking: GameCourtBooking | null, loadState: "loading" | "ready" | "denied" | "error", draft = booking?.status ?? "unspecified") {
  hooks.slots = [
    booking,
    loadState,
    draft,
    null,
    false,
    { current: 1 },
    { current: gameId },
    ["deps-reload"],
    ["deps-session"],
  ];
  hooks.cursor = 0;
}

describe("#386 game court booking panel", () => {
  it("shows manager save UI from server canUpdate and organizer wording", () => {
    seed(managerBooking, "ready");
    mutation.pending = false;
    mutation.code = "";
    const html = renderToStaticMarkup(GameCourtBookingPanel({ gameId, meId: "actor-a", csrfToken: "csrf-a" }));
    expect(html).toContain("Договорённость о корте");
    expect(html).toContain("Со слов организатора");
    expect(html).toContain("Сохранить статус");
    expect(html).toContain("Не указано");
  });

  it("renders participant readonly without save when server denies canUpdate", () => {
    seed(participantBooking, "ready", "arranging");
    mutation.pending = false;
    const html = renderToStaticMarkup(GameCourtBookingPanel({ gameId, meId: "participant", csrfToken: "csrf-p" }));
    expect(html).toContain("Договариваемся");
    expect(html).toContain("со слов организатора");
    expect(html).not.toContain("Сохранить статус");
  });

  it("hides panel on private denied fence", () => {
    seed(null, "denied");
    expect(GameCourtBookingPanel({ gameId, meId: "outsider", csrfToken: "csrf-o" })).toBeNull();
  });

  it("blocks new save while UNKNOWN and requires version advance to clear success", () => {
    seed({ ...managerBooking, status: "arranging", version: 0 }, "ready", "arranging");
    mutation.pending = true;
    mutation.code = "unconfirmed";
    hooks.cursor = 0;
    const html = renderToStaticMarkup(GameCourtBookingPanel({ gameId, meId: "actor-a", csrfToken: "csrf-a" }));
    expect(html).toContain("Повторить ту же отправку");
    expect(mutation.options?.validatePending?.({
      path: `/v1/games/${gameId}/court-booking`,
      method: "PUT",
      body: { expectedVersion: 0, status: "arranging" },
    })).toBe(true);
    expect(mutation.options?.validateSuccess?.(
      { ...managerBooking, status: "arranging", version: 0 },
      { body: { expectedVersion: 0, status: "arranging" } },
    )).toBe(false);
    expect(mutation.options?.validateSuccess?.(
      { ...managerBooking, status: "arranging", version: 1 },
      { body: { expectedVersion: 0, status: "arranging" } },
    )).toBe(true);
  });
});
