"use client";

import { useEffect, useState } from "react";
import type { SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../../../lib/consumer-types";
import { getSocialCapabilities, listFriends } from "../../../lib/friendships";
import {
  formatRecommendationWhen,
  listGameRecommendations,
  recommendableFriends,
  recommendationMutationScope,
  recommendationsUiEnabled,
  sendGameRecommendationPath,
  useGameRecommendationMutation,
  type GameRecommendation,
  type GameRecommendationReceipt,
  type RecommendableFriend,
} from "../../../lib/game-recommendations";
import { privateViews } from "../../../lib/private-view";
import { Button } from "../Button";
import { AuthChooser, ProfileDialog, ProfileState } from "../players/ProfileComposition";
import { MutationNotice } from "../messages/MessageComposition";

type PickerState = "closed" | "loading" | "ready" | "unavailable" | "error" | "empty" | "guest";
type SentRereadState = "idle" | "loading" | "ready" | "empty" | "error" | "guest" | "unavailable";

/**
 * Detail-only «Посоветовать другу». External GameShare stays separate.
 * Honours social-capabilities.gameRecommendations (Friends DEV + recommendation schema).
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
  const [sentReread, setSentReread] = useState(0);
  const [sentState, setSentState] = useState<SentRereadState>("idle");
  const [sentPreview, setSentPreview] = useState<GameRecommendation[]>([]);
  const [sentHasMore, setSentHasMore] = useState(false);

  const mutationScope = recommendationMutationScope(me?.id ?? "guest", `recommend:${gameId}`);
  const mutation = useGameRecommendationMutation<GameRecommendationReceipt>(
    mutationScope,
    me?.id ?? "guest",
    me?.csrfToken ?? "",
    (receipt) => {
      setSentNotice(receipt.outcome === "sent" ? "Совет отправлен другу. Место не резервируется." : "Совет записан.");
      setOpen(false);
      setSelected(null);
      setSentState("idle");
      setSentPreview([]);
      setSentHasMore(false);
    },
    () => {
      // Actor-owned sent recommendations only — never friends/cursor reload.
      setSentPreview([]);
      setSentHasMore(false);
      setSentState("loading");
      setSentReread((n) => n + 1);
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

  useEffect(() => {
    if (sentReread === 0) return;
    let live = true;
    if (!me) {
      setSentPreview([]);
      setSentHasMore(false);
      setSentState("guest");
      return;
    }
    const actorId = me.id;
    const release = privateViews.retain(privateViews.currentGeneration);
    const expire = () => {
      live = false;
      setSentPreview([]);
      setSentHasMore(false);
      setSentState("guest");
    };
    const onSession = () => {
      expire();
    };
    window.addEventListener("gb-private-expired", expire);
    window.addEventListener("gb-session-changed", onSession);
    void (async () => {
      const page = await listGameRecommendations("sent");
      if (!live || me.id !== actorId) return;
      if (!page.ok) {
        // Failed/absent list must not clear UNKNOWN pending or claim noncommit.
        setSentPreview([]);
        setSentHasMore(false);
        setSentState(page.status === 401 ? "guest" : [403, 404, 503].includes(page.status) ? "unavailable" : "error");
        return;
      }
      setSentPreview(page.data.items);
      setSentHasMore(Boolean(page.data.nextCursor));
      setSentState(page.data.items.length || page.data.nextCursor ? "ready" : "empty");
    })();
    return () => {
      live = false;
      release?.();
      window.removeEventListener("gb-private-expired", expire);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, [sentReread, me, gameId]);

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
      {mutation.pending ? (
        <div className="profile-form-actions" data-surface="send-recovery">
          <Button variant="outline" disabled={mutation.busy} onClick={() => mutation.rereadOwnList()}>
            Обновить свой список
          </Button>
          <Button variant="outline" href="/my-games?rec=sent">
            Открыть «Вы советовали»
          </Button>
          {sentState === "loading" ? (
            <p className="gb-c23-helper" role="status">Обновляем список ваших советов…</p>
          ) : null}
          {sentState === "guest" ? (
            <p className="gb-c23-helper" role="status">Сессия больше не действует. Список советов скрыт.</p>
          ) : null}
          {sentState === "unavailable" ? (
            <p className="gb-c23-helper" role="status">Список советов сейчас недоступен. Результат отправки по-прежнему неизвестен.</p>
          ) : null}
          {sentState === "error" ? (
            <p className="gb-c23-helper" role="status">Не удалось загрузить список советов. Результат отправки по-прежнему неизвестен.</p>
          ) : null}
          {sentState === "empty" ? (
            <p className="gb-c23-helper" role="status">
              В списке пока нет видимых советов. Это не подтверждает и не опровергает отправку.
            </p>
          ) : null}
          {sentState === "ready" ? (
            <div className="gb-c23-helper" role="status" data-surface="sent-reread-preview">
              <p>
                {sentPreview.length
                  ? `В списке видно советов: ${sentPreview.length}${sentHasMore ? " (есть ещё)" : ""}. Отсутствие конкретной записи не опровергает отправку.`
                  : "На этой странице нет видимых записей, но список ещё не исчерпан. Это не опровергает отправку."}
              </p>
              {sentPreview.slice(0, 3).map((row) => (
                <p key={row.id}>
                  {row.game.title} · {formatRecommendationWhen(row.game)} · для {row.peer.displayName}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
