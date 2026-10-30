"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deactivateTrainerProfile, deleteMyLookingForGame, getMe, getMySocialProfile, getTrainerProfile, listCities, logout, patchMySocialProfile, putMyLookingForGame, putMySocialProfileVisibility } from "../../../lib/api-client";
import type { ApiResult } from "../../../lib/api-client";
import type { City, Me, OwnSocialProfile, TrainerProfile } from "../../../lib/consumer-types";
import { DIRECTORY_CONSENT_POLICY_VERSION, formatSocialLevel, isSocialDirectoryDisabled, lookingIntentActive, lookingIntentExpired, PILOT_LEVEL_OPTIONS, pilotSocialLevel } from "../../../lib/player-presentation";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, Avatar, ProfileDialog, ProfileState, SectionHeader, Toggle, VisibilityRow } from "../players/ProfileComposition";
import { CoverEditor } from "../players/CoverEditor";
import { AvatarEditor } from "../players/AvatarEditor";
import { PlayerProfileHero } from "../players/PlayerProfileContent";
import { useSocialMutation } from "../messages/useSocialMutation";
import { MutationNotice } from "../messages/MessageComposition";
import { OwnUpcomingGames } from "../players/OwnUpcomingGames";

export function ProfilePage() {
  const router = useRouter();
  const coverFrame = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [social, setSocial] = useState<OwnSocialProfile | null>(null);
  const [trainer, setTrainer] = useState<TrainerProfile | null>(null);
  const [trainerError, setTrainerError] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const [state, setState] = useState("loading");
  const [socialUnavailable, setSocialUnavailable] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lookingEdit, setLookingEdit] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [cityId, setCityId] = useState("");
  const [areaKey, setAreaKey] = useState("");
  const [bio, setBio] = useState("");
  const [levelId, setLevelId] = useState("");
  const [lookingArea, setLookingArea] = useState("");
  const [ttl, setTtl] = useState(180);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  function hydrate(s: OwnSocialProfile) { setSocial(s); setDisplayName(s.displayName); setCityId(s.cityId ?? ""); setAreaKey(s.areaKey ?? ""); setBio(s.bio ?? ""); setLevelId(s.level?.levelId ?? ""); setLookingArea(s.lookingForGame?.areaKey ?? s.areaKey ?? ""); }
  const contactMutation = useSocialMutation<OwnSocialProfile>(`${me?.id ?? "guest"}:contact-preference`, me?.csrfToken ?? "", data => {
    hydrate(data); setNotice(data.contactPolicy === "requests" ? "Приём запросов включён." : "Приём запросов выключен. Принятые переписки остаются доступны.");
  }, () => { setNeedsRefresh(true); });
  function toggleContactRequests() {
    if (!me || !social || social.version < 1 || locked) return;
    setNotice("");
    contactMutation.run("/v1/me/social-profile", { expectedVersion: social.version, contactPolicy: social.contactPolicy === "requests" ? "closed" : "requests" }, "PATCH");
  }
  useEffect(() => {
    let live = true;
    setState("loading"); setSocial(null); setTrainer(null); setTrainerError(false); setSocialUnavailable(false);
    void (async () => {
      const m = await getMe(); if (!live) return;
      if (!m.ok) { setState(m.status === 401 ? "auth" : "error"); return; }
      setMe(m.data);
      const [s, t, c] = await Promise.all([getMySocialProfile(), getTrainerProfile(), listCities()]); if (!live) return;
      if (s.ok) { hydrate(s.data); window.dispatchEvent(new Event("gb-profile-changed")); }
      else if (isSocialDirectoryDisabled(s)) setSocialUnavailable(true);
      else { setState(s.status === 401 ? "auth" : "error"); return; }
      if (t.ok) setTrainer(t.data); else if (t.status !== 404) setTrainerError(true);
      if (c.ok) setCities(c.data.items);
      setNeedsRefresh(false); setState("ready");
    })();
    return () => { live = false; };
  }, [reload]);
  function failed(result: ApiResult<unknown>) {
    if (result.ok) return;
    if (result.status === 401) { setState("auth"); setEditing(false); setLookingEdit(false); }
    else if (isSocialDirectoryDisabled(result)) { setSocialUnavailable(true); setEditing(false); setLookingEdit(false); }
    else if (result.status === 0 || result.status >= 500 || result.status === 409) {
      setNeedsRefresh(true); setNotice(result.status === 409 ? "Профиль изменился. Обновите данные перед сохранением." : "Не удалось подтвердить результат. Обновите данные перед следующим действием.");
    } else setNotice("Не удалось сохранить изменения. Проверьте поля и попробуйте позже.");
  }
  async function saveProfile() {
    if (!me || !social || busy || needsRefresh) return;
    setBusy(true); setNotice("");
    const result = await patchMySocialProfile({ expectedVersion: social.version, displayName: displayName.trim(), cityId: cityId || null, areaKey: areaKey.trim() || null, bio: bio.trim() || null, level: levelId === social.level?.levelId ? social.level : levelId ? pilotSocialLevel(levelId) : null, socialEligible: true }, me.csrfToken);
    setBusy(false);
    if (!result.ok) { failed(result); return; }
    hydrate(result.data); window.dispatchEvent(new Event("gb-profile-changed")); setEditing(false); setNotice("Профиль сохранён.");
  }
  async function toggleDirectoryVisible() {
    if (!me || !social || social.version < 1 || busy || needsRefresh) return;
    const next = !social.directoryVisible;
    if (next && !social.cityId) {
      edit();
      setNotice("Сначала укажите город в игровом профиле, чтобы показывать профиль в каталоге.");
      return;
    }
    setBusy(true); setNotice("");
    const result = await putMySocialProfileVisibility({ directoryVisible: next, expectedVersion: social.version, consentPolicyVersion: next ? social.consentPolicyVersion ?? DIRECTORY_CONSENT_POLICY_VERSION : undefined }, me.csrfToken);
    setBusy(false); if (!result.ok) { failed(result); return; }
    hydrate(result.data); setNotice(next ? "Профиль видим в каталоге." : "Профиль скрыт из каталога.");
  }
  async function changeLooking(turnOff: boolean) {
    if (!me || !social || busy || needsRefresh) return;
    if (!turnOff && !social.cityId) { setNotice("Укажите город в игровом профиле, чтобы включить «Ищу игру»."); return; }
    setBusy(true); setNotice("");
    const result = turnOff ? await deleteMyLookingForGame(me.csrfToken) : await putMyLookingForGame({ cityId: social.cityId!, areaKey: lookingArea.trim() || null, ttlMinutes: ttl, expectedVersion: social.lookingForGame?.version }, me.csrfToken);
    setBusy(false); if (!result.ok) { failed(result); return; }
    setSocial({ ...social, lookingForGame: result.data }); setLookingEdit(false); setNow(new Date()); setNotice(turnOff ? "«Ищу игру» выключено." : "«Ищу игру» включено.");
  }
  async function onTrainerToggle() {
    if (!me || locked) return;
    if (!trainerActive) {
      router.push("/profile/trainer");
      return;
    }
    if (!trainer) {
      setNotice("Не удалось отключить профиль тренера: данные недоступны. Обновите страницу.");
      setNeedsRefresh(true);
      return;
    }
    setBusy(true); setNotice("");
    const result = await deactivateTrainerProfile(trainer.version, me.csrfToken);
    setBusy(false);
    if (!result.ok) {
      // Fail closed: keep showing active until a successful authoritative reread.
      setNeedsRefresh(true);
      setNotice(
        result.status === 409
          ? "Профиль тренера изменился. Обновите данные перед отключением."
          : "Не удалось отключить профиль тренера. Обновите данные и проверьте статус.",
      );
      return;
    }
    const inactive = result.data.status === "inactive";
    setTrainer(result.data.status === "active" ? result.data : null);
    // Keep "What others see" / social.trainer aligned with deactivate without full reload.
    if (inactive && social) setSocial({ ...social, trainer: false });
    setNotice(inactive ? "Профиль тренера отключён." : "Проверьте статус профиля тренера после обновления.");
    if (!inactive) setNeedsRefresh(true);
  }
  async function onLogout() {
    if (!me || logoutBusy) return;
    setLogoutBusy(true);
    setNotice("");
    const result = await logout(me.csrfToken);
    setLogoutBusy(false);
    if (!result.ok && result.status !== 401) {
      setNotice("Не удалось подтвердить выход. Проверьте соединение и попробуйте ещё раз.");
      return;
    }
    router.push("/games");
  }
  const lookingActive = lookingIntentActive(social?.lookingForGame, now);
  const lookingExpired = lookingIntentExpired(social?.lookingForGame, now);
  const trainerActive = trainer?.status === "active";
  const shown = Boolean(social?.directoryVisible && social.socialEligible);
  const city = cities.find(c => c.id === social?.cityId)?.nameRu;
  const locked = busy || needsRefresh || contactMutation.busy || contactMutation.pending;
  function edit() { if (social) hydrate(social); setEditing(true); setNotice(""); }
  const feedback = <><MutationNotice mutation={contactMutation} />{notice && <p role="status" className="profile-notice">{notice}</p>}{needsRefresh && <Button variant="outline" onClick={() => { setEditing(false); setLookingEdit(false); setReload(n => n + 1); }}>Обновить данные</Button>}</>;
  return <ConsumerShell active="profile" title="Профиль" hideHeading><div className="fr3 own-profile-page" data-surface="own-profile">
    {state === "loading" && <ProfileState title="Загружаем ваш профиль…" state="loading" />}
    {state === "error" && <ProfileState title="Не удалось загрузить профиль" state="error" retry={() => setReload(n => n + 1)}>Попробуйте снова.</ProfileState>}
    {state === "auth" && <section className="own-profile-guest"><header className="gb-page-heading"><div><h1>Мой профиль</h1><p>Войдите, чтобы заполнить профиль и находить партнёров для игры.</p></div></header><div className="own-profile-guest__panel"><ProfileState title="Войдите в аккаунт">После входа здесь появятся игровые данные и настройки аккаунта.</ProfileState><AuthEntry returnPath="/profile" /></div></section>}
    {state === "ready" && me && <>
      <header className="gb-page-heading own-profile-pagehead"><div><h1>Мой профиль</h1><p>Управляйте игровыми данными и тем, что видят другие.</p></div></header>
      <section className="own-profile-identity" data-surface="op-01" data-cover={social?.cover?.uploadedUrl ? "uploaded" : "fallback"}>
        <PlayerProfileHero
          titleAs="h2"
          visualRef={coverFrame}
          visualClassName="own-profile-avatar"
          city={city}
          player={{
            publicPlayerId: social?.publicPlayerId ?? me.id,
            displayName: social?.displayName || me.displayName,
            level: social?.level,
            trainer: Boolean(social?.trainer),
            lookingForGame: lookingActive,
            avatar: social?.avatar,
            bio: social?.bio,
            areaKey: social?.areaKey,
            cover: social?.cover,
          }}
        />
        <div className="own-profile-actionband player-profile-actionband">
          <div className="player-profile-actions" data-surface="op-actions">
            <Button variant="outline" disabled={!social || socialUnavailable || locked} onClick={edit}>Изменить профиль</Button>
            <Button href="/profile/settings" variant="ghost">Настройки</Button>
          </div>
          {social && !socialUnavailable && <CoverEditor frameRef={coverFrame} onUnauthorized={() => setState("auth")} cover={social.cover} version={social.version} csrfToken={me.csrfToken} disabled={locked} onBusy={setBusy} onReconcile={hydrate} onChange={value => setSocial(current => current && value.version >= current.version ? { ...current, ...value } : current)} />}
        </div>
      </section>
      <div className="own-profile-layout"><div className="own-profile-main">
        {socialUnavailable ? <ProfileState title="Игровой профиль сейчас недоступен">Попробуйте вернуться позже. Настройки аккаунта доступны ниже.</ProfileState> : social && <>
          <section className="profile-section" data-surface="op-02"><SectionHeader title="Игровой профиль" eyebrow="Публичные данные" action={<button disabled={locked} onClick={edit}>Изменить</button>} /><div className="profile-info-list"><div><span>Уровень</span><strong>{formatSocialLevel(social.level)}</strong></div><div><span>Город</span><strong>{city || "Не указан"}</strong></div><div><span>Район / метро</span><strong>{social.areaKey || "Не указан"}</strong></div><div><span>О себе</span><strong>{social.bio || "Не заполнено"}</strong></div></div></section>
          <section className={`own-intent-card ${lookingActive ? "is-on" : ""}`} data-surface="op-03" data-looking={lookingActive ? "on" : lookingExpired ? "expired" : "off"}><div className="own-intent-icon" aria-hidden="true"><img className="profile-icon" src="/canonical/users.svg" alt="" /></div><span><small>Игровое намерение</small><h3>Ищу игру</h3><p>{lookingActive ? [social.lookingForGame?.areaKey, social.lookingForGame?.expiresAt ? `До ${new Date(social.lookingForGame.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "Включено"].filter(Boolean).join(" · ") : lookingExpired ? "Срок поиска истёк" : "Сейчас выключено"}</p></span><div><Button variant="outline" disabled={locked} onClick={() => { setNotice(""); setLookingEdit(true); }}>Изменить</Button><Button variant={lookingActive ? "dark" : "primary"} disabled={locked} onClick={() => lookingActive ? void changeLooking(true) : setLookingEdit(true)}>{lookingActive ? "Выключить" : "Включить"}</Button></div></section>
        </>}
        <section className="own-radar-card" data-surface="op-04"><div className="own-intent-icon" aria-hidden="true">◎</div><span><small>Поиск поблизости</small><h3>Игроки рядом с вами</h3><p>Временный поиск по приблизительной близости</p></span><div><Button href="/players">Открыть Radar</Button><Link href="/players">Перейти к игрокам →</Link></div></section>
        {!socialUnavailable && social && <section className="profile-section visibility-summary visibility-summary--structured" data-surface="op-05"><SectionHeader title="Видимость профиля" eyebrow="Что увидят другие игроки" /><div className="visibility-rows"><VisibilityRow label="Имя" value={social.displayName || me.displayName} shown={shown} /><VisibilityRow label="Район" value={[city, social.areaKey].filter(Boolean).join(" · ") || "Не указан"} shown={shown && Boolean(social.cityId || social.areaKey)} /><VisibilityRow label="Уровень" value={formatSocialLevel(social.level)} shown={shown && Boolean(social.level)} /><VisibilityRow label="Игровое описание" value={social.bio ? "Заполнено" : "Не заполнено"} shown={shown && Boolean(social.bio)} /><VisibilityRow label="Тренерский профиль" value={social.trainer ? "Включён" : "Выключен"} shown={shown && social.trainer} /></div><p>Если включить видимость, эти сведения смогут видеть посетители каталога, в том числе без входа.</p><Toggle label="Показывать профиль в каталоге" on={social.directoryVisible} disabled={locked || social.version < 1} onClick={() => void toggleDirectoryVisible()} />{social.version < 1 ? <p>Сначала сохраните игровой профиль.</p> : !social.directoryVisible && !social.cityId ? <p>Чтобы показывать профиль в каталоге, сначала укажите город.</p> : null}</section>}
        {!socialUnavailable && social && <section className="profile-section"><SectionHeader title="Запросы на общение" eyebrow="Настройки сообщений" /><Toggle label="Принимать запросы на общение" helper="Другие игроки смогут отправить первое сообщение, когда ваш профиль виден в каталоге. Уже принятые переписки остаются доступны." on={social.contactPolicy === "requests"} disabled={locked || social.version < 1} onClick={toggleContactRequests} />{social.version < 1 && <p>Сначала сохраните игровой профиль.</p>}</section>}
        <section className="profile-section trainer-profile-control" data-surface="op-06"><SectionHeader title="Тренерский профиль" eyebrow="Опциональная информация игрока" />{trainerError ? <ProfileState title="Не удалось загрузить профиль тренера" state="error" retry={() => setReload(n => n + 1)} /> : <><Toggle label="Я тренер" helper={trainerActive ? "Отключает тренерский профиль. Управление созданными играми не отзывается." : "Добавляет информацию о тренировках в ваш профиль"} on={trainerActive} disabled={locked || (trainerActive && !trainer)} onClick={() => void onTrainerToggle()} />{trainerActive && trainer ? <div className="trainer-disclosure is-open"><div className="trainer-disclosure__content"><div className="trainer-disclosure__intro"><Avatar avatar={social?.avatar} name={trainer.displayName} tone="purple" /><span><small>Информация заполнена пользователем</small><h3>{trainer.displayName}</h3>{trainer.bio && <p>{trainer.bio}</p>}</span></div><div className="profile-form-actions"><Button href="/profile/trainer" variant="outline">Редактировать профиль тренера</Button><Button variant="ghost" disabled={locked} onClick={() => void onTrainerToggle()}>Отключить</Button></div></div></div> : <div className="trainer-profile-empty"><span>+</span><div><strong>Профиль тренера выключен</strong><p>Включите, чтобы добавить информацию о тренировках.</p></div></div>}</>}</section>
        <OwnUpcomingGames />
        {!editing && !lookingEdit && feedback}
      </div><aside className="account-panel" data-surface="op-08"><small>Личный аккаунт</small><h2>Аккаунт</h2><Link href="/friends">Друзья <span>→</span></Link><Link href="/profile/settings/login-methods">Способы входа <span>→</span></Link><Link href="/profile/settings/sessions">Активные сессии <span>→</span></Link><Link href="/profile/settings">Настройки <span>→</span></Link><Link href="/help">Помощь и документы <span>→</span></Link><button type="button" className="account-panel__logout" disabled={!me || logoutBusy} onClick={() => void onLogout()}>{logoutBusy ? "Выходим…" : "Выйти"}</button><button type="button" className="account-panel__danger" disabled>Удалить аккаунт <small>Пока недоступно</small></button></aside></div>
    </>}
    {editing && social && <ProfileDialog title="Игровой профиль" onClose={() => { if (!busy) setEditing(false); }}><form onSubmit={e => { e.preventDefault(); void saveProfile(); }}>{me && <AvatarEditor name={social.displayName || me.displayName} avatar={social.avatar} version={social.version} csrfToken={me.csrfToken} disabled={locked} onBusy={setBusy} onChange={value => setSocial(current => current ? { ...current, ...value } : current)} onFailure={result => { failed(result); if (!result.ok && (result.status === 0 || result.status >= 500)) setNeedsRefresh(true); }} />}<label className="profile-field">Имя<input required maxLength={80} value={displayName} onChange={e => setDisplayName(e.target.value)} /></label><label className="profile-field">Город<select value={cityId} onChange={e => setCityId(e.target.value)}><option value="">Не указан</option>{cities.map(c => <option key={c.id} value={c.id}>{c.nameRu}</option>)}</select></label><label className="profile-field">Уровень<select value={levelId} onChange={e => setLevelId(e.target.value)}><option value="">Не указан</option>{levelId && !PILOT_LEVEL_OPTIONS.some(o => o.levelId === levelId) && <option value={levelId}>{formatSocialLevel(social.level)}</option>}{PILOT_LEVEL_OPTIONS.map(o => <option key={o.levelId} value={o.levelId}>{o.label}</option>)}</select></label><label className="profile-field">Район / метро<input maxLength={64} value={areaKey} onChange={e => setAreaKey(e.target.value)} /></label><label className="profile-field">О себе<textarea maxLength={500} rows={4} value={bio} onChange={e => setBio(e.target.value)} /></label>{feedback}<Button type="submit" disabled={locked}>Сохранить</Button></form></ProfileDialog>}
    {lookingEdit && <ProfileDialog title="Ищу игру" onClose={() => { if (!busy) setLookingEdit(false); }}><form onSubmit={e => { e.preventDefault(); void changeLooking(false); }}><p>{city || "Сначала выберите город в игровом профиле."}</p><label className="profile-field">Район<input maxLength={64} value={lookingArea} onChange={e => setLookingArea(e.target.value)} /></label><label className="profile-field">Как долго искать<select value={ttl} onChange={e => setTtl(Number(e.target.value))}><option value={60}>1 час</option><option value={180}>3 часа</option></select></label>{feedback}<Button type="submit" disabled={locked || !social?.cityId}>Сохранить и включить</Button></form></ProfileDialog>}
  </div></ConsumerShell>;
}
