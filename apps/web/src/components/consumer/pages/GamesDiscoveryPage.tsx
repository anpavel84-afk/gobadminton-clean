"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supportedLocation } from "../../../lib/discovery-city";
import { getMe, listGames } from "../../../lib/api-client";
import type { ActivityKind, GamePage } from "../../../lib/consumer-types";
import { useDiscoveryCity, DiscoveryCityNotice } from "../discovery/DiscoveryCityProvider";
import { cityDate, discoveryCityHeading, discoveryDateLabel, futureDiscoveryBounds, futureDiscoveryItems, nextCalendarDay } from "../../../lib/discovery-presentation";
import { AuthChooser } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { CreateBanner, DiscoveryHero, DiscoveryIcon, DiscoverySidebar, DiscoverySkeleton } from "../discovery/DiscoveryComposition";
import { DiscoveryGameCard } from "../discovery/DiscoveryGameCard";

import { GamesViewAction } from "../games/GamesViewAction";
import { FullscreenMap } from "../games/GamesMapViewport";
import { GamesMapView } from "../games/GamesMapView";

type LoadState = "loading" | "ready" | "filtered" | "empty" | "error" | "stale";
type Feed = GamePage & { key: string; state: LoadState };

export function GamesDiscoveryPage() {
  const router = useRouter();
  const [view, setView] = useState<"list" | "map">("list");
  const [authOpen, setAuthOpen] = useState(false);
  const { location: resolvedLocation } = useDiscoveryCity();
  const [urlCity, setUrlCity] = useState<string | null>(null);
  const location = useMemo(() => supportedLocation(urlCity) ?? resolvedLocation, [urlCity, resolvedLocation]);
  const [selectedDay, setSelectedDay] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivityKind>("all");
  const [contextReady, setContextReady] = useState(false);
  const listScroll = useRef(0);
  const restoreListScroll = useRef(true);
  useEffect(() => {
    const readContext = () => {
    const query = new URLSearchParams(window.location.search);
    setView(query.get("view") === "map" ? "map" : "list");
    setUrlCity(query.get("cityId"));
    const day = query.get("day");
    setSelectedDay(day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "");
    const activity = query.get("activity");
    setActivityFilter(activity === "regular" || activity === "trainer_led" ? activity : "all");
    setContextReady(true);
    };
    readContext();
    window.addEventListener("popstate", readContext);
    return () => window.removeEventListener("popstate", readContext);
  }, []);
  useEffect(() => {
    if (!contextReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("day", selectedDay);
    url.searchParams.set("activity", activityFilter);
    if (location) url.searchParams.set("cityId", location.cityId);
    window.history.replaceState(window.history.state, "", url);
  }, [view, selectedDay, activityFilter, contextReady, location]);

  function changeView(next: "list" | "map") {
    if (next === "map") {
      listScroll.current = window.scrollY;
      try { sessionStorage.setItem(`gb-games-list-scroll:${key}`, String(window.scrollY)); } catch { /* Optional storage. */ }
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.pushState(window.history.state, "", url);
    setView(next);
  }


  const [now, setNow] = useState(() => Date.now());
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState<Feed>({ key: "", state: "loading", items: [], nextCursor: null });
  const cache = useRef(new Map<string, GamePage>());
  const loadedPages = useRef(new Map<string, number>());
  const generation = useRef(0);
  const createLock = useRef(false);
  const pagingLock = useRef(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState(false);
  const key = JSON.stringify([location?.cityId, location?.timezone, selectedDay, activityFilter]);
  useEffect(() => {
    if (!contextReady || view !== "list") return;
    const saveListScroll = () => {
      // Do not replace the saved position while the returning list is settling.
      if (restoreListScroll.current) return;
      listScroll.current = window.scrollY;
      try { sessionStorage.setItem(`gb-games-list-scroll:${key}`, String(window.scrollY)); } catch { /* Optional storage. */ }
    };
    // Keep the outgoing list position even when Forward opens the map without
    // going through changeView. popstate runs before React hides the list.
    window.addEventListener("scroll", saveListScroll, { passive: true });
    window.addEventListener("popstate", saveListScroll);
    return () => {
      window.removeEventListener("scroll", saveListScroll);
      window.removeEventListener("popstate", saveListScroll);
    };
  }, [contextReady, view, key]);
  useEffect(() => {
    if (view === "map") { restoreListScroll.current = true; return; }
    if (contextReady && restoreListScroll.current && feed.key === key && (feed.state === "ready" || feed.state === "filtered" || feed.state === "empty" || feed.state === "stale")) {
      let saved = listScroll.current;
      try { saved = Number(sessionStorage.getItem(`gb-games-list-scroll:${key}`) ?? saved); } catch { /* Optional storage. */ }
      const frame = requestAnimationFrame(() => {
        window.scrollTo(0, Number.isFinite(saved) ? saved : 0);
        restoreListScroll.current = false;
        document.querySelector<HTMLButtonElement>(".gb-games-view-action button, .gb-discovery-sidebar .gb-map-entry")?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [view, contextReady, key, feed.key, feed.state]);
  const activeKey = useRef(key);
  activeKey.current = key;
  const items = feed.key === key ? futureDiscoveryItems(feed.items, Math.max(now, Date.now())) : [];
  const baseState = feed.key === key ? feed.state : "loading";
  const state = (baseState === "ready" || baseState === "filtered") && !items.length ? "empty" : baseState;
  const today = location ? cityDate(new Date(now), location.timezone) : "";
  const dates = useMemo(() => today ? Array.from({ length: 7 }, (_, i) => nextCalendarDay(today, i)) : [], [today]);
  const filterActive = activityFilter !== "all";

  const previousCity = useRef(location?.cityId);
  useEffect(() => {
    if (!urlCity && previousCity.current && previousCity.current !== location?.cityId) setSelectedDay("");
    previousCity.current = location?.cityId;
  }, [location?.cityId, urlCity]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const foreground = () => { if (document.visibilityState === "visible") { tick(); setRefresh(n => n + 1); } };
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => { clearInterval(timer); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, []);

  useEffect(() => {
    if (today && selectedDay && selectedDay < today) setSelectedDay(today);
  }, [today, selectedDay]);

  useEffect(() => {
    if (!contextReady || !location) return;
    const request = ++generation.current;
    let cancelled = false;
    pagingLock.current = false;
    setPaging(false);
    setPageError(false);
    setFeed({ key, state: "loading", items: [], nextCursor: null });
    void (async () => {
      // Persist only pagination depth, never game data or cursors. A full venue
      // navigation destroys React memory; replay fresh public pages before
      // restoring scroll so it cannot clamp against just the first page.
      let depth = loadedPages.current.get(key) ?? 1;
      try {
        const stored = Number(sessionStorage.getItem(`gb-games-list-pages:${key}`));
        if (Number.isSafeInteger(stored) && stored > 0) depth = stored;
      } catch { /* Optional storage; in-document navigation retains the ref. */ }
      const bounds = futureDiscoveryBounds(selectedDay, location.timezone);
      let page: GamePage = { items: [], nextCursor: null };
      let fetched = 0;
      do {
        const result = await listGames({ cityId: location.cityId, ...bounds, activityKind: activityFilter === "all" ? undefined : activityFilter, cursor: page.nextCursor ?? undefined, limit: 50 });
        if (cancelled || request !== generation.current) return;
        if (!result.ok) {
          const saved = cache.current.get(key);
          setFeed(saved ? { ...saved, items: futureDiscoveryItems(saved.items), key, state: "stale" } : { key, state: "error", items: [], nextCursor: null });
          return;
        }
        page = { items: futureDiscoveryItems([...new Map([...page.items, ...result.data.items].map(game => [game.id, game])).values()]), nextCursor: result.data.nextCursor };
        fetched += 1;
      } while (fetched < depth && page.nextCursor);
      loadedPages.current.set(key, fetched);
      try { sessionStorage.setItem(`gb-games-list-pages:${key}`, String(fetched)); } catch { /* Optional storage. */ }
      cache.current.set(key, page);
      setFeed({ ...page, key, state: page.items.length ? (activityFilter === "all" ? "ready" : "filtered") : "empty" });
    })();
    return () => { cancelled = true; };
  }, [contextReady, location, selectedDay, activityFilter, key, refresh]);

  async function loadMore() {
    if (!location || !feed.nextCursor || pagingLock.current || state === "stale") return;
    const request = generation.current;
    const requestKey = key;
    pagingLock.current = true;
    setPaging(true); setPageError(false);
    const result = await listGames({ cityId: location.cityId, ...futureDiscoveryBounds(selectedDay, location.timezone), activityKind: activityFilter === "all" ? undefined : activityFilter, cursor: feed.nextCursor, limit: 50 });
    if (request !== generation.current || requestKey !== activeKey.current) return;
    pagingLock.current = false; setPaging(false);
    if (!result.ok) { setPageError(true); return; }
    const items = futureDiscoveryItems([...new Map([...feed.items, ...result.data.items].map(game => [game.id, game])).values()]);
    const page = { items, nextCursor: result.data.nextCursor };
    const depth = (loadedPages.current.get(key) ?? 1) + 1;
    loadedPages.current.set(key, depth);
    try { sessionStorage.setItem(`gb-games-list-pages:${key}`, String(depth)); } catch { /* Optional storage. */ }
    cache.current.set(key, page);
    setFeed({ ...page, key, state: items.length ? (filterActive ? "filtered" : "ready") : "empty" });
  }

  async function goCreate() {
    if (createLock.current) return;
    createLock.current = true; setCreating(true); setCreateError(false);
    try {
      const me = await getMe();
      if (me.ok) { router.push("/games/create"); return; }
      if (me.status !== 401) { setCreateError(true); return; }
      setAuthOpen(true);
    } finally { createLock.current = false; setCreating(false); }
  }

  if (!location) return <ConsumerShell active="games" title="Игры"><div className="gb-discovery-state" role="status"><h2>Загружаем игры</h2><p>Готовим список ближайших игр…</p></div></ConsumerShell>;

  const showCards = state === "ready" || state === "filtered" || state === "stale";
  if (view === "map") return <FullscreenMap onBack={() => changeView("list")}><GamesMapView cityId={location.cityId} day={selectedDay} activity={activityFilter} /></FullscreenMap>;
  return <ConsumerShell active="games" title="Игры" hideHeading>
    <div className="gb-discovery" data-surface="games-discovery" data-view={view}>
      {view === "list" && <DiscoveryHero city={location.nameRu} />}<DiscoveryCityNotice />
      <section className="gb-discovery-search" aria-label="Поиск игр">
        <button type="button" className="gb-discovery-selector" onClick={() => router.push("/location")} aria-label={`Где играем: ${location.nameRu}. Сменить город`}>
          <span className="gb-discovery-selector__icon"><DiscoveryIcon name="pin" /></span>
          <span><small>Где играем</small><strong>{location.nameRu}</strong></span><span className="gb-discovery-selector__chevron" aria-hidden="true">⌄</span>
        </button>
        <label className="gb-discovery-selector">
          <span className="gb-discovery-selector__icon"><DiscoveryIcon name="calendar" /></span>
          <span className="gb-discovery-date"><small>Когда</small><select aria-label="Когда играем" value={selectedDay} onChange={event => setSelectedDay(event.target.value)}><option value="">Все ближайшие</option>{dates.map(day => <option key={day} value={day}>{discoveryDateLabel(day)}</option>)}</select></span>
        </label>
        {view === "list" && <CreateBanner busy={creating} onClick={() => void goCreate()} />}
      </section>
      {createError && <div className="gb-discovery-notice" role="alert">Не удалось проверить вход. Попробуйте создать игру ещё раз.</div>}
      <section className="gb-discovery-layout" hidden={view !== "list"}>
        <div className="gb-discovery-feed">
          <div className="gb-discovery-filters">
            <div className="gb-discovery-chips" role="group" aria-label="Фильтр активности">
              {([["all", "Все"], ["regular", "Обычные"], ["trainer_led", "С тренером"]] as const).map(([value, label]) => <button key={value} type="button" className="gb-discovery-chip" aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)}>{label}</button>)}
            </div>
            <span className="gb-discovery-sort"><DiscoveryIcon name="filter" />По времени</span>
          </div>
          <header className="gb-discovery-feed-heading">
            <div><small>Выходите на корт</small><h2>Игры {discoveryCityHeading(location.nameRu)}</h2></div>
            <div className="gb-discovery-feed-actions">{showCards && <span>Найдено: {items.length}{feed.nextCursor ? "+" : ""}</span>}<button type="button" onClick={() => setRefresh(n => n + 1)} disabled={state === "loading"} aria-label="Обновить игры">↻</button></div>
          </header>
          {state === "filtered" && <p className="gb-discovery-helper" data-state="filtered">{activityFilter === "regular" ? "Обычные игры" : "Игры с тренером"} · {selectedDay ? discoveryDateLabel(selectedDay) : "Все ближайшие"}</p>}
          {state === "loading" && <div data-state="loading" aria-busy="true"><p className="gb-discovery-helper" role="status">Ищем игры рядом…</p><DiscoverySkeleton /><DiscoverySkeleton /></div>}
          {state === "error" && <div className="gb-discovery-state" data-state="error" role="alert"><h3>Не удалось загрузить игры</h3><p>Проверьте соединение и попробуйте ещё раз.</p><Button onClick={() => setRefresh(n => n + 1)}>Попробовать снова</Button></div>}
          {state === "stale" && <div className="gb-discovery-notice" data-state="stale" role="status"><h3>Показываем сохранённый список</h3><p>Не удалось обновить игры. Дата и фильтры те же, но сведения о местах могли измениться.</p><Button variant="outline" onClick={() => setRefresh(n => n + 1)}>Обновить список</Button></div>}
          {state === "empty" && <div className="gb-discovery-state" data-state="empty"><span aria-hidden="true">↗</span><h3>{filterActive ? "По этим условиям игр пока нет" : "Пока нет игр"}</h3><p>{selectedDay ? "Выберите другую дату или вернитесь ко всем ближайшим играм." : filterActive ? "Сбросьте фильтр активности или соберите свою игру." : "Соберите своих на площадке — создайте игру."}</p>{filterActive ? <Button variant="outline" onClick={() => setActivityFilter("all")}>Сбросить фильтр</Button> : <Button loading={creating} onClick={() => void goCreate()}>Создать игру</Button>}</div>}
          {showCards && <div className="gb-discovery-cards" data-state={state}>{items.map(game => <DiscoveryGameCard key={game.id} game={game} />)}{state === "stale" && !items.length && <p className="gb-discovery-helper">В сохранённом списке игр нет.</p>}</div>}
          {pageError && <p role="alert" className="gb-discovery-notice">Не удалось загрузить остальные игры. Попробуйте ещё раз.</p>}
          {(showCards || state === "empty") && feed.nextCursor && state !== "stale" && <Button className="gb-discovery-more" variant="outline" loading={paging} onClick={() => void loadMore()}>{paging ? "Загружаем…" : "Показать ещё"}</Button>}
        </div>
        <DiscoverySidebar city={location.nameRu} onMap={() => changeView("map")} />
      </section>
      <GamesViewAction view={view} onClick={() => changeView(view === "list" ? "map" : "list")} />
    </div>
    {authOpen && <AuthChooser returnPath="/games/create" intent={{ kind: "create" }} onClose={() => setAuthOpen(false)} />}
  </ConsumerShell>;
}
