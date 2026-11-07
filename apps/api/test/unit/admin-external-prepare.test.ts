import { describe, expect, it } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";
import {
  adminReceiptReservationState,
  isAdminKnownModerationReject,
  shouldReleaseAdminExternalPrepareClaim,
} from "../../src/admin/admin.service";

/** Pre-63 receipts omit reservation_state; present 63 states stay exact. */
describe("admin ordinary receipt reservation_state compatibility", () => {
  it("absent or null reservation_state means historical completed only", () => {
    expect(adminReceiptReservationState({})).toBe("completed");
    expect(adminReceiptReservationState({ reservation_state: null })).toBe(
      "completed",
    );
    expect(adminReceiptReservationState({ reservation_state: undefined })).toBe(
      "completed",
    );
  });

  it("present processing/unknown/error are never coalesced to completed", () => {
    expect(
      adminReceiptReservationState({ reservation_state: "processing" }),
    ).toBe("processing");
    expect(adminReceiptReservationState({ reservation_state: "unknown" })).toBe(
      "unknown",
    );
    expect(adminReceiptReservationState({ reservation_state: "error" })).toBe(
      "error",
    );
    expect(
      adminReceiptReservationState({ reservation_state: "completed" }),
    ).toBe("completed");
  });
});

/** Known moderation REJECT (422) vs ordinary validation/budget release — no payment wire. */
describe("admin external-prepare known moderation reject helpers", () => {
  const knownReject = new HttpException(
    {
      type: "about:blank",
      title: "Измените текст и попробуйте снова",
      status: 422,
      code: "PUBLIC_TEXT_CONTENT_REJECTED",
      fields: { text: "Измените текст отзыва" },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

  it("classifies PUBLIC_TEXT_CONTENT_REJECTED as known moderation reject (not a paid hint)", () => {
    expect(isAdminKnownModerationReject(knownReject)).toBe(true);
    expect(shouldReleaseAdminExternalPrepareClaim(knownReject)).toBe(false);
  });

  it("ordinary validation 429 still releases (unpaid cleanup)", () => {
    const rateLimited = new HttpException(
      {
        type: "about:blank",
        title: "Слишком много запросов",
        status: 429,
        code: "RATE_LIMITED",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(isAdminKnownModerationReject(rateLimited)).toBe(false);
    expect(shouldReleaseAdminExternalPrepareClaim(rateLimited)).toBe(true);
  });

  it("ordinary VERSION_CONFLICT 409 still releases", () => {
    const conflict = new HttpException(
      {
        type: "about:blank",
        title: "Конфликт",
        status: 409,
        code: "VERSION_CONFLICT",
      },
      HttpStatus.CONFLICT,
    );
    expect(isAdminKnownModerationReject(conflict)).toBe(false);
    expect(shouldReleaseAdminExternalPrepareClaim(conflict)).toBe(true);
  });

  it("503 unknown stays sealed (no release)", () => {
    const unavailable = new HttpException(
      {
        type: "about:blank",
        title: "Временно недоступно",
        status: 503,
        code: "MODERATION_TEMPORARILY_UNAVAILABLE",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(isAdminKnownModerationReject(unavailable)).toBe(false);
    expect(shouldReleaseAdminExternalPrepareClaim(unavailable)).toBe(false);
  });

  it("COMMAND_IN_PROGRESS 409 does not release", () => {
    const cip = new HttpException(
      {
        type: "about:blank",
        title: "В процессе",
        status: 409,
        code: "COMMAND_IN_PROGRESS",
      },
      HttpStatus.CONFLICT,
    );
    expect(shouldReleaseAdminExternalPrepareClaim(cip)).toBe(false);
  });
});
