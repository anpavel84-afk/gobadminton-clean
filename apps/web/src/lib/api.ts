export type HealthResponse = {
  status: string;
  service: string;
  appEnv: string;
  timestamp: string;
};

export function resolveApiBaseUrl(): string {
  const configured = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!configured) {
    throw new Error("API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) must be configured");
  }
  const url = new URL(configured);
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!loopback && /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new Error("API origin must not be a raw non-loopback IP address");
  }
  return configured.replace(/\/$/, "");
}

export async function fetchApiHealth(): Promise<
  { ok: true; data: HealthResponse } | { ok: false; error: string }
> {
  try {
    const base = resolveApiBaseUrl();
    const response = await fetch(`${base}/v1/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, error: `API health HTTP ${response.status}` };
    }
    const data = (await response.json()) as HealthResponse;
    if (data.status !== "ok") {
      return { ok: false, error: `Unexpected health status: ${data.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "API health request failed",
    };
  }
}
