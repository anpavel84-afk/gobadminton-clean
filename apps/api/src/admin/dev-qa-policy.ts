import type { AppEnv } from "../config/env";
export const DEV_QA_LABEL = "gobad-qa-dev";
export const DEV_QA_AUDIENCE = "gobadminton-admin-dev-qa";
export const DEV_QA_USER_ID = "d0f04800-0000-4000-8000-000000000001";
export const DEV_QA_SESSION_SECONDS = 15 * 60;
export function devQaKeyAllowed(env: AppEnv): boolean {
  return env.ADMIN_DEV_QA_KEY_ENABLED && env.ADMIN_DEV_QA_VPS_VERIFIED
    && env.ADMIN_INTERNAL_ENABLED && env.ADMIN_DEV_ENABLED && env.ADMIN_DEV_PATH_ENABLED
    && env.NODE_ENV === "production" && ["mvp", "stage"].includes(env.APP_ENV)
    && env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru"
    && env.ADMIN_ORIGIN === "https://dev.gobadminton.ru" && env.COOKIE_SECURE !== false;
}
export function qaSessionRouteAllowed(method: string, rawUrl: string): boolean {
  const path = rawUrl.split("?")[0] ?? "";
  return (method === "GET" && ["/v1/admin/auth/me", "/v1/admin/pilot-metrics"].includes(path))
    || (method === "POST" && path === "/v1/admin/auth/logout");
}
