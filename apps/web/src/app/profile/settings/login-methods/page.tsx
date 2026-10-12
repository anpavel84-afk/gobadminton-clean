import { Suspense } from "react";
import { LoginMethodsPage } from "../../../../components/consumer/pages/LoginMethodsPage";

export default function Page() {
  return (
    <Suspense fallback={<p>Загружаем способы входа…</p>}>
      <LoginMethodsPage />
    </Suspense>
  );
}
