"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createAbuseReport, deleteMyBlock, getMe, getPlayer, listCities, putMyBlock } from "../../../lib/api-client";
import type { AbuseReportReasonCode, Me, PublicPlayer } from "../../../lib/consumer-types";
import { isSocialDirectoryDisabled, REPORT_REASON_OPTIONS } from "../../../lib/player-presentation";
import { ContactAction, ContactNote, useContactState } from "./ContactAction";
import { Button } from "../Button";
import { AuthEntry, ProfileDialog, ProfileState } from "./ProfileComposition";
import { PlayerProfileContent } from "./PlayerProfileContent";
import { ProfileFriendship } from "../friends/ProfileFriendship";

/**
 * Shared public-profile body for the ordinary route and Radar expanded sheet.
 * Caller supplies publicPlayerId; route params stay outside. Mount only behind
 * the Radar privacy fence when used from Radar — this component does not bypass it.
 */
export function PublicPlayerProfile({
  publicPlayerId,
  embedded = false,
  distance,
  contactActions,
  nearbyGamesAction,
  titleAs = "h1",
  className,
}: {
  publicPlayerId: string;
  embedded?: boolean;
  /** Radar-only optional metadata; omit on the ordinary public page. */
  distance?: ReactNode;
  /** Radar injects RadarContact/resultRef; ordinary page keeps ContactAction. */
  contactActions?: ReactNode;
  /** Radar internal nearby-games control; replaces the ordinary unavailable stub. */
  nearbyGamesAction?: ReactNode;
  titleAs?: "h1" | "h2";
  className?: string;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [authState, setAuthState] = useState("loading");
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const [city, setCity] = useState("");
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<AbuseReportReasonCode>("harassment");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let live = true, authLive = true;
    setState("loading"); setPlayer(null); setCity(""); setReportOpen(false); setMe(null); setAuthState("loading");
    void getMe().then(r => { if (live && authLive) { setMe(r.ok ? r.data : null); setAuthState(r.ok ? "ready" : r.status === 401 ? "guest" : "error"); } });
    void getPlayer(publicPlayerId).then(async r => {
      if (!live) return;
      if (!r.ok) { setState(isSocialDirectoryDisabled(r) || r.status === 404 ? "unavailable" : "error"); return; }
      setPlayer(r.data); setState("ready");
      const cities = await listCities();
      if (live && cities.ok) setCity(cities.data.items.find(c => c.id === r.data.cityId)?.nameRu ?? "");
    });
    const expired = () => { authLive = false; setMe(null); setAuthState("guest"); setReportOpen(false); };
    const session = () => { expired(); setReload(n => n + 1); };
    window.addEventListener("gb-private-expired", expired); window.addEventListener("gb-session-changed", session);
    return () => { live = false; window.removeEventListener("gb-private-expired", expired); window.removeEventListener("gb-session-changed", session); };
  }, [publicPlayerId, reload]);

  useEffect(() => { setBlocked(false); setNotice(""); setUncertain(false); }, [publicPlayerId]);

  async function toggleBlock() {
    if (!me || busy || uncertain) return;
    setBusy(true); setNotice("");
    const r = blocked ? await deleteMyBlock(publicPlayerId, me.csrfToken) : await putMyBlock(publicPlayerId, me.csrfToken);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) { setMe(null); setAuthState("guest"); }
      if (r.status === 0 || r.status >= 500) { setUncertain(true); setPlayer(null); setState("unavailable"); setNotice("Не удалось подтвердить результат. Обновите профиль перед следующими действиями."); }
      else setNotice("Не удалось изменить блокировку. Попробуйте позже.");
      return;
    }
    setBlocked(r.data.blocked); setPlayer(null); setReportOpen(false);
    setState("unavailable"); setNotice(r.data.blocked ? "Игрок заблокирован." : "Блокировка снята.");
    if (!r.data.blocked) setReload(n => n + 1);
  }

  async function submitReport() {
    if (!me || busy || uncertain) return;
    setBusy(true); setNotice("");
    const r = await createAbuseReport({ targetKind: "player", targetPublicPlayerId: publicPlayerId, reasonCode, detail: detail.trim() || null }, me.csrfToken);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) { setMe(null); setAuthState("guest"); setReportOpen(false); }
      if (r.status === 0 || r.status >= 500) { setUncertain(true); setNotice("Не удалось подтвердить отправку жалобы. Она могла быть получена. Не отправляйте её повторно."); }
      else setNotice("Не удалось отправить жалобу. Попробуйте позже.");
      return;
    }
    setReportOpen(false); setDetail(""); setNotice("Жалоба отправлена.");
  }

  const useDefaultContact = contactActions === undefined;
  // Skip ordinary contact subscription when Radar injects RadarContact/resultRef.
  const contact = useContactState(useDefaultContact ? me : null, useDefaultContact ? authState : "guest", publicPlayerId);
  const variant = player?.trainer ? "trainer" : player?.lookingForGame ? "looking" : "ordinary";
  const rootClass = ["fr3", "player-profile-page", embedded ? "is-embedded" : "", className].filter(Boolean).join(" ");

  return <div className={rootClass} data-surface="public-player" data-variant={variant} data-embedded={embedded ? "true" : undefined}>
    {state === "loading" && <ProfileState title="Загружаем профиль…" state="loading" />}
    {state === "error" && <ProfileState title="Не удалось загрузить профиль" state="error" retry={() => setReload(n => n + 1)}>Проверьте соединение и попробуйте снова.</ProfileState>}
    {state === "unavailable" && <ProfileState title="Профиль недоступен">{blocked ? "Вы заблокировали этого игрока." : "Сейчас этот профиль нельзя открыть."}</ProfileState>}
    {notice && !reportOpen && <p className="profile-notice" role="status">{notice}</p>}
    {blocked && <Button variant="outline" disabled={busy || uncertain} data-action={blocked ? "unblock" : "block"} onClick={() => void toggleBlock()}>Снять блокировку</Button>}
    {uncertain && !reportOpen && <Button variant="outline" onClick={() => { setUncertain(false); setReload(n => n + 1); }}>Обновить профиль</Button>}
    {state === "ready" && player && <>
      <PlayerProfileContent
        player={player}
        city={city}
        distance={distance}
        titleAs={titleAs}
        actions={useDefaultContact
          ? <ContactAction key={`${me?.id}:${me?.csrfToken}:${publicPlayerId}`} retryAuth={() => setReload(n => n + 1)} result={contact} auth={authState} peer={publicPlayerId} canInvite={player.canRequestContact === true} />
          : contactActions}
        note={useDefaultContact ? <ContactNote result={contact} /> : null}
      />
      {me && <ProfileFriendship key={`${me.id}:${me.csrfToken}:${publicPlayerId}`} me={me} peerId={publicPlayerId} />}
      {nearbyGamesAction !== undefined
        ? nearbyGamesAction
        : <section className="profile-upcoming-section" data-surface="pp-02-upcoming" data-state="unavailable"><header className="profile-upcoming-header"><span><small>Публичные будущие события</small><h2>Ближайшие игры</h2></span></header><p>Ближайшие игры этого игрока пока недоступны.</p></section>}
      <section className="profile-section profile-safety"><h2>Безопасность общения</h2>{authState === "guest" ? <><p>Войдите, чтобы заблокировать игрока или отправить жалобу.</p><AuthEntry returnPath={`/players/${publicPlayerId}`} /></> : authState === "error" ? <ProfileState title="Не удалось проверить вход" state="error" retry={() => setReload(n => n + 1)} /> : <div className="profile-form-actions"><Button variant="outline" disabled={!me || busy || uncertain} data-action={blocked ? "unblock" : "block"} onClick={() => void toggleBlock()}>Заблокировать</Button><Button variant="ghost" disabled={!me || busy || uncertain} onClick={() => { setNotice(""); setReportOpen(true); }}>Пожаловаться</Button></div>}</section>
    </>}
    {reportOpen && <ProfileDialog title="Пожаловаться на игрока" onClose={() => { if (!busy) setReportOpen(false); }}><form onSubmit={e => { e.preventDefault(); void submitReport(); }}><label className="profile-field">Причина<select value={reasonCode} onChange={e => setReasonCode(e.target.value as AbuseReportReasonCode)}>{REPORT_REASON_OPTIONS.map(o => <option value={o.code} key={o.code}>{o.label}</option>)}</select></label><label className="profile-field">Подробности<textarea value={detail} onChange={e => setDetail(e.target.value)} maxLength={1000} rows={4} /></label>{notice && <p role="status">{notice}</p>}<Button type="submit" disabled={busy || uncertain}>Отправить жалобу</Button></form></ProfileDialog>}
  </div>;
}
