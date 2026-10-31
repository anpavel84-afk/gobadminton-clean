import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeVenueProfile, validateVenueProfile } from "../src/lib/venue-profile-form";
import type { Session } from "../src/lib/admin-client";

const hooks = vi.hoisted(() => ({
  index: 0,
  slots: [] as { value: unknown; deps?: readonly unknown[] }[],
  effects: [] as (() => unknown)[],
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof ReactModule>();
  function cell() {
    const index = hooks.index++;
    return hooks.slots[index] ?? (hooks.slots[index] = { value: undefined });
  }
  function changed(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return !previous || previous.length !== next.length || next.some((value, index) => !Object.is(previous[index], value));
  }
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.index;
      const existed = index in hooks.slots;
      const slot = cell();
      if (!existed) slot.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slot.value) : next; }];
    },
    useRef(initial: unknown) {
      const slot = cell();
      if (!slot.value) slot.value = { current: initial };
      return slot.value;
    },
    useEffect(effect: () => unknown, deps: readonly unknown[]) {
      const slot = cell();
      if (changed(slot.deps, deps)) { hooks.effects.push(effect); slot.deps = deps; }
    },
    useId: () => "gallery-test",
  };
});
vi.mock("../src/lib/avatar-preprocess", () => ({
  preprocessAvatar: async (file: File) => new Blob([await file.arrayBuffer()], { type: file.type || "image/png" }),
}));

import { VenuePhoto } from "../src/components/VenuePhoto";

