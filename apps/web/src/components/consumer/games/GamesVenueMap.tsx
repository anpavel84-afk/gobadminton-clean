"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../../styles/radar-geographic.css";
import { venueMarkerPresentation } from "../../../lib/games-venue-map";
import { MOSCOW_BUNDLE, allowedMapResource } from "../../../lib/radar-map-assets";
import type { VenueSummary } from "../../../lib/consumer-types";
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GamesVenueMap({ venues, counts, onSelect }: { venues: VenueSummary[]; counts: Map<string, number> | null; onSelect: (venue: VenueSummary) => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  const callbacks = useRef({ onSelect }); callbacks.current = { onSelect };
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Загружаем карту города…");
  const unavailable = () => setStatus("Карта недоступна: ресурсы, Range, CSP или соединение. Площадки доступны списком ниже.");
  useEffect(() => {
    let alive = true; const abort = new AbortController(); let instance: LibreMap | undefined;
    const timeout = setTimeout(() => { if (alive && !instance?.loaded()) unavailable(); }, 20000);
    async function start() {
      try {
        if (window.location.origin !== new URL(MOSCOW_BUNDLE.prefix).origin) throw new Error("Map origin unsupported");
        const response = await fetch(MOSCOW_BUNDLE.prefix + "style-dev.json", { credentials: "omit", signal: abort.signal });
        if (!response.ok) throw new Error("style");
        const bytes = await response.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (hash !== MOSCOW_BUNDLE.styleHash) throw new Error("style identity");
        const style = JSON.parse(new TextDecoder().decode(bytes)) as StyleSpecification;
        // PMTiles fetches its archive internally: validate style URLs before installing it.
        const resources = [style.glyphs, ...(typeof style.sprite === "string" ? [style.sprite] : (style.sprite ?? []).map(sprite => sprite.url)), ...Object.values(style.sources).flatMap(source => ["url" in source ? source.url : undefined, ...("tiles" in source ? source.tiles ?? [] : [])])];
        if (resources.some(url => typeof url === "string" && !allowedMapResource(url))) throw new Error("Unapproved style resource");
        if (!alive || !container.current) return;
        installProtocol();
        instance = new maplibregl.Map({ container: container.current, style, center: MOSCOW_BUNDLE.center, zoom: 10.5, maxBounds: MOSCOW_BUNDLE.bounds, maxZoom: 16, attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false,
          transformRequest: url => { if (!allowedMapResource(url)) throw new Error("Unapproved map resource"); return { url, credentials: "same-origin" }; },
        });
        instance.touchZoomRotate.disableRotation(); map.current = instance;
        instance.on("load", () => { if (alive) { setReady(true); setStatus(""); clearTimeout(timeout); } });
        instance.on("error", () => { if (alive) unavailable(); });
        instance.getCanvas().setAttribute("aria-label", "Карта Москвы: стрелки перемещают карту, плюс и минус меняют масштаб");
      } catch { if (alive) unavailable(); }
    }
    void start();
    const resize = new ResizeObserver(() => instance?.resize()); if (container.current) resize.observe(container.current);
    return () => { alive = false; abort.abort(); clearTimeout(timeout); resize.disconnect(); instance?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const markers: maplibregl.Marker[] = [];
    for (const venue of venues) {
      const { latitude: lat, longitude: lon } = venue;
      if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || lon < 36 || lon > 39.5 || lat < 54.5 || lat > 56.5) continue;
      const marker = venueMarkerPresentation(venue, counts);
      const button = document.createElement("button"); button.type = "button";
      button.className = marker.className;
      button.textContent = marker.text;
      button.setAttribute("aria-label", marker.label);
      button.onclick = () => callbacks.current.onSelect(venue);
      markers.push(new maplibregl.Marker({ element: button }).setLngLat([lon, lat]).addTo(map.current));
    }
    return () => { markers.forEach(marker => marker.remove()); };
  }, [ready, venues, counts]);
  return <><div ref={container} style={{ height: "min(60vh, 540px)", minHeight: 300, position: "relative" }} />{status && <p role="status">{status}</p>}</>;
}
