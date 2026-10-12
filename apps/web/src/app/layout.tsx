import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
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
import { ViewportLock } from "../components/consumer/ViewportLock";
import "../styles/mobile-controls.css";

import { RadarSessionProvider } from "../components/consumer/radar/RadarSessionProvider";

import { DiscoveryCityProvider } from "../components/consumer/discovery/DiscoveryCityProvider";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={onest.variable}>
      <body className={`gb-consumer-body ${onest.className}`}>
        <ViewportLock />
        <RadarSessionProvider><DiscoveryCityProvider>{children}</DiscoveryCityProvider></RadarSessionProvider>
      </body>
    </html>
  );
}