type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props; disabled: boolean };
function nodes(value: unknown, inheritedDisabled = false): Node[] {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item, inheritedDisabled));
  if (!isValidElement<Props>(value)) return [];
  const disabled = inheritedDisabled || value.props.disabled === true;
  return [{ type: value.type, props: value.props, disabled }, ...nodes(value.props.children, disabled)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return isValidElement<Props>(value) ? text(value.props.children) : "";
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const venueId = "a0000000-0000-4000-8000-000000000001";
const session: Session = {
  principalId: "synthetic", userId: "synthetic", status: "active", version: 1,
  roles: ["content_manager"], sessionId: "synthetic", expiresAt: "2099-01-01",
  stepUpAt: "2026-10-22T10:00:00Z", csrfToken: "synthetic-csrf",
};
const item = (n: number) => ({
  id: `a0000000-0000-4000-8000-00000000001${n}`,
  position: n, isMain: n === 0, kind: "illustration" as const,
  uploadedUrl: `/v1/media/venue-covers/${"ab".repeat(32)}.png`,
  credit: { kind: "illustration" as const, text: "Иллюстрация", url: null },
  sourceUrl: null, sourceAuthor: null, permissionBasis: "Письменное согласие клуба", sourceFingerprint: null,
});

describe("admin venue gallery/profile description form", () => {
  it("includes optional description without inventing license text", () => {
    const draft = initializeVenueProfile({
      profile: { courtCount: 2, amenities: { parking: true, showers: false }, description: "Зал у метро" },
    });
    expect(draft.description).toBe("Зал у метро");
    const saved = validateVenueProfile({ ...draft, profileChanged: true });
    expect(saved.errors).toEqual({});
    expect(saved.patch.profile).toEqual({
      courtCount: 2,
      amenities: { parking: true, showers: false },
      description: "Зал у метро",
    });
  });

  it("clears description with empty field and rejects control characters", () => {
    const draft = initializeVenueProfile({ profile: { courtCount: null, amenities: { parking: null, showers: null }, description: "x" } });
    expect(validateVenueProfile({ ...draft, description: "", profileChanged: true }).patch.profile).toBeNull();
    expect(validateVenueProfile({ ...draft, description: "bad\nline", profileChanged: true }).errors.description).toBeTruthy();
  });

  it("VenuePhoto encodes gallery metadata and exposes PUT replacement", () => {
    const source = readFileSync(new URL("../src/components/VenuePhoto.tsx", import.meta.url), "utf8");
    expect(source).toContain("encodeURIComponent(value)");
    expect(source).toContain("X-Gallery-Credit-Text");
    expect(source).toContain("wireMeta(evidence.creditText)");
    expect(source).toContain('wireMeta(evidence.permissionBasis.trim())');
    expect(source).toContain('method:"PUT"');
    expect(source).toContain("replaceId");
    expect(source).toContain("Сохранить замену");
  });

  it("parent keys VenuePhoto by venue id only so version refresh keeps the upload queue", () => {
    const source = readFileSync(new URL("../src/components/Venues.tsx", import.meta.url), "utf8");
    expect(source).toContain("<VenuePhoto key={venue.id}");
    expect(source).not.toContain('key={venue.id+":"+venue.version}');
  });

  it("VenueProfileFields exposes description editor clear action", () => {
    const source = readFileSync(new URL("../src/components/VenueProfileFields.tsx", import.meta.url), "utf8");
    expect(source).toContain("Краткое публичное описание");
    expect(source).toContain("description: \"\"");
    expect(source).toContain("кортах, удобствах и описании");
  });
});

describe("VenuePhoto parent integration: multi-upload queue survives version refresh", () => {
  beforeEach(() => {
    hooks.index = 0; hooks.slots = []; hooks.effects = [];
    let n = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}` });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("selects 2 files; first success + parent refresh must not drop second or evidence", async () => {
    let version = 7;
    let items: ReturnType<typeof item>[] = [];
    const posts: { method: string; version: string }[] = [];
    const fetch = vi.fn(async (_url: string, request: RequestInit = {}) => {
      if (!request.method || request.method === "GET") {
        return new Response(JSON.stringify({ version, items }), { status: 200 });
      }
      posts.push({
        method: request.method as string,
        version: String((request.headers as Record<string, string>)["X-Venue-Version"]),
      });
      items = [...items, item(items.length)];
      version += 1;
      return new Response(JSON.stringify({ version, items }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    let parentVersion = 7;
    const props = () => ({
      id: venueId, session,
      authorityLoss: vi.fn(), stepup: vi.fn(async () => {}), onBusy: vi.fn(),
      changed: async () => { parentVersion += 1; },
    });
    function view() {
      hooks.index = 0;
      return nodes(VenuePhoto(props()));
    }
    function mount() {
      view();
      for (const effect of hooks.effects.splice(0)) effect();
    }
    function labeledInput(label: string) {
      const parent = view().find(node => node.type === "label" && nodes(node.props.children).some(child => child.type === "span" && text(child.props.children) === label));
      expect(parent, label).toBeDefined();
      return nodes(parent!.props.children).find(node => node.type === "input" || node.type === "select")!;
    }

    mount();
    await settle();
    expect(view().some(node => node.type === "ol")).toBe(true);

    (labeledInput("Основание права").props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Письменное согласие клуба" },
    });

    const fileInput = view().find(node => node.type === "input" && node.props.type === "file")!;
    const fileA = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const fileB = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
    const selected = Object.assign([fileA, fileB], {
      item: (index: number) => [fileA, fileB][index] ?? null,
    });
    await (fileInput.props.onChange as (e: { target: { files: FileList; value: string } }) => void)({
      target: {
        files: selected as FileList,
        value: "",
      },
    });
    await settle();
    hooks.index = 0;
    expect(text(VenuePhoto(props()))).toContain("В очереди: 2");
    expect(labeledInput("Основание права").props.value).toBe("Письменное согласие клуба");

    const upload = view().find(node => node.type === "button" && text(node.props.children) === "Загрузить следующее")!;
    await (upload.props.onClick as () => Promise<void>)();
    await settle();
    expect(parentVersion).toBe(8);
    // Same component identity (key=venue.id): slots preserved across parent version bump.
    hooks.index = 0;
    expect(text(VenuePhoto(props()))).toContain("В очереди: 1");
    expect(labeledInput("Основание права").props.value).toBe("Письменное согласие клуба");
    expect(posts).toEqual([{ method: "POST", version: "7" }]);

    // Remount (as if keyed by id+version) would wipe queue — document the contrast.
    hooks.slots = []; hooks.effects = []; hooks.index = 0;
    mount();
    await settle();
    hooks.index = 0;
    expect(text(VenuePhoto(props()))).not.toContain("В очереди:");
  });
});
