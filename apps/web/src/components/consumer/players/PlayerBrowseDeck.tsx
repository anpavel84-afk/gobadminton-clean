"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FriendshipReceipt, FriendshipView } from "@gobadminton/contracts/friendship-types";
import { getMe, getMySocialProfile, getPlayer } from "../../../lib/api-client";
import type { City, Me, PublicPlayer } from "../../../lib/consumer-types";
import { formatSocialLevel } from "../../../lib/player-presentation";
import {
  classifyPointerGesture,
  indexOfBrowsePlayer,
  isBrowseDragExcludedTarget,
  nextEligibleBrowseIndex,
  ordinaryBrowsePlayers,
  persistTutorialDismissed,
  popSkip,
  pushSkip,
  readBrowseHistoryState,
  readTutorialDismissed,
  withBrowseHistoryState,
} from "../../../lib/player-browse";
import { ProfileCover } from "./CoverEditor";
import { Avatar } from "./ProfileComposition";
import { Button } from "../Button";
import { PlayerBrowseFriendship, type BrowseFriendshipApi } from "./PlayerBrowseFriendship";
import "../../../styles/player-browse.css";

type Props = {
  players: PublicPlayer[];
  cities: City[];
  ordinaryScope: string;
  catalogState: string;
  moreBusy: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  placeLabel: string;
};

type DragState = {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  horizontal: boolean;
};

