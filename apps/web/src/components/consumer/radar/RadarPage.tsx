"use client";
import { useRouter } from "next/navigation";
import { useDirectoryFilters } from "./RadarSessionProvider";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
import { GamesMapView } from "../games/GamesMapView";
import { FullscreenMap } from "../games/GamesMapViewport";

export function RadarPage() {
  const router = useRouter();
  const { filters } = useDirectoryFilters();
  return <FullscreenMap onBack={() => router.push("/players")}><GamesMapView cityId={filters.cityId || MOSCOW_BUNDLE.cityId} day="" /></FullscreenMap>;
}
