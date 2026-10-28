"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

type Drag = { id: number; x: number; y: number; lastY: number; time: number; velocity: number; origin: boolean; start: number; travel: number; axis: "pending" | "vertical"; target: HTMLButtonElement };
type CompactDrag = { id: number; x: number; y: number; travel: number; axis: "pending" | "vertical"; target: HTMLElement };

/** The handle retains its old expanded gesture. Only the compact surface gains full-card swipes. */
export function VenuePopup({ expanded, onExpandedChange, onDeselect, preview, children }: {
  expanded: boolean; onExpandedChange: (value: boolean) => void; onDeselect: () => void;
  preview: ReactNode; children: ReactNode;
}) {
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
    const previewButton = source.closest?.(".gb-venue-preview-button") as HTMLButtonElement | null;
    const captureTarget = previewButton ?? event.currentTarget;
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
      if (Math.abs(dx) >= Math.abs(dy)) { compactDrag.current = null; return; }
      current.axis = "vertical";
      suppress.current = true;
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
  return <>
    {expanded && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <div ref={surface} className="gb-venue-popup" role={expanded ? "dialog" : undefined} aria-modal={expanded ? "true" : undefined} aria-label={expanded ? "Выбранная площадка" : undefined} data-expanded={expanded} data-moving={moving}
      style={{ height: position === null ? (expanded ? "88dvh" : "172px") : `calc(172px + ${position}px)`, transition: moving ? "none" : "height 220ms cubic-bezier(.2,.8,.2,1)" }}
      // A swipe's synthetic click has no new pointerdown. A later real tap does.
      // Clear only stale suppression at the start of a fresh press so the first
      // expanded Close/Back tap is never swallowed after an iPhone swipe.
      onPointerDownCapture={() => {
        if (!drag.current && !compactDrag.current) suppress.current = false;
      }}
      onPointerDown={expanded ? undefined : compactPointerDown}
      onPointerMove={expanded ? undefined : compactPointerMove}
      onPointerUp={expanded ? undefined : compactPointerUp}
      onPointerCancel={expanded ? undefined : compactPointerCancel}
      onLostPointerCapture={expanded ? undefined : compactPointerCancel}
      onClickCapture={event => {
        if (event.detail === 0) return;
        if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation(); }
      }} data-compact-morph={compactMorph} data-settling={settling}>
      <div ref={compact} className="gb-venue-popup-compact-measure" aria-hidden="true" />
      <div ref={full} className="gb-venue-popup-full-measure" aria-hidden="true" />
      <button type="button" className="gb-venue-handle" aria-label={expanded ? "Свернуть площадку" : "Развернуть площадку"}
        onClick={() => { reset(); onExpandedChange(!expanded); }}
        onKeyDown={event => { if (event.key === "ArrowUp") { event.preventDefault(); reset(); onExpandedChange(true); } }}
        onPointerDown={event => {
          if (drag.current || !event.isPrimary || event.button !== 0) return;
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
          const current = drag.current; if (!current || current.id !== event.pointerId) return;
          if (current.axis !== "vertical") { reset(); return; }
          // Existing expanded-handle behavior stays untouched; compact handle can dismiss.
          if (!current.origin && event.clientY - current.y >= 64) {
            reset(); onDeselect(); return;
          }
          const progress = Math.max(0, Math.min(current.travel, current.start + current.y - event.clientY));
          const velocity = event.timeStamp - current.time > 100 ? 0 : current.velocity;
          settle(Math.abs(velocity) >= .5 ? velocity > 0 : progress >= current.travel / 2);
        }} onPointerCancel={cancel} onLostPointerCapture={cancel}><span /></button>
      {/* Never display:none the touched preview while the compact card is being dragged.
          Safari drops the pointer stream when its original hit target disappears.
          The popup shell captures the pointer, and this stable layer remains mounted. */}
      <div className="gb-venue-popup-preview-surface"
        aria-hidden={visible}
        style={{ opacity: visible ? 0 : 1, pointerEvents: expanded || settling ? "none" : "auto", ...compactMorphStyle }}>
        {preview}
      </div>
      {visible && <div className="gb-venue-popup-content">{children}</div>}
    </div>
  </>;
}
