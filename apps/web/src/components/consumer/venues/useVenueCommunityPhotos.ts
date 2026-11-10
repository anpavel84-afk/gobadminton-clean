"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVenueCommunityPhotos, isCommunityPhotoPage } from "../../../lib/venue-comment-photos-api";
import { getCommentDetail, isCurrentPhotoSource } from "../../../lib/comments-api";
import type { EntityComment, VenueCommunityPhoto } from "../../../lib/comments-types";

type State = {
  items: VenueCommunityPhoto[]; canonical: string; cursor: string | null;
  phase: "loading" | "ready" | "error" | "restart";
  selection: { items?: VenueCommunityPhoto[]; index: number } | null;
  credit: { url: string; name: string | null; unavailable: boolean } | null;
  source: EntityComment | null; sourceError: string; sourceBusy: boolean;
};
const initial = (venueId: string): State => ({ items: [], canonical: venueId, cursor: null,
  phase: "loading", selection: null, credit: null, source: null, sourceError: "", sourceBusy: false });

/** Local to the single community owner. No shared cache, polling or private media fallback. */
export function useVenueCommunityPhotos(venueId: string, actorId: string | null, csrf: string | null) {
  const [state, setState] = useState<State>(() => initial(venueId));
  const context = useRef({ venueId, actorId, csrf, epoch: 0, live: true });
  const pageRequest = useRef<{ controller: AbortController; initial: boolean } | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  const creditRequest = useRef<AbortController | null>(null);
  const bind = useRef(context.current);
  if (context.current.venueId !== venueId || context.current.actorId !== actorId || context.current.csrf !== csrf) {
    pageRequest.current?.controller.abort(); sourceRequest.current?.abort(); creditRequest.current?.abort();
    context.current = { venueId, actorId, csrf, epoch: context.current.epoch + 1, live: true };
  }
  const current = bind.current === context.current ? state : initial(venueId);
  const snapshot = useRef(current); snapshot.current = current;
  const load = useCallback(async (reset = false, advance = false) => {
    const ctx = context.current;
    if (!ctx.live || pageRequest.current) return;
    const before = snapshot.current;
    const cursor = reset ? null : before.cursor;
    if (!reset && !cursor) return;
    const controller = new AbortController(); pageRequest.current = { controller, initial: reset };
    if (reset) {
      sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
      bind.current = ctx; setState(initial(ctx.venueId));
    } else setState((s) => ({ ...s, phase: "loading" }));
    const result = await getVenueCommunityPhotos(reset ? ctx.venueId : before.canonical, cursor, controller.signal);
    if (controller.signal.aborted || ctx !== context.current || !ctx.live) return;
    pageRequest.current = null;
    if (!result.ok && result.status === 409 && result.problem?.code === "VENUE_CANONICAL_CHANGED") {
      sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
      setState({ ...initial(ctx.venueId), phase: "restart" }); return;
    }
    if (!result.ok || !isCommunityPhotoPage(result.data)) {
      setState((s) => ({ ...s, phase: "error" })); return;
    }
    const page = result.data;
    if ((!reset && (page.venueId !== before.canonical || page.nextCursor === cursor))
      || (!reset && page.items.some((p) => before.items.some((old) => old.id === p.id)))) {
      sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
      setState({ ...initial(ctx.venueId), phase: "restart" }); return;
    }
    setState((s) => ({ ...s, canonical: page.venueId, items: reset ? page.items : [...s.items, ...page.items],
      cursor: page.nextCursor, phase: "ready",
      selection: advance && s.selection && !s.selection.items && s.selection.index === before.selection?.index && page.items.length
        ? { index: before.items.length } : s.selection }));
  }, []);
  useEffect(() => {
    bind.current = context.current;
    pageRequest.current = null;
    void load(true);
    return () => { context.current.epoch++; pageRequest.current?.controller.abort(); sourceRequest.current?.abort(); creditRequest.current?.abort(); pageRequest.current = null; };
  }, [venueId, actorId, csrf, load]);
  useEffect(() => {
    const fence = () => {
      context.current = { ...context.current, epoch: context.current.epoch + 1, live: false };
      pageRequest.current?.controller.abort(); sourceRequest.current?.abort(); creditRequest.current?.abort(); pageRequest.current = null; sourceRequest.current = null;
      bind.current = context.current; setState({ ...initial(context.current.venueId), phase: "restart" });
    };
    window.addEventListener("gb-private-expired", fence); window.addEventListener("gb-session-changed", fence);
    return () => { window.removeEventListener("gb-private-expired", fence); window.removeEventListener("gb-session-changed", fence); };
  }, []);
  const cancelNextPage = () => {
    // The initial read belongs to the community, including when an inline viewer closes.
    if (!pageRequest.current || pageRequest.current.initial) return false;
    pageRequest.current.controller.abort(); pageRequest.current = null;
    return true;
  };
  const close = () => {
    // Fence even transports that complete despite abort, without cancelling gallery state.
    sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
    const cancelledNextPage = cancelNextPage();
    setState((s) => ({ ...s, selection: null, credit: null, sourceBusy: false, phase: cancelledNextPage && s.phase === "loading" ? "ready" : s.phase }));
  };
  const open = (photo: VenueCommunityPhoto, inlineItems?: VenueCommunityPhoto[]) => {
    if (!context.current.live) return;
    sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
    const index = current.items.findIndex((p) => p.url === photo.url);
    setState((s) => ({ ...s, source: null, credit: null, sourceError: "", sourceBusy: false,
      selection: index >= 0 ? { index } : { items: inlineItems ?? [photo], index: Math.max(0, inlineItems?.findIndex((p) => p.url === photo.url) ?? 0) } }));
  };
  const selectedItems = current.selection?.items ?? current.items;
  const selected = current.selection ? selectedItems[current.selection.index] : undefined;
  useEffect(() => {
    if (!selected || !context.current.live) return;
    const ctx = context.current;
    const controller = new AbortController();
    creditRequest.current = controller;
    // Actual author credit needs the existing detail endpoint: gallery intentionally has no author DTO.
    void getCommentDetail(selected.source.commentId, controller.signal).then((result) => {
      if (controller.signal.aborted || ctx !== context.current || !ctx.live) return;
      const source = result.ok && isCurrentPhotoSource(result.data, selected) ? result.data : null;
      setState((s) => ({ ...s, credit: { url: selected.url, name: source?.author?.displayName ?? null, unavailable: !source } }));
    });
    return () => { controller.abort(); if (creditRequest.current === controller) creditRequest.current = null; };
  }, [selected?.url, venueId, actorId, csrf]);
  async function jump() {
    if (!selected || sourceRequest.current || !context.current.live) return;
    const ctx = context.current;
    const controller = new AbortController(); sourceRequest.current = controller;
    setState((s) => ({ ...s, sourceBusy: true, sourceError: "" }));
    const result = await getCommentDetail(selected.source.commentId, controller.signal);
    if (controller.signal.aborted || ctx !== context.current || !ctx.live) return;
    sourceRequest.current = null;
    if (!result.ok || !isCurrentPhotoSource(result.data, selected)) {
      setState((s) => ({ ...s, sourceBusy: false, sourceError: "Публикация недоступна или изменилась. Обновите фотографии." })); return;
    }
    const cancelledNextPage = cancelNextPage();
    creditRequest.current?.abort(); creditRequest.current = null;
    // Membership is supplied by the authorized gallery DTO; detail entityId can be a merged origin.
    setState((s) => ({ ...s, source: result.data as EntityComment, sourceBusy: false, selection: null, phase: cancelledNextPage && s.phase === "loading" ? "ready" : s.phase }));
  }
  function move(delta: number) {
    if (!current.selection || current.sourceBusy) return;
    const next = current.selection.index + delta;
    if (next >= 0 && next < selectedItems.length) setState((s) => ({ ...s, credit: null, sourceError: "", selection: s.selection ? { ...s.selection, index: next } : null }));
    else if (delta > 0 && !current.selection.items && current.cursor) void load(false, true);
  }
  return { ...current, selected, selectedItems, open, close, move, jump,
    loadMore: () => load(false), restart: () => {
      // Signed-in expiry waits for the host's new session props; guest may explicitly resume.
      if (!context.current.live && actorId) return;
      context.current.live = true;
      pageRequest.current?.controller.abort(); pageRequest.current = null;
      sourceRequest.current?.abort(); sourceRequest.current = null; creditRequest.current?.abort(); creditRequest.current = null;
      void load(true);
    } };
}
export type VenueCommunityPhotosModel = ReturnType<typeof useVenueCommunityPhotos>;
