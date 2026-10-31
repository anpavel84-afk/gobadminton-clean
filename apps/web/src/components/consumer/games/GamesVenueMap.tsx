"use client";
import { Button } from "../Button";
import { SurfacePanel } from "../Surfaces";
import { classifyMapError, mapErrorReason, type MapDiagnostic } from "../../../lib/games-map-diagnostics";
import { RadarPage } from "../radar/RadarPage";
import { shuttlecockElement } from "../NavIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../../styles/radar-geographic.css";
import { venueMarkerPresentation, reconcileVenueMarkers, markerActivation } from "../../../lib/games-venue-map";
import { filterVenuesForMapLayer } from "../../../lib/map-layer-filters";
import { MOSCOW_BUNDLE, allowedMapResource, isApprovedAppOrigin } from "../../../lib/radar-map-assets";
import type { VenueSummary } from "../../../lib/consumer-types";
import { useMapLayerFilters } from "./MapLayerFilters";
function sessionStorageVenue() {
  try { return sessionStorage.getItem("gb-games-map-selected"); } catch { return null; }
}
interface VenueMarkerEntry {
  marker: maplibregl.Marker;
  button: HTMLButtonElement;
  presentation?: string;
  position?: string;
}
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GamesVenueMap({ venues, counts, selectedVenueId, onDeselect, onSelect, onAvailability, onErrorCardChange, onReturnToList }: { venues: VenueSummary[]; counts: Map<string, number> | null; selectedVenueId?: string | null; onDeselect?: () => void; onSelect: (venue: VenueSummary) => void; onAvailability?: (available: boolean) => void; onErrorCardChange?: (shown: boolean) => void; onReturnToList?: () => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  const venuesRef = useRef(venues); venuesRef.current = venues;
  const callbacks = useRef({ onSelect, onAvailability }); callbacks.current = { onSelect, onAvailability };
  const markers = useRef(new Map<string, VenueMarkerEntry>());
  const { applied } = useMapLayerFilters();
  // Marker filter only: selection still resolves against the canonical venue list above.
  const markerVenues = useMemo(
    () => applied.venueMode === "all" ? venues : filterVenuesForMapLayer(venues, counts, applied.venueMode),
    [venues, counts, applied.venueMode],
  );
  const [resumeCamera, setResumeCamera] = useState(false);
  const [sharedMap, setSharedMap] = useState<LibreMap>();
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [status, setStatus] = useState("Загружаем карту города…");
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<MapDiagnostic>();
  useEffect(() => {
    onErrorCardChange?.(!!failure);
    return () => onErrorCardChange?.(false);
  }, [failure, onErrorCardChange]);
  const [lastError, setLastError] = useState<string>();
  const [warnings, setWarnings] = useState(0);
  useEffect(() => {
    let alive = true; const abort = new AbortController(); let instance: LibreMap | undefined;
    const saveCamera = () => {
      if (!instance) return;
      const center = instance.getCenter();
      try { sessionStorage.setItem("gb-games-map-camera", JSON.stringify({ lng: center.lng, lat: center.lat, zoom: instance.getZoom() })); } catch { /* Optional storage. */ }
    };
    window.addEventListener("gb-map-return", saveCamera); window.addEventListener("pagehide", saveCamera);
    let loadedAt: number | undefined; let loadedTiles = 0; let firstRender = false;
    let phase: "style" | "init" = "style";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let tileTimeout: ReturnType<typeof setTimeout> | undefined;
    let fatal = false; let started = false;
    const removeMapListeners: (() => void)[] = [];
    let grace: ReturnType<typeof setTimeout> | undefined;
    let deadline: number | undefined;
    const fail = (diagnostic: MapDiagnostic) => {
      if (!alive || fatal) return;
      fatal = true; setFailure(diagnostic); setStatus(""); callbacks.current.onAvailability?.(false);
    };
    const restore = () => {
      if (!alive || fatal || deadline === undefined || Date.now() >= deadline) return;
      clearTimeout(grace); grace = undefined; deadline = undefined; instance?.triggerRepaint();
    };
    const visible = () => { if (alive && document.visibilityState === "visible") instance?.triggerRepaint(); };
    document.addEventListener("visibilitychange", visible);
    const lost = (event: Event) => { event.preventDefault(); report({ kind: "webgl" }); };
    const report = (event: unknown) => {
      if (!alive) return;
      const diagnostic = classifyMapError(event, { loadedTiles, firstRender, sinceLoadMs: loadedAt === undefined ? undefined : Date.now() - loadedAt });
      console.warn("[games-map]", diagnostic.kind, diagnostic.url, diagnostic.status);
      setLastError(diagnostic.kind); setWarnings(n => n + 1);
      if (diagnostic.kind === "webgl") {
        if (!fatal && deadline === undefined) {
          deadline = Date.now() + 4000;
          grace = setTimeout(() => fail(diagnostic), 4000);
        }
      } else if (diagnostic.fatal) fail(diagnostic);
    };
    async function start() {
      timeout = setTimeout(() => report({ kind: "timeout" }), 20000);
      try {
        if (!isApprovedAppOrigin(window.location.origin)) throw new Error("Map origin unsupported");
        const response = await fetch(MOSCOW_BUNDLE.prefix + "style-dev.json", { credentials: "omit", signal: abort.signal });
        if (!response.ok) throw { kind: "style", url: response.url, status: response.status };
        const bytes = await response.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (hash !== MOSCOW_BUNDLE.styleHash) throw new Error("style identity");
        const style = JSON.parse(new TextDecoder().decode(bytes)) as StyleSpecification;
        // PMTiles fetches its archive internally: validate style URLs before installing it.
        const resources = [style.glyphs, ...(typeof style.sprite === "string" ? [style.sprite] : (style.sprite ?? []).map(sprite => sprite.url)), ...Object.values(style.sources).flatMap(source => ["url" in source ? source.url : undefined, ...("tiles" in source ? source.tiles ?? [] : [])])];
        if (resources.some(url => typeof url === "string" && !allowedMapResource(url))) throw new Error("Unapproved style resource");
        if (!alive || !container.current) return;
        phase = "init";
        installProtocol();
        instance = new maplibregl.Map({ container: container.current, style, center: MOSCOW_BUNDLE.center, zoom: 10.5, maxBounds: MOSCOW_BUNDLE.bounds, maxZoom: 16, attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false,
          transformRequest: url => { if (!allowedMapResource(url)) throw Object.assign(new Error("Unapproved map resource"), { url }); return { url, credentials: "same-origin" }; },
        });
        // Pan, pinch and keyboard remain native; fullscreen has no zoom overlay.
        instance.touchZoomRotate.disableRotation(); map.current = instance;
        try {
          setResumeCamera(sessionStorage.getItem("gb-games-map-returning") === "venue");
          sessionStorage.removeItem("gb-games-map-returning");
          const camera = JSON.parse(sessionStorage.getItem("gb-games-map-camera") ?? "null");
          if (camera && [camera.lng, camera.lat, camera.zoom].every(Number.isFinite) && camera.lng >= 36 && camera.lng <= 39.5 && camera.lat >= 54.5 && camera.lat <= 56.5)
            instance.jumpTo({ center: [camera.lng, camera.lat], zoom: Math.min(16, Math.max(0, camera.zoom)) });
        } catch { /* Storage is optional. */ }
        const moving = () => { if (alive) setSettled(false); };
        instance.on("movestart", moving);
        removeMapListeners.push(() => instance?.off("movestart", moving));
        let firstIdle = true;
        const idle = () => { if (alive) { if (firstIdle) { firstIdle = false; instance?.resize(); } setSettled(true); } };
        instance.on("idle", idle);
        removeMapListeners.push(() => instance?.off("idle", idle));
        const rendered = () => { firstRender = true; };
        instance.on("render", rendered);
        removeMapListeners.push(() => instance?.off("render", rendered));
        const sourcedata = (event: maplibregl.MapSourceDataEvent) => {
          if (event.sourceId === "protomaps" && event.tile && event.tile.state === "loaded") loadedTiles++;
        };
        instance.on("sourcedata", sourcedata);
        removeMapListeners.push(() => instance?.off("sourcedata", sourcedata));
        const loaded = () => { if (alive) {
          instance?.resize(); loadedAt = Date.now(); setReady(true); setSharedMap(instance);
          if (!fatal) { callbacks.current.onAvailability?.(true); setStatus(""); }
          clearTimeout(timeout);
          tileTimeout = setTimeout(() => { if (!loadedTiles) report({ kind: "tiles", sourceId: "protomaps" }); }, 8000);
        } };
        instance.on("load", loaded);
        removeMapListeners.push(() => instance?.off("load", loaded));
        instance.on("error", report);
        removeMapListeners.push(() => instance?.off("error", report));
        instance.getCanvas().addEventListener("webglcontextlost", lost);
        instance.getCanvas().addEventListener("webglcontextrestored", restore);
        instance.getCanvas().setAttribute("aria-label", "Карта Москвы: стрелки перемещают карту, плюс и минус меняют масштаб");
      } catch (error) { if (alive) report({ error, kind: classifyMapError(error, { phase, loadedTiles }).kind }); }
    }
    let frame = 0;
    let size = "";
    let observedZero = false;
    const layout = () => {
      frame = 0;
      if (!alive || !container.current) return;
      const { width, height } = container.current.getBoundingClientRect();
      if (width <= 0 || height <= 0) { observedZero = true; return; }
      const nextSize = `${width}:${height}`;
      const changed = observedZero || size !== nextSize;
      size = nextSize; observedZero = false;
      if (!started) { started = true; void start(); }
      else if (instance && changed) { setSettled(false); instance.resize(); }
    };
    const resize = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(layout); });
    if (container.current) resize.observe(container.current);
    layout();
    return () => { alive = false; abort.abort(); clearTimeout(grace); cancelAnimationFrame(frame);
      removeMapListeners.forEach(remove => remove());
      document.removeEventListener("visibilitychange", visible);
      instance?.getCanvas().removeEventListener("webglcontextlost", lost);
      instance?.getCanvas().removeEventListener("webglcontextrestored", restore); clearTimeout(timeout); clearTimeout(tileTimeout); resize.disconnect(); window.removeEventListener("gb-map-return", saveCamera); window.removeEventListener("pagehide", saveCamera);
      if (instance) { const center = instance.getCenter(); try { sessionStorage.setItem("gb-games-map-camera", JSON.stringify({ lng: center.lng, lat: center.lat, zoom: instance.getZoom() })); } catch { /* Optional storage. */ } }
      markers.current.forEach(entry => entry.marker.remove()); markers.current.clear(); instance?.remove(); map.current = null; };
  }, [attempt]);
  useEffect(() => {
    if (!ready || !map.current) return;
    reconcileVenueMarkers<VenueMarkerEntry>(markers.current, markerVenues, {
      create: venue => {
        const button = document.createElement("button"); button.type = "button";
        const activation = markerActivation();
        button.addEventListener("pointerdown", event => activation.start(event.clientX, event.clientY));
        button.addEventListener("pointermove", event => activation.move(event.clientX, event.clientY));
        button.addEventListener("pointercancel", () => activation.cancel());
        button.addEventListener("click", event => {
          if (!activation.allow(event.detail) || map.current?.isMoving()) return;
          const current = callbacks.current;
          current.onSelect(venuesRef.current.find(item => item.id === venue.id) ?? venue);
        });
        const marker = new maplibregl.Marker({ element: button }).setLngLat([venue.longitude!, venue.latitude!]).addTo(map.current!);
        return { marker, button, position: `${venue.longitude}:${venue.latitude}` };
      },
      update: (entry, venue) => {
        const presentation = venueMarkerPresentation(venue, counts);
        const pressed = String((selectedVenueId === undefined ? sessionStorageVenue() : selectedVenueId) === venue.id);
        const previous = entry.presentation ? JSON.parse(entry.presentation) as string[] : [];
        if (previous[0] !== presentation.className) entry.button.className = `maplibregl-marker ${presentation.className}`;
        if (previous[1] !== presentation.text) {
          entry.button.replaceChildren();
          if (presentation.text) entry.button.textContent = presentation.text;
          else {
            const glyph = shuttlecockElement();
            glyph.setAttribute("class", "gb-venue-court-glyph"); glyph.setAttribute("aria-hidden", "true");
            entry.button.append(glyph);
          }
        }
        if (previous[2] !== pressed) entry.button.setAttribute("aria-pressed", pressed);
        if (previous[3] !== presentation.label) entry.button.setAttribute("aria-label", presentation.label);
        entry.presentation = JSON.stringify([presentation.className, presentation.text, pressed, presentation.label]);
        const position = `${venue.longitude}:${venue.latitude}`;
        if (entry.position !== position) {
          entry.marker.setLngLat([venue.longitude!, venue.latitude!]); entry.position = position;
        }
      },
      remove: entry => entry.marker.remove(),
    });
  }, [ready, markerVenues, counts, selectedVenueId]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const canvas = map.current.getCanvas();
    const deselect = () => onDeselect?.();
    canvas.addEventListener("click", deselect);
    return () => canvas.removeEventListener("click", deselect);
  }, [ready, onDeselect]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const separate = () => {
      const own = instance.getContainer().querySelector<HTMLElement>(".g2-own-marker");
      const ownPoint = own ? instance.project([Number(own.dataset.longitude), Number(own.dataset.latitude)]) : null;
      for (const entry of markers.current.values()) {
        const point = instance.project(entry.marker.getLngLat());
        const dx = ownPoint ? point.x - ownPoint.x : 0;
        const dy = ownPoint ? point.y - ownPoint.y : 0;
        const distance = Math.hypot(dx, dy);
        // Presentation offset only: published coordinates remain unchanged.
        const offset = ownPoint && distance < 64 ? 64 - distance : 0;
        entry.marker.setOffset([offset * (distance ? dx / distance : 1), offset * (distance ? dy / distance : 0)]);
      }
    };
    separate(); instance.on("moveend", separate); window.addEventListener("gb-map-own-marker", separate);
    return () => { instance.off("moveend", separate); window.removeEventListener("gb-map-own-marker", separate); };
  }, [ready, markerVenues]);
  const retry = () => {
    setReady(false); setSettled(false); setSharedMap(undefined); setFailure(undefined);
    setLastError(undefined); setWarnings(0); setStatus("Загружаем карту города…");
    callbacks.current.onAvailability?.(true); setAttempt(n => n + 1);
  };
  return <><div className="gb-games-map-area"><div ref={container} data-map-error={lastError} data-map-warnings={warnings} data-map-ready={ready} data-map-settled={settled} className="gb-games-map-canvas" />{failure && <SurfacePanel className="gb-games-map-error" role="alert">
    <h2>Карта не загрузилась</h2><p>{mapErrorReason[failure.kind]}</p>
    <div><Button onClick={retry}>Повторить</Button><Button variant="outline" onClick={() => { if (onReturnToList) onReturnToList(); else window.location.assign("/games"); }}>← К списку</Button></div>
  </SurfacePanel>}</div>{status && <p className="gb-map-sr-only" role="status">{status}</p>}{sharedMap && <RadarPage resumeCamera={resumeCamera} sharedMap={sharedMap} />}</>;
}
