import { describe, expect, it } from "vitest";
import {
  isWebPushDeliverPayload,
  isWebPushGameEventDeliverPayload,
  isWebPushMessageDeliverPayload,
} from "../../src/jobs/payloads";
import {
  GAME_PUSH_COPY,
  GAME_PUSH_KINDS,
  assertSafeGamePushPath,
  eventGroupForKind,
  pathForGamePush,
} from "../../src/push/game-push.policy";
import {
  gameChangeEventKey,
  invitationEventKey,
  participationEventKey,
  reminderEventKey,
} from "../../src/push/game-push-intents";

describe("#496 game event push policy", () => {
  it("covers seven business kinds with neutral Russian copy and safe paths", () => {
    expect(GAME_PUSH_KINDS).toHaveLength(8);
    expect(GAME_PUSH_COPY.game_invitation).toBe("Приглашение на игру");
    expect(GAME_PUSH_COPY.participation_confirmed).toBe("Заявка подтверждена");
    expect(GAME_PUSH_COPY.participation_rejected).toBe("Заявка отклонена");
    expect(GAME_PUSH_COPY.new_pending_application).toBe("Новая заявка на игру");
    expect(GAME_PUSH_COPY.game_cancelled).toBe("Игра отменена");
    expect(GAME_PUSH_COPY.game_time_changed).toBe("Изменено время игры");
    expect(GAME_PUSH_COPY.game_venue_changed).toBe("Изменено место игры");
    expect(GAME_PUSH_COPY.outcome_reminder).toBe("Напоминание об итоге игры");
    for (const text of Object.values(GAME_PUSH_COPY)) {
      expect(text).not.toMatch(/@|\+7|http|улиц|reason|email/i);
    }
    const gameId = "11111111-1111-4111-8111-111111111111";
    expect(pathForGamePush("game_invitation", gameId)).toBe(`/games/${gameId}`);
    expect(pathForGamePush("outcome_reminder", gameId)).toBe(
      `/my-games/${gameId}/results`,
    );
    expect(assertSafeGamePushPath("/evil", "game_cancelled")).toBe("/games");
    expect(eventGroupForKind("game_invitation")).toBe("invites");
    expect(eventGroupForKind("participation_rejected")).toBe("applicationDecisions");
    expect(eventGroupForKind("new_pending_application")).toBe("newApplications");
    expect(eventGroupForKind("game_time_changed")).toBe("gameChanges");
    expect(eventGroupForKind("outcome_reminder")).toBe("outcomeReminders");
  });

  it("builds stable event keys and accepts game payloads separately from messages", () => {
    expect(invitationEventKey("a", 1)).toBe("inv:a:v1");
    expect(participationEventKey("participation_confirmed", "p", 2)).toBe("pc:p:v2");
    expect(participationEventKey("participation_rejected", "p", 3)).toBe("pr:p:v3");
    expect(participationEventKey("new_pending_application", "p", 4)).toBe("app:p:v4");
    expect(gameChangeEventKey("game_cancelled", "g", 5)).toBe("gc:g:v5");
    expect(gameChangeEventKey("game_time_changed", "g", 6)).toBe("gt:g:v6");
    expect(gameChangeEventKey("game_venue_changed", "g", 7)).toBe("gv:g:v7");
    expect(reminderEventKey("r", 2)).toBe("or:r:o2");

    const gamePayload = {
      kind: "game_invitation" as const,
      eventKey: "inv:x:v1",
      recipientUserId: "r",
      actorUserId: "a",
      gameId: "g",
      gameVersion: 1,
      invitationId: "i",
    };
    expect(isWebPushGameEventDeliverPayload(gamePayload)).toBe(true);
    expect(isWebPushMessageDeliverPayload(gamePayload)).toBe(false);
    expect(isWebPushDeliverPayload(gamePayload)).toBe(true);
    expect(
      isWebPushMessageDeliverPayload({
        kind: "dm_message",
        messageId: "m",
        conversationId: "c",
        recipientUserId: "r",
        authorUserId: "a",
      }),
    ).toBe(true);
  });
});
