"use client";
import { useState } from "react";
import type { FriendshipReceipt, FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { friendCommand, friendStatus, type FriendAction } from "../../../lib/friendships";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import { useSocialMutation } from "../messages/useSocialMutation";
import { MutationNotice } from "../messages/MessageComposition";

export function FriendActions({ me, view, peerId, refresh }: { me: Me; view: FriendshipView; peerId?: string; refresh: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const mutation = useSocialMutation<FriendshipReceipt>(`${me.id}:friends:${peerId ?? view.friendshipId}`, me.csrfToken,
    () => { setConfirm(false); refresh(); }, () => { setConfirm(false); refresh(); });
  const locked = mutation.busy || mutation.pending;
  function act(action: FriendAction) {
    const command = friendCommand(view, peerId, action);
    if (!locked && command) mutation.run(command.path, command.body);
  }
  const actions: Array<[FriendAction, string]> = [["request", "Добавить в друзья"], ["accept", "Принять"], ["decline", "Отклонить"], ["cancel", "Отменить запрос"], ["remove", "Удалить из друзей"]];
  return <div><p role="status">{friendStatus[view.relationship]}</p><div className="profile-form-actions">
    {actions.filter(([action]) => friendCommand(view, peerId, action)).map(([action, label]) => <Button key={action} variant={action === "request" || action === "accept" ? "primary" : "outline"} disabled={locked} onClick={() => action === "remove" ? setConfirm(true) : act(action)}>{label}</Button>)}
  </div><MutationNotice mutation={mutation} />
    {confirm && <ProfileDialog title="Удалить из друзей?" onClose={() => { if (!mutation.busy) setConfirm(false); }}><p>Чтобы снова стать друзьями, понадобится новый запрос.</p><div className="profile-form-actions"><Button variant="danger" disabled={locked} onClick={() => act("remove")}>Удалить из друзей</Button><Button variant="outline" disabled={mutation.busy} onClick={() => setConfirm(false)}>Оставить в друзьях</Button></div></ProfileDialog>}
  </div>;
}
