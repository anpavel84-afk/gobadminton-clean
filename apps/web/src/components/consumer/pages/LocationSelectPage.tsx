"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { listCities } from "../../../lib/api-client";
import type { City } from "../../../lib/consumer-types";
import { locationReturnPath } from "../../../lib/location-context";
import { useDiscoveryCity, DiscoveryCityNotice } from "../discovery/DiscoveryCityProvider";
import { supportedLocation } from "../../../lib/discovery-city";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { ProfileState } from "../players/ProfileComposition";

export function LocationSelectPage() {
  const router = useRouter();
  const search = useSearchParams();
  const returnPath = locationReturnPath(search.get("returnTo"));
  const [cities, setCities] = useState<City[]>([]);
  const [status, setStatus] = useState("loading");
  const [reload, setReload] = useState(0);
  const { location: previous, controller, identityReady } = useDiscoveryCity();

  useEffect(() => {
    let live = true;
    setStatus("loading");
    void listCities().then(result => {
      if (!live) return;
      if (!result.ok) { setStatus("error"); return; }
      setCities(result.data.items.filter(city => supportedLocation(city.id))); setStatus("ready");
    });
    return () => { live = false; };
  }, [reload]);

  return <ConsumerShell active="games" title="Где хотите играть?" mode="local">
    <div className="fr3 utility-page location-page">
      <Link className="back-link" href="/games">← К играм</Link>
      <h1>Где хотите играть?</h1>
      <p>Выберите город, в котором хотите играть.</p>
      <div className="location-picker"><DiscoveryCityNotice />
      {status === "loading" && <ProfileState title="Загружаем города…" state="loading" />}
      {status === "error" && <ProfileState title="Не удалось загрузить города" state="error" retry={() => setReload(n => n + 1)}>Проверьте соединение и попробуйте ещё раз.</ProfileState>}
      {status === "ready" && (cities.length ? <section className="settings-list location-city-list" aria-label="Города">{cities.map(city => <button key={city.id} type="button" disabled={!identityReady} aria-pressed={city.id === previous?.cityId} onClick={() => {
        if (controller?.choose(city.id)) router.push(returnPath);
      }}><span>{city.nameRu}</span><span aria-hidden="true">→</span></button>)}</section> : <ProfileState title="Пока нет доступных городов" state="empty">Попробуйте вернуться позже.</ProfileState>)}
      {previous && <Button className="location-city-confirm" variant="outline" disabled={!identityReady} onClick={() => { if (controller?.choose(previous.cityId)) router.push(returnPath); }}>Оставить «{previous.nameRu}»</Button>}
    </div></div>
  </ConsumerShell>;
}
