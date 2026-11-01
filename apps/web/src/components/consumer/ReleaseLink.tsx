"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const DEV_HOST = "dev.gobadminton.ru";

/** DEV-only link. Renders nothing on SSR and on non-DEV hosts to avoid hydration mismatch. */
export function ReleaseLink({
  children = "Версии",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.location.hostname === DEV_HOST);
  }, []);

  if (!visible) return null;
  return (
    <Link href="/releases" className={className}>
      {children}
    </Link>
  );
}

export function isDevReleasesHost(hostname: string): boolean {
  return hostname === DEV_HOST;
}
