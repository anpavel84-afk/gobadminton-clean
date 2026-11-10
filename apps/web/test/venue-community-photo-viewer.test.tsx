// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { VenueCommunityPhotoViewer } from "../src/components/consumer/venues/VenueCommunityPhotoViewer";
import type { VenueCommunityPhotosModel } from "../src/components/consumer/venues/useVenueCommunityPhotos";
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const id = "10000000-0000-4000-8000-000000000001";
const photo = { id, url: `/v1/comments/${id}/revisions/1/photos/${id}`, width: 400, height: 300,
  source: { commentId: id, parentCommentId: null, resourceVersion: 1, path: `/v1/comments/${id}` } };
function model(extra: Partial<VenueCommunityPhotosModel> = {}): VenueCommunityPhotosModel {
  return { items: [photo], canonical: id, cursor: "opaque", phase: "ready", selection: { index: 0 }, selected: photo,
    selectedItems: [photo], credit: null, source: null, sourceError: "", sourceBusy: false, open: vi.fn(), close: vi.fn(), move: vi.fn(),
    jump: vi.fn(async () => {}), restart: vi.fn(), loadMore: vi.fn(async () => {}), ...extra };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("I2c2 viewer", () => {
  it("uses the named native dialog; arrows work from the close control; cancel closes and restores trigger focus/body scroll", () => {
    const move = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Миниатюра</button>{open ? <VenueCommunityPhotoViewer model={model({ move, close: () => setOpen(false) })} /> : null}</>;
    }
    document.body.style.overflow = "auto";
    render(<Harness />); const trigger = screen.getByRole("button", { name: "Миниатюра" }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Фотографии сообщества" });
    expect(dialog.hasAttribute("open")).toBe(true); expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByRole("button", { name: "Закрыть" }), { key: "ArrowRight" }); expect(move).toHaveBeenCalledWith(1);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe("auto");
  });
  it("keeps unknown total honest, shows unavailable without fallback, and keeps next/retry available", () => {
    const m = model({ phase: "error" }); const { rerender } = render(<VenueCommunityPhotoViewer model={m} />);
    expect(screen.getByText("Фото 1")).toBeTruthy();
    fireEvent.error(screen.getByRole("img")); expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Фото недоступно/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" })); expect(m.move).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" })); expect(m.move).toHaveBeenCalledTimes(2);
    rerender(<VenueCommunityPhotoViewer model={model({ cursor: null })} />); expect(screen.getByText("Фото 1 из 1")).toBeTruthy();
    rerender(<VenueCommunityPhotoViewer model={model({ selection: { items: [photo], index: 0 } })} />);
    expect(screen.getByText("Фото 1 к публикации")).toBeTruthy();
  });
  it("keeps focus inside the open dialog when the focused retry disappears, so plain arrows still work", () => {
    const items = Array.from({ length: 25 }, () => photo);
    const move = vi.fn();
    const m = model({ items, selectedItems: items, selection: { index: 23 }, phase: "error", move });
    const { rerender } = render(<VenueCommunityPhotoViewer model={m} />);
    const dialog = screen.getByRole("dialog", { name: "Фотографии сообщества" });
    const retry = screen.getByRole("button", { name: "Повторить загрузку" });
    retry.focus(); expect(document.activeElement).toBe(retry);
    fireEvent.click(retry); expect(move).toHaveBeenCalledExactlyOnceWith(1);

    rerender(<VenueCommunityPhotoViewer model={{ ...m, selection: { index: 24 }, phase: "ready", cursor: null }} />);
    expect(screen.getByText("Фото 25 из 25")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить загрузку" })).toBeNull();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(move).toHaveBeenLastCalledWith(-1);
  });
  it("preserves focus on a surviving control when the async retry disappears", () => {
    const m = model({ phase: "error", selection: { index: 1 }, items: [photo, photo], selectedItems: [photo, photo] });
    const { rerender } = render(<VenueCommunityPhotoViewer model={m} />);
    const previous = screen.getByRole("button", { name: "Предыдущее фото" });
    previous.focus(); expect(document.activeElement).toBe(previous);
    rerender(<VenueCommunityPhotoViewer model={{ ...m, phase: "ready", cursor: null }} />);
    expect(screen.queryByRole("button", { name: "Повторить загрузку" })).toBeNull();
    expect(document.activeElement).toBe(previous);
  });
  it("requires 48px and horizontal axis dominance; a vertical gesture stays on the same photo", () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number; isPrimary = true;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const m = model(); render(<VenueCommunityPhotoViewer model={m} />);
    const image = screen.getByRole("img").parentElement!;
    const swipe = (x: number, y: number) => {
      fireEvent.pointerDown(image, { pointerId: 1, button: 0, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(image, { pointerId: 1, clientX: 200 + x, clientY: 100 + y });
      fireEvent.pointerUp(image, { pointerId: 1, clientX: 200 + x, clientY: 100 + y });
    };
    swipe(-47, 0); swipe(-60, 90); expect(m.move).not.toHaveBeenCalled();
    swipe(-48, 0); expect(m.move).toHaveBeenCalledExactlyOnceWith(1);
    // Lock vertical at 10px even if the final diagonal later becomes horizontal.
    m.move = vi.fn(); fireEvent.pointerDown(image, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(image, { clientX: 201, clientY: 120 }); fireEvent.pointerUp(image, { clientX: 100, clientY: 125 });
    expect(m.move).not.toHaveBeenCalled();
  });
});
