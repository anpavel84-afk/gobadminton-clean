"use client";
import { venueCreatePath } from "../../../lib/games-venue-map";

import { GamePhotoSelection } from "../games/GamePhotoSelection";
import { gameCoverRequest } from "../../../lib/game-cover-api";
import { VenueCover } from "../venues/VenueCover";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  createVenue,
  getMe,
  getMySocialProfile,
  getMyCreatedGame,
  listMyCreatedGames,
  getTrainerProfile,
  getGamePreferences,
  listAllMyParticipations,
  listAllCityVenues,
  publishGame,
} from "../../../lib/api-client";
import type {
  ActivityKind,
  CreateGameInput,
  Game,
  GameVisibility,
  Me,
  TrainerProfile,
  VenueSummary,
} from "../../../lib/consumer-types";

import {
  clearAuthIntent,
  readAuthIntent,
} from "../../../lib/location-context";
import {
  formatGameWhen,
} from "../../../lib/game-presentation";
import { useDiscoveryCity } from "../discovery/DiscoveryCityProvider";
import type { GamePreferences } from "@gobadminton/contracts/game-types";
import { AuthEntry } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { VenuePickerDialog } from "../games/VenuePickerDialog";
import { resolveSelectedVenue } from "../../../lib/venue-picker-utils";

type Step = "setup" | "load-error" | "loading" | "auth" | "activity" | "form" | "preview" | "published" | "unknown" | "conflict";

type Draft = {
  title: string;
  venueId: string;
  venueName: string;
  venueAddress: string;
  latitude: string;
  longitude: string;
  createNewVenue: boolean;
  startDate: string;
  startTime: string;
  durationMinutes: string;
  capacity: number;
  visibility: GameVisibility;
  formatKey: string;
  levelIds: string;
  hostPublicContact: string;
  venueTerms: string;
  trainingDescription: string;
  trainerFeeTerms: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  venueId: "",
  venueName: "",
  venueAddress: "",
  latitude: "",
  longitude: "",
  createNewVenue: false,
  startDate: "",
  startTime: "",
  durationMinutes: "120",
  capacity: 4,
  visibility: "public",
  formatKey: "doubles",
  levelIds: "3.0, 3.5",
  hostPublicContact: "",
  venueTerms: "Площадка и условия вне платформы",
  trainingDescription: "",
  trainerFeeTerms: "Оплата тренеру по договорённости вне платформы",
});

import { GameHero, GameTerms } from "../games/GameDetailComposition";
import { GameActionBar } from "../games/GameActionBar";
import { gameDurationMinutes, gameSchedule, gameStartIsFuture, MAX_GAME_DURATION_MINUTES } from "../../../lib/game-form";
import { cityDate, nextCalendarDay } from "../../../lib/discovery-presentation";

