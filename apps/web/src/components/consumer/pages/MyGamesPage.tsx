"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getGame, getMe, listAllMyManagedGames, listAllMyParticipations, listMyGameResults } from "../../../lib/api-client";
import type { Game, ManagedGame, Me, MeGameResultsPage, Participation, PostgameReminder } from "../../../lib/consumer-types";
import { isTerminalParticipation, managedGameRelationLabel, participationLabel } from "../../../lib/game-presentation";
import { ownResultPendingNotice, resultsPath } from "../../../lib/game-results";
import { invitationPath, listInvitations } from "../../../lib/messaging-api";
import type { AcceptInvitationResult, GameInvitation } from "../../../lib/messaging-types";
import { invitationCopy } from "../../../lib/messaging-presentation";
import { privateViews } from "../../../lib/private-view";
import { AuthEntry } from "../players/ProfileComposition";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { OwnResultsHistoryCard, PersonalGameCard, GameStatusBadge } from "../games/GameDetailComposition";
import { GameRecommendationsSection } from "../games/GameRecommendationsSection";
import { GameReviewsHistory } from "../games/GameReviewsHistory";
import { PostgameReminderActions, usePostgameReminders } from "../games/PostgameReminders";
import { RoleReviewsHistory } from "../games/RoleReviewsHistory";
import { MutationNotice } from "../messages/MessageComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import type { SocialMutationPending } from "../messages/useSocialMutation";
import "../../../styles/postgame.css";

type Filter = "all" | "manage" | "participate" | "invites";
type LoadState = "loading" | "ready" | "error" | "unavailable";
type Source<T> = { data: T[]; state: LoadState; error?: string };
type OwnItem = MeGameResultsPage["items"][number];
type GameRead = { game: Game | null; status: number; error?: string };
type Row = { id: string; managed?: ManagedGame; parts: Participation[]; invites: GameInvitation[]; own: OwnItem[]; reminders: PostgameReminder[] };
type LoadContext = { epoch: number; generation: number; actor: Me; reads: Set<string>; queue: string[]; active: number };
const initial = <T,>(): Source<T> => ({ data: [], state: "loading" });
const filters: Filter[] = ["all", "manage", "participate", "invites"];
const labels: Record<Filter, string> = { all: "Все", manage: "Создаю и управляю", participate: "Заявки и участие", invites: "Приглашения" };

export function myGamesFilter(value: string | null, legacy: string | null): Filter {
  if (value === "all" || value === "manage" || value === "participate" || value === "invites") return value;
  return value === null && legacy === "created" ? "manage" : "all";
}

/** Relationships are facts from independent actor-owned sources, never inferred from names. */
export function myGamesBucket(row: Row, game: Game | null, now: number): "upcoming" | "draft" | "past" | "terminal" | "unknown" {
  if (row.managed && game?.status === "draft") return "draft";
  const endsAt = game?.endsAt ?? row.own.find((item) => item.endsAt)?.endsAt ?? row.reminders[0]?.endsAt;
  const ends = endsAt ? Date.parse(endsAt) : NaN;
  if (game?.status === "completed" || (Number.isFinite(ends) && ends <= now)) return "past";
  if (!Number.isFinite(ends)) return "unknown";
  const active = Boolean(row.managed) || row.parts.some((part) => !isTerminalParticipation(part.status)) || row.invites.some((invite) => invite.status === "pending" && (!invite.expiresAt || Date.parse(invite.expiresAt) > now));
  if (game?.status === "cancelled" || !active) return "terminal";
  return "upcoming";
}

