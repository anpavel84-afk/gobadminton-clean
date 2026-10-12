"use client";

import { useEffect } from "react";

/** Owner GitHub #65: block iOS gesture zoom that can ignore viewport maximum-scale. */
export function ViewportLock() {
  useEffect(() => {
    const block = (event: Event) => {
      event.preventDefault();
    };
    document.addEventListener("gesturestart", block, { passive: false });
    document.addEventListener("gesturechange", block, { passive: false });
    document.addEventListener("gestureend", block, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.removeEventListener("gestureend", block);
    };
  }, []);
  return null;
}
