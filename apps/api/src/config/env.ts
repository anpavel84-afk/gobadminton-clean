import { z } from "zod";

const appEnvSchema = z.enum(["local", "mvp", "stage", "prod"]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function splitCsv(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: appEnvSchema.default("local"),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default("127.0.0.1"),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
        { message: "DATABASE_URL must be a PostgreSQL connection string" },
      ),
    PUBLIC_API_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        const hostname = new URL(value).hostname;
        if (isLoopbackHostname(hostname)) return true;
        return !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
      }, {
        message:
          "PUBLIC_API_ORIGIN must be a hostname (or loopback). Do not hard-code a public VPS IP.",
      }),
    PUBLIC_WEB_ORIGIN: z
      .string()
      .url()
      .default("http://127.0.0.1:3001")
      .refine((value) => {
        const hostname = new URL(value).hostname;
        if (isLoopbackHostname(hostname)) return true;
        return !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
      }, {
        message:
          "PUBLIC_WEB_ORIGIN must be a hostname (or loopback). Do not hard-code a public VPS IP.",
      }),
    ALLOWED_WEB_ORIGINS: z.string().optional(),
    AUTH_PEPPER: z
      .string()
      .min(32, "AUTH_PEPPER must be at least 32 characters")
      .default("local-only-dev-auth-pepper-change-me!!"),
    CASES_INTERNAL_ENABLED: z.enum(["0", "1"]).default("0"),
    CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS: z.coerce.number().int().positive().max(86400).optional(),
    USER_RESTRICTIONS_INTERNAL_ENABLED: z.enum(["0", "1"]).default("0"),
    GAME_MODERATION_INTERNAL_ENABLED: z.enum(["0", "1"]).default("0"),
    ADMIN_INTERNAL_ENABLED: z.enum(["0", "1"]).default("0"),
    ADMIN_DEV_ENABLED: z.enum(["0", "1"]).default("0"),
    ADMIN_ORIGIN: z.string().url().default("http://localhost:18540"),
    ADMIN_AUTH_PEPPER: z.string().min(32).optional(),
    ADMIN_VK_REDIRECT_URI: z.string().url().optional(),
    ADMIN_YANDEX_REDIRECT_URI: z.string().url().optional(),
    EMAIL_AUTH_TRANSPORT: z.enum(["fake"]).optional(),
    EMAIL_AUTH_HMAC_SECRET: z.string().min(32).optional(),
    EMAIL_AUTH_ENCRYPTION_SECRET: z.string().min(32).optional(),
    EMAIL_AUTH_RATE_SECRET: z.string().min(32).optional(),
    EMAIL_AUTH_GLOBAL_HOURLY_BUDGET: z.coerce.number().int().positive().max(10000).default(1000),
    AUTH_TRANSACTION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    COOKIE_SECURE: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        return value === "1" || value === "true";
      }),
    CONTENT_MODERATION_PROVIDER: z.enum(["openai", "fake"]).optional(),
    CONTENT_MODERATION_FINGERPRINT_SECRET: z.string().min(32).optional(),
    OPENAI_MODERATION_API_KEY: z.string().min(1).optional(),
    OPENAI_MODERATION_BASE_URL: z.enum(["https://api.openai.com/v1", "https://eu.api.openai.com/v1"]).default("https://api.openai.com/v1"),
    AVATAR_MEDIA_ROOT: z.string().startsWith("/").optional(),
    GIT_SHA: z.string().min(1).default("unknown"),
    SERVICE_NAME: z.string().min(1).default("gobadminton-api"),
    VK_CLIENT_ID: z.string().optional(),
    VK_CLIENT_SECRET: z.string().optional(),
    VK_REDIRECT_URI: z.string().url().optional().or(z.literal("")),
    YANDEX_CLIENT_ID: z.string().optional(),
    YANDEX_CLIENT_SECRET: z.string().optional(),
    YANDEX_REDIRECT_URI: z.string().url().optional().or(z.literal("")),
    FRIENDS_INTERNAL_ENABLED: z.enum(["0", "1"]).default("0"),
    FRIENDS_REQUEST_TTL_SECONDS: z.coerce.number().int().positive().safe().optional(),
    FRIENDS_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().safe().optional(),
    FRIENDS_SEND_LIMIT: z.coerce.number().int().positive().max(2147483647).optional(),
    FRIENDS_RECEIVE_LIMIT: z.coerce.number().int().positive().max(2147483647).optional(),
    SOCIAL_DIRECTORY_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    /** Root-only DEV opt-in; owner receives simulated GPS, authenticated viewers see TEST peers. */
    RADAR_DEV_MAP_PREVIEW_ENABLED: z.enum(["0", "1"]).default("0"),
    RADAR_DEV_MAP_PREVIEW_VERSION: z.string().optional(),
    RADAR_DEV_MAP_PREVIEW_STYLE_SHA256: z.string().optional(),
    RADAR_DEV_TEST_OWNER_USER_ID: z.uuid().optional(),
    RADAR_DEV_TEST_SECOND_USER_ID: z.uuid().optional(),
    /** Source-staged geographic cutover; default off, separate from legacy mode flags. */
    RADAR_GEOGRAPHIC_TOKEN_EPOCH: z.string().min(1).max(128).default("source-stage-v1"),
    SOCIAL_RADAR_UNIFIED_ENABLED: z.enum(["0", "1", "true", "false"]).optional().transform(value => value === "1" || value === "true"),
    SOCIAL_RADAR_PUBLISHING_V2_ENABLED: z.enum(["0", "1", "true", "false"]).optional().transform(value => value === "1" || value === "true"),
    SOCIAL_RADAR_GEOGRAPHIC_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    SOCIAL_RADAR_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    /** Synthetic/internal city-scoped Radar demo; independent of live SOCIAL_RADAR_ENABLED. */
    SOCIAL_RADAR_DEMO_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    /** Explicit owner/test-only user IDs allowed to activate Radar outside admitted live regions. */
    SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS: z.string().optional(),
    SOCIAL_DM_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    SOCIAL_DM_REQUEST_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(60 * 24 * 60 * 60)
      .default(7 * 24 * 60 * 60),
    SOCIAL_DM_MESSAGE_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60)
      .default(90 * 24 * 60 * 60),
    SOCIAL_INVITATIONS_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    SOCIAL_INVITATION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(60 * 24 * 60 * 60)
      .default(7 * 24 * 60 * 60),
    SOCIAL_GAME_CHAT_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
    SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60)
      .default(90 * 24 * 60 * 60),
    SOCIAL_INBOX_ENABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),
  })
  .superRefine((raw, ctx) => {
    if (raw.FRIENDS_INTERNAL_ENABLED === "1" && (raw.NODE_ENV === "production" || raw.APP_ENV === "prod")) {
      const dev = ["mvp", "stage"].includes(raw.APP_ENV)
        && raw.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
        && raw.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru";
      const bounded = raw.FRIENDS_REQUEST_TTL_SECONDS !== undefined && raw.FRIENDS_REQUEST_TTL_SECONDS <= 30 * 86400
        && raw.FRIENDS_RATE_WINDOW_SECONDS !== undefined && raw.FRIENDS_RATE_WINDOW_SECONDS <= 86400
        && raw.FRIENDS_SEND_LIMIT !== undefined && raw.FRIENDS_SEND_LIMIT <= 100
        && raw.FRIENDS_RECEIVE_LIMIT !== undefined && raw.FRIENDS_RECEIVE_LIMIT <= 100;
      if (!dev || !raw.SOCIAL_DIRECTORY_ENABLED || !bounded) {
        ctx.addIssue({code:"custom", path:["FRIENDS_INTERNAL_ENABLED"],
          message:"Friends production runtime requires exact DEV origins, mvp/stage, directory and bounded explicit TTL/rate limits; PROD forbidden"});
      }
    }
    if (raw.RADAR_DEV_TEST_SECOND_USER_ID && !raw.RADAR_DEV_TEST_OWNER_USER_ID) {
      ctx.addIssue({code:"custom",path:["RADAR_DEV_TEST_SECOND_USER_ID"],message:"Second Moscow test actor requires the existing owner capability"});
    }
    if ((raw.RADAR_DEV_TEST_OWNER_USER_ID || raw.RADAR_DEV_TEST_SECOND_USER_ID) && (!["mvp", "stage"].includes(raw.APP_ENV) || raw.PUBLIC_WEB_ORIGIN !== "https://dev.gobadminton.ru" || raw.PUBLIC_API_ORIGIN !== "https://dev.gobadminton.ru")) {
      ctx.addIssue({code:"custom",path:["RADAR_DEV_TEST_OWNER_USER_ID"],message:"Moscow test capability requires exact DEV API/web origins and mvp/stage; forbidden in PROD"});
    }
    if (raw.CASES_INTERNAL_ENABLED === "1" && raw.ADMIN_INTERNAL_ENABLED !== "1") {
      ctx.addIssue({code:"custom",path:["CASES_INTERNAL_ENABLED"],message:"Cases require local internal Admin"});
    }
    if (raw.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS !== undefined && (raw.CASES_INTERNAL_ENABLED !== "1" || raw.NODE_ENV !== "test" || raw.APP_ENV !== "local")) {
      ctx.addIssue({code:"custom",path:["CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS"],message:"Evidence policy requires explicit test/local cases simulation"});
    }
    if (raw.USER_RESTRICTIONS_INTERNAL_ENABLED === "1" && raw.ADMIN_INTERNAL_ENABLED !== "1") {
      ctx.addIssue({code:"custom",path:["USER_RESTRICTIONS_INTERNAL_ENABLED"],message:"User restrictions are local Admin simulation only; public rollout disabled"});
    }
    if (raw.GAME_MODERATION_INTERNAL_ENABLED === "1" && raw.ADMIN_INTERNAL_ENABLED !== "1") {
      ctx.addIssue({code:"custom",path:["GAME_MODERATION_INTERNAL_ENABLED"],message:"Game moderation is local Admin simulation only; public rollout disabled"});
    }
    if (raw.ADMIN_DEV_ENABLED === "1" && raw.ADMIN_INTERNAL_ENABLED !== "1") {
      ctx.addIssue({code:"custom",path:["ADMIN_DEV_ENABLED"],message:"DEV opt-in requires Admin enabled"});
    }
    if (raw.ADMIN_INTERNAL_ENABLED === "1") {
      const origin = new URL(raw.ADMIN_ORIGIN);
      const db = new URL(raw.DATABASE_URL);
      const local = raw.ADMIN_DEV_ENABLED === "0" && raw.NODE_ENV === "test" && raw.APP_ENV === "local"
        && ["localhost", "127.0.0.1", "::1"].includes(raw.HOST)
        && ["localhost", "127.0.0.1", "[::1]"].includes(db.hostname)
        && origin.hostname === "localhost" && ["http:", "https:"].includes(origin.protocol);
      const dev = raw.ADMIN_DEV_ENABLED === "1" && raw.NODE_ENV === "production"
        && ["mvp", "stage"].includes(raw.APP_ENV)
        && raw.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
        && raw.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru"
        && raw.ADMIN_ORIGIN === "https://dev-admin.gobadminton.ru"
        && raw.COOKIE_SECURE !== false;
      const redirects = (["VK", "YANDEX"] as const).every(provider => {
        const uri = raw[provider === "VK" ? "ADMIN_VK_REDIRECT_URI" : "ADMIN_YANDEX_REDIRECT_URI"];
        if (!uri) return !dev;
        return uri === `${raw.ADMIN_ORIGIN}/v1/admin/auth/${provider.toLowerCase()}/callback`;
      });
      const providerConfigured = Boolean(
        (raw.VK_CLIENT_ID?.trim() && raw.VK_CLIENT_SECRET?.trim() && raw.ADMIN_VK_REDIRECT_URI) ||
        (raw.YANDEX_CLIENT_ID?.trim() && raw.YANDEX_CLIENT_SECRET?.trim() && raw.ADMIN_YANDEX_REDIRECT_URI));
      const sharedSecrets = [raw.AUTH_PEPPER, raw.EMAIL_AUTH_HMAC_SECRET, raw.EMAIL_AUTH_ENCRYPTION_SECRET,
        raw.EMAIL_AUTH_RATE_SECRET, raw.CONTENT_MODERATION_FINGERPRINT_SECRET, raw.VK_CLIENT_SECRET, raw.YANDEX_CLIENT_SECRET];
      if ((!local && !dev) || origin.origin !== raw.ADMIN_ORIGIN || origin.username || origin.password ||
          raw.ADMIN_ORIGIN === raw.PUBLIC_WEB_ORIGIN || splitCsv(raw.ALLOWED_WEB_ORIGINS).includes(raw.ADMIN_ORIGIN) ||
          !redirects || (dev && !providerConfigured) ||
          !raw.ADMIN_AUTH_PEPPER || sharedSecrets.includes(raw.ADMIN_AUTH_PEPPER)) {
        ctx.addIssue({code:"custom",path:["ADMIN_INTERNAL_ENABLED"],message:"Admin requires isolated local test or explicit Germany DEV, exact separate origin/redirects and dedicated secret; PROD forbidden"});
      }
    }
    if (raw.EMAIL_AUTH_TRANSPORT) {
      if (raw.NODE_ENV !== "test" || raw.APP_ENV !== "local" ||
          ![raw.PUBLIC_API_ORIGIN, raw.PUBLIC_WEB_ORIGIN, ...splitCsv(raw.ALLOWED_WEB_ORIGINS)].every(origin =>
            ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) ||
          !["localhost", "127.0.0.1", "::1"].includes(raw.HOST)) {
        ctx.addIssue({code: "custom", path: ["EMAIL_AUTH_TRANSPORT"], message: "Fake mail requires loopback local NODE_ENV=test"});
      }
      const secrets = [raw.EMAIL_AUTH_HMAC_SECRET, raw.EMAIL_AUTH_ENCRYPTION_SECRET, raw.EMAIL_AUTH_RATE_SECRET];
      if (secrets.some(secret => !secret) || new Set(secrets).size !== 3 || secrets.includes(raw.AUTH_PEPPER)) {
        ctx.addIssue({code: "custom", path: ["EMAIL_AUTH_HMAC_SECRET"], message: "Three distinct dedicated email secrets required"});
      }
    }
    if (raw.CONTENT_MODERATION_PROVIDER === "fake" && (raw.NODE_ENV !== "test" || raw.APP_ENV !== "local")) {
      ctx.addIssue({code: "custom", path: ["CONTENT_MODERATION_PROVIDER"], message: "Fake moderation requires local NODE_ENV=test"});
    }
    if (raw.NODE_ENV !== "test" && raw.CONTENT_MODERATION_PROVIDER !== "openai") {
      ctx.addIssue({code: "custom", path: ["CONTENT_MODERATION_PROVIDER"], message: "Non-test startup requires OpenAI moderation configuration"});
    }
    if (raw.CONTENT_MODERATION_PROVIDER && !raw.CONTENT_MODERATION_FINGERPRINT_SECRET) {
      ctx.addIssue({code: "custom", path: ["CONTENT_MODERATION_FINGERPRINT_SECRET"], message: "Dedicated moderation fingerprint secret is required"});
    }
    if (raw.CONTENT_MODERATION_PROVIDER === "openai" && !raw.OPENAI_MODERATION_API_KEY) {
      ctx.addIssue({code: "custom", path: ["OPENAI_MODERATION_API_KEY"], message: "Moderation API key is required"});
    }
  })
  .transform((raw) => {
    const allowedFromCsv = splitCsv(raw.ALLOWED_WEB_ORIGINS);
    const allowedWebOrigins = Array.from(
      new Set([raw.PUBLIC_WEB_ORIGIN, ...allowedFromCsv]),
    );

    const cookieSecure =
      raw.COOKIE_SECURE ??
      (raw.APP_ENV === "local" || raw.NODE_ENV === "test"
        ? !isLoopbackHostname(new URL(raw.PUBLIC_API_ORIGIN).hostname)
        : true);

    return {
      NODE_ENV: raw.NODE_ENV,
      APP_ENV: raw.APP_ENV,
      PORT: raw.PORT,
      HOST: raw.HOST,
      DATABASE_URL: raw.DATABASE_URL,
      PUBLIC_API_ORIGIN: raw.PUBLIC_API_ORIGIN,
      PUBLIC_WEB_ORIGIN: raw.PUBLIC_WEB_ORIGIN,
      ALLOWED_WEB_ORIGINS: allowedWebOrigins,
      AUTH_PEPPER: raw.AUTH_PEPPER,
      CASES_INTERNAL_ENABLED: raw.CASES_INTERNAL_ENABLED === "1",
      CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS: raw.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS,
      USER_RESTRICTIONS_INTERNAL_ENABLED: raw.USER_RESTRICTIONS_INTERNAL_ENABLED === "1",
      GAME_MODERATION_INTERNAL_ENABLED: raw.GAME_MODERATION_INTERNAL_ENABLED === "1",
      ADMIN_INTERNAL_ENABLED: raw.ADMIN_INTERNAL_ENABLED === "1",
      ADMIN_DEV_ENABLED: raw.ADMIN_DEV_ENABLED === "1",
      ADMIN_ORIGIN: raw.ADMIN_ORIGIN,
      ADMIN_AUTH_PEPPER: raw.ADMIN_AUTH_PEPPER,
      ADMIN_VK_REDIRECT_URI: raw.ADMIN_VK_REDIRECT_URI,
      ADMIN_YANDEX_REDIRECT_URI: raw.ADMIN_YANDEX_REDIRECT_URI,
      EMAIL_AUTH_TRANSPORT: raw.EMAIL_AUTH_TRANSPORT,
      EMAIL_AUTH_HMAC_SECRET: raw.EMAIL_AUTH_HMAC_SECRET,
      EMAIL_AUTH_ENCRYPTION_SECRET: raw.EMAIL_AUTH_ENCRYPTION_SECRET,
      EMAIL_AUTH_RATE_SECRET: raw.EMAIL_AUTH_RATE_SECRET,
      EMAIL_AUTH_GLOBAL_HOURLY_BUDGET: raw.EMAIL_AUTH_GLOBAL_HOURLY_BUDGET,
      AUTH_TRANSACTION_TTL_SECONDS: raw.AUTH_TRANSACTION_TTL_SECONDS,
      SESSION_TTL_SECONDS: raw.SESSION_TTL_SECONDS,
      COOKIE_SECURE: cookieSecure,
      AVATAR_MEDIA_ROOT: raw.AVATAR_MEDIA_ROOT,
      CONTENT_MODERATION_PROVIDER: raw.CONTENT_MODERATION_PROVIDER,
      CONTENT_MODERATION_FINGERPRINT_SECRET: raw.CONTENT_MODERATION_FINGERPRINT_SECRET,
      OPENAI_MODERATION_API_KEY: raw.OPENAI_MODERATION_API_KEY,
      OPENAI_MODERATION_BASE_URL: raw.OPENAI_MODERATION_BASE_URL,
      GIT_SHA: raw.GIT_SHA,
      SERVICE_NAME: raw.SERVICE_NAME,
      VK_CLIENT_ID: optionalNonEmpty(raw.VK_CLIENT_ID),
      VK_CLIENT_SECRET: optionalNonEmpty(raw.VK_CLIENT_SECRET),
      VK_REDIRECT_URI: optionalNonEmpty(raw.VK_REDIRECT_URI),
      YANDEX_CLIENT_ID: optionalNonEmpty(raw.YANDEX_CLIENT_ID),
      YANDEX_CLIENT_SECRET: optionalNonEmpty(raw.YANDEX_CLIENT_SECRET),
      YANDEX_REDIRECT_URI: optionalNonEmpty(raw.YANDEX_REDIRECT_URI),
      FRIENDS_INTERNAL_ENABLED: raw.FRIENDS_INTERNAL_ENABLED === "1",
      FRIENDS_REQUEST_TTL_SECONDS: raw.FRIENDS_REQUEST_TTL_SECONDS,
      FRIENDS_RATE_WINDOW_SECONDS: raw.FRIENDS_RATE_WINDOW_SECONDS,
      FRIENDS_SEND_LIMIT: raw.FRIENDS_SEND_LIMIT,
      FRIENDS_RECEIVE_LIMIT: raw.FRIENDS_RECEIVE_LIMIT,
      SOCIAL_DIRECTORY_ENABLED: raw.SOCIAL_DIRECTORY_ENABLED ?? false,
      RADAR_DEV_MAP_PREVIEW_ENABLED: raw.RADAR_DEV_MAP_PREVIEW_ENABLED === "1",
      RADAR_DEV_MAP_PREVIEW_VERSION: raw.RADAR_DEV_MAP_PREVIEW_VERSION,
      RADAR_DEV_MAP_PREVIEW_STYLE_SHA256: raw.RADAR_DEV_MAP_PREVIEW_STYLE_SHA256,
      RADAR_DEV_TEST_OWNER_USER_ID: raw.RADAR_DEV_TEST_OWNER_USER_ID,
      RADAR_DEV_TEST_SECOND_USER_ID: raw.RADAR_DEV_TEST_SECOND_USER_ID,
      RADAR_GEOGRAPHIC_TOKEN_EPOCH: raw.RADAR_GEOGRAPHIC_TOKEN_EPOCH,
      SOCIAL_RADAR_UNIFIED_ENABLED: raw.SOCIAL_RADAR_UNIFIED_ENABLED ?? false,
      SOCIAL_RADAR_PUBLISHING_V2_ENABLED: raw.SOCIAL_RADAR_PUBLISHING_V2_ENABLED ?? false,
      SOCIAL_RADAR_GEOGRAPHIC_ENABLED: raw.SOCIAL_RADAR_GEOGRAPHIC_ENABLED ?? false,
      SOCIAL_RADAR_ENABLED: raw.SOCIAL_RADAR_ENABLED ?? false,
      SOCIAL_RADAR_DEMO_ENABLED: raw.SOCIAL_RADAR_DEMO_ENABLED ?? false,
      SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS: splitCsv(
        raw.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS,
      ),
      SOCIAL_DM_ENABLED: raw.SOCIAL_DM_ENABLED ?? false,
      SOCIAL_DM_REQUEST_TTL_SECONDS: raw.SOCIAL_DM_REQUEST_TTL_SECONDS,
      SOCIAL_DM_MESSAGE_RETENTION_SECONDS:
        raw.SOCIAL_DM_MESSAGE_RETENTION_SECONDS,
      SOCIAL_INVITATIONS_ENABLED: raw.SOCIAL_INVITATIONS_ENABLED ?? false,
      SOCIAL_INVITATION_TTL_SECONDS: raw.SOCIAL_INVITATION_TTL_SECONDS,
      SOCIAL_GAME_CHAT_ENABLED: raw.SOCIAL_GAME_CHAT_ENABLED ?? false,
      SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS:
        raw.SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS,
      SOCIAL_INBOX_ENABLED: raw.SOCIAL_INBOX_ENABLED ?? false,
    };
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid API configuration: ${details}`);
  }
  return parsed.data;
}
