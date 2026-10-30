"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { apiFetch, listAllCityVenues } from "../../../lib/api-client";
import type { OwnSocialProfile } from "../../../lib/consumer-types";
import type { UnifiedRow } from "@gobadminton/contracts";
import { MOSCOW_BUNDLE, allowedMapResource } from "../../../lib/radar-map-assets";
import { createRadarEntryCamera, radarNeighborhood } from "../../../lib/radar-camera";
import { useRadarSession } from "./RadarSessionProvider";
import { shuttlecockElement } from "../NavIcon";
import { createRoot } from "react-dom/client";
import { Avatar } from "../players/ProfileComposition";
import { prewarmRadarPeerMedia } from "../players/PlayerBrowseMedia";
import type { PublicPlayer } from "../../../lib/consumer-types";
import type { UnifiedDirectoryController } from "../../../lib/unified-directory";
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GeographicRadarMap({ controller, rows, selected, onSelect, onUnavailable, sharedMap, resumeCamera = false, playersVisible = true }: { resumeCamera?: boolean; sharedMap?: LibreMap; controller: UnifiedDirectoryController; rows: UnifiedRow[]; selected: string | null; onSelect: (row: UnifiedRow) => void; onUnavailable: () => void; playersVisible?: boolean }) {
  const { view: session } = useRadarSession();
  const center = session.phase === "active" && session.confirmedOn && !session.pendingStop && session.status?.state === "active" && playersVisible ? session.status.coarseCenter : undefined;
  const centerLatitude = center?.latitude, centerLongitude = center?.longitude;
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  type PeerMarker = { marker: maplibregl.Marker; button: HTMLButtonElement; id: string; mediaKey: string; row: UnifiedRow; dispose?: () => void };
  const markers = useRef<PeerMarker[]>([]);
  const callbacks = useRef({ onSelect, onUnavailable }); callbacks.current = { onSelect, onUnavailable };
  const entryCamera = useRef(createRadarEntryCamera(resumeCamera));
  const [ownProfile, setOwnProfile] = useState<OwnSocialProfile | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setOwnProfile(null);
    if (session.me) void apiFetch<OwnSocialProfile>("/v1/me/social-profile", { signal: abort.signal }).then(result => { if (!abort.signal.aborted && result.ok) setOwnProfile(result.data); });
    return () => abort.abort();
  }, [session.me?.id]);
  const [venueCount, setVenueCount] = useState<number | null>(null);
  const [venuesFailed, setVenuesFailed] = useState(false);
  const [ready, setReady] = useState(false); const [status, setStatus] = useState("Загружаем карту города…");
  useEffect(() => {
    if (sharedMap) { map.current = sharedMap; setReady(true); setStatus(""); return () => { markers.current.forEach(m => { m.marker.remove(); m.dispose?.(); }); markers.current = []; map.current = null; }; }
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
    return () => { alive = false; abort.abort(); clearTimeout(timeout); resize.disconnect(); markers.current.forEach(m => { m.marker.remove(); m.dispose?.(); }); markers.current = []; instance?.remove(); map.current = null; };
  }, [controller, sharedMap]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (!playersVisible) {
      markers.current.forEach(m => { m.marker.remove(); m.dispose?.(); });
      markers.current = [];
      return;
    }
    const previous = markers.current;
    // Validate every peer row before any marker mutation so an invalid mid-list
    // row cannot leave a mix of old markers and a partial new set.
    type ValidPeer = { row: UnifiedRow; geo: NonNullable<NonNullable<UnifiedRow["radar"]>["geo"]>; mediaKey: string };
    const valid: ValidPeer[] = [];
    for (const row of rows) {
      if (row.publicPlayerId === ownProfile?.publicPlayerId) continue;
      const geo = row.radar?.geo;
      if (!geo || geo.crs !== "EPSG:4326" || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || geo.longitude < 36 || geo.longitude > 39.5 || geo.latitude < 54.5 || geo.latitude > 56.5) {
        previous.forEach(entry => { entry.marker.remove(); entry.dispose?.(); });
        markers.current = [];
        callbacks.current.onUnavailable();
        return;
      }
      valid.push({
        row,
        geo,
        mediaKey: `${row.player.avatar?.uploadedUrl ?? ""}|${row.player.avatar?.providerUrl ?? ""}|${row.player.displayName}`,
      });
    }
    const byId = new Map(previous.map(entry => [entry.id, entry]));
    const next: PeerMarker[] = [];
    const keep = new Set<string>();
    for (const { row, geo, mediaKey } of valid) {
      const existing = byId.get(row.publicPlayerId);
      if (existing && existing.mediaKey === mediaKey) {
        existing.row = row;
        existing.marker.setLngLat([geo.longitude, geo.latitude]);
        existing.button.setAttribute("aria-pressed", String(row.publicPlayerId === selected));
        keep.add(row.publicPlayerId);
        next.push(existing);
        continue;
      }
      if (existing) { existing.marker.remove(); existing.dispose?.(); }
      const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-marker g2-person-marker";
      const root = createRoot(button); root.render(<Avatar name={row.player.displayName} avatar={row.player.avatar} />); button.setAttribute("aria-label", `Показать игрока: ${row.player.displayName}`); button.setAttribute("aria-pressed", String(row.publicPlayerId === selected));
      const entry: PeerMarker = {
        marker: new maplibregl.Marker({ element: button, anchor: "center" }),
        button, id: row.publicPlayerId, mediaKey, dispose: () => root.unmount(), row,
      };
      button.addEventListener("click", () => { button.focus({ preventScroll: true }); callbacks.current.onSelect(entry.row); });
      // Hover/focus share the same bounded pending+retained admission as provider prewarm.
      const warm = () => prewarmRadarPeerMedia(entry.row.player as PublicPlayer, {
        resolveCover: true,
        retainIds: selected ? [selected, row.publicPlayerId] : [row.publicPlayerId],
      });
      button.addEventListener("pointerenter", warm);
      button.addEventListener("focus", warm);
      entry.marker.setLngLat([geo.longitude, geo.latitude]).addTo(map.current!);
      keep.add(row.publicPlayerId);
      next.push(entry);
    }
    for (const entry of previous) {
      if (keep.has(entry.id)) continue;
      entry.marker.remove();
      entry.dispose?.();
    }
    markers.current = next;
    // Same-key soft refresh reuses markers; only identity/media/TTL changes remount.
  }, [rows, ready, ownProfile?.publicPlayerId, playersVisible, selected]);
  useEffect(() => {
    if (sharedMap || !ready || !map.current) return;
    let alive = true; const venueMarkers: maplibregl.Marker[] = [];
    void listAllCityVenues(MOSCOW_BUNDLE.cityId).then(result => {
      if (!alive || !map.current) return;
      if (!result.ok) { setVenuesFailed(true); return; }
      for (const venue of result.data) {
        const { latitude: lat, longitude: lon } = venue;
        if (venue.cityId !== MOSCOW_BUNDLE.cityId || typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || lon < 36 || lon > 39.5 || lat < 54.5 || lat > 56.5) continue;
        const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-venue-marker"; button.append(shuttlecockElement()); button.setAttribute("aria-label", `Площадка: ${venue.name}`);
        const content = document.createElement("div"); const title = document.createElement("strong"); title.textContent = venue.name; const address = document.createElement("p"); address.textContent = venue.address; content.append(title, address);
        const marker = new maplibregl.Marker({ element: button }).setLngLat([lon, lat]).setPopup(new maplibregl.Popup().setDOMContent(content)).addTo(map.current);
        venueMarkers.push(marker);
      }
      setVenueCount(venueMarkers.length);
    }).catch(() => { if (alive) setVenuesFailed(true); });
    return () => { alive = false; venueMarkers.forEach(marker => marker.remove()); };
  }, [ready, sharedMap]);
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
  useEffect(() => {
    if (!ready || !map.current || centerLatitude === undefined || centerLongitude === undefined || !radarNeighborhood(center)) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-marker g2-person-marker g2-own-marker";
    button.setAttribute("aria-label", "Вы: опубликованная геопозиция Radar");
    button.dataset.longitude = String(centerLongitude); button.dataset.latitude = String(centerLatitude);
    const root = createRoot(button); root.render(<Avatar name={session.me?.displayName ?? "Вы"} avatar={ownProfile?.avatar} />);
    const own = new maplibregl.Marker({ element: button, anchor: "center" }).setLngLat([centerLongitude, centerLatitude]).addTo(map.current);
    window.dispatchEvent(new Event("gb-map-own-marker"));
    const initialBounds = entryCamera.current.claim(center);
    if (initialBounds) map.current.fitBounds(initialBounds, { padding: 48, duration: 0 });
    return () => { own.remove(); root.unmount(); window.dispatchEvent(new Event("gb-map-own-marker")); };
  }, [ready, centerLatitude, centerLongitude, session.me, ownProfile, fit]);
  if (sharedMap) return null;
  return <><div ref={container} className="g2-map-canvas" data-map-ready={ready} />{status && <p className="g2-map-loading" role="status">{status}</p>}<p className="g2-map-venues" role="status">{venuesFailed ? "Площадки не удалось загрузить" : venueCount === null ? "Загружаем площадки…" : `Площадки на карте: ${venueCount}`}</p><div className="g2-map-camera" aria-label="Управление картой"><button aria-label="Увеличить карту" onClick={() => map.current?.zoomIn()}>+</button><button aria-label="Уменьшить карту" onClick={() => map.current?.zoomOut()}>−</button><button aria-label="Показать район Radar около 10 км" onClick={fit}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg></button></div></>;
}
