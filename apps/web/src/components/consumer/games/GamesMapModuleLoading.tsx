/** Visible only while the map's JavaScript module is pending. */
export function GamesMapModuleLoading() {
  return <div className="gb-games-map-area gb-games-map-module-loading" role="status" aria-live="polite" aria-atomic="true">
    <p className="gb-games-map-module-loading__text">Загружаем карту…</p>
    <div className="gb-games-map-module-loading__progress" aria-hidden="true"><span /></div>
  </div>;
}
