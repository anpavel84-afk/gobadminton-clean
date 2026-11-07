import { describe, expect, it } from "vitest";
import {
  isWebPushDeliverPayload,
  isWebPushGameEventDeliverPayload,
  isWebPushMessageDeliverPayload,
} from "../../src/jobs/payloads";
import {
  DEFERRED_GAME_PUSH_KINDS,
  GAME_PUSH_COPY,
  GAME_PUSH_DISPOSABLE_DB_NAME,
  GAME_PUSH_KINDS,
  assertSafeGamePushPath,
  eventGroupForKind,
  isDeferredGamePushKind,
  isGamePushDisposableDatabaseUrl,
  isGamePushKind,
  pathForGamePush,
} from "../../src/push/game-push.policy";
import {
  eventKeyMatchesGameChange,
  eventKeyMatchesInvitation,
  eventKeyMatchesParticipation,
  eventKeyMatchesReminder,
  gameChangeEventKey,
  invitationEventKey,
  participationEventKey,
  reminderEventKey,
} from "../../src/push/game-push-intents";

describe("#496 game event push policy", () => {
  it("covers six released business kinds with neutral Russian copy and safe paths", () => {
    expect(GAME_PUSH_KINDS).toHaveLength(6);
    expect(GAME_PUSH_COPY.game_invitation).toBe("Приглашение на игру");
    expect(GAME_PUSH_COPY.participation_confirmed).toBe("Заявка подтверждена");
    expect(GAME_PUSH_COPY.participation_rejected).toBe("Заявка отклонена");
    expect(GAME_PUSH_COPY.new_pending_application).toBe("Новая заявка на игру");
    expect(GAME_PUSH_COPY.game_cancelled).toBe("Игра отменена");
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
    expect(eventGroupForKind("game_cancelled")).toBe("gameChanges");
    expect(eventGroupForKind("outcome_reminder")).toBe("outcomeReminders");
  });

  it("rejects deferred time/venue kinds at policy and payload gates", () => {
    expect(DEFERRED_GAME_PUSH_KINDS).toEqual([
      "game_time_changed",
      "game_venue_changed",
    ]);
    expect(isDeferredGamePushKind("game_time_changed")).toBe(true);
    expect(isDeferredGamePushKind("game_venue_changed")).toBe(true);
    expect(isGamePushKind("game_time_changed")).toBe(false);
    expect(isGamePushKind("game_venue_changed")).toBe(false);
    expect(isGamePushKind("game_cancelled")).toBe(true);
    const deferredPayload = {
      kind: "game_time_changed",
      eventKey: "gt:g:v6",
      recipientUserId: "r",
      actorUserId: "a",
      gameId: "g",
      gameVersion: 6,
    };
    expect(isWebPushGameEventDeliverPayload(deferredPayload)).toBe(false);
    expect(isWebPushDeliverPayload(deferredPayload)).toBe(false);
    expect(
      isWebPushGameEventDeliverPayload({
        ...deferredPayload,
        kind: "game_venue_changed",
        eventKey: "gv:g:v7",
      }),
    ).toBe(false);
  });

  it("builds stable event keys and accepts game payloads separately from messages", () => {
    expect(invitationEventKey("a", 1)).toBe("inv:a:v1");
    expect(participationEventKey("participation_confirmed", "p", 2)).toBe("pc:p:v2");
    expect(participationEventKey("participation_rejected", "p", 3)).toBe("pr:p:v3");
    expect(participationEventKey("new_pending_application", "p", 4)).toBe("app:p:v4");
    expect(gameChangeEventKey("game_cancelled", "g", 5)).toBe("gc:g:v5");
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

  it("rejects stale eventKey versions via trusted builders", () => {
    expect(eventKeyMatchesInvitation("inv:a:v1", "a", 1)).toBe(true);
    expect(eventKeyMatchesInvitation("inv:a:v1", "a", 2)).toBe(false);
    expect(eventKeyMatchesInvitation("inv:a:v2", "a", 1)).toBe(false);
    expect(
      eventKeyMatchesParticipation("pc:p:v2", "participation_confirmed", "p", 2),
    ).toBe(true);
    expect(
      eventKeyMatchesParticipation("pc:p:v1", "participation_confirmed", "p", 2),
    ).toBe(false);
    expect(
      eventKeyMatchesParticipation("pr:p:v3", "participation_rejected", "p", 3),
    ).toBe(true);
    expect(
      eventKeyMatchesParticipation("app:p:v4", "new_pending_application", "p", 4),
    ).toBe(true);
    expect(eventKeyMatchesGameChange("gc:g:v5", "game_cancelled", "g", 5)).toBe(
      true,
    );
    expect(eventKeyMatchesGameChange("gc:g:v4", "game_cancelled", "g", 5)).toBe(
      false,
    );
    expect(eventKeyMatchesReminder("or:r:o2", "r", 2)).toBe(true);
    expect(eventKeyMatchesReminder("or:r:o1", "r", 2)).toBe(false);
  });

  it("CI disposable guard allows only dedicated local DB or strict Actions recipe", () => {
    expect(
      isGamePushDisposableDatabaseUrl({
        databaseUrl: `postgres://u:p@127.0.0.1:5432/${GAME_PUSH_DISPOSABLE_DB_NAME}`,
        nodeEnv: "test",
      }),
    ).toBe(true);
    expect(
      isGamePushDisposableDatabaseUrl({
        databaseUrl: "postgres://u:p@127.0.0.1:55432/gobadminton",
        nodeEnv: "test",
        githubActions: "true",
        gmap1DisposableDb: "1",
        pgContainer: "gb-ci-1-2-3",
        ciDbPort: "55432",
      }),
    ).toBe(true);
    expect(
      isGamePushDisposableDatabaseUrl({
        databaseUrl: "postgres://u:p@127.0.0.1:5432/gobadminton",
        nodeEnv: "test",
      }),
    ).toBe(false);
    expect(
      isGamePushDisposableDatabaseUrl({
        databaseUrl: "postgres://u:p@db.example:5432/gobadminton_game_push_disposable",
        nodeEnv: "test",
      }),
    ).toBe(false);
    expect(
      isGamePushDisposableDatabaseUrl({
        databaseUrl: "postgres://u:p@127.0.0.1:5432/postgres",
        nodeEnv: "test",
        githubActions: "true",
        gmap1DisposableDb: "1",
        pgContainer: "gb-ci-1-2-3",
        ciDbPort: "5432",
      }),
    ).toBe(false);
  });
});
