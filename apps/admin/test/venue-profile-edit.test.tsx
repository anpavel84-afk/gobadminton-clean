import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Venues } from "../src/components/Venues";
import { VenueProfileFields } from "../src/components/VenueProfileFields";
import { VenuePhoto } from "../src/components/VenuePhoto";
import type { Session } from "../src/lib/admin-client";

// Execute the production components and their event closures with controlled
// hooks/transport. No extra DOM dependency, real session, network or server.
// Browser layout, focus navigation and React lifecycle still need external QA.
const hooks = vi.hoisted(() => ({
  index: 0,
  slots: [] as { value: unknown; deps?: readonly unknown[] }[],
  effects: [] as (() => unknown)[],
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
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
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const slot = cell();
      if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value;
    },
    useEffect(effect: () => unknown, deps: readonly unknown[]) {
      const slot = cell();
      if (changed(slot.deps, deps)) { hooks.effects.push(effect); slot.deps = deps; }
    },
    useId: () => "profile-test",
  };
});
vi.mock("../src/components/VenuePhoto", () => ({ VenuePhoto: () => null }));

type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props; disabled: boolean };
function nodes(value: unknown, inheritedDisabled = false): Node[] {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item, inheritedDisabled));
  if (!isValidElement<Props>(value)) return [];
  if (value.type === VenueProfileFields) return nodes(VenueProfileFields(value.props as Parameters<typeof VenueProfileFields>[0]), inheritedDisabled);
  const disabled = inheritedDisabled || value.props.disabled === true;
  return [{ type: value.type, props: value.props, disabled }, ...nodes(value.props.children, disabled)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return isValidElement<Props>(value) ? text(value.props.children) : "";
}
const a = "a0000000-0000-4000-8000-000000000001", b = "a0000000-0000-4000-8000-000000000002";
function venue(id = a, name = "Зал А") {
  return {
    id, cityId: "c0000000-0000-4000-8000-000000000001", cityName: "Город", name,
    address: "Проверенный адрес", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62,
    identityDiscriminator: "", lifecycleState: "unverified", canonicalVenueId: null, version: 7,
    publicContacts: { phone: "+79991234567", website: "https://venue.example/", messengers: [{ kind: "telegram", url: "https://t.me/venue" }] },
    profile: { courtCount: 0, amenities: { parking: false, showers: null }, updatedAt: "2026-10-22T10:00:00Z", gallery: { coverage: "cover_only", items: [] } },
    history: [{ version: 7, action: "edit" }],
  };
}
const session: Session = { principalId: "synthetic", userId: "synthetic", status: "active", version: 1, roles: ["content_manager"], sessionId: "synthetic", expiresAt: "2099-01-01", stepUpAt: "2026-10-22T10:00:00Z", csrfToken: "synthetic-csrf" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Command = { action?: string; expectedVersion?: number; reasonCode: string; fields?: Props } & Props;

function harness() {
  const records = new Map<string, Props>([[a, venue()], [b, { ...venue(b, "Зал Б"), publicContacts: null, profile: null }]]);
  const receipts = new Map<string, Props>();
  const authorityLoss = vi.fn(), stepup = vi.fn(async () => {});
  let detailOverride: ((id: string) => Promise<Response> | undefined) | undefined;
  let afterCommit: (() => Promise<Response>) | undefined;
  let reject: { code: string; status: number } | undefined;
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    const path = new URL(url, "http://synthetic.invalid");
    const suffix = path.pathname.split("/venues")[1]!;
    if (request.method === "POST") {
      if (reject) { const failure = reject; reject = undefined; return json({ code: failure.code }, failure.status); }
      const body = JSON.parse(request.body as string) as Command;
      const key = (request.headers as Record<string, string>)["Idempotency-Key"]!;
      let result = receipts.get(key);
      if (!result) {
        const id = suffix.split("/")[1] || a;
        const current = records.get(id)!;
        result = { ...current, ...(body.fields ?? body), version: Number(current.version) + 1 };
        records.set(id, result); receipts.set(key, result);
      }
      if (afterCommit) { const fault = afterCommit; afterCommit = undefined; return fault(); }
      return json(result);
    }
    if (!suffix) {
      // Summary deliberately differs: EDIT must initialize from the detail GET.
      const item = records.get(path.searchParams.has("beforeId") ? b : a)!;
      return json({ items: [{ ...item, publicContacts: null, profile: null }], nextBeforeId: path.searchParams.has("beforeId") ? null : a });
    }
    if (suffix === "/duplicates") return json({ items: [] });
    if (suffix.endsWith("/games")) return json({ items: [{ id: "game", title: "Игра", status: "published" }], nextBeforeId: null });
    const id = suffix.slice(1);
    return detailOverride?.(id) ?? json(records.get(id));
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  function view() { hooks.index = 0; return nodes(Venues({ session, onAuthorityLoss: authorityLoss, stepup })); }
  function button(name: string) {
    const result = view().find(node => node.type === "button" && text(node.props.children) === name);
    expect(result, "button: " + name).toBeDefined(); return result!;
  }
  function control(label: string) {
    const parent = view().find(node => node.type === "label" && nodes(node.props.children).some(child => child.type === "span" && text(child.props.children) === label));
    expect(parent, "label: " + label).toBeDefined();
    const result = nodes(parent!.props.children, parent!.disabled).find(node => node.type === "input" || node.type === "select");
    expect(result).toBeDefined(); return result!;
  }
  async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); (node.props.onClick as () => void)(); await settle(); }
  function change(label: string, value: string) { const node = control(label); expect(node.disabled).toBe(false); (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }
  function posts() { return fetch.mock.calls.filter(([, request]) => request.method === "POST"); }
  async function mount() { view(); for (const effect of hooks.effects.splice(0)) effect(); await settle(); }
  async function edit() { await click("Зал А · Открыть / Редактировать"); await click("Редактировать данные"); }
  return { records, fetch, view, button, control, click, change, posts, mount, edit, authorityLoss, stepup,
    rejectNext: (status: number, code: string) => { reject = { status, code }; },
    loseNextResponse: (fault: () => Promise<Response>) => { afterCommit = fault; },
    detail: (override: typeof detailOverride) => { detailOverride = override; },
  };
}

beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => vi.unstubAllGlobals());

describe("existing venue EDIT UI and transport", () => {
  it("renders without mutation; initializes from authoritative detail; submits strict edit with CSRF/reason/version", async () => {
    const h = harness(); await h.mount(); await h.edit();
    expect(h.posts()).toHaveLength(0);
    expect(h.control("Телефон (виден всем)").props.value).toBe("+79991234567");
    expect(h.control("Количество кортов").props.value).toBe("0");
    expect(h.control("Парковка").props.value).toBe("no");
    h.change("Количество кортов", "12"); h.change("Сайт (виден всем)", "https://new.example");
    h.change("Причина действия (сохраняется в аудите)", "catalog_correction");
    await h.click("Подтвердить сохранение");
    const [url, request] = h.posts()[0]!;
    expect(url.endsWith(`/venues/${a}/commands`)).toBe(true);
    expect(request).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", headers: { "X-CSRF-Token": session.csrfToken, "Idempotency-Key": expect.any(String) } });
    const body = JSON.parse(request.body as string);
    expect(body).toEqual({ action: "edit", expectedVersion: 7, reasonCode: "catalog_correction", fields: {
      cityId: venue().cityId, name: "Зал А", address: "Проверенный адрес", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62, identityDiscriminator: "",
      publicContacts: { ...venue().publicContacts, website: "https://new.example/" }, profile: { courtCount: 12, amenities: { parking: false, showers: null } },
    } });
    await h.click("Редактировать данные");
    expect(h.control("Количество кортов").props.value).toBe("12");
    expect(h.control("Сайт (виден всем)").props.value).toBe("https://new.example/");
  });

  it("omits untouched groups, explicitly clears groups with null, and cancel makes no request", async () => {
    const h = harness(); await h.mount(); await h.edit();
    h.change("Название", "Зал А обновлён"); await h.click("Подтвердить сохранение");
    const body = JSON.parse(h.posts()[0]![1].body as string);
    expect(body.fields).not.toHaveProperty("publicContacts"); expect(body.fields).not.toHaveProperty("profile");
    await h.click("Редактировать данные"); await h.click("Очистить публичные контакты"); await h.click("Очистить сведения о кортах и удобствах");
    await h.click("Отмена"); expect(h.posts()).toHaveLength(1);
    await h.click("Редактировать данные"); expect(h.control("Количество кортов").props.value).toBe("0");
    await h.click("Очистить публичные контакты"); await h.click("Очистить сведения о кортах и удобствах"); await h.click("Подтвердить сохранение");
    expect(JSON.parse(h.posts()[1]![1].body as string).fields).toMatchObject({ publicContacts: null, profile: null });
  });

  it("opens a legacy detail without profile/contact keys as unknown and preserves omitted groups", async () => {
    const h = harness();
    const legacy: Props = { ...venue() };
    delete legacy.publicContacts; delete legacy.profile;
    h.records.set(a, legacy); await h.mount(); await h.edit();
    expect(h.control("Телефон (виден всем)").props.value).toBe("");
    expect(h.control("Количество кортов").props.value).toBe("");
    expect(h.control("Парковка").props.value).toBe("unknown");
    expect(h.control("Душевые").props.value).toBe("unknown");
    h.change("Адрес", "Уточнённый адрес"); await h.click("Подтвердить сохранение");
    const fields = JSON.parse(h.posts()[0]![1].body as string).fields;
    expect(fields).not.toHaveProperty("profile"); expect(fields).not.toHaveProperty("publicContacts");
  });

  it("provides accessible inline feedback and blocks invalid phone, URL, count and duplicate messenger", async () => {
    const h = harness(); await h.mount(); await h.edit();
    h.change("Телефон (виден всем)", "123"); h.change("Сайт (виден всем)", "https://user@host.example"); h.change("Количество кортов", "2147483648");
    for (const label of ["Телефон (виден всем)", "Сайт (виден всем)", "Количество кортов"]) {
      const field = h.control(label);
      expect(field.props["aria-invalid"]).toBe(true);
      expect(h.view().find(node => node.props.id === field.props["aria-describedby"] && node.props.role === "alert")).toBeDefined();
    }
    expect(h.button("Подтвердить сохранение").disabled).toBe(true);
    h.change("Телефон (виден всем)", "+79991234567"); h.change("Сайт (виден всем)", "https://venue.example"); h.change("Количество кортов", "0");
    await h.click("Добавить публичный мессенджер"); h.change("Мессенджер 2 (виден всем)", "telegram"); h.change("Ссылка мессенджера 2 (видна всем)", "https://t.me/other");
    expect(h.control("Мессенджер 2 (виден всем)").props["aria-invalid"]).toBe(true);
    expect(h.button("Подтвердить сохранение").disabled).toBe(true); expect(h.posts()).toHaveLength(0);
    h.change("Мессенджер 2 (виден всем)", "whatsapp"); h.change("Ссылка мессенджера 2 (видна всем)", "https://evil.example/123");
    expect(h.control("Ссылка мессенджера 2 (видна всем)").props["aria-invalid"]).toBe(true);
    await h.click("Удалить мессенджер 2"); expect(h.button("Подтвердить сохранение").disabled).toBe(false);
  });

  it("switches venue without leaking a previous draft, including a stale save callback during the read", async () => {
    const h = harness(); await h.mount(); await h.edit(); h.change("Телефон (виден всем)", "+70001112233");
    const staleSubmit = h.button("Подтвердить сохранение").props.onClick as () => void;
    await h.click("Следующие площадки");
    let resolve!: (response: Response) => void;
    h.detail(id => id === b ? new Promise<Response>(done => { resolve = done; }) : undefined);
    const open = h.button("Зал Б · Открыть / Редактировать").props.onClick as () => void;
    open(); staleSubmit(); await settle(); expect(h.posts()).toHaveLength(0);
    resolve(json(h.records.get(b))); await settle(); h.detail(undefined);
    await h.click("Редактировать данные");
    expect(h.control("Телефон (виден всем)").props.value).toBe(""); expect(h.control("Парковка").props.value).toBe("unknown");
    h.change("Количество кортов", "0"); h.change("Парковка", "no"); await h.click("Подтвердить сохранение");
    expect(h.posts()[0]![0].endsWith(`/venues/${b}/commands`)).toBe(true);
    expect(JSON.parse(h.posts()[0]![1].body as string).fields).toMatchObject({ profile: { courtCount: 0, amenities: { parking: false, showers: null } } });
    expect(JSON.parse(h.posts()[0]![1].body as string).fields).not.toHaveProperty("publicContacts");
  });

  it("does not overwrite dirty edits with an older photo/detail response or an obsolete selection callback", async () => {
    const h = harness(); await h.mount(); await h.click("Зал А · Открыть / Редактировать");
    const changed = h.view().find(node => node.type === VenuePhoto)!.props.changed as () => Promise<void>;
    let resolve!: (response: Response) => void;
    h.detail(() => new Promise<Response>(done => { resolve = done; }));
    const waiting = changed(); await h.click("Редактировать данные"); h.change("Количество кортов", "42");
    resolve(json({ ...venue(), version: 99, profile: { ...venue().profile, courtCount: 99 } })); await waiting; h.detail(undefined);
    expect(h.control("Количество кортов").props.value).toBe("42");
    // Clicking EDIT again must not reset a dirty draft even via an old handler.
    (h.button("Редактировать данные").props.onClick as () => void)(); expect(h.control("Количество кортов").props.value).toBe("42");
    await h.click("Подтвердить сохранение"); expect(JSON.parse(h.posts()[0]![1].body as string).expectedVersion).toBe(7);
    await h.click("Следующие площадки"); await h.click("Зал Б · Открыть / Редактировать");
    const before = h.fetch.mock.calls.length; await changed(); expect(h.fetch.mock.calls.length).toBe(before);
    await h.click("Редактировать данные"); expect(h.control("Количество кортов").props.value).toBe("");
  });

  for (const fault of ["network", "503", "408"]) {
    it("locks an unknown outcome and replays the identical operation only on explicit request: " + fault, async () => {
      const h = harness(); await h.mount(); await h.edit(); h.change("Количество кортов", "5");
      h.loseNextResponse(async () => { if (fault === "network") throw new TypeError("response lost after commit"); return json({ code: "ADMIN_UPSTREAM_UNAVAILABLE" }, Number(fault)); });
      const save = h.button("Подтвердить сохранение").props.onClick as () => void;
      save(); save(); await settle(); expect(h.posts()).toHaveLength(1);
      expect(h.button("Подтвердить сохранение").disabled).toBe(true); expect(h.control("Количество кортов").disabled).toBe(true);
      expect(h.button("Зал А · Открыть / Редактировать").disabled).toBe(true);
      expect(h.view().some(node => node.props.role === "status" && text(node.props.children).includes("Действие сохранено"))).toBe(false);
      await settle(); expect(h.posts()).toHaveLength(1);
      h.rejectNext(403, "ADMIN_STEP_UP_REQUIRED"); await h.click("Проверить результат");
      expect(h.authorityLoss).not.toHaveBeenCalled();
      const postsBefore = h.posts().length; await h.click("Подтвердить вход"); expect(h.stepup).toHaveBeenCalledOnce(); expect(h.posts()).toHaveLength(postsBefore);
      await h.click("Проверить результат");
      const first = h.posts()[0]![1];
      for (const [, replay] of h.posts()) { expect(replay.body).toBe(first.body); expect(replay.headers).toEqual(first.headers); }
      expect(h.records.get(a)!.version).toBe(8);
    });
  }

  it("retries only authoritative GET after acknowledged mutation/read failure; reopens returned values", async () => {
    const h = harness(); await h.mount(); await h.edit(); h.change("Количество кортов", "5");
    h.detail(async () => { throw new TypeError("read lost"); }); await h.click("Подтвердить сохранение");
    expect(h.posts()).toHaveLength(1);
    expect(h.view().some(node => node.props.role === "status" && text(node.props.children).includes("Действие сохранено"))).toBe(false);
    h.records.set(a, { ...h.records.get(a), profile: { ...venue().profile, courtCount: 6 } }); h.detail(undefined);
    await h.click("Проверить результат"); expect(h.posts()).toHaveLength(1);
    await h.click("Редактировать данные"); expect(h.control("Количество кортов").props.value).toBe("6");
  });

  for (const flow of ["edit", "create"] as const) {
    it("retains the unresolved " + flow + " operation across throttled explicit replays", async () => {
      const h = harness(); await h.mount();
      if (flow === "edit") { await h.edit(); h.change("Количество кортов", "5"); }
      else {
        await h.click("Создать площадку");
        h.change("Идентификатор города (создание)", venue().cityId);
        h.change("Название", "Новый зал"); h.change("Адрес", "Новый адрес");
      }
      const staleSave = h.button("Подтвердить сохранение").props.onClick as () => void;
      h.loseNextResponse(async () => { throw new TypeError("response lost after commit"); });
      await h.click("Подтвердить сохранение");
      expect(h.posts()).toHaveLength(1);
      const first = h.posts()[0]!;
      for (let attempt = 0; attempt < 2; attempt++) {
        h.rejectNext(429, "ADMIN_RATE_LIMIT"); await h.click("Проверить результат");
        expect(h.button("Проверить результат").disabled).toBe(false);
        for (const name of ["Подтвердить сохранение", "Отмена", "Создать площадку", "Зал А · Открыть / Редактировать"]) {
          expect(h.button(name).disabled).toBe(true);
        }
        expect(h.control("Название").disabled).toBe(true);
        expect(h.view().some(node => node.props.role === "alert" && text(node.props.children).includes("Слишком много попыток"))).toBe(true);
        expect(h.view().some(node => node.props.role === "status" && text(node.props.children).includes("Действие сохранено"))).toBe(false);
        staleSave(); await settle(); expect(h.posts()).toHaveLength(attempt + 2);
      }
      await h.click("Проверить результат");
      expect(h.posts()).toHaveLength(4);
      for (const [url, replay] of h.posts()) {
        expect(url).toBe(first[0]); expect(replay.body).toBe(first[1].body); expect(replay.headers).toEqual(first[1].headers);
      }
      expect(h.records.get(a)!.version).toBe(8);
      expect(h.view().some(node => node.type === "button" && text(node.props.children) === "Проверить результат")).toBe(false);
      expect(h.view().some(node => node.props.role === "status" && text(node.props.children) === "Действие сохранено.")).toBe(true);
    });
  }

  for (const selected of [false, true]) {
    for (const cancel of [false, true]) {
      it(`recovers a CREATE identity conflict with selected=${selected}, cancel=${cancel}`, async () => {
        const h = harness(); await h.mount();
        if (selected) await h.click("Зал А · Открыть / Редактировать");
        await h.click("Создать площадку");
        h.change("Идентификатор города (создание)", venue().cityId);
        h.change("Название", "Совпадающий зал"); h.change("Адрес", "Совпадающий адрес");
        h.rejectNext(409, "VENUE_IDENTITY_CONFLICT"); await h.click("Подтвердить сохранение");
        expect(h.posts()).toHaveLength(1);
        expect(h.button("Подтвердить сохранение").disabled).toBe(false);
        expect(h.button("Создать площадку").disabled).toBe(false);
        expect(h.view().some(node => node.type === "button" && ["Проверить результат", "Обновить выбранную площадку"].includes(text(node.props.children)))).toBe(false);
        expect(h.view().some(node => node.props.role === "alert" && text(node.props.children).includes("Такая площадка уже существует"))).toBe(true);
        if (cancel) {
          await h.click("Отмена"); expect(h.posts()).toHaveLength(1);
          await h.click("Создать площадку");
          h.change("Идентификатор города (создание)", venue().cityId);
          h.change("Название", "Другой зал"); h.change("Адрес", "Другой адрес");
        } else h.change("Название", "Другой зал");
        await h.click("Подтвердить сохранение");
        expect(h.posts()).toHaveLength(2);
        expect(h.posts()[1]![0].endsWith("/venues")).toBe(true);
        const body = JSON.parse(h.posts()[1]![1].body as string);
        expect(body.name).toBe("Другой зал"); expect(body).not.toHaveProperty("fields");
        expect(body).not.toHaveProperty("publicContacts"); expect(body).not.toHaveProperty("profile");
        expect(h.posts()[1]![1].headers).not.toEqual(h.posts()[0]![1].headers);
      });
    }
  }

  it("requires refresh and new confirmation after 409, with a new version/key", async () => {
    const h = harness(); await h.mount(); await h.edit(); h.change("Количество кортов", "5"); h.rejectNext(409, "VENUE_VERSION_CONFLICT");
    await h.click("Подтвердить сохранение"); expect(h.button("Подтвердить сохранение").disabled).toBe(true);
    h.records.set(a, { ...venue(), version: 9, profile: { ...venue().profile, courtCount: 3 } });
    await h.click("Обновить выбранную площадку"); await h.click("Редактировать данные");
    expect(h.control("Количество кортов").props.value).toBe("3"); h.change("Количество кортов", "4"); await h.click("Подтвердить сохранение");
    expect(JSON.parse(h.posts()[1]![1].body as string).expectedVersion).toBe(9);
    expect(h.posts()[1]![1].headers).not.toEqual(h.posts()[0]![1].headers);
  });

  for (const status of [401, 403]) {
    it("loses authority and prevents further mutations after " + status, async () => {
      const h = harness(); await h.mount(); await h.edit(); h.rejectNext(status, "ADMIN_PERMISSION_DENIED"); await h.click("Подтвердить сохранение");
      expect(h.authorityLoss).toHaveBeenCalledOnce(); expect(h.button("Подтвердить сохранение").disabled).toBe(true);
      (h.button("Подтвердить сохранение").props.onClick as () => void)(); await settle(); expect(h.posts()).toHaveLength(1);
    });
  }

  it("preserves photoBusy guards, pagination/history/games, and keeps new fields out of CREATE", async () => {
    const h = harness(); await h.mount(); await h.click("Зал А · Открыть / Редактировать");
    expect(h.view().some(node => text(node.props.children) === "Версия 7 · edit")).toBe(true);
    await h.click("Показать игры"); expect(h.view().some(node => text(node.props.children) === "Игра")).toBe(true);
    const onBusy = h.view().find(node => node.type === VenuePhoto)!.props.onBusy as (busy: boolean) => void;
    onBusy(true); expect(h.button("Редактировать данные").disabled).toBe(true); expect(h.button("Создать площадку").disabled).toBe(true);
    onBusy(false); await h.click("Создать площадку");
    expect(h.view().some(node => text(node.props.children) === "Публичные контакты площадки")).toBe(false);
    h.change("Идентификатор города (создание)", venue().cityId); h.change("Название", "Новый зал"); h.change("Адрес", "Новый адрес"); await h.click("Подтвердить сохранение");
    const [url, request] = h.posts()[0]!; expect(url.endsWith("/venues")).toBe(true);
    const body = JSON.parse(request.body as string); expect(body).not.toHaveProperty("fields"); expect(body).not.toHaveProperty("profile"); expect(body).not.toHaveProperty("publicContacts"); expect(body.reasonCode).toBe("address_verified");
  });
});
