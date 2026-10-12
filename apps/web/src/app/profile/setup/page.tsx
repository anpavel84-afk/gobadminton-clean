import { Suspense } from "react";
import { ProfileSetupPage } from "../../../components/consumer/pages/ProfileSetupPage";

export default function Page() {
  return <Suspense fallback={<p role="status">Проверяем игровой профиль…</p>}><ProfileSetupPage /></Suspense>;
}
