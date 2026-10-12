"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMe, getMySocialProfile, listCities, patchMySocialProfile } from "../../../lib/api-client";
import type { City, Me, OwnSocialProfile } from "../../../lib/consumer-types";
import { profileCityReady, safeAuthReturnPath } from "../../../lib/auth-return";
import { clearAuthIntent, readSelectedLocation, writeSelectedLocation } from "../../../lib/location-context";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";

export function ProfileSetupPage() {
  const router = useRouter();
  const search = useSearchParams();
  const returnTo = safeAuthReturnPath(search.get("returnTo"));
  const [state, setState] = useState<"loading" | "auth" | "error" | "ready">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<OwnSocialProfile | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    let live = true; alive.current = true;
    setState("loading");
    void (async () => {
      const m = await getMe();
      if (!live) return;
      if (!m.ok) { setState(m.status === 401 ? "auth" : "error"); return; }
      const [p, c] = await Promise.all([getMySocialProfile(), listCities()]);
      if (!live) return;
      if (!p.ok || !c.ok) { setState((!p.ok && p.status === 401) || (!c.ok && c.status === 401) ? "auth" : "error"); return; }
      setMe(m.data); setProfile(p.data); setCities(c.data.items);
      const ownCity = c.data.items.find(city => city.id === p.data.cityId);
      if (profileCityReady(p.data) && ownCity) {
        if (!readSelectedLocation()) writeSelectedLocation({ cityId: ownCity.id, nameRu: ownCity.nameRu, timezone: ownCity.defaultTimezone });
        if (!returnTo.startsWith("/games/create")) clearAuthIntent(); router.replace(returnTo); return;
      }
      setCityId(current => c.data.items.some(city => city.id === current) ? current : readSelectedLocation()?.cityId ?? "");
      setState("ready");
    })();
    return () => { live = false; alive.current = false; };
  }, [reload, returnTo, router]);

  async function save() {
    if (!me || !profile || saving.current) return;
    const city = cities.find(c => c.id === cityId);
    if (!city) { setNotice("Выберите город."); return; }
    saving.current = true; setBusy(true); setNotice("");
    try {
      // Only city changes: existing privacy/eligibility/optional fields remain authoritative.
      const result = await patchMySocialProfile({ expectedVersion: profile.version, cityId: city.id }, me.csrfToken);
      if (!alive.current) return;
      if (!result.ok) {
        if (result.status === 401) { setState("auth"); setNotice("Вход истёк. Войдите снова, чтобы сохранить город."); return; }
        if (result.status === 0 || result.status >= 500 || result.status === 409 || result.status === 403) {
          // An uncertain write must be reread before another save; reload preserves city and URL intent.
          setNotice("Не удалось подтвердить сохранение. Повторите проверку профиля перед следующей попыткой."); setState("error"); return;
        }
        setNotice("Не удалось сохранить город. Проверьте выбор и попробуйте ещё раз."); return;
      }
      if (!profileCityReady(result.data) || result.data.cityId !== city.id) { setNotice("Город не подтверждён. Повторите проверку профиля."); setState("error"); return; }
      writeSelectedLocation({ cityId: city.id, nameRu: city.nameRu, timezone: city.defaultTimezone });
      if (!returnTo.startsWith("/games/create")) clearAuthIntent(); router.replace(returnTo);
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }

  return <ConsumerShell active="profile" title="Настройка профиля" mode="local"><div className="fr3 utility-page" data-surface="profile-setup">
    {state === "loading" && <ProfileState title="Проверяем игровой профиль…" state="loading" />}
    {state === "auth" && <section className="profile-section"><h1>Войдите, чтобы сохранить город</h1><p>После входа продолжим настройку и вернём вас к выбранному действию.</p>{notice && <p role="alert">{notice}</p>}<AuthEntry returnPath={returnTo} /></section>}
    {state === "error" && <ProfileState title="Не удалось проверить профиль" state="error" retry={() => setReload(n => n + 1)}>{notice || "Проверьте соединение и попробуйте снова."}</ProfileState>}
    {state === "ready" && <section className="profile-section"><h1>Где будете играть?</h1><p>Выберите город для игрового профиля. После сохранения продолжим выбранное действие.</p><form className="gb-game-form" onSubmit={e => { e.preventDefault(); void save(); }}><label className="gb-game-field">Город<select id="setupCity" required disabled={busy} value={cityId} onChange={e => setCityId(e.target.value)}><option value="">Выберите город</option>{cities.map(city => <option key={city.id} value={city.id}>{city.nameRu}</option>)}</select></label>{notice && <p className="gb-game-notice" role="alert">{notice}</p>}<div className="gb-game-form-actions"><Button type="submit" disabled={busy || !cityId} loading={busy}>Сохранить и продолжить</Button></div></form></section>}
  </div></ConsumerShell>;
}
