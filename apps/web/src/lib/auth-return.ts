/** Safe destinations survive OAuth → setup → reload, without trusting browser intent storage. */
export function safeAuthReturnPath(raw: string | null | undefined, fallback = "/games"): string {
  const value = (raw ?? "").trim();
  if (!value || value.length > 512) return fallback;
  let decoded = value;
  try {
    for (let n = 0; n < 4; n++) {
      if (!decoded.startsWith("/") || decoded.startsWith("//") || (decoded.includes("\\") || [...decoded].some(c => c.charCodeAt(0) <= 31 || c.charCodeAt(0) === 127)) || decoded.includes("://")) return fallback;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    const url = new URL(value, "https://gobadminton.invalid");
    if (url.origin !== "https://gobadminton.invalid" || url.pathname === "/profile/setup" || url.pathname.startsWith("/v1/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function profileSetupPath(returnTo: string) {
  return `/profile/setup?returnTo=${encodeURIComponent(safeAuthReturnPath(returnTo))}`;
}

export function profileCityReady(profile: { cityId: string | null }): boolean {
  return Boolean(profile.cityId);
}
