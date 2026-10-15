import type { Metadata } from "next";
import "../styles/admin.css";
import localFont from "next/font/local";
const onest = localFont({ src: "../../public/fonts/Onest.ttf", weight: "100 900", display: "swap", variable: "--font-onest" });
export const metadata: Metadata = { title: "GoBadminton · Администрирование", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body className={onest.className}>{children}</body></html>;
}
