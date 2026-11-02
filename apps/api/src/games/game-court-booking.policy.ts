import { z } from "zod";
import { notFound, unprocessable } from "../auth/problem";
import { parseGameId, uuid } from "./game-outcomes.policy";

export { parseGameId, uuid };

export const COURT_BOOKING_STATUSES = [
  "unspecified",
  "arranging",
  "organizer_confirmed",
  "not_arranged",
] as const;

export type CourtBookingStatus = (typeof COURT_BOOKING_STATUSES)[number];

export const COURT_BOOKING_LABELS: Record<CourtBookingStatus, string> = {
  unspecified: "Не указано",
  arranging: "Договариваемся",
  organizer_confirmed: "Подтверждено организатором",
  not_arranged: "Не удалось договориться",
};

export const putCourtBookingRequest = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483647),
    status: z.enum(COURT_BOOKING_STATUSES),
  })
  .strict();

export type PutCourtBookingRequest = z.infer<typeof putCourtBookingRequest>;

export type CourtBookingAllowedActions = {
  canUpdate: boolean;
};

export type CourtBookingView = {
  gameId: string;
  status: CourtBookingStatus;
  version: number;
  updatedAt: string | null;
  declarationSource: "organizer_declared";
  allowedActions: CourtBookingAllowedActions;
};

export type CourtBookingRow = {
  game_id: string;
  status: CourtBookingStatus;
  version: number;
  declaration_source: "organizer_declared";
  actor_user_id: string;
  updated_at: Date;
  created_at: Date;
};

export function parse<T>(schema: z.ZodType<T>, input: unknown, code = "COURT_BOOKING_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable(code, "Некорректный запрос о договорённости о корте");
  return result.data;
}

export function unavailable(): never {
  throw notFound("GAME_NOT_FOUND", "Игра не найдена");
}

export function initialCourtBooking(gameId: string, canUpdate: boolean): CourtBookingView {
  return {
    gameId,
    status: "unspecified",
    version: 0,
    updatedAt: null,
    declarationSource: "organizer_declared",
    allowedActions: { canUpdate },
  };
}

export function projectCourtBooking(
  row: CourtBookingRow | null,
  gameId: string,
  canUpdate: boolean,
): CourtBookingView {
  if (!row) return initialCourtBooking(gameId, canUpdate);
  return {
    gameId: row.game_id,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    declarationSource: "organizer_declared",
    allowedActions: { canUpdate },
  };
}
