import type { FastifyInstance } from "fastify";
import { AVATAR_MAX_BYTES } from "./avatar-image";

/** Register before Nest routes; only this raw upload route gets the larger body budget. */
export function registerAvatarHttp(server: FastifyInstance): void {
  server.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: AVATAR_MAX_BYTES }, (_request, body, done) => done(null, body));
  server.addHook("onRoute", (route) => {
    if (route.url === "/v1/me/avatar" && route.method === "PUT") route.bodyLimit = AVATAR_MAX_BYTES;
  });
}
