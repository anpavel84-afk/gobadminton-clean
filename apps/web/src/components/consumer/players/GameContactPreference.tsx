"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GamePreferences } from "@gobadminton/contracts/game-types";
import type { Me } from "../../../lib/consumer-types";
import { getGamePreferences, patchGamePreferences } from "../../../lib/api-client";
import { Button } from "../Button";
import { ProfileState, SectionHeader } from "./ProfileComposition";

/** Own template, deliberately independent of social-profile contacts/visibility. */
export function GameContactPreference({ me }: { me: Me }) {
  const [preference, setPreference] = useState<GamePreferences | null>(null);
  const [contact, setContact] = useState("");
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false), epoch = useRef(0);
  const retired = useRef(false);
  const retire = useCallback(() => {
    ++epoch.current; retired.current = true; mutation.current = false;
    setPreference(null); setContact(""); setNotice(""); setBusy(false); setState("retired");
  }, []);
  useEffect(() => {
    const request = ++epoch.current;
    retired.current = false; mutation.current = false;
    setState("loading"); setPreference(null); setContact(""); setNotice(""); setBusy(false);
    window.addEventListener("gb-private-expired", retire);
    window.addEventListener("gb-session-changed", retire);
    void getGamePreferences().then(result => {
      if (request !== epoch.current) return;
      if (!result.ok) { if (result.status === 401) retire(); else setState("error"); return; }
      setPreference(result.data); setContact(result.data.defaultPublicGameContact ?? ""); setState("ready");
    });
    return () => {
      ++epoch.current; retired.current = true;
      window.removeEventListener("gb-private-expired", retire);
      window.removeEventListener("gb-session-changed", retire);
    };
  }, [reload, me.id, me.csrfToken, retire]);
  async function save(value: string | null) {
    if (retired.current || !preference || state !== "ready" || mutation.current) return;
    mutation.current = true; setBusy(true); setNotice(""); const request = epoch.current;
    try {
      const result = await patchGamePreferences({ expectedVersion: preference.version, defaultPublicGameContact: value }, me.csrfToken);
      if (request !== epoch.current) return;
      if (!result.ok) {
        if (result.status === 401) { retire(); return; }
        setNotice(result.status === 409 ? "Контакт изменился. Обновите данные перед сохранением." : result.status === 401 || result.status === 403 ? "Вход или разрешение на сохранение истекли. Проверьте вход снова." : "Не удалось подтвердить сохранение контакта. Обновите данные перед следующей попыткой.");
        setState("error"); return;
      }
      setPreference(result.data); setContact(result.data.defaultPublicGameContact ?? "");
      setNotice(result.data.defaultPublicGameContact === null ? "Сохранённый контакт удалён. Контакты в существующих играх не изменились." : "Контакт сохранён для следующих игр.");
    } finally { if (request === epoch.current) { mutation.current = false; setBusy(false); } }
  }
  if (state === "retired") return null;
  return <section className="profile-section" data-surface="game-contact-preference">
    <SectionHeader title="Контакт для игр" eyebrow="Создание игр" />
    <p>Контакт подставится при создании игры. Он станет виден на её странице после публикации. Сведения в каталоге игроков не изменятся.</p>
    {state === "loading" ? <ProfileState title="Загружаем сохранённый контакт…" state="loading" /> : state === "error" ? <ProfileState title="Проверьте сохранённый контакт" state="error" retry={() => { setBusy(false); setReload(n => n + 1); }}>{notice || "Не удалось загрузить контакт. Можно указать его при создании игры."}</ProfileState> : <form onSubmit={event => { event.preventDefault(); void save(contact.trim()); }}>
      <label className="profile-field">Сохранённый контакт для игры<input maxLength={320} value={contact} disabled={busy} onChange={event => setContact(event.target.value)} /></label>
      <div className="profile-form-actions"><Button type="submit" disabled={busy || !contact.trim() || contact.trim() === preference?.defaultPublicGameContact}>Сохранить контакт</Button><Button type="button" variant="outline" disabled={busy || preference?.defaultPublicGameContact == null} onClick={() => void save(null)}>Удалить сохранённый контакт</Button></div>
      {notice && <p className="profile-notice" role="status">{notice}</p>}
    </form>}
  </section>;
}
