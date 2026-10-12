/**
 * Allow only same-origin relative paths. Reject protocol-relative, absolute, and escapes.
 */
export function normalizeReturnPath(raw: string | undefined): string | null {
  const value = (raw ?? "/").trim();
  if (value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  try {
    const parsed = new URL(value, "https://gobadminton.invalid");
    if (parsed.origin !== "https://gobadminton.invalid") return null;
    if (parsed.username || parsed.password) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildWebRedirect(webOrigin: string, returnPath: string): string {
  return new URL(returnPath, webOrigin).toString();
}

export function buildAuthErrorRedirect(
  webOrigin: string,
  returnPath: string,
  code: string,
): string {
  const url = new URL(returnPath, webOrigin);
  url.searchParams.set("authError", code);
  return url.toString();
}
