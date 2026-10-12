"use client";
import { useEffect, useState } from "react";
import { getGame, getMySocialProfile, listAllMyParticipations, listMyManagedGames } from "../../../lib/api-client";
import { getInvitation, invitationPath } from "../../../lib/messaging-api";
import type { Game, Me } from "../../../lib/consumer-types";
import type { AcceptInvitationResult, GameInvitation } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { ProfileState } from "../players/ProfileComposition";
import { ConversationHeader, InvitationCard, MutationNotice } from "./MessageComposition";
import { useSocialMutation } from "./useSocialMutation";

export function InvitationDetail({ id, me, changed }: { id: string; me: Me; changed: () => void }) {
  const [invitation, setInvitation] = useState<GameInvitation | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [recipient, setRecipient] = useState(false);
  const [manager, setManager] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useSocialMutation<GameInvitation | AcceptInvitationResult>(`${me.id}:invitation:${id}`, me.csrfToken, () => { setState("loading"); setReload(n => n + 1); changed(); }, () => { setState("loading"); setReload(n => n + 1); changed(); });
  useEffect(() => {
    let live = true;
    setState("loading"); setRecipient(false); setManager(false); setConfirmed(false);
    void (async () => {
      const [r, own] = await Promise.all([getInvitation(id), getMySocialProfile()]);
      if (!live) return;
      if (!r.ok) { setInvitation(null); setState(r.status === 404 ? "unavailable" : "error"); return; }
      const [g, participation] = await Promise.all([getGame(r.data.gameId), listAllMyParticipations()]);
      if (!live) return;
      setInvitation(r.data); setGame(g.ok ? g.data : null);
      setRecipient(own.ok && own.data.publicPlayerId === r.data.inviteePublicPlayerId);
      setConfirmed(participation.ok && participation.data.some(p => p.id === r.data.participationId && p.gameId === r.data.gameId && p.status === "confirmed"));
      setState("ready");
      // Current GameManager projection, not inviter identity or createdByMe inference.
      if (own.ok && own.data.publicPlayerId !== r.data.inviteePublicPlayerId && r.data.status === "pending") {
        let cursor: string | undefined;
        do {
          const managed = await listMyManagedGames({ cursor, limit: 50 });
          if (!live || !managed.ok) return;
          if (managed.data.items.some(x => x.id === r.data.gameId)) { setManager(true); return; }
          cursor = managed.data.nextCursor ?? undefined;
        } while (cursor);
      }
    })();
    return () => { live = false; };
  }, [id, reload]);
  const pending = invitation?.status === "pending";
  const unavailable = !game || game.status !== "published" || game.availablePlaces < 1 || mutation.code === "GAME_FULL";
  const disabled = mutation.busy || mutation.pending || state !== "ready";
  return <section className="conversation-panel"><ConversationHeader name="Приглашение в игру" subtitle="Участие и условия игры" /><div className="conversation-body">
    {state === "loading" && <ProfileState state="loading" title="Загружаем приглашение…" />}
    {state === "error" && <ProfileState state="error" title="Не удалось загрузить приглашение" retry={() => setReload(n => n + 1)} />}
    {state === "unavailable" && <ProfileState title="Приглашение недоступно">Оно больше не доступно для просмотра.</ProfileState>}
    {state === "ready" && invitation && <InvitationCard invitation={invitation} game={game} unavailable={pending && unavailable} confirmed={confirmed}>
      {pending && recipient && <><Button disabled={disabled || unavailable} onClick={() => { if (game) mutation.run(`${invitationPath(id)}/accept`, { expectedVersion: invitation.version, expectedGameVersion: game.version }); }}>Принять приглашение</Button><Button variant="outline" disabled={disabled} onClick={() => mutation.run(`${invitationPath(id)}/decline`, { expectedVersion: invitation.version })}>Отклонить</Button></>}
      {pending && manager && <Button variant="outline" disabled={disabled} onClick={() => mutation.run(`${invitationPath(id)}/revoke`, { expectedVersion: invitation.version })}>Отозвать приглашение</Button>}
      {game && <Button variant="outline" href={`/games/${game.id}`}>Открыть игру</Button>}
      {unavailable && <Button variant="ghost" href="/games">Найти другую игру</Button>}
    </InvitationCard>}
    <MutationNotice mutation={mutation} />
  </div><div className="composer-restricted">Приглашение и статус участия проверяются отдельно.</div><div className="conversation-safety"><button disabled={mutation.busy} onClick={() => setReload(n => n + 1)}>Обновить</button></div></section>;
}
