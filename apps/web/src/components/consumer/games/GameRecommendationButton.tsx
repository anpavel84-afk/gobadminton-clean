"use client";

import { useEffect, useState } from "react";
import type { SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { getSocialCapabilities, listFriends } from "../../../lib/friendships";
import {
  recommendableFriends,
  recommendationMutationScope,
  recommendationsUiEnabled,
  sendGameRecommendationPath,
  useGameRecommendationMutation,
  type GameRecommendationReceipt,
  type RecommendableFriend,
} from "../../../lib/game-recommendations";
import { privateViews } from "../../../lib/private-view";
import { Button } from "../Button";
import { AuthChooser, ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "../messages/MessageComposition";

type PickerState = "closed" | "loading" | "ready" | "unavailable" | "error" | "empty" | "guest";

/**
 * Detail-only «Посоветовать другу». External GameShare stays separate.
 * Honours social-capabilities.gameRecommendations (currently false on FR-3A).
 */
export function GameRecommendationButton({
  gameId,
  me,
  eligible,
  onLogin,
}: {
  gameId: string;
  me: Me | null;
  eligible: boolean;
  onLogin?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<SocialCapabilities | null>(null);
  const [friends, setFriends] = useState<RecommendableFriend[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>("closed");
  const [sentNotice, setSentNotice] = useState("");
  const [reload, setReload] = useState(0);

  const mutationScope = recommendationMutationScope(me?.id ?? "guest", `recommend:${gameId}`);
  const mutation = useGameRecommendationMutation<GameRecommendationReceipt>(
    mutationScope,
    me?.id ?? "guest",
    me?.csrfToken ?? "",
    (receipt) => {
      setSentNotice(receipt.outcome === "sent" ? "Совет отправлен другу. Место не резервируется." : "Совет записан.");
      setOpen(false);
      setSelected(null);
    },
    () => {
      setFriends([]);
      setCursor(null);
      setPicker("loading");
      setReload((n) => n + 1);
    },
  );

  useEffect(() => {
    if (!open || !me) return;
    let live = true;
    setPicker("loading");
    setFriends([]);
    setNextCursor(null);
    setSelected(null);
    setSentNotice("");
    const release = privateViews.retain(privateViews.currentGeneration);
    const expire = () => {
      live = false;
      setCapabilities(null);
      setFriends([]);
      setPicker("guest");
      setOpen(false);
    };
    const session = () => {
      expire();
    };
    const onForeground = () => {
      if (document.visibilityState !== "visible" || !live) return;
      live = false;
      setFriends([]);
      setSelected(null);
      setCursor(null);
      setCapabilities(null);
      setPicker("loading");
      setReload((n) => n + 1);
    };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", session);
    document.addEventListener("visibilitychange", onForeground);
    void (async () => {
      const caps = await getSocialCapabilities();
      if (!live) return;
      if (!caps.ok) {
        setPicker(caps.status === 401 ? "guest" : [403, 404, 503].includes(caps.status) ? "unavailable" : "error");
        return;
      }
      setCapabilities(caps.data);
      if (!recommendationsUiEnabled(caps.data)) {
        setPicker("unavailable");
        return;
      }
      const page = await listFriends("accepted", cursor);
      if (!live) return;
      if (!page.ok) {
        setPicker(page.status === 401 ? "guest" : [403, 404, 503].includes(page.status) ? "unavailable" : "error");
        return;
      }
      const items = recommendableFriends(page.data.items);
      setFriends(items);
      setNextCursor(page.data.nextCursor);
      setPicker(items.length || page.data.nextCursor ? "ready" : "empty");
    })();
    return () => {
      live = false;
      release?.();
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", session);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [open, me, cursor, reload, gameId]);

  if (!eligible) return null;

  const locked = mutation.busy || mutation.pending || !me;

  function openPicker() {
    if (!me) {
      if (onLogin) onLogin();
      else setAuthOpen(true);
      return;
    }
    setCursor(null);
    setOpen(true);
  }

  function send() {
    if (!me || !selected || locked || !recommendationsUiEnabled(capabilities)) return;
    mutation.run(sendGameRecommendationPath(gameId), { friendshipId: selected });
  }

  return (
    <div className="gb-game-recommend" data-surface="game-recommend">
      <Button variant="outline" disabled={mutation.busy || mutation.pending} onClick={openPicker}>
        Посоветовать другу
      </Button>
      {sentNotice ? <p className="gb-game-notice" role="status">{sentNotice}</p> : null}
      <MutationNotice mutation={mutation} />
      {open && me ? (
        <div className="fr3">
          <ProfileDialog
            title="Посоветовать другу"
            onClose={() => {
              if (!mutation.busy) setOpen(false);
            }}
          >
            <p>Выберите одного принятого друга. Совет не резервирует место и не заменяет заявку на участие.</p>
            <p>Это не внешняя ссылка «Поделиться» и не приглашение организатора.</p>
            {picker === "loading" && <ProfileState title="Загружаем друзей…" state="loading" />}
            {picker === "guest" && <ProfileState title="Войдите снова">Сессия больше не действует.</ProfileState>}
            {picker === "unavailable" && (
              <ProfileState title="Рекомендации сейчас недоступны">Попробуйте позже.</ProfileState>
            )}
            {picker === "error" && (
              <ProfileState title="Не удалось загрузить друзей" state="error" retry={() => { setCursor(null); setReload((n) => n + 1); }}>
                Обновите список перед отправкой.
              </ProfileState>
            )}
            {picker === "empty" && (
              <ProfileState title="Нет подходящих друзей">
                Нужен принятый взаимный контакт. Запрос можно отправить из профиля игрока.
              </ProfileState>
            )}
            {picker === "ready" && (
              <>
                <div role="radiogroup" aria-label="Друзья">
                  {friends.map((friend) => (
                    <label key={friend.friendshipId} className="profile-field">
                      <input
                        type="radio"
                        name="recommend-friend"
                        value={friend.friendshipId}
                        checked={selected === friend.friendshipId}
                        disabled={locked}
                        onChange={() => setSelected(friend.friendshipId)}
                      />
                      {" "}
                      {friend.displayName}
                    </label>
                  ))}
                </div>
                <div className="profile-form-actions">
                  <Button disabled={!selected || locked} onClick={send}>
                    {mutation.busy ? "Отправляем…" : "Отправить совет"}
                  </Button>
                  {nextCursor ? (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => {
                        setPicker("loading");
                        setCursor(nextCursor);
                      }}
                    >
                      Ещё друзья
                    </Button>
                  ) : null}
                  <Button variant="outline" disabled={mutation.busy} onClick={() => setOpen(false)}>
                    Отмена
                  </Button>
                </div>
              </>
            )}
            <MutationNotice mutation={mutation} />
          </ProfileDialog>
        </div>
      ) : null}
      {authOpen && !onLogin ? (
        <AuthChooser
          returnPath={`/games/${gameId}`}
          onClose={() => setAuthOpen(false)}
        />
      ) : null}
    </div>
  );
}
