"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { listAllCityVenues } from "../../../lib/api-client";
import type { UnifiedRow } from "@gobadminton/contracts";
import { MOSCOW_BUNDLE, allowedMapResource } from "../../../lib/radar-map-assets";
import { radarNeighborhood } from "../../../lib/radar-camera";
import { useRadarSession } from "./RadarSessionProvider";
import { initialsFromName } from "../../../lib/player-presentation";
import type { UnifiedDirectoryController } from "../../../lib/unified-directory";
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GeographicRadarMap({ controller, rows, selected, onSelect, onUnavailable }: { controller: UnifiedDirectoryController; rows: UnifiedRow[]; selected: string | null; onSelect: (row: UnifiedRow) => void; onUnavailable: () => void }) {
  const { view: session } = useRadarSession();
  const center = session.phase === "active" && session.confirmedOn && session.status?.state === "active" ? session.status.coarseCenter : undefined;
  const centerLatitude = center?.latitude, centerLongitude = center?.longitude;
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  const markers = useRef<Array<{ marker: maplibregl.Marker; button: HTMLButtonElement; id: string }>>([]);
  const callbacks = useRef({ onSelect, onUnavailable }); callbacks.current = { onSelect, onUnavailable };
  const [venueCount, setVenueCount] = useState<number | null>(null);
  const [venuesFailed, setVenuesFailed] = useState(false);
  const [ready, setReady] = useState(false); const [status, setStatus] = useState("Загружаем карту города…");
  useEffect(() => {
    let alive = true; const abort = new AbortController(); let instance: LibreMap | undefined;
    const timeout = setTimeout(() => { if (alive && !instance?.loaded()) callbacks.current.onUnavailable(); }, 20000);
    async function start() {
      try {
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
        instance = new maplibregl.Map({ container: container.current, style, center: controller.camera?.center ?? MOSCOW_BUNDLE.center, zoom: controller.camera?.zoom ?? 10.5, maxBounds: MOSCOW_BUNDLE.bounds, maxZoom: 16, attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false,
          transformRequest: url => { if (!allowedMapResource(url)) throw new Error("Unapproved map resource"); return { url, credentials: "same-origin" }; },
        });
        instance.touchZoomRotate.disableRotation(); map.current = instance;
        instance.on("load", () => { if (alive) { setReady(true); setStatus(""); clearTimeout(timeout); } });
        instance.on("error", () => { if (alive) callbacks.current.onUnavailable(); });
        instance.on("moveend", () => { if (instance) { const center = instance.getCenter(); controller.camera = { center: [center.lng, center.lat], zoom: instance.getZoom() }; } });
        instance.getCanvas().setAttribute("aria-label", "Карта Москвы: стрелки перемещают карту, плюс и минус меняют масштаб");
      } catch { if (alive) callbacks.current.onUnavailable(); }
    }
    void start();
    const resize = new ResizeObserver(() => instance?.resize()); if (container.current) resize.observe(container.current);
    return () => { alive = false; abort.abort(); clearTimeout(timeout); resize.disconnect(); markers.current.forEach(m => m.marker.remove()); markers.current = []; instance?.remove(); map.current = null; };
  }, [controller]);
  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach(m => m.marker.remove()); markers.current = [];
    for (const row of rows) {
      const geo = row.radar?.geo;
      if (!geo || geo.crs !== "EPSG:4326" || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || geo.longitude < 36 || geo.longitude > 39.5 || geo.latitude < 54.5 || geo.latitude > 56.5) { callbacks.current.onUnavailable(); return; }
      const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-marker";
      button.textContent = initialsFromName(row.player.displayName); button.setAttribute("aria-label", `Показать игрока: ${row.player.displayName}`); button.setAttribute("aria-pressed", String(row.publicPlayerId === selected));
      button.addEventListener("click", () => callbacks.current.onSelect(row));
      const marker = new maplibregl.Marker({ element: button, anchor: "center" }).setLngLat([geo.longitude, geo.latitude]).addTo(map.current);
      markers.current.push({ marker, button, id: row.publicPlayerId });
    }
    // Selection focus survives subsequent tick renders; source rows change only on a new window.
  }, [rows, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    let alive = true; const venueMarkers: maplibregl.Marker[] = [];
    void listAllCityVenues(MOSCOW_BUNDLE.cityId).then(result => {
      if (!alive || !map.current) return;
      if (!result.ok) { setVenuesFailed(true); return; }
      for (const venue of result.data) {
        const { latitude: lat, longitude: lon } = venue;
        if (venue.cityId !== MOSCOW_BUNDLE.cityId || typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || lon < 36 || lon > 39.5 || lat < 54.5 || lat > 56.5) continue;
        const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-venue-marker"; button.textContent = "⌂"; button.setAttribute("aria-label", `Площадка: ${venue.name}`);
        const content = document.createElement("div"); const title = document.createElement("strong"); title.textContent = venue.name; const address = document.createElement("p"); address.textContent = venue.address; content.append(title, address);
        const marker = new maplibregl.Marker({ element: button }).setLngLat([lon, lat]).setPopup(new maplibregl.Popup().setDOMContent(content)).addTo(map.current);
        venueMarkers.push(marker);
      }
      setVenueCount(venueMarkers.length);
    }).catch(() => { if (alive) setVenuesFailed(true); });
    return () => { alive = false; venueMarkers.forEach(marker => marker.remove()); };
  }, [ready]);
  useEffect(() => { for (const marker of markers.current) marker.button.setAttribute("aria-pressed", String(marker.id === selected)); }, [selected]);
  const fit = useCallback(() => {
    if (!map.current) return;
    const bounds = radarNeighborhood(centerLatitude === undefined || centerLongitude === undefined ? undefined : { latitude: centerLatitude, longitude: centerLongitude });
    if (!bounds) {
      map.current.easeTo({ center: MOSCOW_BUNDLE.center, zoom: 10.5, duration: 0 }); return;
    }
    // Only the server-published coarse center; never the acquired browser fix.
    map.current.fitBounds(bounds, { padding: 48, duration: 0 });
  }, [centerLatitude, centerLongitude]);
  useEffect(() => { if (ready && centerLatitude !== undefined && centerLongitude !== undefined) fit(); }, [ready, fit, centerLatitude, centerLongitude]);
  return <><div ref={container} className="g2-map-canvas" data-map-ready={ready} />{status && <p className="g2-map-loading" role="status">{status}</p>}<p className="g2-map-venues" role="status">{venuesFailed ? "Площадки не удалось загрузить" : venueCount === null ? "Загружаем площадки…" : `Площадки на карте: ${venueCount}`}</p><div className="g2-map-camera" aria-label="Управление картой"><button aria-label="Увеличить карту" onClick={() => map.current?.zoomIn()}>+</button><button aria-label="Уменьшить карту" onClick={() => map.current?.zoomOut()}>−</button><button aria-label="Показать район Radar около 10 км" onClick={fit}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg></button></div></>;
}