function Chevron({ dir }: { dir: "left" | "right" | "down" }) {
  const path = dir === "left" ? "M15 6 9 12l6 6" : dir === "down" ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6";
  return <svg className="pb-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function PlayerBrowseDeck({
  players,
  cities,
  ordinaryScope,
  catalogState,
  moreBusy,
  hasMore,
  onLoadMore,
  placeLabel,
}: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [ownPublicPlayerId, setOwnPublicPlayerId] = useState<string | null>(null);
  const [authReload, setAuthReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [skipStack, setSkipStack] = useState<string[]>([]);
  const [known, setKnown] = useState<Map<string, FriendshipView["relationship"]>>(() => new Map());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [coverById, setCoverById] = useState<Record<string, string | null>>({});
  const [friendBusy, setFriendBusy] = useState(false);
  const [rateBlockedUntil, setRateBlockedUntil] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [announce, setAnnounce] = useState("");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialMemory, setTutorialMemory] = useState(false);
  const [dragStamp, setDragStamp] = useState<{ opacity: number; skip: boolean; label: string }>({ opacity: 0, skip: false, label: "" });
  const deckRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const tutorialRef = useRef<HTMLElement>(null);
  const friendshipApi = useRef<BrowseFriendshipApi | null>(null);
  const drag = useRef<DragState | null>(null);
  const coverGen = useRef(0);
  const scopeGen = useRef(0);
  const restoredScope = useRef<string | null>(null);

  const browsePlayers = useMemo(
    () => ordinaryBrowsePlayers(players, ownPublicPlayerId),
    [players, ownPublicPlayerId],
  );
  const current = browsePlayers[index] ?? null;
  // In-flight POST locks browse navigation; UNKNOWN latch stays in per-peer pending storage without freezing the deck.
  const navigationLocked = friendBusy;

  useEffect(() => {
    let live = true;
    setAuthState("loading");
    setMe(null);
    setOwnPublicPlayerId(null);
    void (async () => {
      const meResult = await getMe();
      if (!live) return;
      if (!meResult.ok) {
        setMe(null);
        setAuthState(meResult.status === 401 ? "guest" : "error");
        return;
      }
      setMe(meResult.data);
      setAuthState("ready");
      const social = await getMySocialProfile();
      if (!live) return;
      if (social.ok && social.data.publicPlayerId) setOwnPublicPlayerId(social.data.publicPlayerId);
    })();
    const expire = () => { live = false; setMe(null); setOwnPublicPlayerId(null); setAuthState("guest"); };
    const session = () => { expire(); setAuthReload(n => n + 1); };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    return () => {
      live = false;
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
    };
  }, [authReload]);

  useEffect(() => {
    scopeGen.current += 1;
    setSkipStack([]);
    setDetailsOpen(false);
    setKnown(new Map());
    restoredScope.current = null;
    setIndex(0);
  }, [ordinaryScope]);

  useEffect(() => {
    if (restoredScope.current === ordinaryScope) return;
    const saved = readBrowseHistoryState(window.history.state, ordinaryScope);
    const savedIndex = saved ? indexOfBrowsePlayer(browsePlayers, saved.id) : -1;
    if (savedIndex >= 0) setIndex(savedIndex);
    else setIndex(0);
    restoredScope.current = ordinaryScope;
  }, [ordinaryScope, browsePlayers]);

  useEffect(() => {
    if (!browsePlayers.length) return;
    if (index >= browsePlayers.length) setIndex(Math.max(0, browsePlayers.length - 1));
  }, [browsePlayers, index]);

  useEffect(() => {
    const id = current?.publicPlayerId;
    if (!id) return;
    window.history.replaceState(
      withBrowseHistoryState(window.history.state, { id, scope: ordinaryScope }),
      "",
      window.location.href,
    );
  }, [current?.publicPlayerId, ordinaryScope]);

  useEffect(() => {
    setDetailsOpen(false);
    setFriendBusy(false);
    setDragStamp({ opacity: 0, skip: false, label: "" });
    if (cardRef.current) {
      cardRef.current.style.transform = "";
      cardRef.current.classList.remove("is-dragging");
    }
  }, [current?.publicPlayerId]);

  useEffect(() => {
    const dismissed = readTutorialDismissed(
      typeof sessionStorage !== "undefined" ? sessionStorage : null,
      tutorialMemory,
    );
    const blank = catalogState === "loading" || catalogState === "empty" || catalogState === "error" || catalogState === "unavailable" || !browsePlayers.length;
    if (!dismissed && !blank) setTutorialOpen(true);
  }, [catalogState, browsePlayers.length, tutorialMemory]);

  useEffect(() => {
    if (!current) return;
    if (coverById[current.publicPlayerId] !== undefined) return;
    if (current.cover?.uploadedUrl) {
      setCoverById(prev => ({ ...prev, [current.publicPlayerId]: current.cover?.uploadedUrl ?? null }));
      return;
    }
    const gen = ++coverGen.current;
    const peer = current.publicPlayerId;
    const scope = scopeGen.current;
    const auth = authState;
    void getPlayer(peer).then(result => {
      if (coverGen.current !== gen || scopeGen.current !== scope || authState !== auth) return;
      if (!result.ok) {
        setCoverById(prev => (prev[peer] !== undefined ? prev : { ...prev, [peer]: null }));
        return;
      }
      setCoverById(prev => ({ ...prev, [peer]: result.data.cover?.uploadedUrl ?? null }));
    });
  }, [current, coverById, authState]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onRateLimited = useCallback((until: number | null, _retryAfterSeconds: number | null) => {
    setRateBlockedUntil(until);
  }, []);

  useEffect(() => {
    if (rateBlockedUntil == null) return;
    const delay = rateBlockedUntil - Date.now();
    if (delay <= 0) {
      setRateBlockedUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setRateBlockedUntil(null), delay);
    return () => window.clearTimeout(timer);
  }, [rateBlockedUntil]);

  const cityName = (cityId: string | null) => cities.find(c => c.id === cityId)?.nameRu;

  const moveTo = useCallback((next: number) => {
    if (navigationLocked) return;
    if (next < 0 || next >= browsePlayers.length) return;
    setIndex(next);
    setAnnounce(`Карточка ${String(next + 1).padStart(2, "0")} из ${String(browsePlayers.length).padStart(2, "0")}`);
  }, [browsePlayers.length, navigationLocked]);

  const skipCurrent = useCallback(() => {
    if (!current || navigationLocked || tutorialOpen) return;
    setSkipStack(stack => pushSkip(stack, current.publicPlayerId));
    if (index < browsePlayers.length - 1) moveTo(index + 1);
    else if (hasMore) setAnnounce("Подборка на этой странице закончилась. Можно загрузить ещё.");
    else setAnnounce("Подборка закончилась.");
    setToast("Пропущено. Игрок не получит уведомления.");
  }, [current, navigationLocked, tutorialOpen, index, browsePlayers.length, hasMore, moveTo]);

  const undoSkip = useCallback(() => {
    if (navigationLocked || tutorialOpen) return;
    const { stack, id } = popSkip(skipStack);
    if (!id) return;
    const restored = indexOfBrowsePlayer(browsePlayers, id);
    setSkipStack(stack);
    if (restored >= 0) moveTo(restored);
  }, [navigationLocked, tutorialOpen, skipStack, browsePlayers, moveTo]);

  const requestFriendship = useCallback(() => {
    if (navigationLocked || tutorialOpen) return;
    friendshipApi.current?.request();
  }, [navigationLocked, tutorialOpen]);

  const onConfirmedRequest = useCallback((receipt: FriendshipReceipt) => {
    if (!current) return;
    const relationship = receipt.outcome === "accepted" ? "friends" : receipt.outcome === "pending" ? "outgoing_pending" : undefined;
    if (relationship) {
      setKnown(prev => {
        const next = new Map(prev);
        next.set(current.publicPlayerId, relationship);
        return next;
      });
    }
    setToast(receipt.outcome === "accepted" ? "Теперь вы друзья" : "Запрос отправлен");
    setAnnounce(receipt.outcome === "accepted" ? "Запрос принят" : "Запрос отправлен");
    const skipped = new Set(skipStack);
    const next = nextEligibleBrowseIndex(browsePlayers, index, new Map([
      ...known,
      ...(relationship ? [[current.publicPlayerId, relationship] as const] : []),
    ]), skipped);
    // Bypass navigationLocked: confirmed receipt already cleared the mutation busy latch in the child.
    if (next >= 0) {
      setIndex(next);
      setAnnounce(`Карточка ${String(next + 1).padStart(2, "0")} из ${String(browsePlayers.length).padStart(2, "0")}`);
    }
  }, [current, skipStack, browsePlayers, index, known]);

  const dismissTutorial = useCallback(() => {
    setTutorialOpen(false);
    const ok = persistTutorialDismissed(typeof sessionStorage !== "undefined" ? sessionStorage : null);
    if (!ok) setTutorialMemory(true);
    else setTutorialMemory(true);
    requestAnimationFrame(() => deckRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (tutorialOpen) requestAnimationFrame(() => tutorialRef.current?.focus({ preventScroll: true }));
  }, [tutorialOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        resetDrag();
        return;
      }
      if (event.key === "Escape" && tutorialOpen) {
        event.preventDefault();
        dismissTutorial();
        return;
      }
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || tutorialOpen) return;
      if (event.target !== deckRef.current) return;
      if (event.key === "ArrowRight") { event.preventDefault(); moveTo(index + 1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); moveTo(index - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tutorialOpen, dismissTutorial, moveTo, index]);

  function resetDrag() {
    drag.current = null;
    if (cardRef.current) {
      cardRef.current.style.transform = "";
      cardRef.current.classList.remove("is-dragging");
    }
    setDragStamp({ opacity: 0, skip: false, label: "" });
  }

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    const onDown = (event: PointerEvent) => {
      if (navigationLocked || tutorialOpen || !current) return;
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (isBrowseDragExcludedTarget(event.target)) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, horizontal: false };
      try { deck.setPointerCapture(event.pointerId); } catch { /* Optional capture. */ }
    };

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      state.dx = event.clientX - state.x;
      state.dy = event.clientY - state.y;
      const intent = classifyPointerGesture({ dx: state.dx, dy: state.dy, width: deck.clientWidth, phase: "move" });
      if (intent !== "horizontal") return;
      state.horizontal = true;
      const card = cardRef.current;
      if (card) {
        card.classList.add("is-dragging");
        card.style.transform = `translateX(${state.dx * 0.32}px) rotate(${state.dx / 30}deg)`;
      }
      const threshold = Math.max(84, Math.min(120, deck.clientWidth * 0.24));
      const skip = state.dx < 0;
      setDragStamp({
        opacity: Math.min(1, Math.abs(state.dx) / threshold),
        skip,
        label: skip ? "← Пропустить" : rateBlockedUntil && Date.now() < rateBlockedUntil ? "Запросы временно недоступны" : "Предложить дружбу →",
      });
    };

    const onUp = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      state.dx = event.clientX - state.x;
      state.dy = event.clientY - state.y;
      const horizontal = state.horizontal;
      const result = classifyPointerGesture({ dx: state.dx, dy: state.dy, width: deck.clientWidth, phase: "release" });
      resetDrag();
      try { if (deck.hasPointerCapture(event.pointerId)) deck.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
      if (!horizontal) return;
      if (result === "skip") skipCurrent();
      else if (result === "request") requestFriendship();
    };

    const onCancel = () => resetDrag();
    deck.addEventListener("pointerdown", onDown);
    deck.addEventListener("pointermove", onMove);
    deck.addEventListener("pointerup", onUp);
    deck.addEventListener("pointercancel", onCancel);
    deck.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("blur", onCancel);
    return () => {
      deck.removeEventListener("pointerdown", onDown);
      deck.removeEventListener("pointermove", onMove);
      deck.removeEventListener("pointerup", onUp);
      deck.removeEventListener("pointercancel", onCancel);
      deck.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("blur", onCancel);
    };
  }, [navigationLocked, tutorialOpen, current, rateBlockedUntil, skipCurrent, requestFriendship]);

  const blank = catalogState === "loading" || (!browsePlayers.length && (catalogState === "empty" || catalogState === "ready"));
  const showHelp = tutorialOpen && !blank && catalogState !== "error" && catalogState !== "unavailable";

  if (catalogState === "loading" && !players.length) {
    return <div className="gb-player-browse"><div className="pb-loading" role="status"><h2>Ищем игроков…</h2><p>Загружаем публичный каталог.</p></div></div>;
  }
  if (catalogState === "unavailable") {
    return <div className="gb-player-browse"><div className="pb-empty" role="status"><h2>Каталог игроков сейчас недоступен</h2><p>Попробуйте вернуться позже.</p></div></div>;
  }
  if (catalogState === "error") {
    return <div className="gb-player-browse"><div className="pb-empty" role="alert"><h2>Не удалось загрузить каталог</h2><p>Проверьте соединение и попробуйте снова.</p></div></div>;
  }
  if (!browsePlayers.length) {
    return <div className="gb-player-browse">
      <div className="pb-empty" role="status">
        <h2>Никого не нашли</h2>
        <p>Попробуйте изменить фильтры или загрузить ещё, если доступно.</p>
        {hasMore && <Button variant="outline" disabled={moreBusy} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>}
      </div>
    </div>;
  }

  const levelLabel = formatSocialLevel(current?.level);
  const meta = [levelLabel !== "не указан" ? levelLabel : null, cityName(current?.cityId ?? null), current?.areaKey].filter(Boolean).join(" · ");
  const coverUrl = current ? coverById[current.publicPlayerId] : undefined;
  const atEnd = index >= browsePlayers.length - 1;

  return <div className={`gb-player-browse${showHelp ? " is-teaching" : ""}`} data-surface="player-browse-deck">
    <div className="pb-deck-context">
      <strong className="pb-deck-context__place"><img className="profile-icon" src="/discovery/pin.svg" alt="" />{placeLabel}</strong>
      <div className="pb-deck-context__tools">
        <span className="pb-counter" aria-live="polite">{String(index + 1).padStart(2, "0")} / {String(browsePlayers.length).padStart(2, "0")}</span>
        <button type="button" className="pb-help" aria-label="Подсказка по жестам" onClick={() => setTutorialOpen(true)}>?</button>
      </div>
    </div>

    <div className="pb-slider-stage">
      <button type="button" className="pb-slider-nav prev" aria-label="Предыдущий игрок — только просмотр" disabled={navigationLocked || showHelp || index <= 0} onClick={() => moveTo(index - 1)}><Chevron dir="left" /></button>
      <button type="button" className="pb-slider-nav next" aria-label="Следующий игрок — только просмотр" disabled={navigationLocked || showHelp || index >= browsePlayers.length - 1} onClick={() => moveTo(index + 1)}><Chevron dir="right" /></button>

      <div
        ref={deckRef}
        id="player-browse-deck"
        className="pb-deck"
        tabIndex={0}
        role="group"
        aria-label="Игроки по одному"
        aria-describedby="player-browse-live"
        inert={showHelp ? true : undefined}
      >
        {current && <div className="pb-surface">
          <article ref={cardRef} className="pb-card" data-player-id={current.publicPlayerId}>
            <div className="pb-cover">
              <ProfileCover url={coverUrl ?? undefined} />
              <Avatar className={`avatar avatar--${current.trainer ? "purple" : "yellow"} pb-avatar`} avatar={current.avatar} name={current.displayName} tone={current.trainer ? "purple" : "yellow"} />
            </div>
            <div className="pb-copy">
              <div>
                {current.lookingForGame && <span className="pb-pill">● Ищу игру</span>}
                {current.trainer && !current.lookingForGame && <span className="pb-pill">Тренер</span>}
                <h2>{current.displayName}</h2>
                {meta && <p className="pb-meta">{meta}</p>}
                <small className="pb-level-note">Уровень — со слов игрока</small>
              </div>
              <div className="pb-excerpt">
                {current.bio ? <p className="pb-bio">{current.bio}</p> : <p className="pb-bio">О себе пока ничего не написано.</p>}
                <button type="button" className="pb-detail-toggle" aria-expanded={detailsOpen} data-browse-no-drag="" onClick={() => setDetailsOpen(v => !v)}>
                  <span>{detailsOpen ? "Скрыть подробности" : "Подробнее об игроке"}</span>
                  <Chevron dir="down" />
                </button>
              </div>
            </div>

            <div className={`pb-details${detailsOpen ? " is-open" : ""}`} data-browse-no-drag="">
              <div className="pb-details-panel">
                <h3>Подробнее</h3>
                <div className="pb-facts">
                  <div className="pb-fact"><span>Уровень</span><strong>{levelLabel}</strong><small>Самооценка игрока</small></div>
                  <div className="pb-fact"><span>Город</span><strong>{cityName(current.cityId) || "Не указан"}</strong></div>
                  <div className="pb-fact"><span>Район / метро</span><strong>{current.areaKey || "Не указан"}</strong></div>
                  <div className="pb-fact"><span>Роль</span><strong>{current.trainer ? "Тренер" : "Игрок"}</strong></div>
                </div>
                {current.bio && <div className="pb-about"><h3>О себе</h3><p>{current.bio}</p></div>}
                <div className="pb-games">
                  <h3>Ближайшие игры</h3>
                  <p>Публичные ближайшие игры этого игрока пока недоступны.</p>
                  <Link className="pb-profile-link" href={`/players/${current.publicPlayerId}`}>Открыть публичный профиль</Link>
                </div>
              </div>
            </div>

            <div className={`pb-swipe-stamp${dragStamp.skip ? " is-skip" : ""}`} aria-hidden="true" style={{ opacity: dragStamp.opacity }}>
              <span>{dragStamp.label}</span>
            </div>

            <div className="pb-controls">
              <button type="button" className="pb-undo" disabled={!skipStack.length || navigationLocked || showHelp} onClick={undoSkip}>
                ← Вернуть пропущенного
              </button>
              <div style={{ flex: 1 }} />
              {current && (
                <PlayerBrowseFriendship
                  key={`${me?.id ?? "guest"}:${current.publicPlayerId}`}
                  me={me}
                  authState={authState}
                  peerId={current.publicPlayerId}
                  returnPath={`/players?view=cards`}
                  navigationLocked={false}
                  rateBlockedUntil={rateBlockedUntil}
                  onRateLimited={onRateLimited}
                  onRelationship={(view) => {
                    if (!view) return;
                    setKnown(prev => {
                      const next = new Map(prev);
                      next.set(current.publicPlayerId, view.relationship);
                      return next;
                    });
                  }}
                  onConfirmedRequest={onConfirmedRequest}
                  onBusyChange={setFriendBusy}
                  onApi={(api) => { friendshipApi.current = api; }}
                  onSkip={skipCurrent}
                  onAuthRetry={() => setAuthReload(n => n + 1)}
                />
              )}
            </div>
          </article>
        </div>}

        {showHelp && (
          <div className="pb-tutorial-shade">
            <section ref={tutorialRef} className="pb-tutorial" role="dialog" aria-modal="false" aria-labelledby="pb-tutorial-title" tabIndex={-1}>
              <button type="button" className="pb-tutorial-close" aria-label="Закрыть подсказку" onClick={dismissTutorial}>×</button>
              <div className="pb-tutorial__eyebrow">Знакомьтесь в своём темпе</div>
              <h2 id="pb-tutorial-title">Одна карточка. Два жеста.</h2>
              <div className="pb-gesture-pair">
                <div className="pb-gesture-choice"><strong>Свайп влево</strong><span>Пропустить. Без уведомления игроку.</span></div>
                <div className="pb-gesture-choice"><strong>Свайп вправо</strong><span>Предложить дружбу явной командой.</span></div>
              </div>
              <p className="pb-tutorial-note">Стрелки ‹ › и клавиши ← → только листают карточки и не отправляют запросы.</p>
              <button type="button" className="pb-tutorial-dismiss" onClick={dismissTutorial}>Понятно</button>
            </section>
          </div>
        )}
      </div>
    </div>

    {atEnd && (
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
        {hasMore
          ? <Button variant="outline" disabled={moreBusy || navigationLocked} onClick={onLoadMore}>{moreBusy ? "Загрузка…" : "Загрузить ещё"}</Button>
          : <p className="pb-counter" role="status">Больше игроков в текущей выборке нет.</p>}
      </div>
    )}

    <div id="player-browse-live" className="pb-live" aria-live="polite">{announce}</div>
    {toast && <div className="pb-toast" role="status">{toast}</div>}
  </div>;
}
