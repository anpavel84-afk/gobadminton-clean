"use client";
import { useEffect, useState } from "react";
import type { Me } from "../../../lib/consumer-types";
import type { ContactResult } from "../../../lib/messaging-types";
import type { RadarItem } from "../../../lib/radar-types";
import { apiFetch } from "../../../lib/api-client";
import type { RadarPreview } from "../../../lib/radar-types";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import { InvitationChooser } from "../messages/InvitationChooser";
import { MutationNotice } from "../messages/MessageComposition";
import { useSocialMutation } from "../messages/useSocialMutation";

export function RadarContact({ me, item }: { me: Me; item: Pick<RadarItem, "resultId" | "resultRef" | "player"> }) {
  const [mode, setMode] = useState<"message" | "invite" | null>(null);
  const [text, setText] = useState("");
  const [created, setCreated] = useState<{ kind: "conversation" | "invitation"; id: string } | null>(null);
  const [available, setAvailable] = useState(item.player.canRequestContact === true);
  const [checking, setChecking] = useState(false);
  useEffect(() => { setAvailable(item.player.canRequestContact === true); setMode(null); }, [item.resultId, item.player.canRequestContact]);
  const mutation = useSocialMutation<ContactResult>(`${me.id}:radar:${item.resultId}`, me.csrfToken, r => { setCreated({ kind: "conversation", id: r.conversation.id }); setMode(null); }, () => { setAvailable(false); }, false);
  async function open(next: "message" | "invite") {
    if (checking || mutation.busy || mutation.pending || !available) return;
    setChecking(true);
    const r = await apiFetch<RadarPreview>("/v1/radar/results/preview", { method: "POST", csrfToken: me.csrfToken, body: JSON.stringify({ resultRef: item.resultRef }) });
    setChecking(false);
    if (r.ok && r.data.player.canRequestContact === true) setMode(next);
    else { setAvailable(false); setMode(null); }
  }
  return <div className="radar-contact-actions">{created ? <Button href={`/messages?${created.kind}=${encodeURIComponent(created.id)}`}>Открыть {created.kind === "conversation" ? "переписку" : "приглашение"}</Button> : available ? <><Button variant="outline" disabled={checking || mutation.busy || mutation.pending} onClick={() => void open("message")}>Написать</Button><Button variant="outline" disabled={checking || mutation.busy || mutation.pending} onClick={() => void open("invite")}>Пригласить на игру</Button></> : <p role="status">Написать сейчас нельзя.</p>}
    {mode === "message" && available && <ProfileDialog title="Написать" onClose={() => { if (!mutation.busy) setMode(null); }}><form onSubmit={e => { e.preventDefault(); if (available && text.trim()) mutation.run("/v1/conversations/requests", { targetPublicPlayerId: item.player.publicPlayerId, text: text.trim(), clientMessageId: crypto.randomUUID(), discoveryProof: item.resultRef }); }}><label className="profile-field">Сообщение<textarea maxLength={2000} rows={4} value={text} disabled={mutation.busy || mutation.pending} onChange={e => setText(e.target.value)} /></label><Button type="submit" disabled={!text.trim() || mutation.busy || mutation.pending}>Отправить</Button></form><MutationNotice mutation={mutation} /></ProfileDialog>}
    {mode === "invite" && available && <InvitationChooser me={me} playerId={item.player.publicPlayerId} resultRef={item.resultRef} onClose={() => setMode(null)} onCreated={id => { setCreated({ kind: "invitation", id }); setMode(null); }} />}
    {mode !== "message" && <MutationNotice mutation={mutation} />}
  </div>;
}
