"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { DesktopMapInspector, useDesktopMapInspector } from "./DesktopMapInspector";

type Drag = { id: number; x: number; y: number; lastY: number; time: number; velocity: number; origin: boolean; start: number; travel: number; axis: "pending" | "vertical"; target: HTMLButtonElement };
type CompactDrag = { id: number; x: number; y: number; travel: number; axis: "pending" | "vertical"; target: HTMLElement; galleryOwned?: boolean };

/** Shared expanded-shell keyboard/focus/body-overflow lifecycle for VenueSheet and player detail. */
export function useVenuePopupModalLifecycle({
  active, embedded = false, panelRef, initialFocusRef, onEscape, skipFocusRestore, lockBody = true,
}: {
  active: boolean;
  embedded?: boolean;
  panelRef: { current: HTMLElement | null };
  initialFocusRef?: { current: HTMLElement | null };
  onEscape: () => void;
  /** When true at cleanup (player→venue replacement), do not restore the old opener. */
  skipFocusRestore?: { current: boolean };
  /** Desktop inspector keeps the map usable; do not freeze document scroll. */
  lockBody?: boolean;
}) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const initiator = document.activeElement;
    const overflow = document.body.style.overflow;
    if (lockBody) document.body.style.overflow = "hidden";
    initialFocusRef?.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      // The portal/native dialog owns its own keyboard and focus lifecycle.
      if (document.querySelector(".gb-venue-picker, dialog[open]")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); escape.current(); return; }
      // Desktop inspector (lockBody=false) must not trap Tab — focus moves between map and panel.
      if (!lockBody || event.key !== "Tab") return;
      const boundary = embedded
        ? panelRef.current?.closest?.<HTMLElement>(".gb-venue-popup, .gb-desktop-map-inspector") ?? panelRef.current
        : panelRef.current;
      const targets = [...boundary?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]') ?? []].filter(target => {
        if (target.tabIndex < 0 || target.matches(':disabled, [aria-disabled="true"], input[type="hidden"]') || target.closest('[hidden], [inert]')) return false;
        const style = window.getComputedStyle(target);
        return style.visibility !== 'hidden' && style.visibility !== 'collapse' && target.getClientRects().length > 0;
      });
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !boundary?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !boundary?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const options = { capture: true };
    window.addEventListener("keydown", keydown, options);
    return () => {
      window.removeEventListener("keydown", keydown, options);
      if (lockBody) document.body.style.overflow = overflow;
      if (skipFocusRestore?.current) return;
      // Node/test cleanups may run without a DOM HTMLElement constructor.
      if (typeof HTMLElement !== "undefined" && initiator instanceof HTMLElement && initiator.isConnected && !initiator.closest?.("[hidden]")) initiator.focus();
      else (document.querySelector<HTMLButtonElement>('.gb-venue-popup .gb-venue-handle') ?? document.querySelector<HTMLButtonElement>('.gb-venue-preview-button'))?.focus();
    };
  }, [active, embedded, panelRef, initialFocusRef, skipFocusRestore, lockBody]);
}

