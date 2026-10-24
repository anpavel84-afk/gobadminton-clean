/** Original HTTP(S) authority, recovered before WHATWG can discard empty userinfo.
 * Host is a bracketed IPv6 candidate or one token with no structural delimiter,
 * plus an optional decimal port. Default ports are mapped away. Callers keep
 * their own length, label, scheme and allowlist policy. */

export function forbiddenUrlScalars(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || character === "\\";
  });
}

export function originalHttpAuthority(text: string): { scheme: "http" | "https"; host: string; port: string } | null {
  const prefix = /^(https?):\/{2,}/i.exec(text);
  if (!prefix) return null;
  const remainder = text.slice(prefix[0].length);
  const boundary = remainder.search(/[/?#]/);
  const authority = boundary < 0 ? remainder : remainder.slice(0, boundary);
  const parts = /^(\[[0-9a-f:.]+\]|[^:[\]@/\\?#]+)(?::([0-9]*))?$/i.exec(authority);
  if (!parts) return null;
  const schemeName = prefix[1]!.toLowerCase();
  if (schemeName !== "http" && schemeName !== "https") return null;
  const host = parts[1]!;
  let port = parts[2] === undefined || parts[2] === "" ? "" : parts[2].replace(/^0+/, "") || "0";
  if (port.length > 5 || (port.length === 5 && port > "65535")) return null;
  if (port === (schemeName === "https" ? "443" : "80")) port = "";
  return { scheme: schemeName, host, port };
}

/** Parsed URL whose host and port agree with the original authority, and reparse stably. */
export function httpUrlAgreesWithOriginalAuthority(text: string, forbidden: (value: string) => boolean): URL | null {
  if (/[\ud800-\udfff]/u.test(text)) return null;
  const authority = originalHttpAuthority(text);
  if (!authority) return null;
  try {
    if (forbidden(decodeURIComponent(text))) return null;
    const url = new URL(text);
    const protocol = `${authority.scheme}:`;
    if (url.protocol !== protocol || !url.hostname || url.username || url.password) return null;
    const hostOnly = new URL(`${authority.scheme}://${authority.host}/`);
    if (hostOnly.protocol !== protocol || !hostOnly.hostname || hostOnly.username || hostOnly.password || hostOnly.port
      || hostOnly.pathname !== "/" || hostOnly.search || hostOnly.hash) return null;
    const expectedHost = hostOnly.hostname + (authority.port ? `:${authority.port}` : "");
    if (url.hostname !== hostOnly.hostname || url.port !== authority.port || url.host !== expectedHost) return null;
    const stable = new URL(url.href);
    if (stable.href !== url.href || stable.protocol !== protocol || stable.hostname !== url.hostname
      || stable.port !== url.port || stable.host !== url.host || stable.origin !== url.origin || stable.username || stable.password) return null;
    return url;
  } catch {
    return null;
  }
}
