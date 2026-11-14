import type { Metadata } from "next";
import { NativeAuthBridge } from "../../../components/consumer/players/NativeAuthBridge";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход в приложение GoBadminton", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function NativeAuthPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const id = typeof query.transactionId === "string" && /^[A-Za-z0-9_-]{43}$/.test(query.transactionId) ? query.transactionId : null;
  return <NativeAuthBridge transactionId={id} />;
}
