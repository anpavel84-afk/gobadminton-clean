"use client";
import { Button } from "../Button";
import { SurfacePanel } from "../Surfaces";
import { classifyMapError, mapErrorReason, type MapDiagnostic } from "../../../lib/games-map-diagnostics";
import { RadarPage } from "../radar/RadarPage";
import { shuttlecockElement } from "../NavIcon";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../../styles/radar-geographic.css";
import { venueMarkerPresentation, reconcileVenueMarkers, markerActivation, separateMarkerPoints } from "../../../lib/games-venue-map";
import { MOSCOW_BUNDLE, allowedMapResource } from "../../../lib/radar-map-assets";
import type { VenueSummary } from "../../../lib/consumer-types";
function sessionStorageVenue() {
  try { return sessionStorage.getItem("gb-games-map-selected"); } catch { return null; }
}
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GamesVenueMap({ venues, counts, onSelect, onAvailability, onErrorCardChange, onReturnToList, selectedVenueId }: { selectedVenueId?: string; venues: VenueSummary[]; counts: Map<string, number> | null; onSelect: (venue: VenueSummary) => void; onAvailability?: (available: boolean) => void; onErrorCardChange?: (shown: boolean) => void; onReturnToList?: () => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  const venuesRef = useRef(venues); venuesRef.current = venues;
  const callbacks = useRef({ onSelect, onAvailability }); callbacks.current = { onSelect, onAvailability };
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; button: HTMLButtonElement }>());
  const [resumeCamera, setResumeCamera] = useState(false);
  const [sharedMap, setSharedMap] = useState<LibreMap>();
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [status, setStatus] = useState("Загружаем карту города…");
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<MapDiagnostic>();
  // Return-control visibility follows the M0 card, independently of map load.
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
    const report = (event: unknown) => {
      if (!alive) return;
      const diagnostic = classifyMapError(event, { loadedTiles, firstRender, sinceLoadMs: loadedAt === undefined ? undefined : Date.now() - loadedAt });
      console.warn("[games-map]", diagnostic.kind, diagnostic.url, diagnostic.status);
      setLastError(diagnostic.kind); setWarnings(n => n + 1);
      if (diagnostic.fatal) { fatal = true; setFailure(diagnostic); setStatus(""); callbacks.current.onAvailability?.(false); }
    };
    async function start() {
      timeout = setTimeout(() => report({ kind: "timeout" }), 20000);
      try {
        if (window.location.origin !== new URL(MOSCOW_BUNDLE.prefix).origin) throw new Error("Map origin unsupported");
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
        instance.on("movestart", () => { if (alive) setSettled(false); });
        let firstIdle = true;
        instance.on("idle", () => { if (alive) { if (firstIdle) { firstIdle = false; instance?.resize(); } setSettled(true); } });
        instance.on("render", () => { firstRender = true; });
        instance.on("sourcedata", event => {
          if (event.sourceId === "protomaps" && event.tile && event.tile.state === "loaded") loadedTiles++;
        });
        instance.on("load", () => { if (alive) {
          instance?.resize(); loadedAt = Date.now(); setReady(true); setSharedMap(instance);
          if (!fatal) { callbacks.current.onAvailability?.(true); setStatus(""); }
          clearTimeout(timeout);
          tileTimeout = setTimeout(() => { if (!loadedTiles) report({ kind: "tiles", sourceId: "protomaps" }); }, 8000);
        } });
        instance.on("error", report);
        instance.on("webglcontextlost", () => report({ kind: "webgl" }));
        instance.getCanvas().setAttribute("aria-label", "Карта Москвы: стрелки перемещают карту, плюс и минус меняют масштаб");
      } catch (error) { if (alive) report({ error, kind: classifyMapError(error, { phase, loadedTiles }).kind }); }
    }
    const layout = () => {
      if (!alive || !container.current) return;
      const { width, height } = container.current.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      if (!started) { started = true; void start(); }
      else if (instance) { setSettled(false); instance.resize(); }
    };
    const resize = new ResizeObserver(layout);
    if (container.current) resize.observe(container.current);
    layout();
    return () => { alive = false; abort.abort(); clearTimeout(timeout); clearTimeout(tileTimeout); resize.disconnect(); window.removeEventListener("gb-map-return", saveCamera); window.removeEventListener("pagehide", saveCamera);
      if (instance) { const center = instance.getCenter(); try { sessionStorage.setItem("gb-games-map-camera", JSON.stringify({ lng: center.lng, lat: center.lat, zoom: instance.getZoom() })); } catch { /* Optional storage. */ } }
      markers.current.forEach(entry => entry.marker.remove()); markers.current.clear(); instance?.remove(); map.current = null; };
  }, [attempt]);
  useEffect(() => {
    if (!ready || !map.current) return;
    reconcileVenueMarkers(markers.current, venues, {
      create: venue => {
        const button = document.createElement("button"); button.type = "button";
        const activation = markerActivation();
        button.addEventListener("pointerdown", event => activation.start(event.clientX, event.clientY));
        button.addEventListener("pointermove", event => activation.move(event.clientX, event.clientY));
        button.addEventListener("pointercancel", () => activation.cancel());
        button.addEventListener("click", event => {
          if (!activation.allow(event.detail) || map.current?.isMoving()) return;
          const current = callbacks.current;
          window.dispatchEvent(new Event("gb-map-return"));
          try { sessionStorage.setItem("gb-games-map-returning", "venue"); sessionStorage.setItem("gb-games-map-selected", venue.id); } catch { /* Optional storage. */ }
          current.onSelect(venuesRef.current.find(item => item.id === venue.id) ?? venue);
        });
        const marker = new maplibregl.Marker({ element: button }).setLngLat([venue.longitude!, venue.latitude!]).addTo(map.current!);
        return { marker, button };
      },
      update: (entry, venue) => {
        const presentation = venueMarkerPresentation(venue, counts);
        entry.button.className = `maplibregl-marker ${presentation.className}`;
        entry.button.replaceChildren();
        if (presentation.text) entry.button.textContent = presentation.text;
        else {
          const glyph = shuttlecockElement();
          glyph.setAttribute("class", "gb-venue-court-glyph");
          glyph.setAttribute("aria-hidden", "true");
          entry.button.append(glyph);
        }
        entry.button.setAttribute("aria-pressed", String((selectedVenueId ?? sessionStorageVenue()) === venue.id));
        entry.button.setAttribute("aria-label", presentation.label);
        entry.marker.setLngLat([venue.longitude!, venue.latitude!]);
      },
      remove: entry => entry.marker.remove(),
    });
  }, [ready, venues, counts, selectedVenueId]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const separate = () => {
      const own = instance.getContainer().querySelector<HTMLElement>(".g2-own-marker");
      const ownPoint = own ? instance.project([Number(own.dataset.longitude), Number(own.dataset.latitude)]) : null;
      const points = [...markers.current].map(([id, entry]) => ({ id, ...instance.project(entry.marker.getLngLat()) }));
      for (const offset of separateMarkerPoints(points)) {
        const entry = markers.current.get(offset.id)!;
        const point = instance.project(entry.marker.getLngLat());
        const dx = ownPoint ? point.x + offset.x - ownPoint.x : 0;
        const dy = ownPoint ? point.y + offset.y - ownPoint.y : 0;
        const distance = Math.hypot(dx, dy);
        // Bound venue-to-venue offsets first, then preserve the existing 64px
        // own-marker clearance, including when that offset moves a venue inward.
        const ownOffset = ownPoint && distance < 64 ? 64 - distance : 0;
        const x = offset.x + ownOffset * (distance ? dx / distance : 1);
        const y = offset.y + ownOffset * (distance ? dy / distance : 0);
        entry.marker.setOffset([x, y]);
      }
    };
    separate(); instance.on("moveend", separate); instance.on("zoomend", separate); window.addEventListener("gb-map-own-marker", separate);
    return () => { instance.off("moveend", separate); instance.off("zoomend", separate); window.removeEventListener("gb-map-own-marker", separate); };
  }, [ready, venues, counts]);
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
