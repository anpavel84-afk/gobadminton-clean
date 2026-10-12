import { Suspense } from "react";
import { PublicPlayerProfilePage } from "../../../components/consumer/pages/PublicPlayerProfilePage";

export default function Page() {
  return <Suspense fallback={<p>Загружаем профиль…</p>}><PublicPlayerProfilePage /></Suspense>;
}
