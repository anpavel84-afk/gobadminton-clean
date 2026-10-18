import { MapEntryIcon } from "../games/MapEntryIcon";
/* frozen local branded assets; decorative imagery, not venue photography. */
import { Button } from "../Button";
import { discoveryCityHeading } from "../../../lib/discovery-presentation";

export function DiscoveryIcon({ name }: { name: "pin" | "calendar" | "filter" | "arrow" }) {
  return <img className="gb-discovery-icon" src={`/discovery/${name}.svg`} alt="" width={20} height={20} />;
}

export function DiscoveryHero({ city }: { city: string }) {
  return <section className="gb-discovery-hero" aria-labelledby="discovery-title">
    <div className="gb-discovery-hero__copy">
      <span className="gb-discovery-eyebrow">Игры рядом · {city}</span>
      <h1 id="discovery-title">Игры<br /> <em>{discoveryCityHeading(city)}.</em></h1>
      <p>Настоящие люди. Большой бадминтон. Выбирайте игру или тренировку и выходите на корт.</p>
    </div>
    <div className="gb-discovery-hero__visual" aria-hidden="true">
      <img className="gb-discovery-shape gb-discovery-shape--lime" src="/discovery/hero-lime.svg" alt="" />
      <img className="gb-discovery-shape gb-discovery-shape--purple" src="/discovery/purple-shape.svg" alt="" />
      <div className="gb-discovery-hero__photo"><img src="/discovery/badminton-gear.jpg" alt="" /></div>
      <span className="gb-discovery-hero__note">Game first.<br />Always.</span>
    </div>
  </section>;
}

export function CreateBanner({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return <button type="button" className="gb-discovery-create" onClick={onClick} disabled={busy} aria-busy={busy}>
    <span className="gb-discovery-create__plus" aria-hidden="true">+</span>
    <span><strong>{busy ? "Открываем…" : "Создать игру"}</strong><small>Соберите своих на площадке</small></span>
    <span className="gb-discovery-create__arrow" aria-hidden="true">→</span>
    <img className="gb-discovery-create__shape" src="/discovery/create-shape.svg" alt="" />
  </button>;
}

export function DiscoverySidebar({ city, onMap }: { city: string; onMap: () => void }) {
  return <aside className="gb-discovery-sidebar" aria-label="Город и сообщество">
    <section className="gb-discovery-map-card">
      <header><small>Рядом с вами</small><h2>Все игры на карте</h2></header>
      <div className="gb-discovery-map" aria-hidden="true">
        <span className="gb-discovery-map__river" />
        <span className="gb-discovery-pin gb-discovery-pin--one" />
        <span className="gb-discovery-pin gb-discovery-pin--two" />
        <span className="gb-discovery-pin gb-discovery-pin--three" />
        <span className="gb-discovery-map__label">{city}</span>
      </div>
      <p className="gb-discovery-map-caption">Площадки {city}: доступные публичные игры и расписание.</p>
      <Button variant="outline" className="gb-map-entry" onClick={onMap}><MapEntryIcon />Все игры на карте</Button>
    </section>
    <section className="gb-discovery-community">
      <small>Game first</small>
      <h2>Выберите игру, отправьте заявку и дождитесь ответа организатора.</h2>
      <img src="/discovery/purple-shape.svg" alt="" />
    </section>
  </aside>;
}

export function DiscoverySkeleton() {
  return <div className="gb-discovery-skeleton" aria-hidden="true"><div /><section><i /><i /><i /><i /></section></div>;
}
