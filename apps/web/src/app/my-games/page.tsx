import { Suspense } from "react";
import { MyGamesPage } from "../../components/consumer/pages/MyGamesPage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="gb-consumer">
          <div className="gb-consumer-shell">
            <div className="gb-c23-state" data-state="loading">
              <h2>Мои игры</h2>
              <p>Загрузка…</p>
            </div>
          </div>
        </div>
      }
    >
      <MyGamesPage />
    </Suspense>
  );
}
