import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as React from "react";
import type * as ReactDom from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Venue, VenueProfile } from "../src/lib/consumer-types";
import { readFileSync } from "node:fs";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => "gallery-comp",
  useState<T>(initial: T | (() => T)) {
    const index = hooks.cursor++; const slots = hooks.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [slots[index], (next: T | ((old: T) => T)) => {
      slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
    }];
  },
  useRef(initial: unknown) { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => value !== previous[i])) {
      hooks.slots[index] = deps;
      hooks.effects.push(() => { hooks.cleanups[index]?.(); hooks.cleanups[index] = effect() || (() => {}); });
    }
  },
}));

import { VenueGallery } from "../src/components/consumer/venues/VenueGallery";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { VenuePickerDialog } from "../src/components/consumer/games/VenuePickerDialog";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDom>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});
vi.mock("../src/components/consumer/games/DesktopMapInspector", () => ({
  useDesktopMapInspector: () => false,
  DesktopMapInspector: ({ children }: { children: ReactNode }) => children,
}));

const url = (n: string) => `/v1/media/venue-covers/${n.repeat(64)}.png`;
const venue = (items: VenueProfile["gallery"]["items"], coverUrl?: string | null, coverCredit?: Venue["cover"]): Pick<Venue, "id" | "name" | "cover" | "profile"> => ({
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Зал",
  cover: coverCredit ?? { uploadedUrl: coverUrl === undefined ? url("a") : coverUrl, credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } },
  profile: {
    courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
    gallery: { coverage: "ordered", items },
  },
});

function resetHooks() {
  hooks.cleanups.forEach(fn => fn?.());
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
}
function ssr(node: ReactNode) {
  resetHooks();
  // SSR markup only — do not flush browser effects (Image/window preload/listeners).
  return renderToStaticMarkup(node);
}

