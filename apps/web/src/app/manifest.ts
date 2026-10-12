import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GoBadminton",
    short_name: "GoBadminton",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Frozen Make foundation palette: paper launch surface, lime brand chrome.
    theme_color: "#a7f447",
    background_color: "#f5f6f2",
    icons: [
      { src: "/brand/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
