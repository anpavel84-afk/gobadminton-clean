import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Onest } from "next/font/google";
import "../styles/account.css";
import "../styles/consumer.css";
import "../styles/foundation.css";
import "../styles/discovery.css";
import "../styles/games.css";
import "../styles/players.css";
import "../styles/messages.css";
import "../styles/radar.css";
import "../styles/content.css";
import "../styles/utility.css";
import "../styles/venue-community.css";
import { ViewportLock } from "../components/consumer/ViewportLock";
import "../styles/mobile-controls.css";

import { RadarSessionProvider } from "../components/consumer/radar/RadarSessionProvider";

import { DiscoveryCityProvider } from "../components/consumer/discovery/DiscoveryCityProvider";
import { SESSION_COOKIE_NAME, sessionCookiePresenceFromStore } from "../lib/session-presence";
import { resolveApiBaseUrl } from "../lib/api";
import { HeaderIdentityProvider, type HeaderIdentitySnapshot } from "../lib/header-identity";
import type { Me, OwnSocialProfile } from "../lib/consumer-types";

/** No cache or module-owned identity. The own-profile endpoint verifies this request's session. */
async function headerBootstrap(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<HeaderIdentitySnapshot> {
  const empty = (loading: boolean): HeaderIdentitySnapshot => ({ identity: null, imageGeneration: 0, loading });
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  if (!session) return empty(false);
  try {
    const init: RequestInit = {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      headers: { Accept: "application/json", Cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
    };
    const base = resolveApiBaseUrl();
    const [meResponse, response] = await Promise.all([
      fetch(`${base}/v1/me`, init),
      fetch(`${base}/v1/me/social-profile`, init),
    ]);
    if (!meResponse.ok) return empty(meResponse.status === 408 || meResponse.status >= 500);
    if (!response.ok) return empty(response.status === 408 || response.status >= 500);
    const me = await meResponse.json() as Me;
    if (typeof me.id !== "string" || !me.id) return empty(true);
    const profile = await response.json() as OwnSocialProfile;
    if (typeof profile.displayName !== "string" || !profile.displayName.trim()) return empty(false);
    // Explicit allowlist: never serialize /me, cookies, CSRF, email or provider account fields.
    const uploadedUrl = profile.avatar?.uploadedUrl;
    const providerUrl = profile.avatar?.providerUrl;
    return {
      identity: {
        name: profile.displayName.trim(),
        avatar: {
          uploadedUrl: typeof uploadedUrl === "string" ? uploadedUrl : null,
          providerUrl: typeof providerUrl === "string" ? providerUrl : null,
        },
      },
      imageGeneration: 0,
      loading: false,
      ownerId: me.id,
    };
  } catch {
    return empty(true);
  }
}

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-onest",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "GoBadminton",
  description: "GoBadminton — сначала игра",
  appleWebApp: {
    capable: true,
    title: "GoBadminton",
    statusBarStyle: "default",
  },
  // Next 16 emits mobile-web-app-capable; retain the Apple key for older iOS.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    apple: [{ url: "/brand/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Presence remains an eligibility hint; verified presentation is request-scoped below.
  const cookieStore = await cookies();
  const sessionPresence = sessionCookiePresenceFromStore(cookieStore);
  const headerIdentity = await headerBootstrap(cookieStore);
  return (
    <html lang="ru" className={onest.variable} data-gb-session-presence={sessionPresence}>
      <body className={`gb-consumer-body ${onest.className}`}>
        <ViewportLock />
        <HeaderIdentityProvider snapshot={headerIdentity}><RadarSessionProvider><DiscoveryCityProvider>{children}</DiscoveryCityProvider></RadarSessionProvider></HeaderIdentityProvider>
      </body>
    </html>
  );
}