beforeEach(() => { resetHooks(); });
afterEach(() => { resetHooks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("VenueGallery", () => {
  it("hides navigation for a single image and keeps honest fallback when empty", () => {
    const one = ssr(<VenueGallery venue={venue([{ id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } }])} />);
    expect(one).not.toContain("Предыдущее фото");
    expect(one).not.toContain("Следующее фото");
    expect(one).toContain(url("a"));
    const empty = ssr(<VenueGallery venue={venue([], null)} />);
    expect(empty).toContain("/discovery/badminton-courts.jpg");
    expect(empty).not.toContain("Предыдущее фото");
  });

  it("does not invent illustration credit for an unattributed legacy cover", () => {
    const html = ssr(<VenueGallery venue={venue([], url("a"), { uploadedUrl: url("a"), credit: null })} />);
    expect(html).toContain(url("a"));
    expect(html).not.toContain("Иллюстрация");
    expect(html).toContain('data-cover="uploaded"');
  });

  it("starts on main image even when main is not position 0", () => {
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "logo", text: "Логотип: Клуб", url: "https://club.example/logo" } },
    ], url("b"));
    const html = ssr(<VenueGallery venue={multi} />);
    expect(html).toContain(url("b"));
    expect(html).toContain("2/2");
    expect(html).toContain("Логотип: Клуб");
  });

  it("shows controls for multi-image sheet and resets when venue id changes", () => {
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "logo", text: "Логотип: Клуб", url: "https://club.example/logo" } },
    ]);
    const html = ssr(<VenueGallery venue={multi} />);
    expect(html).toContain("Предыдущее фото");
    expect(html).toContain("Следующее фото");
    expect(html).toContain("1/2");
    expect(html).toContain("Фото: Один");
    const next = ssr(<VenueGallery venue={{ ...multi, id: "a0000000-0000-4000-8000-000000000099" }} />);
    expect(next).toContain("1/2");
  });

  it("keeps compact picker/media free of nested interactive controls", () => {
    const html = ssr(<VenueGallery venue={venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
    ])} size="compact" showCredit={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Предыдущее фото");
  });

  it("integrates gallery with morph slot in preview instead of bypassing", () => {
    const morph = <span data-testid="morph-slot" className="gb-venue-preview-cover" />;
    const html = ssr(<VenuePreviewCard
      venue={venue([
        { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
        { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
      ]) as never}
      games={[]}
      gamesReady
      now={0}
      onOpen={() => {}}
      coverSlot={morph}
    />);
    expect(html).toContain("gb-venue-gallery");
    expect(html).toContain('data-size="compact"');
    expect(html).toContain('data-testid="morph-slot"');
  });

  it("uses VenueGallery inside create-game venue picker options without nested nav buttons", () => {
    vi.stubGlobal("document", {
      body: { style: { overflow: "auto" } },
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
    });
    const multiVenue = {
      id: "1",
      cityId: "a0000000-0000-4000-8000-000000000001",
      name: "Альфа",
      address: "Москва",
      timezone: "Europe/Moscow",
      cover: { uploadedUrl: url("a"), credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
      profile: {
        courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
        gallery: {
          coverage: "ordered" as const,
          items: [
            { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo" as const, text: "Фото: Один", url: "https://club.example/1" } },
            { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo" as const, text: "Фото: Два", url: "https://club.example/2" } },
          ],
        },
      },
    };
    const singleVenue = {
      ...multiVenue,
      id: "2",
      name: "Бета",
      profile: {
        ...multiVenue.profile,
        gallery: {
          coverage: "ordered" as const,
          items: [
            { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo" as const, text: "Фото: Один", url: "https://club.example/1" } },
          ],
        },
      },
    };
    const onSelect = vi.fn();
    const html = ssr(<VenuePickerDialog
      venues={[multiVenue]}
      selectedId=""
      status="ready"
      onSelect={onSelect}
      onClose={() => {}}
      onRetry={() => {}}
    />);
    expect(html).toContain("gb-venue-gallery");
    expect(html).toContain('data-size="compact"');
    expect(html).toContain('data-size="sheet"');
    expect(html).toContain("gb-venue-picker-photos");
    expect(html).toContain("Фото · 2");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Предыдущее фото");
    expect(html).toContain("Следующее фото");
    expect(html).toContain("1/2");
    expect(html).toContain("Фото: Один");
    expect(html).toContain("Альфа");
    // Compact thumb stays inside the select button; sheet nav/credits stay outside (no nested buttons).
    const optionInner = html.match(/class="gb-venue-picker-option"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? "";
    expect(optionInner).toContain('data-size="compact"');
    expect(optionInner).not.toContain("<button");
    expect(optionInner).not.toContain("Предыдущее фото");
    expect(optionInner).not.toContain("gb-venue-gallery__credit");
    expect(html.indexOf("gb-venue-picker-option")).toBeLessThan(html.indexOf("gb-venue-picker-photos"));
    expect(html.indexOf("gb-venue-picker-photos")).toBeLessThan(html.indexOf("Предыдущее фото"));

    const one = ssr(<VenuePickerDialog
      venues={[singleVenue]}
      selectedId=""
      status="ready"
      onSelect={() => {}}
      onClose={() => {}}
      onRetry={() => {}}
    />);
    expect(one).toContain("Бета");
    expect(one).toContain('data-size="compact"');
    expect(one).not.toContain("gb-venue-picker-photos");
    expect(one).not.toContain("Предыдущее фото");
    expect(one).not.toContain("Следующее фото");
    expect(one).not.toContain('data-size="sheet"');

    // Selecting the row calls onSelect; browsing sheet photos does not.
    function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
      if (!isValidElement<Record<string, unknown>>(node)) return [];
      return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
    }
    resetHooks();
    onSelect.mockClear();
    const tree = VenuePickerDialog({
      venues: [multiVenue],
      selectedId: "",
      status: "ready",
      onSelect,
      onClose: () => {},
      onRetry: () => {},
    });
    hooks.effects.splice(0).forEach(fn => fn());
    const nodes = elements(tree);
    const option = nodes.find(node => node.props.className === "gb-venue-picker-option");
    expect(option).toBeTruthy();
    (option!.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(multiVenue);
    onSelect.mockClear();
    const summary = nodes.find(node => node.type === "summary");
    expect(summary?.props.tabIndex).toBe(0);
    expect(summary?.props.className).toBe("gb-venue-picker-photos__summary");
    const sheetEl = nodes.find(node => node.type === VenueGallery && node.props.size === "sheet" && node.props.showCredit === true);
    expect(sheetEl).toBeTruthy();
    expect(sheetEl!.props.venue).toBe(multiVenue);
    // Expand sheet gallery tree (outside the select button) and click nav — must not select.
    const gallerySlots = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
    hooks.slots = gallerySlots.slots;
    hooks.cleanups = gallerySlots.cleanups;
    hooks.cursor = 0;
    hooks.effects = [];
    const galleryTree = VenueGallery({
      venue: sheetEl!.props.venue as typeof multiVenue,
      size: "sheet",
      showCredit: true,
    });
    const galleryNodes = elements(galleryTree);
    const next = galleryNodes.find(node => node.props["aria-label"] === "Следующее фото");
    const prev = galleryNodes.find(node => node.props["aria-label"] === "Предыдущее фото");
    expect(next).toBeTruthy();
    expect(prev).toBeTruthy();
    (next!.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    (prev!.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("scopes VenuePage media CSS so image+credit flow without clipping credit", () => {
    const css = readFileSync(new URL("../src/styles/venue-gallery.css", import.meta.url), "utf8");
    expect(css).toContain(".gb-venue-media:has(> .gb-venue-gallery-wrap)");
    expect(css).toContain("overflow: visible");
    expect(css).toContain("max-height: 300px");
    expect(css).toContain("max-height: 196px");
    // Picker inline expander stays picker-scoped; must not redefine page/map/popup gallery chrome.
    expect(css).toContain(".gb-venue-picker-photos");
    expect(css).toContain(".gb-venue-picker-option-block");
    expect(css).toContain(".gb-venue-picker-photos__summary");
  });
});

describe("VenuePopup + VenueGallery compact composition gestures", () => {
  function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (!isValidElement<Record<string, unknown>>(node)) return [];
    return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
  }

  it("preserves controlled index on same-venue remount and resets uncontrolled on new venue", () => {
    class FakeImage { decoding = ""; src = ""; }
    vi.stubGlobal("Image", FakeImage);
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
    ]);
    const onIndexChange = vi.fn();
    // Controlled remount (compact→expanded): do not push main-index back to the parent.
    ssr(<VenueGallery venue={multi} size="compact" index={1} onIndexChange={onIndexChange} />);
    hooks.effects.splice(0).forEach(fn => fn());
    expect(onIndexChange).not.toHaveBeenCalled();
    const controlled = ssr(<VenueGallery venue={multi} index={1} onIndexChange={onIndexChange} />);
    hooks.effects.splice(0).forEach(fn => fn());
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(controlled).toContain("2/2");
    expect(controlled).toContain(url("b"));
    // Uncontrolled still starts on main and resets when venue id changes.
    const first = ssr(<VenueGallery venue={multi} />);
    expect(first).toContain("1/2");
    const next = ssr(<VenueGallery venue={{ ...multi, id: "a0000000-0000-4000-8000-000000000099" }} />);
    expect(next).toContain("1/2");
  });

  it("keeps horizontal gallery capture; vertical still expands popup; swipe suppresses click", () => {
    vi.useFakeTimers();
    class FakeImage {
      decoding = "";
      src = "";
    }
    vi.stubGlobal("Image", FakeImage);
    if (typeof window === "undefined") vi.stubGlobal("window", new EventTarget());
    const galleryCapture = new Set<number>();
    const previewCapture = new Set<number>();
    const galleryTarget = {
      className: "gb-venue-gallery",
      setPointerCapture: (id: number) => galleryCapture.add(id),
      hasPointerCapture: (id: number) => galleryCapture.has(id),
      releasePointerCapture: (id: number) => galleryCapture.delete(id),
    };
    const previewButton = {
      className: "gb-venue-preview-button",
      setPointerCapture: (id: number) => previewCapture.add(id),
      hasPointerCapture: (id: number) => previewCapture.has(id),
      releasePointerCapture: (id: number) => previewCapture.delete(id),
      closest(selector: string) {
        if (selector === ".gb-venue-preview-button") return this;
        if (selector === ".gb-venue-gallery") return null;
        if (selector === ".gb-venue-handle") return null;
        return null;
      },
    };
    const gallerySource = {
      closest(selector: string) {
        if (selector === ".gb-venue-gallery") return galleryTarget;
        if (selector === ".gb-venue-preview-button") return previewButton;
        if (selector === ".gb-venue-handle") return null;
        return null;
      },
    };
    const change = vi.fn();
    const deselect = vi.fn();
    const indexChange = vi.fn();
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
    ]);

    const popupSlots = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
    const gallerySlots = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
    let popupTree: ReactNode = null;
    let galleryNode: ReactElement<Record<string, unknown>> | null = null;

    const renderPopup = () => {
      hooks.slots = popupSlots.slots; hooks.cleanups = popupSlots.cleanups; hooks.cursor = 0; hooks.effects = [];
      popupTree = VenuePopup({
        expanded: false, onExpandedChange: change, onDeselect: deselect,
        preview: <VenuePreviewCard venue={multi as never} games={[]} gamesReady now={0} onOpen={() => change(true)}
          galleryIndex={0} onGalleryIndexChange={indexChange} />,
        children: <div>full</div>,
      });
      for (const item of elements(popupTree)) {
        const ref = item.props.ref as { current: unknown } | undefined;
        if (ref) {
          ref.current = {
            getBoundingClientRect: () => ({
              height: item.props.className === "gb-venue-popup-full-measure" ? 772 : 172,
              width: 366,
            }),
          };
        }
      }
      hooks.effects.splice(0).forEach(fn => fn());
      popupSlots.slots = hooks.slots; popupSlots.cleanups = hooks.cleanups;
    };

    const renderGallery = () => {
      hooks.slots = gallerySlots.slots; hooks.cleanups = gallerySlots.cleanups; hooks.cursor = 0; hooks.effects = [];
      const tree = VenueGallery({
        venue: multi, size: "compact", showCredit: false, index: 0, onIndexChange: indexChange,
      });
      galleryNode = elements(tree).find(node => node.props.className === "gb-venue-gallery") ?? null;
      hooks.effects.splice(0).forEach(fn => fn());
      gallerySlots.slots = hooks.slots; gallerySlots.cleanups = hooks.cleanups;
    };

    renderPopup();
    renderGallery();
    expect(galleryNode).toBeTruthy();
    const shell = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    const surface = {
      setPointerCapture: previewButton.setPointerCapture,
      hasPointerCapture: previewButton.hasPointerCapture,
      releasePointerCapture: previewButton.releasePointerCapture,
    };

    // Horizontal: gallery captures; popup must not steal onto preview.
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 1, button: 0, clientX: 100, clientY: 100, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    expect(galleryCapture.has(1)).toBe(true);
    (shell.props.onPointerDown as (e: unknown) => void)({
      pointerId: 1, button: 0, isPrimary: true, clientX: 100, clientY: 100,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(1)).toBe(false);

    const stop = vi.fn();
    const prevent = vi.fn();
    (galleryNode!.props.onPointerMove as (e: unknown) => void)({
      pointerId: 1, clientX: 40, clientY: 102, currentTarget: galleryTarget,
      preventDefault: prevent, stopPropagation: stop,
    });
    expect(stop).toHaveBeenCalled();
    expect(prevent).toHaveBeenCalled();
    (galleryNode!.props.onPointerUp as (e: unknown) => void)({
      pointerId: 1, clientX: 40, clientY: 102, currentTarget: galleryTarget, stopPropagation: vi.fn(),
    });
    expect(indexChange).toHaveBeenCalled();
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (galleryNode!.props.onClickCapture as (e: unknown) => void)(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();

    // Fresh vertical gesture: gallery releases; popup takes over and expands.
    galleryCapture.clear(); previewCapture.clear(); indexChange.mockClear(); change.mockClear();
    renderGallery();
    renderPopup();
    const shellVertical = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    // Clear stale galleryOwned pending left after horizontal swipe (no popup pointerup).
    (shellVertical.props.onPointerDownCapture as () => void)();
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 2, button: 0, clientX: 100, clientY: 400, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shellVertical.props.onPointerDown as (e: unknown) => void)({
      pointerId: 2, button: 0, isPrimary: true, clientX: 100, clientY: 400,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(2)).toBe(false);
    (galleryNode!.props.onPointerMove as (e: unknown) => void)({
      pointerId: 2, clientX: 101, clientY: 360, currentTarget: galleryTarget,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    expect(galleryCapture.has(2)).toBe(false);
    (shellVertical.props.onPointerMove as (e: unknown) => void)({
      pointerId: 2, clientX: 101, clientY: 360, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(2)).toBe(true);
    renderPopup();
    const moving = elements(popupTree).find(node => node.props.className === "gb-venue-popup");
    expect(moving?.props["data-moving"]).toBe(true);
    (shellVertical.props.onPointerUp as (e: unknown) => void)({
      pointerId: 2, clientX: 101, clientY: 300, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(change).toHaveBeenCalledWith(true);
    // Compact expand schedules settling=true for 220ms; a new gesture before settle is ignored.
    vi.advanceTimersByTime(220);
    renderPopup();
    expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props["data-settling"]).toBe(false);

    // Non-gallery compact touch still captures onto preview (regression).
    // Fresh collapsed instance — independent of the prior expand/settling lifecycle.
    previewCapture.clear();
    popupSlots.cleanups.forEach(fn => fn?.());
    popupSlots.slots = [];
    popupSlots.cleanups = [];
    const copySource = {
      closest(selector: string) {
        if (selector === ".gb-venue-preview-button") return previewButton;
        if (selector === ".gb-venue-gallery") return null;
        if (selector === ".gb-venue-handle") return null;
        return null;
      },
    };
    renderPopup();
    const shell2 = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    (shell2.props.onPointerDown as (e: unknown) => void)({
      pointerId: 3, button: 0, isPrimary: true, clientX: 10, clientY: 10,
      currentTarget: surface, target: copySource, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(3)).toBe(true);
  });

  it("event-order: gallery lostcapture after parent takeover does not cancel vertical; horizontal then vertical; genuine target loss resets; fresh pointerdown clears suppressClick", () => {
    vi.useFakeTimers();
    class FakeImage { decoding = ""; src = ""; }
    vi.stubGlobal("Image", FakeImage);
    if (typeof window === "undefined") vi.stubGlobal("window", new EventTarget());
    const galleryCapture = new Set<number>();
    const previewCapture = new Set<number>();
    const galleryTarget = {
      className: "gb-venue-gallery",
      setPointerCapture: (id: number) => galleryCapture.add(id),
      hasPointerCapture: (id: number) => galleryCapture.has(id),
      releasePointerCapture: (id: number) => galleryCapture.delete(id),
    };
    const previewButton = {
      className: "gb-venue-preview-button",
      setPointerCapture: (id: number) => previewCapture.add(id),
      hasPointerCapture: (id: number) => previewCapture.has(id),
      releasePointerCapture: (id: number) => previewCapture.delete(id),
      closest(selector: string) {
        if (selector === ".gb-venue-preview-button") return this;
        if (selector === ".gb-venue-gallery") return null;
        if (selector === ".gb-venue-handle") return null;
        return null;
      },
    };
    const gallerySource = {
      closest(selector: string) {
        if (selector === ".gb-venue-gallery") return galleryTarget;
        if (selector === ".gb-venue-preview-button") return previewButton;
        if (selector === ".gb-venue-handle") return null;
        return null;
      },
    };
    const change = vi.fn();
    const deselect = vi.fn();
    const indexChange = vi.fn();
    const multi = venue([
      { id: "a0000000-0000-4000-8000-000000000011", url: url("a"), credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      { id: "a0000000-0000-4000-8000-000000000012", url: url("b"), credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
    ]);
    const popupSlots = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
    const gallerySlots = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
    let popupTree: ReactNode = null;
    let galleryNode: ReactElement<Record<string, unknown>> | null = null;
    const surface = {
      setPointerCapture: previewButton.setPointerCapture,
      hasPointerCapture: previewButton.hasPointerCapture,
      releasePointerCapture: previewButton.releasePointerCapture,
    };
    const renderPopup = () => {
      hooks.slots = popupSlots.slots; hooks.cleanups = popupSlots.cleanups; hooks.cursor = 0; hooks.effects = [];
      popupTree = VenuePopup({
        expanded: false, onExpandedChange: change, onDeselect: deselect,
        preview: <VenuePreviewCard venue={multi as never} games={[]} gamesReady now={0} onOpen={() => change(true)}
          galleryIndex={0} onGalleryIndexChange={indexChange} />,
        children: <div>full</div>,
      });
      for (const item of elements(popupTree)) {
        const ref = item.props.ref as { current: unknown } | undefined;
        if (ref) {
          ref.current = {
            getBoundingClientRect: () => ({
              height: item.props.className === "gb-venue-popup-full-measure" ? 772 : 172,
              width: 366,
            }),
          };
        }
      }
      hooks.effects.splice(0).forEach(fn => fn());
      popupSlots.slots = hooks.slots; popupSlots.cleanups = hooks.cleanups;
    };
    const renderGallery = () => {
      hooks.slots = gallerySlots.slots; hooks.cleanups = gallerySlots.cleanups; hooks.cursor = 0; hooks.effects = [];
      const tree = VenueGallery({
        venue: multi, size: "compact", showCredit: false, index: 0, onIndexChange: indexChange,
      });
      galleryNode = elements(tree).find(node => node.props.className === "gb-venue-gallery") ?? null;
      hooks.effects.splice(0).forEach(fn => fn());
      gallerySlots.slots = hooks.slots; gallerySlots.cleanups = hooks.cleanups;
    };

    // 1) Parent vertical takeover then bubbled gallery lostcapture must keep moving.
    renderPopup();
    renderGallery();
    const shell = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 10, button: 0, clientX: 60, clientY: 736, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shell.props.onPointerDown as (e: unknown) => void)({
      pointerId: 10, button: 0, isPrimary: true, clientX: 60, clientY: 736,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    // Popup axis-locks at 8px before gallery's 10px release — matches browser trace.
    (shell.props.onPointerMove as (e: unknown) => void)({
      pointerId: 10, clientX: 60, clientY: 722, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(10)).toBe(true);
    renderPopup();
    expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props["data-moving"]).toBe(true);
    (shell.props.onLostPointerCapture as (e: unknown) => void)({
      pointerId: 10, target: galleryTarget, currentTarget: surface,
    });
    renderPopup();
    expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props["data-moving"]).toBe(true);
    expect(previewCapture.has(10)).toBe(true);
    (shell.props.onPointerUp as (e: unknown) => void)({
      pointerId: 10, clientX: 60, clientY: 640, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(change).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(220);

    // 2) Horizontal complete clears pending via capture-phase up; next vertical still works.
    change.mockClear(); galleryCapture.clear(); previewCapture.clear();
    popupSlots.cleanups.forEach(fn => fn?.());
    popupSlots.slots = []; popupSlots.cleanups = [];
    gallerySlots.cleanups.forEach(fn => fn?.());
    gallerySlots.slots = []; gallerySlots.cleanups = [];
    renderPopup();
    renderGallery();
    const shellH = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 11, button: 0, clientX: 100, clientY: 100, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shellH.props.onPointerDown as (e: unknown) => void)({
      pointerId: 11, button: 0, isPrimary: true, clientX: 100, clientY: 100,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    (galleryNode!.props.onPointerMove as (e: unknown) => void)({
      pointerId: 11, clientX: 40, clientY: 102, currentTarget: galleryTarget,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (galleryNode!.props.onPointerUp as (e: unknown) => void)({
      pointerId: 11, clientX: 40, clientY: 102, currentTarget: galleryTarget, stopPropagation: vi.fn(),
    });
    // Gallery swallowed bubble up; capture-phase up still clears gallery-owned pending.
    (shellH.props.onPointerUpCapture as (e: unknown) => void)({ pointerId: 11 });
    (shellH.props.onPointerDownCapture as () => void)();
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 12, button: 0, clientX: 100, clientY: 400, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shellH.props.onPointerDown as (e: unknown) => void)({
      pointerId: 12, button: 0, isPrimary: true, clientX: 100, clientY: 400,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    (galleryNode!.props.onPointerMove as (e: unknown) => void)({
      pointerId: 12, clientX: 101, clientY: 360, currentTarget: galleryTarget,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shellH.props.onPointerMove as (e: unknown) => void)({
      pointerId: 12, clientX: 101, clientY: 360, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(previewCapture.has(12)).toBe(true);
    (shellH.props.onPointerUp as (e: unknown) => void)({
      pointerId: 12, clientX: 101, clientY: 300, currentTarget: surface, preventDefault: vi.fn(),
    });
    expect(change).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(220);

    // 3) Genuine capture loss on the active parent target still resets.
    change.mockClear(); galleryCapture.clear(); previewCapture.clear();
    popupSlots.cleanups.forEach(fn => fn?.());
    popupSlots.slots = []; popupSlots.cleanups = [];
    renderPopup();
    renderGallery();
    const shellLoss = elements(popupTree).find(node => node.props.className === "gb-venue-popup")!;
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 13, button: 0, clientX: 60, clientY: 736, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (shellLoss.props.onPointerDown as (e: unknown) => void)({
      pointerId: 13, button: 0, isPrimary: true, clientX: 60, clientY: 736,
      currentTarget: surface, target: gallerySource, preventDefault: vi.fn(),
    });
    (shellLoss.props.onPointerMove as (e: unknown) => void)({
      pointerId: 13, clientX: 60, clientY: 722, currentTarget: surface, preventDefault: vi.fn(),
    });
    renderPopup();
    expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props["data-moving"]).toBe(true);
    previewCapture.delete(13);
    (shellLoss.props.onLostPointerCapture as (e: unknown) => void)({
      pointerId: 13, target: previewButton, currentTarget: surface,
    });
    renderPopup();
    expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props["data-moving"]).toBe(false);
    expect(change).not.toHaveBeenCalled();

    // 4) Swipe sets suppressClick; fresh pointerdown clears it so the first tap is not swallowed.
    gallerySlots.cleanups.forEach(fn => fn?.());
    gallerySlots.slots = []; gallerySlots.cleanups = [];
    renderGallery();
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 14, button: 0, clientX: 100, clientY: 100, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (galleryNode!.props.onPointerMove as (e: unknown) => void)({
      pointerId: 14, clientX: 40, clientY: 102, currentTarget: galleryTarget,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    (galleryNode!.props.onPointerUp as (e: unknown) => void)({
      pointerId: 14, clientX: 40, clientY: 102, currentTarget: galleryTarget, stopPropagation: vi.fn(),
    });
    const swallowed = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (galleryNode!.props.onClickCapture as (e: unknown) => void)(swallowed);
    expect(swallowed.preventDefault).toHaveBeenCalled();
    (galleryNode!.props.onPointerDown as (e: unknown) => void)({
      pointerId: 15, button: 0, clientX: 100, clientY: 100, currentTarget: galleryTarget, target: gallerySource,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    const tap = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (galleryNode!.props.onClickCapture as (e: unknown) => void)(tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
  });
});
