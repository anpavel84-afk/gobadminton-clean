import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { ProblemHttpException } from "../../src/auth/problem";
import {
  isWebPushDeliverPayload,
  isWebPushMessageDeliverPayload,
} from "../../src/jobs/payloads";
import {
  buildEncryptedPushRequest,
  classifyWebPushTransportError,
} from "../../src/push/push-delivery";
import {
  PUSH_COPY,
  WEB_PUSH_MAX_DEVICES,
  accountFence,
  assertSafeSameOriginPath,
  hashPushEndpoint,
  validatePushEndpoint,
  validatePushKeys,
} from "../../src/push/push.policy";

describe("#456 web push policy + offline library encrypt", () => {
  it("rejects private/arbitrary HTTPS endpoints and accepts known hosts", () => {
    expect(() => validatePushEndpoint("http://fcm.googleapis.com/fcm/send/x")).toThrow(
      ProblemHttpException,
    );
    expect(() =>
      validatePushEndpoint("https://127.0.0.1/fcm/send/x"),
    ).toThrow(ProblemHttpException);
    expect(() =>
      validatePushEndpoint("https://evil.example/push/token"),
    ).toThrow(ProblemHttpException);
    const ok = validatePushEndpoint(
      "https://fcm.googleapis.com/fcm/send/abc123tokenpath",
    );
    expect(ok.host).toBe("fcm.googleapis.com");
    expect(ok.endpointHash).toBe(
      hashPushEndpoint("https://fcm.googleapis.com/fcm/send/abc123tokenpath"),
    );
    expect(
      validatePushEndpoint("https://web.push.apple.com/push/v1/deviceTokenHere")
        .host,
    ).toBe("web.push.apple.com");
  });

  it("validates keys and keeps payload copy neutral", () => {
    expect(() => validatePushKeys({ p256dh: "!!", auth: "x" })).toThrow(
      ProblemHttpException,
    );
    const keys = validatePushKeys({
      p256dh: "BNcRdreALRFXTkOOUHM6SWjsPeUqlu-EXAMPLEKEY",
      auth: "tBHIEXAMPLEAUTH",
    });
    expect(keys.p256dh.length).toBeGreaterThan(8);
    expect(PUSH_COPY.dm_message).toBe("Новое сообщение");
    expect(PUSH_COPY.game_chat_message).toBe("Новое сообщение в чате игры");
    expect(WEB_PUSH_MAX_DEVICES).toBe(5);
    expect(
      assertSafeSameOriginPath(
        "/messages?conversation=11111111-1111-4111-8111-111111111111",
        "dm_message",
      ),
    ).toContain("/messages?conversation=");
    expect(
      assertSafeSameOriginPath("/evil", "dm_message"),
    ).toBe("/messages");
    expect(accountFence("pepper-at-least-thirty-two-chars!!!!", "user")).toHaveLength(
      32,
    );
  });

  it("accepts recover_intents sweep payload separately from message deliver", () => {
    expect(isWebPushDeliverPayload({ kind: "recover_intents" })).toBe(true);
    expect(isWebPushMessageDeliverPayload({ kind: "recover_intents" })).toBe(false);
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

  it("builds VAPID encrypted request offline without network", () => {
    const vapid = webpush.generateVAPIDKeys();
    const userKeys = webpush.generateVAPIDKeys();
    // userKeys.publicKey/privateKey are not push subscription keys; generate via subscribe mock material:
    // web-push accepts any valid URL-safe base64 key pair shape from generateVAPIDKeys for request details.
    const details = buildEncryptedPushRequest({
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKey: vapid.privateKey,
      vapidSubject: "mailto:push-test@gobadminton.invalid",
      endpoint: "https://fcm.googleapis.com/fcm/send/offline-unit-token",
      p256dh: userKeys.publicKey,
      auth: Buffer.from("unit-auth-secret-bytes").toString("base64url"),
      payload: JSON.stringify({
        title: PUSH_COPY.dm_message,
        path: "/messages",
        fence: "abc",
        tag: "gb-msg-x",
      }),
    });
    expect(details.method).toBe("POST");
    expect(details.body).toBeTruthy();
    expect(details.headers).toBeTruthy();
    const headerBlob = JSON.stringify(details.headers);
    expect(headerBlob).not.toMatch(/PRIVATE_KEY|endpoint_sealed/);
  });

  it("classifies known HTTP failure vs ambiguous claim/transport", () => {
    const known503 = classifyWebPushTransportError({ statusCode: 503 });
    expect(known503).toEqual({ statusCode: 503, permanent: false });
    expect(known503.unknown).toBeUndefined();

    const gone = classifyWebPushTransportError({ statusCode: 410 });
    expect(gone).toEqual({ statusCode: 410, permanent: true });

    const ambiguousNetwork = classifyWebPushTransportError(new Error("socket hang up"));
    expect(ambiguousNetwork).toEqual({
      statusCode: 0,
      permanent: false,
      unknown: true,
    });

    const ambiguousTimeout = classifyWebPushTransportError({ code: "ETIMEDOUT" });
    expect(ambiguousTimeout.unknown).toBe(true);
    expect(ambiguousTimeout.statusCode).toBe(0);
  });
});