export function CreateGamePage() {
  const { location } = useDiscoveryCity();
  const [preferences, setPreferences] = useState<GamePreferences | null>(null);
  const [saveContact, setSaveContact] = useState(false);
  const [creatorSeat, setCreatorSeat] = useState<string | null>(null);
  const sessionEpoch = useRef(0);
  const contactEdited = useRef(false);
  const [me, setMe] = useState<Me | null>(null);
  const [trainer, setTrainer] = useState<TrainerProfile | null>(null);
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState<Step>("loading");
  const [activityKind, setActivityKind] = useState<ActivityKind>("regular");
  const [dateChoice, setDateChoice] = useState<"today" | "tomorrow" | "custom">("today");
  const [customDuration, setCustomDuration] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [knownVenues, setKnownVenues] = useState<VenueSummary[]>([]);
  const [selectedVenueCache, setSelectedVenueCache] = useState<VenueSummary | null>(null);
  const [venueStatus, setVenueStatus] = useState<"loading" | "ready" | "error">("loading");
  const [venueReload, setVenueReload] = useState(0);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const venueTriggerRef = useRef<HTMLButtonElement>(null);
  const [created, setCreated] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo,setPhoto] = useState<Blob|null>(null);
  const [photoReady,setPhotoReady] = useState(true);
  const [photoUrl,setPhotoUrl] = useState<string|undefined>();
  useEffect(()=>{
    if(!photo){setPhotoUrl(undefined);return;}
    const url=URL.createObjectURL(photo);setPhotoUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[photo]);
  const mutation = useRef(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  useEffect(() => {
    if (!location) return;
    let cancelled = false; const epoch = sessionEpoch.current;
    setStep("loading");
    void (async () => {
      const meResult = await getMe();
      if (cancelled || epoch !== sessionEpoch.current) return;
      if (!meResult.ok) { setStep(meResult.status === 401 ? "auth" : "load-error"); return; }
      setMe(meResult.data);
      const profile = await getMySocialProfile();
      if (cancelled || epoch !== sessionEpoch.current) return;
      if (!profile.ok) { setStep(profile.status === 401 ? "auth" : "load-error"); return; }
      if (!profile.data.cityId) { setStep("setup"); return; }
      setDraft(d => ({ ...d, startDate: d.startDate || cityDate(new Date(), location.timezone) }));
      const [tp, pref] = await Promise.all([getTrainerProfile(), getGamePreferences()]);
      if (cancelled || epoch !== sessionEpoch.current) return;
      if (!tp.ok && tp.status !== 404) { setStep(tp.status === 401 ? "auth" : "load-error"); return; }
      if (!pref.ok && pref.status === 401) { setStep("auth"); return; }
      setPreferences(pref.ok ? pref.data : null);
      setSaveContact(pref.ok && pref.data.defaultPublicGameContact === null);
      if (pref.ok) setDraft(d => ({ ...d, hostPublicContact: contactEdited.current ? d.hostPublicContact : pref.data.defaultPublicGameContact || "" }));
      setTrainer(tp.ok && tp.data.status === "active" ? tp.data : null);
      if (!tp.ok || tp.data.status !== "active") setActivityKind("regular");
      clearAuthIntent();
      setStep("form");

    })();
    return () => { cancelled = true; };
  }, [reload, location]);

  useEffect(() => {
    const changed = () => { ++sessionEpoch.current; contactEdited.current = false; setMe(null); setTrainer(null); setPreferences(null); setSaveContact(false); setDraft(emptyDraft()); setCreated(null); setPhoto(null); setPhotoReady(true); setCreatorSeat(null); setStep("loading"); setReload(n => n + 1); };
    window.addEventListener("gb-session-changed", changed);
    return () => { ++sessionEpoch.current; window.removeEventListener("gb-session-changed", changed); };
  }, []);

  useEffect(() => {
    if (!location) return;
    // A deliberate city change invalidates an incompatible draft venue.
    setDraft(d => ({ ...d, venueId: "", createNewVenue: false })); setSelectedVenueCache(null);
  }, [location?.cityId]);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setKnownVenues([]);
    setVenueStatus("loading");
    void listAllCityVenues(location.cityId).then(result => {
      if (cancelled) return;
      if (result.ok) {
        setKnownVenues(result.data);
        const requested = new URLSearchParams(window.location.search).get("venueId");
        const preselected = result.data.find(venue => venue.id === requested && venue.cityId === location.cityId);
        if (preselected) {
          setSelectedVenueCache(preselected);
          setDraft(d => ({ ...d, venueId: d.venueId || preselected.id, createNewVenue: false }));
        }
        setVenueStatus("ready");
      } else {
        setKnownVenues([]);
        setVenueStatus("error");
      }
    });
    return () => { cancelled = true; };
  }, [location, venueReload]);

  const previewPayload = useMemo(() => {
    if (!me || !location) return null;
    const levelIds = draft.levelIds
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const schedule = gameSchedule(`${draft.startDate}T${draft.startTime}`, draft.durationMinutes, location.timezone);
    const { startsAt = "", endsAt = "", applicationDeadlineAt = "" } = schedule ?? {};
    const settlement =
      activityKind === "regular"
        ? ({
            mode: "external",
            purpose: "no_trainer_fee",
            priceMinor: null,
            currency: null,
            terms: draft.venueTerms,
          } as const)
        : ({
            mode: "external",
            purpose: "trainer_fee",
            priceStatus: "by_agreement",
            priceMinor: null,
            currency: null,
            terms: draft.trainerFeeTerms,
          } as const);
    const input: CreateGameInput = {
      hostDisplayName: me.displayName,
      hostPublicContact: draft.hostPublicContact.trim(),
      ...(saveContact && preferences ? { savePublicContactDefault: { expectedVersion: preferences.version } } : {}),
      venueId: draft.venueId,
      title: draft.title.trim() || undefined,
      startsAt,
      endsAt,
      timezone: location.timezone,
      applicationDeadlineAt,
      capacity: draft.capacity,
      externalReservedCount: 0,
      visibility: draft.visibility,
      formatKey: draft.formatKey.trim() || "doubles",
      activityKind,
      levelRule: {
        scaleId: "ntrp",
        scaleVersion: 1,
        allowedLevelIds: levelIds.length ? levelIds : ["3.0"],
      },
      settlement,
      trainingDescription:
        activityKind === "trainer_led" ? draft.trainingDescription.trim() || null : null,
    };
    return input;
  }, [activityKind, draft, location, me, saveContact, preferences]);



  async function onCheck() {
    setError(null);
    if (saveContact && !preferences) { setError("Не удалось проверить сохранённый контакт. Обновите проверку входа."); return; }
    if (!previewPayload || !me || !location) return;
    if (!draft.startDate || !draft.startTime) {
      setError("Укажите дату и время начала.");
      return;
    }
    if (!draft.hostPublicContact.trim()) {
      setError("Укажите публичный контакт для этой игры.");
      return;
    }
    if (draft.createNewVenue) {
      if (!draft.venueName || !draft.venueAddress || !draft.latitude || !draft.longitude) {
        setError("Для новой площадки нужны название, адрес, широта и долгота.");
        return;
      }
    } else if (!draft.venueId) {
      setError(
        "Выберите площадку или добавьте новую.",
      );
      return;
    }
    if (!draft.createNewVenue && !selectedVenue) {
      setError("Не удалось подтвердить выбранную площадку. Откройте каталог и выберите её снова.");
      return;
    }
    if (!previewPayload.startsAt || !previewPayload.endsAt) {
      setError(`Проверьте дату, время и длительность: от 1 до ${MAX_GAME_DURATION_MINUTES} целых минут.`); return;
    }
    if (!gameStartIsFuture(previewPayload.startsAt)) {
      setError("Начало должно быть в будущем. Выберите другое время."); return;
    }
    if (draft.createNewVenue && (!Number.isFinite(Number(draft.latitude)) || Math.abs(Number(draft.latitude)) > 90 || !Number.isFinite(Number(draft.longitude)) || Math.abs(Number(draft.longitude)) > 180)) {
      setError("Проверьте координаты площадки."); return;
    }
    setStep("preview");
  }

  async function rereadResult(known: Game | null) {
    const epoch = sessionEpoch.current;
    setRecoveryChecked(false);
    if (known) {
      const result = await getMyCreatedGame(known.id);
      if (epoch !== sessionEpoch.current) return;
      if (result.ok && result.data) {
        setCreated(result.data);
        setRecoveryChecked(true);
        if (result.data.status === "published") { setStep("published"); setError(null); }
      }
    } else {
      const result = await listMyCreatedGames();
      if (epoch !== sessionEpoch.current) return;
      if (result.ok) setRecoveryChecked(true);
      // Without an id a title match cannot prove which request committed. Never auto-select or replay.
    }
  }

  async function onPublish() {
    if (!previewPayload || !me || !location) return;
    if (busy || !photoReady) return;
    if (!gameStartIsFuture(previewPayload.startsAt)) {
      setError("Начало уже прошло, пока вы проверяли игру. Выберите другое время."); setStep("form"); return;
    }
    if (mutation.current) return;
    const epoch = sessionEpoch.current;
    mutation.current = true; setBusy(true); setError(null);
    try {
      let venueId = draft.venueId;
      if (draft.createNewVenue) {
        const venueResult = await createVenue({ cityId: location.cityId, name: draft.venueName.trim(), address: draft.venueAddress.trim(), timezone: location.timezone, latitude: Number(draft.latitude), longitude: Number(draft.longitude) }, me.csrfToken);
        if (epoch !== sessionEpoch.current) return;
        if (!venueResult.ok) {
          if ([400, 401, 403, 422].includes(venueResult.status) || (venueResult.status === 409 && venueResult.problem?.code === "VENUE_POSSIBLE_DUPLICATE")) {
            setError(venueResult.status === 401 || venueResult.status === 403 ? "Вход или разрешение на сохранение истекли. Обновите проверку входа." : "Не удалось сохранить площадку. Проверьте данные или выберите известную площадку в городе.");
            setStep("form"); return;
          }
          setError("Не удалось подтвердить сохранение площадки. Проверьте созданные игры перед новой попыткой.");
          setStep("unknown"); await rereadResult(null); return;
        }
        venueId = venueResult.data.id;
        setDraft(value => ({ ...value, venueId, createNewVenue: false }));
      }
      if (!gameStartIsFuture(previewPayload.startsAt)) {
        setError("Начало уже прошло. Выберите другое время."); setStep("form"); return;
      }
      const createResult = await createGame({ ...previewPayload, venueId }, me.csrfToken);
      if (epoch !== sessionEpoch.current) return;
      if (!createResult.ok) {
        if ([400, 401, 403, 422].includes(createResult.status)) {
          setError(createResult.status === 401 || createResult.status === 403 ? "Вход или разрешение на сохранение истекли. Обновите проверку входа и попробуйте снова." : createResult.problem?.code === "GAME_START_NOT_FUTURE" ? "Начало уже прошло. Выберите другое время." : "Не удалось создать игру. Проверьте поля, площадку и доступность профиля тренера.");
          setStep("form"); return;
        }
        setError("Не удалось подтвердить создание игры.");
        setStep(createResult.status === 409 || createResult.status === 412 ? "conflict" : "unknown");
        await rereadResult(null); return;
      }
      setCreated(createResult.data);
      // Contact save is atomic with creation, even when publication subsequently fails.
      if (saveContact) { setSaveContact(false); const pref = await getGamePreferences(); if (epoch !== sessionEpoch.current) return; setPreferences(pref.ok ? pref.data : null); }

      if (!gameStartIsFuture(createResult.data.startsAt)) {
        setError("Начало уже прошло. Черновик сохранён, игра не опубликована."); setStep("conflict"); await rereadResult(createResult.data); return;
      }
      let publishVersion=createResult.data.version;
      if(photo){
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
        try {
          const receipt=await gameCoverRequest(createResult.data.id,"PUT",controller.signal,{version:publishVersion,csrfToken:me.csrfToken},photo);
          if(epoch!==sessionEpoch.current)return;
          publishVersion=receipt.version;
        } catch {
          if(epoch!==sessionEpoch.current)return;
          setError("Фото не сохранено или проверка не пройдена. Черновик сохранён, игра не опубликована. Повторите загрузку или удалите своё фото в сводке, затем опубликуйте черновик.");
          setStep("conflict");await rereadResult(createResult.data);return;
        } finally {clearTimeout(timer);}
      }
      const published = await publishGame(createResult.data.id, publishVersion, me.csrfToken);
      if (epoch !== sessionEpoch.current) return;
      if (!published.ok) {
        setError(published.status === 422 ? "Публикация отклонена. Проверьте время начала и доступность профиля тренера в сохранённом черновике." : "Не удалось подтвердить публикацию. Проверяем сохранённую игру.");
        setStep([400, 401, 403, 409, 412, 422].includes(published.status) ? "conflict" : "unknown");
        await rereadResult(createResult.data); return;
      }
      setCreated(published.data); setStep("published");
      const own = await listAllMyParticipations();
      if (epoch !== sessionEpoch.current) return;
      const participation = own.ok ? own.data.find(p => p.gameId === published.data.id) : null;
      setCreatorSeat(participation?.status === "confirmed" ? "Ваше участие подтверждено." : published.data.activityKind === "trainer_led" ? "Тренер не занимает место игрока." : "Проверьте своё участие в разделе «Мои игры»." );
    } finally { mutation.current = false; setBusy(false); }
  }

  const selectedVenue = resolveSelectedVenue(knownVenues, selectedVenueCache, draft.venueId, location?.cityId);
  const previewVenue = draft.createNewVenue ? {
    id: "preview", cityId: location?.cityId ?? "", name: draft.venueName, address: draft.venueAddress, timezone: location?.timezone ?? "UTC",
  } : selectedVenue;
  const previewGame: Game | null = previewPayload && previewVenue && me ? {
    ...previewPayload, title: previewPayload.title || (activityKind === "trainer_led" ? "Игра с тренером" : "Игра"), id: "preview", version: 1, status: "draft", venue: previewVenue,
    organizer: { id: null, displayName: me.displayName, publicContact: draft.hostPublicContact },
    trainer: activityKind === "trainer_led" && trainer ? { profileId: trainer.id, displayName: trainer.displayName, declarationSource: "self_declared" } : null,
    trainingDescription: previewPayload.trainingDescription ?? null, confirmedCount: 0, availablePlaces: draft.capacity,
  } : null;

  // Restore intent note only (callback must not auto-create/publish).
  useEffect(() => {
    const intent = readAuthIntent();
    if (intent?.kind === "create" && intent.activityKind) {
      setActivityKind(intent.activityKind);
    }
  }, []);

  return (
    <ConsumerShell active="games" title="Создать игру" mode="local">
      <div className="gb-game-create">
      <Button variant="ghost" className="gb-game-back" href="/games">← Все игры</Button>
      {step === "loading" && <div className="gb-game-feedback" role="status"><h1>Готовим создание игры</h1></div>}
      {step === "setup" && <div className="gb-game-feedback" data-state="setup"><h1>Укажите город, чтобы создать игру</h1><p>Сначала сохраните город в игровом профиле. Затем вы вернётесь к созданию игры и сможете проверить её перед публикацией.</p><Button href={`/profile/setup?returnTo=${encodeURIComponent(venueCreatePath(typeof window === "undefined" ? "" : window.location.search))}`}>Указать город</Button></div>}
      {step === "load-error" && <div className="gb-game-feedback" data-state="error" role="alert"><h1>Не удалось проверить профиль</h1><p>Проверьте соединение и попробуйте снова. Создание игры продолжится после проверки входа и города.</p><Button onClick={() => setReload(n => n + 1)}>Повторить проверку</Button></div>}
      {step === "auth" && <div className="gb-game-feedback" data-state="auth"><h1>Войдите, чтобы создать игру</h1><p>После входа вы сможете заполнить игру и проверить её перед публикацией.</p><AuthEntry returnPath={venueCreatePath(typeof window === "undefined" ? "" : window.location.search)} intent={{ kind: "create", activityKind }} />{error && <p role="alert">{error}</p>}</div>}
      {step === "form" && <>
        <header className="gb-create-header"><span className="gb-game-kicker">Соберите свою игру</span><h1>Создать игру</h1><p>Выберите место, время и условия. Перед публикацией вы сможете всё проверить.</p></header>
        <form className="gb-game-form" data-surface="create-form" onSubmit={event => { event.preventDefault(); void onCheck(); }}>
          <section className="gb-game-form-group" aria-labelledby="gb-create-game-section-1"><h2 id="gb-create-game-section-1" className="gb-game-form-group-title">Основное</h2><div className="gb-game-fields">
            {trainer && <div className="gb-game-field gb-game-field--wide"><span>Тип игры</span><div className="gb-game-segmented" role="group" aria-label="Тип игры"><button type="button" aria-pressed={activityKind === "regular"} onClick={() => setActivityKind("regular")}>Обычная игра</button><button type="button" aria-pressed={activityKind === "trainer_led"} onClick={() => setActivityKind("trainer_led")}>С тренером</button></div></div>}
            <label className="gb-game-field gb-game-field--wide">Название (необязательно)<input id="title" maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Например, парная игра в субботу" /></label>
          </div></section>
          <section className="gb-game-form-group" aria-labelledby="gb-create-game-section-2"><h2 id="gb-create-game-section-2" className="gb-game-form-group-title">Место и время</h2><div className="gb-game-fields">
            <label className="gb-game-field gb-game-field--wide">Площадка<select id="venueMode" value={draft.createNewVenue ? "new" : "known"} onChange={e => setDraft({ ...draft, createNewVenue: e.target.value === "new", venueId: "" })}><option value="known">Из каталога площадок</option><option value="new">Новая площадка</option></select><small>Договоритесь о корте с площадкой заранее.</small></label>
            {!draft.createNewVenue ? <div className="gb-game-field gb-game-field--wide">
              <label htmlFor="venueId">Известная площадка</label>
              <button
                ref={venueTriggerRef}
                id="venueId"
                type="button"
                className="gb-venue-picker-trigger"
                aria-haspopup="dialog"
                aria-expanded={venuePickerOpen}
                onClick={() => setVenuePickerOpen(true)}
              >
                {selectedVenue && <VenueCover className="gb-venue-cover--thumb" cover={selectedVenue.cover} name={selectedVenue.name} />}
                <span className="gb-venue-picker-trigger-copy">
                  <span className="gb-venue-picker-trigger-title">{selectedVenue?.name ?? "Выберите площадку"}</span>
                  {selectedVenue && <span className="gb-venue-picker-trigger-address">{selectedVenue.address}</span>}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              {selectedVenue && <Button variant="ghost" href={`/venues/${selectedVenue.id}`}>Открыть площадку</Button>}
              <small>{venueStatus === "loading" ? "Загружаем все площадки…" :
                venueStatus === "error" ? "Каталог временно недоступен. Откройте список, чтобы повторить загрузку." :
                knownVenues.length ? `В каталоге ${knownVenues.length} площадок. Поиск по названию и адресу.` :
                "Площадок пока нет. Вы можете добавить новую."}</small>
              {venuePickerOpen && <VenuePickerDialog
                venues={knownVenues}
                selectedId={draft.venueId}
                status={venueStatus}
                onRetry={() => setVenueReload(value => value + 1)}
                onClose={() => { setVenuePickerOpen(false); venueTriggerRef.current?.focus(); }}
                onSelect={venue => {
                  setSelectedVenueCache(venue);
                  setDraft(value => ({ ...value, venueId: venue.id }));
                  setVenuePickerOpen(false);
                  venueTriggerRef.current?.focus();
                }}
              />}
            </div> : <>
              <label className="gb-game-field gb-game-field--wide">Название площадки<input id="venueName" required value={draft.venueName} onChange={e => setDraft({ ...draft, venueName: e.target.value })} /></label>
              <label className="gb-game-field gb-game-field--wide">Адрес<input id="venueAddress" required value={draft.venueAddress} onChange={e => setDraft({ ...draft, venueAddress: e.target.value })} /></label>
              <label className="gb-game-field">Широта<input id="lat" type="number" min={-90} max={90} step="any" required value={draft.latitude} onChange={e => setDraft({ ...draft, latitude: e.target.value })} /></label>
              <label className="gb-game-field">Долгота<input id="lng" type="number" min={-180} max={180} step="any" required value={draft.longitude} onChange={e => setDraft({ ...draft, longitude: e.target.value })} /></label>
            </>}
            <div className="gb-game-field gb-game-field--wide"><span>Дата начала</span><div className="gb-discovery-chips" role="group" aria-label="Дата начала">
              {([["today", "Сегодня"], ["tomorrow", "Завтра"], ["custom", "Выбрать дату"]] as const).map(([choice, label]) => <button key={choice} className="gb-discovery-chip" type="button" aria-pressed={dateChoice === choice} onClick={() => { setDateChoice(choice); if (choice !== "custom" && location) setDraft(d => ({ ...d, startDate: nextCalendarDay(cityDate(new Date(), location.timezone), choice === "today" ? 0 : 1) })); }}>{label}</button>)}
            </div></div>
            <label className="gb-game-field">Дата<input id="startDate" type="date" required readOnly={dateChoice !== "custom"} value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
            <label className="gb-game-field">Время начала<input id="startTime" type="time" required value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })} /><small>Время выбранного города</small></label>
            <div className="gb-game-field gb-game-field--wide"><span>Длительность</span><div className="gb-discovery-chips" role="group" aria-label="Длительность">
              {([60, 120, 180] as const).map(minutes => <button key={minutes} className="gb-discovery-chip" type="button" aria-pressed={!customDuration && draft.durationMinutes === String(minutes)} onClick={() => { setCustomDuration(false); setDraft({ ...draft, durationMinutes: String(minutes) }); }}>{minutes / 60} ч</button>)}
              <button className="gb-discovery-chip" type="button" aria-pressed={customDuration} onClick={() => setCustomDuration(true)}>Своя</button>
            </div></div>
            {customDuration && <label className="gb-game-field">Длительность в минутах<input id="duration" aria-invalid={gameDurationMinutes(draft.durationMinutes) === null} type="number" min={1} max={MAX_GAME_DURATION_MINUTES} step={1} required value={draft.durationMinutes} onChange={e => setDraft({ ...draft, durationMinutes: e.target.value })} /><small>От 1 до {MAX_GAME_DURATION_MINUTES} целых минут.</small>{gameDurationMinutes(draft.durationMinutes) === null && <small role="alert">Укажите положительное целое число минут в этом диапазоне.</small>}</label>}
            <div className="gb-game-field"><span>Окончание</span><output>{previewPayload?.endsAt && location ? new Date(previewPayload.endsAt).toLocaleString("ru-RU", { timeZone: location.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Укажите начало и длительность"}</output><small>Заявки закрываются в момент начала.</small></div>
          </div></section>
          <section className="gb-game-form-group" aria-labelledby="gb-create-game-section-3"><h2 id="gb-create-game-section-3" className="gb-game-form-group-title">Для кого</h2><div className="gb-game-fields">
            <div className="gb-game-field"><label htmlFor="capacity">Количество мест</label><div className="gb-game-stepper"><button type="button" aria-label="Уменьшить количество мест" disabled={draft.capacity <= 1} onClick={() => setDraft({ ...draft, capacity: draft.capacity - 1 })}>−</button><input id="capacity" type="number" min={1} max={1000} required value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: Number(e.target.value) })} /><button type="button" aria-label="Увеличить количество мест" disabled={draft.capacity >= 1000} onClick={() => setDraft({ ...draft, capacity: draft.capacity + 1 })}>+</button></div></div>
            <label className="gb-game-field">Формат<select id="format" value={draft.formatKey} onChange={e => setDraft({ ...draft, formatKey: e.target.value })}><option value="doubles">Парная игра</option><option value="singles">Одиночная игра</option><option value="mixed">Микст</option></select></label>
            <label className="gb-game-field">Уровни игроков<input id="levels" required value={draft.levelIds} onChange={e => setDraft({ ...draft, levelIds: e.target.value })} /><small>Укажите уровни через запятую, например: 3.0, 3.5.</small></label>
            <label className="gb-game-field">Видимость<select id="visibility" value={draft.visibility} onChange={e => setDraft({ ...draft, visibility: e.target.value as GameVisibility })}><option value="public">В поиске</option><option value="unlisted">Только по ссылке</option></select></label>
          </div></section>
          <section className="gb-game-form-group" aria-labelledby="gb-create-game-section-4"><h2 id="gb-create-game-section-4" className="gb-game-form-group-title">Условия участия</h2><div className="gb-game-fields">
            <label className="gb-game-field gb-game-field--wide">Публичный контакт для этой игры<input id="contact" required maxLength={320} value={draft.hostPublicContact} onChange={e => { contactEdited.current = true; setDraft({ ...draft, hostPublicContact: e.target.value }); }} /><small>Будет виден на странице игры.</small></label>
            <label className="gb-game-field gb-game-field--wide gb-contact-save"><span><input type="checkbox" checked={saveContact} disabled={!preferences} onChange={e => setSaveContact(e.target.checked)} /> Сохранить контакт для следующих игр</span><small>{preferences ? "Контакт подставится при создании новой игры. Контакты в профиле не изменятся." : "Не удалось проверить сохранённый контакт. Можно создать игру без сохранения."}</small></label>
            {activityKind === "regular" ? <label className="gb-game-field gb-game-field--wide">Условия площадки<textarea id="venueTerms" required value={draft.venueTerms} onChange={e => setDraft({ ...draft, venueTerms: e.target.value })} /></label> : <>
              <label className="gb-game-field gb-game-field--wide">Описание тренировки<textarea id="training" maxLength={2000} value={draft.trainingDescription} onChange={e => setDraft({ ...draft, trainingDescription: e.target.value })} /></label>
              <label className="gb-game-field gb-game-field--wide">Оплата тренеру (по договорённости)<textarea id="feeTerms" required value={draft.trainerFeeTerms} onChange={e => setDraft({ ...draft, trainerFeeTerms: e.target.value })} /><small>Расчёт напрямую с тренером.</small></label>
            </>}
          </div></section>
          <GamePhotoSelection onChange={setPhoto} onReady={setPhotoReady} disabled={busy}/>
          {error && <div className="gb-game-notice" role="alert"><p>{error}</p><Button variant="outline" type="button" onClick={() => setReload(n => n + 1)}>Обновить проверку входа</Button></div>}
          <div className="gb-game-form-actions"><Button variant="outline" href="/games">Отмена</Button><Button type="submit" disabled={!photoReady}>Проверить игру</Button></div>
        </form>
      </>}
      {step === "preview" && previewGame && <div className="gb-game-preview" data-surface="create-preview">
        <header className="gb-game-preview-heading"><h2>Проверка перед публикацией</h2><p>Проверьте данные. Игра появится после нажатия «Опубликовать игру».</p></header>
        <GameHero game={previewGame} preview localPreview={photoUrl} />
        <p>{photo ? "Выбрано своё фото этой игры. Перед публикацией сервер проверит изображение." : "Будет использована текущая одобренная обложка площадки или стандартная."}</p>
        <div className="gb-game-detail-grid"><div><GameTerms game={previewGame} /><section className="gb-game-section"><h2>Кто увидит игру</h2><p>{draft.visibility === "public" ? "Игра появится в поиске" : "Только те, у кого есть ссылка"}</p></section></div>
          <aside className="gb-game-booking"><div className="gb-game-booking__terms"><strong>Готово к публикации</strong><p>{activityKind === "regular" ? "При создании обычной игры ваше участие подтверждает сервер." : "Тренер не занимает место игрока."}</p></div><GameActionBar><Button disabled={busy} loading={busy} onClick={() => void onPublish()}>{busy ? "Публикуем…" : "Опубликовать игру"}</Button><Button variant="outline" disabled={busy} onClick={() => setStep("form")}>Назад к редактированию</Button></GameActionBar></aside>
        </div>
      </div>}
      {step === "published" && created && <div className="gb-game-feedback" data-state="ready" data-result="success"><span className="gb-game-kicker">Всё готово</span><h1>Игра опубликована</h1><p>{created.title} · {formatGameWhen(created)}</p><p>Подтверждено: {created.confirmedCount} · Свободно: {created.availablePlaces} · Вместимость: {created.capacity}</p><p>{creatorSeat || "Проверяем ваше участие…"}</p><p>Вы можете открыть игру или перейти к её сводке.</p><div className="gb-game-form-actions"><Button variant="outline" href={`/games/${created.id}`}>Открыть игру</Button><Button href={`/my-games/${created.id}`}>Открыть сводку созданной игры</Button></div></div>}
      {(step === "unknown" || step === "conflict") && <div className="gb-game-feedback" data-state="error" data-result={step}>
        <h1>{step === "unknown" ? "Результат публикации неизвестен" : "Данные игры изменились"}</h1><p>{error}</p><p>Проверьте список своих игр перед повторной публикацией.</p>
        <p role="status">{recoveryChecked ? created ? (created.status === "draft" ? "Игра сохранена как черновик. Публикация не подтверждена." : "Статус игры обновлён.") : "Список обновлён. Откройте созданные игры и проверьте результат." : "Не удалось проверить результат. Обновите состояние ещё раз."}</p>
        <div className="gb-game-form-actions"><Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await rereadResult(created); } finally { setBusy(false); } }}>Проверить состояние</Button><Button href={created ? `/my-games/${created.id}` : "/my-games?tab=created"}>{created ? "Открыть сводку" : "К созданным играм"}</Button></div>
      </div>}
      </div>
    </ConsumerShell>
  );
}
