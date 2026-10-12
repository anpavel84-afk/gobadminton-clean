import type { Metadata } from "next";
import "../styles/admin.css";
export const metadata: Metadata = { title: "GoBadminton · Администрирование", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
