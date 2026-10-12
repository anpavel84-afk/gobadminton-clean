import { HttpException, HttpStatus } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  code: string;
  requestId: string;
  detail?: string;
};

export class ProblemHttpException extends HttpException {
  constructor(
    body: ProblemBody,
    status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(body, status);
  }
}

export function problem(
  status: number,
  code: string,
  title: string,
  detail?: string,
  retryAfterSeconds?: number,
): ProblemHttpException {
  const body: ProblemBody = {
    type: "about:blank",
    title,
    status,
    code,
    requestId: randomUUID(),
    ...(detail ? { detail } : {}),
  };
  return new ProblemHttpException(body, status, retryAfterSeconds);
}

export function unauthorized(code = "UNAUTHENTICATED", title = "Требуется вход"): HttpException {
  return problem(HttpStatus.UNAUTHORIZED, code, title);
}

export function forbidden(code: string, title: string, detail?: string): HttpException {
  return problem(HttpStatus.FORBIDDEN, code, title, detail);
}

export function badRequest(code: string, title: string, detail?: string): HttpException {
  return problem(HttpStatus.BAD_REQUEST, code, title, detail);
}

export function conflict(code: string, title: string, detail?: string): HttpException {
  return problem(HttpStatus.CONFLICT, code, title, detail);
}

export function commandInProgress(
  title = "Команда ещё выполняется",
  retryAfterSeconds = 1,
): ProblemHttpException {
  return problem(
    HttpStatus.CONFLICT,
    "COMMAND_IN_PROGRESS",
    title,
    "Повторите запрос с тем же Idempotency-Key после короткой паузы",
    retryAfterSeconds,
  );
}

export function notFound(code: string, title: string): HttpException {
  return problem(HttpStatus.NOT_FOUND, code, title);
}

export function unprocessable(
  code: string,
  title: string,
  detail?: string,
): HttpException {
  return problem(HttpStatus.UNPROCESSABLE_ENTITY, code, title, detail);
}

export function serviceUnavailable(
  code: string,
  title: string,
  detail?: string,
): HttpException {
  return problem(HttpStatus.SERVICE_UNAVAILABLE, code, title, detail);
}