/** Same Messages operation identity; a read never settles an unresolved write. */
export function MyGamesInvitation({ invitation, game, me, changed }: {
  invitation: GameInvitation; game: Game | null; me: Me; changed: () => void;
}) {
  const generation = privateViews.currentGeneration;
  const live = useRef(true);
  const fresh = () => live.current && generation === privateViews.currentGeneration;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  function validPacket(packet: SocialMutationPending) {
    if (!packet || packet.method !== "POST" || !packet.key || !packet.body || typeof packet.body !== "object") return false;
    if (!("expectedVersion" in packet.body) || !Number.isInteger(packet.body.expectedVersion)) return false;
    return packet.path === `${invitationPath(invitation.id)}/decline` ||
      (packet.path === `${invitationPath(invitation.id)}/accept` && "expectedGameVersion" in packet.body && Number.isInteger(packet.body.expectedGameVersion));
  }
  const mutation = useSocialMutation<GameInvitation | AcceptInvitationResult>(
    `${me.id}:invitation:${invitation.id}`, me.csrfToken,
    () => { if (fresh()) changed(); },
    () => { if (fresh()) changed(); }, true,
    { holdCorruptStorage: true, validatePending: validPacket, validateSuccess: (data, packet) => {
      if (!fresh() || !data || !packet) return false;
      if (packet.path.endsWith("/accept")) {
        if (!("invitation" in data) || !("participation" in data)) return false;
        const receipt = data.invitation;
        const part = data.participation;
        return receipt?.id === invitation.id && receipt.gameId === invitation.gameId && receipt.status === "accepted" && receipt.inviteePublicPlayerId === invitation.inviteePublicPlayerId &&
          part?.id === receipt.participationId && part.gameId === invitation.gameId && part.userId === me.id && part.status === "confirmed";
      }
      return "id" in data && data.id === invitation.id && data.gameId === invitation.gameId && data.status === "declined";
    } },
  );
  const now = Date.now();
  const pending = invitation.status === "pending";
  const expired = Boolean(invitation.expiresAt && Date.parse(invitation.expiresAt) <= now);
  const acceptUnavailable = !game || game.status !== "published" || game.availablePlaces < 1 || Date.parse(game.startsAt) <= now || Date.parse(game.applicationDeadlineAt) <= now || expired || mutation.code === "GAME_FULL";
  const locked = mutation.busy || mutation.pending || !fresh();
  return <div className="gb-my-game-subline" data-invitation-id={invitation.id}>
    <div><strong>{pending ? "Приглашение в игру" : invitationCopy[invitation.status][0]}</strong>
      {invitation.status === "accepted" ? <p>Актуальный статус участия указан отдельно.</p> : null}
      {pending ? <p>{!game ? "Для принятия нужны доступные свежие условия игры." : game.availablePlaces < 1 ? "Свободных мест сейчас нет." : expired ? "Срок приглашения истёк." : "Место проверим при принятии."}</p> : null}
    </div>
    {pending ? <div className="profile-form-actions">
      <Button disabled={locked || acceptUnavailable} onClick={() => {
        if (!game || locked || acceptUnavailable) return;
        mutation.run(`${invitationPath(invitation.id)}/accept`, { expectedVersion: invitation.version, expectedGameVersion: game.version });
      }}>Принять приглашение</Button>
      <Button variant="ghost" disabled={locked} onClick={() => { if (!locked) mutation.run(`${invitationPath(invitation.id)}/decline`, { expectedVersion: invitation.version }); }}>Отклонить</Button>
    </div> : null}
    <MutationNotice mutation={{ ...mutation, retry: () => { if (fresh()) mutation.retry(); } }} />
  </div>;
}

