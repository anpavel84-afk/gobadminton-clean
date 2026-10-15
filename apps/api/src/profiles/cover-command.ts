import { badRequest } from "../auth/problem";

/** Cover DELETE is a JSON command. Both CAS representations must agree. */
export function coverDeleteVersion(body: unknown, header: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("INVALID_COVER_COMMAND", "Укажите версию профиля");
  const command = body as Record<string, unknown>;
  const version = command.expectedVersion;
  if (Object.keys(command).length !== 1 || typeof version !== "number" || !Number.isInteger(version) || version < 0 || version > 2147483647) {
    throw badRequest("INVALID_COVER_COMMAND", "Укажите допустимую версию профиля");
  }
  if (header !== String(version)) throw badRequest("INVALID_COVER_COMMAND", "Версии профиля не совпадают");
  return String(version);
}
