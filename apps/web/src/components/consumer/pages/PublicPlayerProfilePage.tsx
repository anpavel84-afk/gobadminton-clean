"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createAbuseReport, deleteMyBlock, getMe, getPlayer, listCities, putMyBlock } from "../../../lib/api-client";
import type { AbuseReportReasonCode, Me, PublicPlayer } from "../../../lib/consumer-types";
import { formatSocialLevel, isSocialDirectoryDisabled, REPORT_REASON_OPTIONS } from "../../../lib/player-presentation";
import { ContactAction, ContactNote, useContactState } from "../players/ContactAction";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, Avatar, Badge, ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { ProfileFriendship } from "../friends/ProfileFriendship";
import { safeProfileReturnPath } from "../../../lib/profile-return";

export function PublicPlayerProfilePage() {
  const { publicPlayerId } = useParams<{ publicPlayerId: string }>();
  const search = useSearchParams();
  const returnPath = safeProfileReturnPath(search.get("returnTo"));
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
  const contact = useContactState(me, authState, publicPlayerId);
  const variant = player?.trainer ? "trainer" : player?.lookingForGame ? "looking" : "ordinary";
  return <ConsumerShell active="players" title="Профиль игрока" mode="local"><div className="fr3 player-profile-page" data-surface="public-player" data-variant={variant}>
    <Link className="back-link" href={returnPath}>{returnPath === "/players" ? "← Все игроки" : "← К переписке"}</Link>
    {state === "loading" && <ProfileState title="Загружаем профиль…" state="loading" />}
    {state === "error" && <ProfileState title="Не удалось загрузить профиль" state="error" retry={() => setReload(n => n + 1)}>Проверьте соединение и попробуйте снова.</ProfileState>}
    {state === "unavailable" && <ProfileState title="Профиль недоступен">{blocked ? "Вы заблокировали этого игрока." : "Сейчас этот профиль нельзя открыть."}</ProfileState>}
    {notice && !reportOpen && <p className="profile-notice" role="status">{notice}</p>}
    {blocked && <Button variant="outline" disabled={busy || uncertain} data-action={blocked ? "unblock" : "block"} onClick={() => void toggleBlock()}>Снять блокировку</Button>}
    {uncertain && !reportOpen && <Button variant="outline" onClick={() => { setUncertain(false); setReload(n => n + 1); }}>Обновить профиль</Button>}
    {state === "ready" && player && <>
      <section className="player-profile-hero"><div className="player-profile-visual"><Avatar avatar={player.avatar} name={player.displayName} tone={player.trainer ? "purple" : "yellow"} /><img src="/canonical/bb5a8.svg" alt="" /></div><div className="player-profile-copy"><div className="player-profile-status">{player.lookingForGame && <Badge>Ищу игру</Badge>}{player.trainer && <Badge trainer>Тренер</Badge>}</div><h1>{player.displayName}</h1><p className="player-profile-meta">{[formatSocialLevel(player.level), city, player.areaKey].filter(Boolean).join(" · ")}</p>{player.bio && <p className="player-profile-bio">{player.bio}</p>}<div className="player-profile-actions" data-surface="pp-actions"><ContactAction key={`${me?.id}:${me?.csrfToken}:${publicPlayerId}`} retryAuth={() => setReload(n => n + 1)} result={contact} auth={authState} peer={publicPlayerId} canInvite={player.canRequestContact === true} /></div></div></section>
      {me && <ProfileFriendship key={`${me.id}:${me.csrfToken}:${publicPlayerId}`} me={me} peerId={publicPlayerId} />}
      <section className="player-profile-grid"><div className="guide-panel preference-card"><small>Игровой профиль</small><div><span>Уровень<strong>{formatSocialLevel(player.level)}</strong></span><span>Район<strong>{player.areaKey || "Не указан"}</strong></span></div></div><ContactNote result={contact} />{player.trainer && <div className="guide-panel trainer-profile-optional"><Badge trainer>Тренер</Badge><p>Информация заполнена пользователем</p></div>}</section>
      <section className="profile-upcoming-section" data-surface="pp-02-upcoming" data-state="unavailable"><header className="profile-upcoming-header"><span><small>Публичные будущие события</small><h2>Ближайшие игры</h2></span></header><p>Ближайшие игры этого игрока пока недоступны.</p></section>
      <section className="profile-section profile-safety"><h2>Безопасность общения</h2>{authState === "guest" ? <><p>Войдите, чтобы заблокировать игрока или отправить жалобу.</p><AuthEntry returnPath={`/players/${publicPlayerId}`} /></> : authState === "error" ? <ProfileState title="Не удалось проверить вход" state="error" retry={() => setReload(n => n + 1)} /> : <div className="profile-form-actions"><Button variant="outline" disabled={!me || busy || uncertain} data-action={blocked ? "unblock" : "block"} onClick={() => void toggleBlock()}>Заблокировать</Button><Button variant="ghost" disabled={!me || busy || uncertain} onClick={() => { setNotice(""); setReportOpen(true); }}>Пожаловаться</Button></div>}</section>
    </>}
    {reportOpen && <ProfileDialog title="Пожаловаться на игрока" onClose={() => { if (!busy) setReportOpen(false); }}><form onSubmit={e => { e.preventDefault(); void submitReport(); }}><label className="profile-field">Причина<select value={reasonCode} onChange={e => setReasonCode(e.target.value as AbuseReportReasonCode)}>{REPORT_REASON_OPTIONS.map(o => <option value={o.code} key={o.code}>{o.label}</option>)}</select></label><label className="profile-field">Подробности<textarea value={detail} onChange={e => setDetail(e.target.value)} maxLength={1000} rows={4} /></label>{notice && <p role="status">{notice}</p>}<Button type="submit" disabled={busy || uncertain}>Отправить жалобу</Button></form></ProfileDialog>}
  </div></ConsumerShell>;
}
