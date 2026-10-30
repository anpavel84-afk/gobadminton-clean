"use client";
import { useEffect, useRef, useState } from "react";
import { getGame, listMyManagedGames } from "../../../lib/api-client";
import {
  createGameForInvitePath,
  invitationEligibilityBlockReason,
  invitationEligibilityNotice,
  isGameOpenForInvitation,
  nextInvitationEligibilityBoundary,
} from "../../../lib/invitation-continuation";
import type { ManagedGame, Me } from "../../../lib/consumer-types";
import type { GameInvitation } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";

export function InvitationChooser({ me, playerId, resultRef, preferredGameId, onClose, onCreated }: { me: Me; playerId: string; resultRef?: string; preferredGameId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [managed, setManaged] = useState<ManagedGame[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const mutation = useSocialMutation<GameInvitation>(`${me.id}:invite:${playerId}`, me.csrfToken, r => onCreated(r.id), () => setReload(n => n + 1), !resultRef);
  useEffect(() => {
    let live = true;
    setState("loading"); setManaged([]);
    void (async () => {
      const items: ManagedGame[] = []; let cursor: string | undefined;
      do {
        const r = await listMyManagedGames({ cursor, limit: 50 });
        if (!live) return;
        if (!r.ok) { setState("error"); return; }
        items.push(...r.data.items); cursor = r.data.nextCursor ?? undefined;
      } while (cursor);
      setManaged(items); setNow(Date.now()); setState("ready");
    })();
    return () => { live = false; };
  }, [reload]);
  const games = managed.filter(g => isGameOpenForInvitation(g, now));
  const preferred = preferredGameId ? managed.find(g => g.id === preferredGameId) : undefined;
  const selected = preferred && isGameOpenForInvitation(preferred, now) ? preferred : null;
  const preferredBlock = preferred && !selected ? invitationEligibilityBlockReason(preferred, now) : null;
  useEffect(() => {
    const open = managed.filter(g => isGameOpenForInvitation(g, now));
    const watch = preferredGameId ? open.filter(g => g.id === preferredGameId) : open;
    const boundary = nextInvitationEligibilityBoundary(watch, now);
    if (boundary == null) return;
    const delay = Math.min(2147483647, Math.max(0, boundary - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [managed, now, preferredGameId]);
  async function invite(game: ManagedGame) {
    if (checking || mutation.busy || mutation.pending) return;
    setChecking(true);
    const fresh = await getGame(game.id);
    if (!live.current) return;
    setChecking(false);
    if (!fresh.ok) { mutation.setNotice("Игра сейчас недоступна. Обновите список."); setReload(n => n + 1); return; }
    const block = invitationEligibilityBlockReason(fresh.data, Date.now());
    if (block) { mutation.setNotice(invitationEligibilityNotice(block)); setReload(n => n + 1); return; }
    mutation.run(`/v1/games/${encodeURIComponent(game.id)}/invitations`, { inviteePublicPlayerId: playerId, expectedGameVersion: fresh.data.version, ...(resultRef ? { discoveryProof: resultRef } : {}) });
  }
  const offeredGames = preferredGameId ? selected ? [selected] : [] : games;
  return <ProfileDialog title="Пригласить на игру" onClose={() => { if (!checking && !mutation.busy) onClose(); }}><div className="invite-dialog-example"><small>Пригласить на игру</small><strong>{preferredGameId ? "Пригласить в созданную игру" : "Выберите вашу игру"}</strong><p>Приглашение не резервирует место.</p>
    {state === "loading" && <ProfileState title="Загружаем игры…" state="loading" />}
    {state === "error" && <ProfileState title="Не удалось загрузить игры" state="error" retry={() => setReload(n => n + 1)} />}
    {state === "ready" && !preferredGameId && games.length === 0 && <p>Нет предстоящих игр, открытых для приглашений.</p>}
    {state === "ready" && preferredGameId && !selected && preferredBlock && <><p role="status">{preferredBlock === "started" ? "Созданная игра уже началась и недоступна для приглашений." : preferredBlock === "deadline" ? "Срок записи на созданную игру уже прошёл — приглашение недоступно." : preferredBlock === "unpublished" ? "Созданная игра больше не опубликована и недоступна для приглашений." : "Созданная игра недоступна для приглашений из‑за некорректных дат."}</p><Button variant="outline" onClick={() => setReload(n => n + 1)}>Обновить игры</Button></>}
    {state === "ready" && preferredGameId && !selected && !preferredBlock && <><p role="status">Созданная игра пока не найдена в вашем списке. Обновите игры, не создавая новую.</p><Button variant="outline" onClick={() => setReload(n => n + 1)}>Обновить игры</Button></>}
    {offeredGames.map(g => <button key={g.id} disabled={checking || mutation.busy || mutation.pending} onClick={() => void invite(g)}><span>{g.title}<small>{new Date(g.startsAt).toLocaleString("ru-RU", { timeZone: g.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</small></span><b aria-hidden="true">→</b></button>)}
    {!preferredGameId && <Button variant="outline" href={createGameForInvitePath(playerId)}>+ Создать новую игру</Button>}<MutationNotice mutation={mutation} /></div></ProfileDialog>;
}