export function MyGamesPage() {
  const router = useRouter();
  const search = useSearchParams();
  const filter = myGamesFilter(search.get("filter"), search.get("tab"));
  const historyEntry = search.get("view") === "history";
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">("loading");
  const [managed, setManaged] = useState<Source<ManagedGame>>(initial);
  const [parts, setParts] = useState<Source<Participation>>(initial);
  const [invitations, setInvitations] = useState<Source<GameInvitation>>(initial);
  const [own, setOwn] = useState<Source<OwnItem>>(initial);
  const [ownCursor, setOwnCursor] = useState<string | null>(null);
  const [ownLoadingMore, setOwnLoadingMore] = useState(false);
  const [games, setGames] = useState<Record<string, GameRead>>({});
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [focusTarget, setFocusTarget] = useState<string | null>(historyEntry ? "history" : null);
  const epoch = useRef(0);
  const context = useRef<LoadContext | null>(null);
  const requests = useRef({ managed: 0, parts: 0, invites: 0, own: 0 });
  const ownRef = useRef<OwnItem[]>([]);
  const reminders = usePostgameReminders(me);
  const current = (ctx: LoadContext | null): ctx is LoadContext => Boolean(ctx && context.current === ctx && epoch.current === ctx.epoch && privateViews.currentGeneration === ctx.generation);

  function clearPrivate() {
    ++epoch.current;
    context.current = null;
    setMe(null); setManaged(initial()); setParts(initial()); setInvitations(initial()); setOwn(initial());
    ownRef.current = []; setOwnCursor(null); setOwnLoadingMore(false); setGames({}); setState("auth");
  }
  function pump(ctx: LoadContext) {
    while (current(ctx) && ctx.active < 4 && ctx.queue.length) {
      const id = ctx.queue.shift()!;
      ctx.active++;
      void getGame(id).then((result) => {
        if (!current(ctx)) return;
        if (!result.ok && result.status === 401) { clearPrivate(); return; }
        setGames((previous) => ({ ...previous, [id]: result.ok ? { game: result.data, status: result.status } : { game: null, status: result.status, error: result.error } }));
      }).finally(() => { ctx.active--; if (current(ctx)) pump(ctx); });
    }
  }
  function readGames(ids: string[]) {
    const ctx = context.current;
    if (!current(ctx)) return;
    for (const id of ids) if (!ctx.reads.has(id)) { ctx.reads.add(id); ctx.queue.push(id); }
    pump(ctx);
  }
  async function loadManaged() {
    const ctx = context.current; if (!current(ctx)) return;
    const request = ++requests.current.managed;
    setManaged(initial());
    const result = await listAllMyManagedGames();
    if (!current(ctx) || request !== requests.current.managed) return;
    if (!result.ok && result.status === 401) { clearPrivate(); return; }
    setManaged(result.ok ? { data: result.data, state: "ready" } : { data: [], state: [403, 404].includes(result.status) ? "unavailable" : "error", error: result.error });
    if (result.ok) readGames(result.data.map((game) => game.id));
  }
  async function loadParts() {
    const ctx = context.current; if (!current(ctx)) return;
    const request = ++requests.current.parts;
    setParts(initial());
    const result = await listAllMyParticipations();
    if (!current(ctx) || request !== requests.current.parts) return;
    if (!result.ok && result.status === 401) { clearPrivate(); return; }
    setParts(result.ok ? { data: result.data, state: "ready" } : { data: [], state: [403, 404].includes(result.status) ? "unavailable" : "error", error: result.error });
    if (result.ok) readGames(result.data.map((part) => part.gameId));
  }
  async function loadInvitations() {
    const ctx = context.current; if (!current(ctx)) return;
    const request = ++requests.current.invites;
    setInvitations(initial());
    let cursor: string | undefined;
    const items = new Map<string, GameInvitation>();
    const seen = new Set<string>();
    do {
      const page = await listInvitations(cursor);
      if (!current(ctx) || request !== requests.current.invites) return;
      if (!page.ok) {
        if (page.status === 401) { clearPrivate(); return; }
        setInvitations({ data: [403, 404].includes(page.status) ? [] : [...items.values()], state: [403, 404].includes(page.status) ? "unavailable" : "error", error: page.error });
        return;
      }
      for (const item of page.data.items) items.set(item.id, item);
      readGames(page.data.items.map((item) => item.gameId));
      cursor = page.data.nextCursor ?? undefined;
      setInvitations({ data: [...items.values()], state: cursor ? "loading" : "ready" });
      if (cursor && seen.has(cursor)) { setInvitations({ data: [...items.values()], state: "error", error: "Не удалось продолжить список приглашений." }); return; }
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  async function loadOwnResults(append = false) {
    const ctx = context.current; if (!current(ctx)) return;
    if (append && ownLoadingMore) return;
    const request = ++requests.current.own;
    if (append) setOwnLoadingMore(true); else { setOwn(initial()); ownRef.current = []; setOwnCursor(null); }
    const page = await listMyGameResults({ limit: 20, cursor: append ? ownCursor ?? undefined : undefined });
    if (!current(ctx) || request !== requests.current.own) return;
    setOwnLoadingMore(false);
    if (!page.ok) {
      if (page.status === 401) { clearPrivate(); return; }
      const denied = page.status === 403 || page.status === 404;
      if (denied) { ownRef.current = []; setOwnCursor(null); }
      setOwn({ data: ownRef.current, state: denied ? "unavailable" : "error", error: page.error });
      return;
    }
    const items = [...new Map([...ownRef.current, ...page.data.items].map((item) => [`${item.gameId}:${item.contextId}`, item])).values()];
    ownRef.current = items;
    setOwn({ data: items, state: "ready" }); setOwnCursor(page.data.nextCursor);
    readGames(items.map((item) => item.gameId));
  }

  useEffect(() => {
    const request = ++epoch.current;
    let live = true;
    const generation = privateViews.currentGeneration;
    const release = privateViews.retain(generation);
    context.current = null;
    setMe(null); setState("loading"); setManaged(initial()); setParts(initial()); setInvitations(initial()); setOwn(initial()); setGames({});
    ownRef.current = []; setOwnCursor(null); setOwnLoadingMore(false);
    const onExpire = () => { live = false; clearPrivate(); };
    const onSession = () => { onExpire(); setReload((n) => n + 1); };
    window.addEventListener("gb-private-expired", onExpire);
    window.addEventListener("gb-session-changed", onSession);
    void getMe().then((account) => {
      if (!live || request !== epoch.current || generation !== privateViews.currentGeneration) return;
      if (!account.ok) { setState(account.status === 401 ? "auth" : "error"); return; }
      const ctx: LoadContext = { epoch: request, generation, actor: account.data, reads: new Set(), queue: [], active: 0 };
      context.current = ctx;
      setMe(account.data); setState("ready");
      void loadManaged(); void loadParts(); void loadInvitations(); void loadOwnResults();
      // Existing results backlink points to history; restore only the saved UI filter.
      if (historyEntry && !search.get("filter") && !search.get("tab")) {
        try {
          const saved = sessionStorage.getItem(`gb-my-games-filter:${account.data.id}`);
          sessionStorage.removeItem(`gb-my-games-filter:${account.data.id}`);
          if (saved && myGamesFilter(saved, null) !== "all") router.replace(`/my-games?filter=${myGamesFilter(saved, null)}&view=history`);
        } catch { /* Optional UI context; no private data or mutation packet. */ }
      }
    });
    return () => { live = false; ++epoch.current; context.current = null; release?.(); window.removeEventListener("gb-private-expired", onExpire); window.removeEventListener("gb-session-changed", onSession); };
  }, [reload]);

  useEffect(() => { readGames(reminders.items.map((item) => item.gameId)); }, [reminders.items]);
  useEffect(() => {
    const refreshTime = () => setNow(Date.now());
    const timer = setInterval(refreshTime, 30000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", refreshTime);
    return () => { clearInterval(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", refreshTime); };
  }, []);
  useEffect(() => { if (historyEntry) setFocusTarget("history"); }, [historyEntry]);
  useEffect(() => { if (search.get("rec") === "sent") setFocusTarget("my-advice-summary"); }, [search.get("rec")]);
  useEffect(() => {
    if (!focusTarget || state !== "ready" || typeof document === "undefined") return;
    if (focusTarget.startsWith("my-game-") && !games[focusTarget.slice(8)]) return;
    const target = document.getElementById(focusTarget);
    if (target) { target.scrollIntoView({ block: "start" }); target.focus({ preventScroll: true }); setFocusTarget(null); }
  }, [focusTarget, state, filter, games, managed, parts, invitations, own]);

  const rows = useMemo(() => {
    const union = new Map<string, Row>();
    const row = (id: string) => { let item = union.get(id); if (!item) { item = { id, parts: [], invites: [], own: [], reminders: [] }; union.set(id, item); } return item; };
    for (const game of managed.data) row(game.id).managed = game;
    for (const part of parts.data) row(part.gameId).parts.push(part);
    for (const invite of invitations.data) row(invite.gameId).invites.push(invite);
    for (const item of own.data) row(item.gameId).own.push(item);
    for (const reminder of reminders.items) row(reminder.gameId).reminders.push(reminder);
    return [...union.values()];
  }, [managed.data, parts.data, invitations.data, own.data, reminders.items]);
  const ids = new Set(rows.map((row) => row.id));
  const visible = rows.filter((row) => filter === "all" || (filter === "manage" ? row.managed : filter === "participate" ? row.parts.length : row.invites.length));
  const gameFor = (row: Row) => row.managed ?? games[row.id]?.game ?? null;
  const bucket = (row: Row) => myGamesBucket(row, gameFor(row), now);
  const timeFor = (row: Row, end: boolean) => Date.parse((end ? gameFor(row)?.endsAt : gameFor(row)?.startsAt) ?? row.own.find((item) => item.endsAt)?.endsAt ?? row.reminders[0]?.endsAt ?? "") || 0;
  const upcoming = visible.filter((row) => bucket(row) === "upcoming").sort((a, b) => timeFor(a, false) - timeFor(b, false));
  const drafts = visible.filter((row) => bucket(row) === "draft");
  const past = visible.filter((row) => bucket(row) === "past").sort((a, b) => timeFor(b, true) - timeFor(a, true));
  const terminal = visible.filter((row) => bucket(row) === "terminal");
  const unknown = visible.filter((row) => bucket(row) === "unknown");
  const attention = rows.filter((row) => row.reminders.length || row.own.some(ownResultPendingNotice));
  function pathFor(next: Filter, history = historyEntry) { const params = new URLSearchParams(); if (next !== "all") params.set("filter", next); if (history) params.set("view", "history"); return `/my-games${params.size ? `?${params}` : ""}`; }
  const returnPath = pathFor(filter);
  function changed(id: string) { setFocusTarget(`my-game-${id}`); setReload((n) => n + 1); }
  function sourceNotice<T>(source: Source<T>, title: string, retry: () => void) {
    if (source.state === "ready") return null;
    return <div className="gb-my-games-source" data-state={source.state} role="status">
      <p>{source.state === "loading" ? `${title}: загружаем…` : source.state === "unavailable" ? `${title}: недоступны. Это не пустой список.` : `Не удалось загрузить: ${title.toLowerCase()}. ${source.error ?? ""}`}</p>
      {source.state !== "loading" ? <Button variant="outline" onClick={retry}>Обновить {title.toLowerCase()}</Button> : null}
    </div>;
  }
  function card(row: Row, attached: ReadonlyMap<string, ReactNode>) {
    const game = gameFor(row);
    const read = games[row.id];
    const history = bucket(row) !== "upcoming" && bucket(row) !== "draft";
    const extras = <>
      {row.invites.map((invite) => me ? <MyGamesInvitation key={`${me.id}:${invite.id}`} invitation={invite} game={read?.game ?? null} me={me} changed={() => changed(row.id)} /> : null)}
      {row.own.map((item) => <OwnResultsHistoryCard key={item.contextId} item={item} embedded />)}
      {history ? row.reminders.map((item) => <PostgameReminderActions key={item.id} item={item} busy={Boolean(reminders.busyId)} onLater={(reminder) => void reminders.onLater(reminder)} />) : null}
      {attached.get(row.id)}
    </>;
    if (game) return <PersonalGameCard key={row.id} game={game} compact cardId={`my-game-${row.id}`} owned={Boolean(row.managed)} managementRelation={row.managed ? managedGameRelationLabel(row.managed.management) : null}
      ownStatuses={row.parts.map((part) => part.status)} returnPath={pathFor(filter, history)}>{extras}</PersonalGameCard>;
    return <article key={row.id} id={`my-game-${row.id}`} tabIndex={-1} className="gb-my-game-unavailable" data-game-id={row.id} data-surface="game-details-unavailable">
      <h3>{row.own[0]?.gameTitle ?? row.reminders[0]?.gameTitle ?? (!read ? "Загружаем детали игры…" : ![403, 404].includes(read.status) ? "Не удалось загрузить игру" : "Детали игры недоступны")}</h3>
      {!row.own.length ? <p>{row.reminders[0]?.endsAt ? `${new Date(row.reminders[0].endsAt).toLocaleString("ru-RU")} · ваше местное время` : "Дата и время недоступны"}</p> : null}
      {row.parts.map((part) => <GameStatusBadge key={part.id} tone={part.status}>{participationLabel(part.status)}</GameStatusBadge>)}
      {extras}
      <Button variant="outline" onClick={() => changed(row.id)}>Обновить детали игры</Button>
    </article>;
  }
  const listLoading = [managed, parts, invitations, own].some((source) => source.state === "loading") || reminders.loading;
  function content(attached: ReadonlyMap<string, ReactNode> = new Map(), secondary: ReactNode = null) {
    return <>
      <section aria-labelledby="upcoming-title" className="gb-my-games-section"><h2 id="upcoming-title">Предстоящие</h2>
        {upcoming.length ? upcoming.map((row) => card(row, attached)) : <p className="gb-my-games-empty">{listLoading ? "Проверяем предстоящие игры…" : filter === "all" ? "Предстоящих игр пока нет." : "В этом фильтре нет предстоящих игр."} <Button variant="ghost" href="/games">Найти игру</Button></p>}
        {drafts.length ? <details className="gb-my-games-disclosure" open><summary>Черновики</summary>{drafts.map((row) => card(row, attached))}</details> : null}
      </section>
      {filter === "all" || search.get("rec") === "received" ? secondary : null}
      <section className="gb-my-games-section" aria-labelledby="history"><h2 id="history" tabIndex={-1}>История</h2>
        <p className="gb-c23-helper">История показывает исход заявки или статус игры. Это не подтверждает присутствие на площадке и не означает оплату.</p>
        {past.map((row) => card(row, attached))}
        {terminal.length ? <><h3>Завершённые заявки и отмены</h3>{terminal.map((row) => card(row, attached))}</> : null}
        {unknown.length ? <><h3>Дата недоступна</h3>{unknown.map((row) => card(row, attached))}</> : null}
        {!past.length && !terminal.length && !unknown.length ? <p>{listLoading ? "История ещё загружается…" : "В загруженных источниках история этого фильтра пуста."}</p> : null}
        {ownCursor ? <Button variant="outline" disabled={ownLoadingMore} onClick={() => void loadOwnResults(true)}>{ownLoadingMore ? "Загружаем…" : "Показать ещё итоги"}</Button> : null}
      </section>
    </>;
  }
  const sourcesReady = [managed, parts, invitations, own].every((source) => source.state === "ready") && !reminders.loading && !reminders.error;
  return <ConsumerShell active="my-games" title="Мои игры" hideHeading>
    <div className="gb-my-games gb-my-games--unified" data-surface="my-games" onClickCapture={(event) => {
      const target = event.target;
      if (!(target instanceof Element) || !me) return;
      const href = target.closest("a")?.getAttribute("href");
      if (href?.startsWith("/my-games/") && href.includes("/results")) try { sessionStorage.setItem(`gb-my-games-filter:${me.id}`, filter); } catch { /* Optional return context. */ }
    }}>
      <header className="gb-my-games-header"><h1>Мои игры</h1><Button href="/games/create">Создать игру</Button></header>
      <div className="gb-my-games-toolbar"><div className="gb-game-segmented" role="group" aria-label="Отношение к играм">
        {filters.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => router.replace(pathFor(value))}>{labels[value]}{value === "invites" && invitations.state === "ready" && invitations.data.some((invite) => invite.status === "pending" && (!invite.expiresAt || Date.parse(invite.expiresAt) > now)) ? <span className="gb-my-games-invite-count">{invitations.data.filter((invite) => invite.status === "pending" && (!invite.expiresAt || Date.parse(invite.expiresAt) > now)).length}</span> : null}</button>)}
      </div><a href="#history" onClick={(event) => { event.preventDefault(); setFocusTarget("history"); }}>К истории ↓</a></div>
      {state === "loading" ? <div aria-busy="true" role="status" className="gb-game-feedback">Загружаем ваши игры…</div> : null}
      {state === "auth" ? <div className="gb-game-feedback"><h2>Войдите, чтобы видеть свои игры</h2><AuthEntry returnPath={returnPath} /></div> : null}
      {state === "error" ? <div className="gb-game-feedback"><h2>Не удалось проверить вход</h2><Button onClick={() => setReload((n) => n + 1)}>Обновить</Button></div> : null}
      {state === "ready" && me ? <>
        {attention.length ? <div className="gb-my-games-attention"><strong>После игры ждут ответа · {attention.length}{ownCursor ? "+" : ""}</strong><a href={`#my-game-${attention[0].id}`} onClick={(event) => { event.preventDefault(); router.replace(pathFor("all", true)); setFocusTarget(`my-game-${attention[0].id}`); }}>К итогам ↓</a></div> : null}
        {sourceNotice(managed, "Управляемые игры", () => void loadManaged())}
        {sourceNotice(parts, "Заявки и участия", () => void loadParts())}
        {sourceNotice(invitations, "Приглашения", () => void loadInvitations())}
        {sourceNotice(own, "Ваши итоги", () => void loadOwnResults())}
        {reminders.error ? <div className="gb-my-games-source" role="status"><p>{reminders.error}</p><Button variant="outline" onClick={reminders.retry}>Обновить напоминания</Button></div> : null}
        {sourcesReady && !rows.length ? <div className="gb-game-feedback"><h2>Пока нет ваших игр</h2><Button href="/games">Найти игру</Button></div> : null}
        <GameRecommendationsSection me={me} fixedView="received" compact gameIds={ids} showEmpty={search.get("rec") === "received"} renderWithGames={content} />
        <details className="gb-my-games-disclosure" open={search.get("rec") === "sent" || undefined} id="my-advice"><summary id="my-advice-summary" tabIndex={-1}>Мои советы</summary><GameRecommendationsSection me={me} fixedView="sent" compact showEmpty /></details>
        <details className="gb-my-games-disclosure"><summary>Отзывы</summary><GameReviewsHistory /><RoleReviewsHistory /></details>
      </> : null}
    </div>
  </ConsumerShell>;
}
