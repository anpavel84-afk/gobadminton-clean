"use client";
import { useEffect, useState } from "react";
import { getPlayer } from "../../../lib/api-client";
import { getContactState, getConversation } from "../../../lib/messaging-api";
import type { Me, PublicPlayer } from "../../../lib/consumer-types";
import type { ContactResult } from "../../../lib/messaging-types";
import { Button } from "../Button";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";
import { ConversationHeader, MutationNotice } from "./MessageComposition";
import { InvitationChooser } from "./InvitationChooser";
import { useSocialMutation } from "./useSocialMutation";
export function NewContact({ playerId, invite, me, openConversation, openInvitation }: { playerId: string; invite: boolean; me: Me; openConversation: (id: string) => void; openInvitation: (id: string) => void }) {
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [text, setText] = useState("");
  const [chooser, setChooser] = useState(invite);
  const mutation = useSocialMutation<ContactResult>(`${me.id}:contact:${playerId}`, me.csrfToken, data => openConversation(data.conversation.id), () => setReload(n => n + 1));
  useEffect(() => {
    let live = true; const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000); setState("loading");
    void (async () => {
      const contact = await getContactState(playerId, controller.signal);
      if (!live) return;
      if (!contact.ok) { setState(contact.status === 401 ? "guest" : "error"); return; }
      if (contact.data.targetPublicPlayerId !== playerId) { setState("unavailable"); return; }
      if ("conversationId" in contact.data) {
        const header = await getConversation(contact.data.conversationId, controller.signal);
        if (!live) return;
        if (header.ok && header.data.peer.publicPlayerId === playerId) openConversation(header.data.id);
        else setState(!header.ok && header.status === 401 ? "guest" : "unavailable");
        return;
      }
      if (contact.data.state !== "none") { setState("unavailable"); setChooser(false); return; }
      const r = await getPlayer(playerId, controller.signal);
      if (!live) return;
      setPlayer(r.ok ? r.data : null); setState(r.ok ? r.data.canRequestContact === true ? "ready" : "unavailable" : r.status === 404 ? "unavailable" : r.status === 401 ? "guest" : "error");
      if (!r.ok || r.data.canRequestContact !== true) setChooser(false);
    })();
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [playerId, me.id, me.csrfToken, reload, invite]);
  return <section className="conversation-panel"><ConversationHeader playerId={player?.publicPlayerId} avatar={player?.avatar} name={player?.displayName ?? "Игрок"} subtitle="Первое сообщение" /><div className="conversation-body">
    {state === "loading" && <ProfileState title="Загружаем профиль…" state="loading" />}
    {state === "guest" && <ProfileState title="Войдите, чтобы написать"><AuthEntry returnPath={`/messages?to=${encodeURIComponent(playerId)}`} /></ProfileState>}
    {state === "error" && <ProfileState title="Не удалось загрузить профиль" state="error" retry={() => setReload(n => n + 1)} />}
    {state === "unavailable" && <ProfileState title="Общение сейчас недоступно">Новый запрос этому игроку сейчас отправить нельзя.</ProfileState>}
    {state === "ready" && player && <section className="contact-request contact-request--new"><small>Запрос на общение</small><p>Отправьте одно первое сообщение. Продолжить переписку можно после принятия запроса.</p><form onSubmit={e => { e.preventDefault(); if (state === "ready" && player.canRequestContact === true && text.trim()) mutation.run("/v1/conversations/requests", { targetPublicPlayerId: playerId, text: text.trim(), clientMessageId: crypto.randomUUID() }); }}><label className="profile-field">Первое сообщение<textarea maxLength={2000} rows={4} value={text} disabled={mutation.busy || mutation.pending} onChange={e => setText(e.target.value)} /></label><Button type="submit" disabled={!text.trim() || mutation.busy || mutation.pending}>Отправить запрос</Button></form></section>}
    <MutationNotice mutation={mutation} />
  </div><div className="composer-restricted">{state === "ready" && player?.canRequestContact === true && <Button variant="outline" onClick={() => setChooser(true)}>Пригласить на игру</Button>}</div>
    {chooser && state === "ready" && player?.canRequestContact === true && <InvitationChooser me={me} playerId={playerId} onClose={() => setChooser(false)} onCreated={openInvitation} />}
  </section>;
}
