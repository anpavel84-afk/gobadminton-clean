import Link from "next/link";
import { ConsumerShell } from "../ConsumerShell";
import { ReleaseLink } from "../ReleaseLink";
export const documents = { terms: "Пользовательское соглашение", privacy: "Политика конфиденциальности", rules: "Правила сервиса" } as const;
function ReadingFooter() {
  return (
    <nav className="mobile-reading-footer" aria-label="Навигация по материалам">
      <Link href="/games">← К играм</Link>
      <span className="mobile-reading-footer-links">
        <Link href="/legal">Документы</Link>
        <Link href="/help">Помощь</Link>
        <ReleaseLink />
      </span>
    </nav>
  );
}
export function EditorialPage({ help = false }: { help?: boolean }) {
  return <ConsumerShell active="none" title={help ? "Помощь" : "О GoBadminton"} mode="local" reading><div className="fr6-content content-page">
    <header className="gb-page-local-header">
      <Link className="back-link" href="/games">← На главную</Link>
    </header>
    <section className="about-hero"><div><span className="eyebrow">{help ? "Помощь" : "О сервисе"}</span><h1>{help ? "Всё начинается с игры" : "О GoBadminton"}</h1><p>{help ? "Как найти игру, запросить участие и общаться с игроками." : "GoBadminton помогает находить игры, партнёров и тренерские занятия. В центре — встреча на площадке."}</p></div><img src="/discovery/badminton-gear.jpg" alt="Ракетки и воланы для бадминтона" /></section>
    <section className="about-content">
      <article><small>01 · {help ? "Участие" : "Идея"}</small><h2>{help ? "Заявка и подтверждение" : "Сначала игра"}</h2><p>{help ? "Отправьте заявку на странице игры. Дождитесь подтверждения: отправленная заявка сама по себе не означает, что место занято за вами. Актуальный статус смотрите в «Моих играх»." : "Выбирайте подходящую игру по времени, месту и условиям. Узнайте подробности и отправьте заявку организатору."}</p><Link href={help ? "/my-games" : "/games"}>{help ? "Мои игры →" : "Найти игру →"}</Link></article>
      <article><small>02 · Общение</small><h2>{help ? "Личные и игровые сообщения" : "Один спортивный контекст"}</h2><p>{help ? "Первое личное сообщение — запрос на общение. Продолжить переписку можно после принятия запроса. Чат игры доступен её организаторам и подтверждённым участникам до завершения игры." : "Игры, игроки, тренерские занятия и общение связаны вокруг реального игрового события."}</p><Link href={help ? "/messages" : "/players"}>{help ? "Сообщения →" : "Найти партнёра →"}</Link></article>
      <div className="about-image-block"><img src="/discovery/badminton-courts.jpg" alt="Бадминтонные площадки" /><span><strong>Настоящие люди.<br />Большой бадминтон.</strong></span></div>
      <article><small>03 · {help ? "Безопасность" : "Принципы"}</small><h2>{help ? "Общайтесь спокойно" : "Практично и понятно"}</h2><p>{help ? "Пожаловаться на игрока или заблокировать личное общение можно из переписки или профиля. Блокировка не отменяет участие в игре и не закрывает общий чат. Не отправляйте пароли, коды входа и данные сессии." : "Кто играет, где, когда и на каких условиях — главное для выбора встречи. Статус заявки и подтверждённое участие показаны отдельно."}</p></article>
      <aside className="about-service"><small>{help ? "Поддержка" : "Материалы сервиса"}</small><h3>{help ? "Контакт пока не опубликован" : "Помощь и документы"}</h3><p>{help ? "Адрес поддержки пока недоступен. Информация появится здесь после публикации." : "Узнайте, как устроены участие и общение. Доступность документов указана на их страницах."}</p><Link href={help ? "/about" : "/help"}>{help ? "О сервисе →" : "Помощь →"}</Link><Link href="/legal">Документы →</Link></aside>
    </section><ReadingFooter />
  </div></ConsumerShell>;
}
export function LegalPage({ document }: { document?: keyof typeof documents }) {
  return <ConsumerShell active="none" title={document ? documents[document] : "Документы сервиса"} mode="local" reading><div className="fr6-content content-page content-page--legal">
    <header className="gb-page-local-header">
      <Link className="back-link" href={document ? "/legal" : "/help"}>← {document ? "К документам" : "К помощи"}</Link>
    </header>
    <article className="legal-document" id="document-top"><header><span className="eyebrow">Документ сервиса</span><h1>{document ? documents[document] : "Документы сервиса"}</h1><span className="legal-status-badge">Не опубликовано</span><p>Тексты документов готовятся к публикации. Утверждённая редакция и дата её действия пока недоступны.</p></header>
      <nav className="document-toc" aria-label="Содержание"><strong>Содержание</strong><a href="#availability">1. Доступность документов</a><a href="#contacts">2. Информация об операторе</a></nav>
      <section id="availability"><h2>Доступность документов</h2><div className="document-note" role="status"><strong>{document ? "Документ пока недоступен" : "Документы пока недоступны"}</strong><p>На этой странице нет действующих юридических условий. Текст появится после публикации.</p></div></section>
      <section id="contacts"><h2>Информация об операторе</h2><p>Сведения об операторе и контакт для обращений пока не опубликованы.</p></section>
      <footer className="document-end"><Link href="/legal">Все документы</Link><nav aria-label="Другие документы">{Object.entries(documents).filter(([key]) => key !== document).map(([key, title]) => <Link key={key} href={`/legal/${key}`}>{title}</Link>)}</nav></footer>
    </article><ReadingFooter />
  </div></ConsumerShell>;
}
