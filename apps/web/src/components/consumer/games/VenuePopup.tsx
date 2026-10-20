"use client";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type Drag = { id: number; x: number; y: number; lastY: number; time: number; velocity: number; origin: boolean; start: number; travel: number; axis: "pending" | "vertical"; target: HTMLButtonElement };

/** Owns the surface and capture across both presentations. Content never owns gestures. */
export function VenuePopup({ expanded, onExpandedChange, onDeselect, preview, children }: {
  expanded: boolean; onExpandedChange: (value: boolean) => void; onDeselect: () => void;
  preview: ReactNode; children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppress = useRef(false);
  const [position, setPosition] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [settling, setSettling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => {
    const current = drag.current; drag.current = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  };
  const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const reset = () => { release(); clearTimer(); setMoving(false); setSettling(false); setPosition(null); };
  useEffect(() => {
    window.addEventListener("resize", reset);
    return () => { window.removeEventListener("resize", reset); release(); clearTimer(); };
  }, []);
  const settle = (value: boolean) => {
    const current = drag.current;
    const travel = current?.travel;
    release(); setMoving(false); clearTimer();
    onExpandedChange(value);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || travel === undefined) {
      setPosition(null); setSettling(false); return;
    }
    setPosition(value ? travel : 0); setSettling(true);
    timer.current = setTimeout(() => { timer.current = null; setPosition(null); setSettling(false); }, 220);
  };
  const cancel = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    suppress.current = false;
    settle(drag.current.origin);
  };
  const visible = expanded || moving || settling;
  return <>
    {expanded && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <div ref={surface} className="gb-venue-popup" role={expanded ? "dialog" : undefined} aria-modal={expanded ? "true" : undefined} aria-label={expanded ? "Выбранная площадка" : undefined} data-expanded={expanded} data-moving={moving}
      style={{ height: position === null ? (expanded ? "88dvh" : "172px") : `calc(172px + ${position}px)`, transition: moving ? "none" : "height 220ms cubic-bezier(.2,.8,.2,1)" }}
      onClickCapture={event => {
        if (event.detail === 0) return;
        if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation(); }
      }}>
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
          const progress = Math.max(0, Math.min(current.travel, current.start + current.y - event.clientY));
          const velocity = event.timeStamp - current.time > 100 ? 0 : current.velocity;
          settle(Math.abs(velocity) >= .5 ? velocity > 0 : progress >= current.travel / 2);
        }} onPointerCancel={cancel} onLostPointerCapture={cancel}><span /></button>
      <div hidden={visible}>{preview}</div>
      {visible && <div className="gb-venue-popup-content">{children}</div>}
    </div>
  </>;
}