/** The handle retains its old expanded gesture. Only the compact surface gains full-card swipes. */
export function VenuePopup({ expanded, onExpandedChange, onDeselect, preview, children, labels }: {
  expanded: boolean; onExpandedChange: (value: boolean) => void; onDeselect: () => void;
  preview: ReactNode; children: ReactNode;
  /** Narrow neutral copy for non-venue sheets; gesture/geometry stay identical. */
  labels?: { dialog?: string; expandHandle?: string; collapseHandle?: string };
}) {
  const desktop = useDesktopMapInspector();
  const dialogLabel = labels?.dialog ?? "Выбранная площадка";
  const expandHandle = labels?.expandHandle ?? "Развернуть площадку";
  const collapseHandle = labels?.collapseHandle ?? "Свернуть площадку";
  const surface = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const compactDrag = useRef<CompactDrag | null>(null);
  const suppress = useRef(false);
  const [position, setPosition] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [settling, setSettling] = useState(false);
  // A single image moves between compact and expanded slots. Keep it in the
  // compact slot until its size morph finishes; never move it on first touch.
  const [compactMorph, setCompactMorph] = useState(false);
  const compactMorphGeometry = useRef({ travel: 1, width: 366 });
  const rememberCompactGeometry = (travel: number) => {
    const measured = surface.current?.getBoundingClientRect().width;
    const width = typeof measured === "number" && measured > 96
      ? measured : Math.max(96, (window.innerWidth || 390) - 24);
    compactMorphGeometry.current = { travel: Math.max(1, travel), width };
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => {
    const current = drag.current; drag.current = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  };
  const releaseCompact = () => {
    const current = compactDrag.current; compactDrag.current = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  };
  const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const reset = () => { release(); releaseCompact(); clearTimer(); setMoving(false); setSettling(false); setCompactMorph(false); setPosition(null); };
  useEffect(() => {
    const onResize = () => {
      // On iOS the browser bars can change viewport size while a finger is moving.
      // Never reset the compact gesture mid-touch; expanded/handle keep their old behavior.
      if (compactDrag.current) return;
      reset();
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); release(); releaseCompact(); clearTimer(); };
  }, []);
  const settle = (value: boolean) => {
    const current = drag.current;
    const travel = current?.travel;
    const fromCompact = current?.origin === false;
    release(); setMoving(false); clearTimer();
    // The full VenueSheet must not steal the single cover image until the
    // compact cover has animated to its destination on a compact-origin drag.
    if (fromCompact) setCompactMorph(true);
    onExpandedChange(value);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || travel === undefined) {
      setPosition(null); setSettling(false); setCompactMorph(false); return;
    }
    setPosition(value ? travel : 0); setSettling(true);
    timer.current = setTimeout(() => { timer.current = null; setPosition(null); setSettling(false); setCompactMorph(false); }, 220);
  };
  const cancel = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    suppress.current = false;
    settle(drag.current.origin);
  };

  // Use the same immediate pointer capture as the working handle on iPhone Safari.
  // Capture the original preview button when present: this preserves its native tap/click
  // and keeps receiving subsequent pointer moves even when the finger leaves the card.
  // The preview remains mounted and the compact-only CSS prevents native vertical panning.
  const compactPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (expanded || moving || settling || drag.current || compactDrag.current ||
        !event.isPrimary || event.button !== 0 ||
        (event.target as HTMLElement).closest?.(".gb-venue-handle")) return;
    const travel = (full.current?.getBoundingClientRect().height ?? 0) -
      (compact.current?.getBoundingClientRect().height ?? 0);
    if (travel <= 0) return;
    rememberCompactGeometry(travel);
    suppress.current = false;
    const source = event.target as HTMLElement;
    const gallery = source.closest?.(".gb-venue-gallery") as HTMLElement | null;
    const previewButton = source.closest?.(".gb-venue-preview-button") as HTMLButtonElement | null;
    const captureTarget = previewButton ?? event.currentTarget;
    // Compact gallery already captures for horizontal swipes. Do not override
    // onto the preview button; keep a pending vertical takeover instead.
    if (gallery) {
      compactDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
        travel, axis: "pending", target: captureTarget, galleryOwned: true };
      return;
    }
    captureTarget.setPointerCapture(event.pointerId);
    compactDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
      travel, axis: "pending", target: captureTarget };
  };
  const compactPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = compactDrag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.axis === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Horizontal: leave gallery ownership alone; drop popup pending.
        compactDrag.current = null;
        return;
      }
      current.axis = "vertical";
      current.galleryOwned = false;
      suppress.current = true;
      // Vertical parent takeover after gallery axis-lock released capture.
      if (!current.target.hasPointerCapture(current.id)) {
        try { current.target.setPointerCapture(current.id); } catch { /* already released */ }
      }
    }
    event.preventDefault();
    setPosition(Math.max(0, Math.min(current.travel, -dy)));
    // Downward drags keep the original small card. An upward drag grows the
    // compact image proportionally; never mount the full info cover mid-touch.
    if (dy < 0) setCompactMorph(true);
    setMoving(dy < 0);
  };
  const compactPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = compactDrag.current;
    if (!current || current.id !== event.pointerId) return;
    const vertical = current.axis === "vertical";
    const dy = event.clientY - current.y;
    releaseCompact();
    if (!vertical) return; // ordinary click, handled by VenuePreviewCard
    event.preventDefault();
    clearTimer();
    if (dy >= 64) {
      // Only the compact view dismisses on a downward swipe.
      setMoving(false); setSettling(false); setCompactMorph(false); setPosition(null);
      onDeselect(); return;
    }
    const shouldExpand = dy <= -56;
    if (shouldExpand) onExpandedChange(true);
    setMoving(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPosition(null); setSettling(false); setCompactMorph(false); return;
    }
    setPosition(shouldExpand ? current.travel : 0);
    setSettling(true);
    timer.current = setTimeout(() => { timer.current = null; setPosition(null); setSettling(false); setCompactMorph(false); }, 220);
  };
  const compactPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (compactDrag.current?.id !== event.pointerId) return;
    releaseCompact(); clearTimer();
    suppress.current = false;
    setMoving(false); setSettling(false); setCompactMorph(false); setPosition(null);
  };
  // Gallery releasePointerCapture / parent setPointerCapture fires a bubbled
  // lostpointercapture from the old child. That must not cancel an active
  // vertical takeover that already holds capture on the preview/surface.
  const compactLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    const current = compactDrag.current;
    if (!current || current.id !== event.pointerId) return;
    if (
      current.axis === "vertical"
      && event.target !== current.target
      && current.target.hasPointerCapture(current.id)
    ) {
      return;
    }
    compactPointerCancel(event);
  };
  const progress = compactMorph && position !== null
    ? Math.max(0, Math.min(1, position / compactMorphGeometry.current.travel)) : 0;
  const mediaWidth = Math.max(64, compactMorphGeometry.current.width - 32);
  const mediaHeight = mediaWidth * 9 / 16;
  const compactMorphStyle = compactMorph ? {
    "--gb-venue-cover-width": `${Math.round(64 + (mediaWidth - 64) * progress)}px`,
    "--gb-venue-cover-height": `${Math.round(64 + (mediaHeight - 64) * progress)}px`,
    "--gb-venue-cover-top": `${Math.round(24 * (1 - progress))}px`,
    "--gb-venue-copy-opacity": Math.max(0, 1 - progress * 4),
  } as CSSProperties : undefined;
  // The full information block would steal the only photo from the compact
  // preview on the very first pointermove. Mount it only AFTER the morph.
  const visible = (expanded || moving || settling) && !compactMorph;
  // One React path for mobile + desktop: retainHost keeps the aside fiber so
  // VenueSheet/CreateGamePage state survives the 1024px presentation change.
  // Desktop chrome is CSS-driven; compact gestures stay available below that.
  return <>
    {!desktop && expanded && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <DesktopMapInspector open={desktop} retainHost label={dialogLabel} onDismiss={onDeselect}>
      <div ref={surface}
        className={desktop ? "gb-venue-popup gb-venue-popup--desktop" : "gb-venue-popup"}
        role={!desktop && expanded ? "dialog" : undefined}
        aria-modal={!desktop && expanded ? "true" : undefined}
        aria-label={!desktop && expanded ? dialogLabel : undefined}
        data-expanded={desktop || expanded}
        data-desktop={desktop ? "true" : undefined}
        data-moving={desktop ? undefined : moving}
        style={desktop ? undefined : { height: position === null ? (expanded ? "88dvh" : "172px") : `calc(172px + ${position}px)`, transition: moving ? "none" : "height 220ms cubic-bezier(.2,.8,.2,1)" }}
        // A swipe's synthetic click has no new pointerdown. A later real tap does.
        // Clear only stale suppression at the start of a fresh press so the first
        // expanded Close/Back tap is never swallowed after an iPhone swipe.
        onPointerDownCapture={desktop ? undefined : () => {
          // Clear a stale gallery-deferred pending left after a horizontal swipe
          // (gallery owned capture, so popup never saw pointerup).
          if (!drag.current && compactDrag.current?.galleryOwned) releaseCompact();
          if (!drag.current && !compactDrag.current) suppress.current = false;
        }}
        onPointerDown={desktop || expanded ? undefined : compactPointerDown}
        onPointerMove={desktop || expanded ? undefined : compactPointerMove}
        onPointerUp={desktop || expanded ? undefined : compactPointerUp}
        // Capture-phase up clears gallery-owned pending after a horizontal swipe
        // (gallery stopPropagation otherwise leaves stale pending that blocks the next gesture).
        onPointerUpCapture={desktop || expanded ? undefined : (event) => {
          const current = compactDrag.current;
          if (!current || current.id !== event.pointerId || current.axis === "vertical") return;
          if (current.galleryOwned) releaseCompact();
        }}
        onPointerCancel={desktop || expanded ? undefined : compactPointerCancel}
        onLostPointerCapture={desktop || expanded ? undefined : compactLostPointerCapture}
        onClickCapture={desktop ? undefined : event => {
          if (event.detail === 0) return;
          if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation(); }
        }}
        data-compact-morph={desktop ? undefined : compactMorph}
        data-settling={desktop ? undefined : settling}>
        {/* Stable slots: CSS hides measure/handle/preview inside the desktop rail. */}
        <div ref={compact} className="gb-venue-popup-compact-measure" aria-hidden="true" />
        <div ref={full} className="gb-venue-popup-full-measure" aria-hidden="true" />
        <button type="button" className="gb-venue-handle" aria-label={(desktop || expanded) ? collapseHandle : expandHandle}
          tabIndex={desktop ? -1 : undefined}
          onClick={() => { if (desktop) return; reset(); onExpandedChange(!expanded); }}
          onKeyDown={event => { if (desktop) return; if (event.key === "ArrowUp") { event.preventDefault(); reset(); onExpandedChange(true); } }}
          onPointerDown={event => {
            if (desktop || drag.current || !event.isPrimary || event.button !== 0) return;
            suppress.current = false;
            const travel = (full.current?.getBoundingClientRect().height ?? 0) - (compact.current?.getBoundingClientRect().height ?? 0);
            if (travel <= 0) return;
            if (!expanded) rememberCompactGeometry(travel);
            const start = settling ? Math.max(0, Math.min(travel, (surface.current?.getBoundingClientRect().height ?? 0) - (compact.current?.getBoundingClientRect().height ?? 0))) : expanded ? travel : 0;
            clearTimer(); setSettling(false);
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, time: event.timeStamp, velocity: 0, origin: expanded, start, travel, axis: "pending", target: event.currentTarget };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (desktop) return;
            const current = drag.current; if (!current || current.id !== event.pointerId) return;
            const dx = event.clientX - current.x; const dy = event.clientY - current.y;
            if (current.axis === "pending") {
              if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
              if (Math.abs(dx) >= Math.abs(dy)) {
                reset(); suppress.current = true; return;
              }
              current.axis = "vertical"; suppress.current = true; setMoving(true);
              if (!current.origin) setCompactMorph(true);
            }
            event.preventDefault();
            const elapsed = event.timeStamp - current.time;
            if (elapsed > 0) current.velocity = (current.lastY - event.clientY) / elapsed;
            current.lastY = event.clientY; current.time = event.timeStamp;
            setPosition(Math.max(0, Math.min(current.travel, current.start - dy)));
          }}
          onPointerUp={event => {
            if (desktop) return;
            const current = drag.current; if (!current || current.id !== event.pointerId) return;
            if (current.axis !== "vertical") { reset(); return; }
            // Existing expanded-handle behavior stays untouched; compact handle can dismiss.
            if (!current.origin && event.clientY - current.y >= 64) {
              reset(); onDeselect(); return;
            }
            const progress = Math.max(0, Math.min(current.travel, current.start + current.y - event.clientY));
            const velocity = event.timeStamp - current.time > 100 ? 0 : current.velocity;
            settle(Math.abs(velocity) >= .5 ? velocity > 0 : progress >= current.travel / 2);
          }} onPointerCancel={desktop ? undefined : cancel} onLostPointerCapture={desktop ? undefined : cancel}><span /></button>
        {/* Never display:none the touched preview while the compact card is being dragged.
            Safari drops the pointer stream when its original hit target disappears.
            The popup shell captures the pointer, and this stable layer remains mounted. */}
        <div className="gb-venue-popup-preview-surface"
          aria-hidden={desktop || visible}
          style={{ opacity: desktop || visible ? 0 : 1, pointerEvents: desktop || expanded || settling ? "none" : "auto", ...(!desktop ? compactMorphStyle : undefined) }}>
          {/* Keep the surface slot mounted; omit compact children on desktop (CSS also hides). */}
          {desktop ? null : preview}
        </div>
        {(desktop || visible) && <div className="gb-venue-popup-content">{children}</div>}
      </div>
    </DesktopMapInspector>
  </>;
}
