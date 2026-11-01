import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConsumerShell } from "../../components/consumer/ConsumerShell";
import { ReleaseLink } from "../../components/consumer/ReleaseLink";
import {
  FIRST_ALPHA_FEATURES,
  FIRST_ALPHA_KNOWN_LIMITATIONS,
  formatReleaseDateRu,
  groupFeatures,
  shortSha,
} from "../../lib/releases";
import {
  isTrustedDevReleasesRuntime,
  loadReleasesPageModel,
  type EnvironmentLiveStatus,
  type HistoryRow,
} from "../../lib/releases-server";

export const dynamic = "force-dynamic";

function siteTitle(env: EnvironmentLiveStatus["environment"]): string {
  return env === "dev" ? "Тестовый сайт (DEV)" : "Основной сайт (PROD)";
}

function installationStatus(env: EnvironmentLiveStatus): string {
  switch (env.acceptance.state) {
    case "accepted_current":
      return "Установлена";
    case "mismatch":
      return "Данные расходятся";
    case "pending_or_none":
      return "Обновляется";
    case "projection_only":
      return "Не удалось проверить";
    default:
      return "Не удалось проверить";
  }
}

function applicationNumber(env: EnvironmentLiveStatus): string {
  if (env.web.state === "ok" && env.web.applicationVersion) return env.web.applicationVersion;
  return "пока неизвестен";
}

function EnvironmentCard({ env }: { env: EnvironmentLiveStatus }) {
  const accepted =
    env.acceptance.state === "accepted_current"
    || env.acceptance.state === "projection_only"
    || env.acceptance.state === "mismatch"
      ? env.acceptance.accepted
      : null;
  const installedAt = accepted ? formatReleaseDateRu(accepted.finished_at) : "—";
  const status = installationStatus(env);

  return (
    <article className="gb-releases-env-card" data-environment={env.environment} data-acceptance={env.acceptance.state}>
      <header>
        <h2>{siteTitle(env.environment)}</h2>
        <p>{status}</p>
      </header>
      <dl>
        <div>
          <dt>Номер приложения</dt>
          <dd>{applicationNumber(env)}</dd>
        </div>
        <div>
          <dt>Дата установки</dt>
          <dd>{installedAt}</dd>
        </div>
      </dl>
      <details className="gb-releases-details">
        <summary>Технические сведения</summary>
        <dl>
          <div>
            <dt>Web SHA</dt>
            <dd>
              {env.web.state === "ok"
                ? shortSha(env.web.gitSha)
                : env.web.state === "mismatch"
                  ? "расхождение"
                  : env.web.state === "unavailable"
                    ? "недоступно"
                    : "неизвестно"}
              {env.web.state === "ok" && env.web.applicationVersion ? ` · ${env.web.applicationVersion}` : ""}
            </dd>
          </div>
          <div>
            <dt>API SHA</dt>
            <dd>
              {env.api.state === "ok"
                ? shortSha(env.api.gitSha)
                : env.api.state === "mismatch"
                  ? "расхождение"
                  : env.api.state === "unavailable"
                    ? "недоступно"
                    : "неизвестно"}
              {env.api.state === "ok" && env.api.apiVersion ? ` · контракт ${env.api.apiVersion}` : ""}
            </dd>
          </div>
          <div>
            <dt>Accepted SHA</dt>
            <dd>{accepted ? shortSha(accepted.source_sha) : "—"}</dd>
          </div>
          <div>
            <dt>Принято (ISO)</dt>
            <dd>{accepted ? accepted.finished_at : "—"}</dd>
          </div>
          <div>
            <dt>Release id / receipt</dt>
            <dd>{accepted?.release_id ?? (accepted ? "managed / нет pipeline id" : "—")}</dd>
          </div>
          <div>
            <dt>Статус проверки владельцем</dt>
            <dd>NOT_TESTED</dd>
          </div>
          {"reason" in env.acceptance ? (
            <div>
              <dt>Служебная причина</dt>
              <dd>{env.acceptance.reason}</dd>
            </div>
          ) : null}
          {env.projection.state !== "ok" ? (
            <div>
              <dt>Источник записи</dt>
              <dd>{env.projection.detail}</dd>
            </div>
          ) : null}
          {env.web.state !== "ok" && env.web.state !== "mismatch" ? (
            <div>
              <dt>Web</dt>
              <dd>{env.web.detail}</dd>
            </div>
          ) : null}
          {env.api.state !== "ok" && env.api.state !== "mismatch" ? (
            <div>
              <dt>API</dt>
              <dd>{env.api.detail}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </article>
  );
}

function HistoryList({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="gb-releases-note">Подтверждённая история пока пуста.</p>;
  }
  return (
    <ol className="gb-releases-history">
      {rows.map((row) => (
        <li key={`${row.environment}-${row.source_sha}-${row.accepted_at}`}>
          <div className="gb-releases-history-head">
            <strong>{row.version_label === "Без формального номера" ? "Без номера" : row.version_label}</strong>
            <span>{row.environment === "dev" ? "Тестовый сайт" : "Основной сайт"}</span>
          </div>
          <p>{row.title}</p>
          <p className="gb-releases-meta">{formatReleaseDateRu(row.accepted_at)}</p>
          <details className="gb-releases-details">
            <summary>Технические сведения</summary>
            <p className="gb-releases-meta">
              {shortSha(row.source_sha)} · {row.accepted_at}
              {row.release_id ? ` · ${row.release_id}` : " · managed"}
              {" · проверка владельцем "}{row.owner_uat}
            </p>
          </details>
        </li>
      ))}
    </ol>
  );
}

export default async function ReleasesPage() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!isTrustedDevReleasesRuntime({ host })) notFound();

  const model = await loadReleasesPageModel();
  const groups = groupFeatures(FIRST_ALPHA_FEATURES);

  return (
    <ConsumerShell active="none" title="Версии" mode="local" reading>
      <div className="fr6-content content-page gb-releases-page">
        <header className="gb-page-local-header">
          <Link className="back-link" href="/games">← На главную</Link>
        </header>

        <section className="gb-releases-hero">
          <span className="eyebrow">История версий · тестовый сайт</span>
          <h1>GoBadminton {model.build.applicationVersion}</h1>
          <p>
            Здесь собрано, что умеет эта сборка, и какие выпуски уже ставили на тестовый и основной сайты.
            Номер приложения — это версия самого сервиса, не путать с внутренней версией обмена данными.
          </p>
          <p>
            Проверка владельцем после обычного входа ещё не выполнялась.
          </p>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-live">
          <h2 id="releases-live">Где сейчас стоит выпуск</h2>
          <p>Краткий статус тестового и основного сайтов. Подробные служебные коды — в технических сведениях.</p>
          <div className="gb-releases-env-grid">
            {model.environments.map((env) => <EnvironmentCard key={env.environment} env={env} />)}
          </div>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-named">
          <h2 id="releases-named">{model.named.application_version}</h2>
          <p>
            {model.named.title}.{" "}
            {model.named.source_sha
              ? `Установка этого номера подтверждена на сайте.`
              : "Фактическая установка этого номера появится после выпуска — черновик разработки сюда не подставляется."}
          </p>
          {model.named.additions.length > 0 ? (
            <div className="gb-releases-list-block">
              <h3>Что добавлено</h3>
              <ul>{model.named.additions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          {model.named.fixes.length > 0 ? (
            <div className="gb-releases-list-block">
              <h3>Что исправлено</h3>
              <ul>{model.named.fixes.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-features">
          <h2 id="releases-features">Что умеет приложение</h2>
          <p>
            Базовый список функций первой alpha (0.1.0-alpha.1) по фактическому коду.
            «Доступно» значит, что функция есть в сборке — это ещё не отдельная проверка владельцем после входа.
          </p>
          <div className="gb-releases-groups">
            {groups.map((group) => (
              <section key={group.group} className="gb-releases-group">
                <h3>{group.group}</h3>
                <ul>
                  {group.items.map((feature) => (
                    <li key={feature.id}>
                      <strong>{feature.title}</strong>
                      <span>{feature.description}</span>
                      {feature.limitation ? <em>{feature.limitation}</em> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-limits">
          <h2 id="releases-limits">Известные ограничения</h2>
          <ul className="gb-releases-limits">
            {FIRST_ALPHA_KNOWN_LIMITATIONS.map((item) => <li key={item}>{item}</li>)}
            {model.named.known_limitations
              .filter((item) => !FIRST_ALPHA_KNOWN_LIMITATIONS.includes(item))
              .map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="gb-releases-note">
            Раздел Admin служебный. Вход по электронной почте недоступен. Результаты и отзывы после игры не запущены.
            Push-уведомления не активны. Тестовая геопозиция не для обычных пользователей.
          </p>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-history">
          <h2 id="releases-history">История установок</h2>
          <p>Подтверждённые установки по дате. Ранние выпуски без формального номера сохранены как есть.</p>
          <HistoryList rows={model.history} />
        </section>

        <nav className="mobile-reading-footer" aria-label="Навигация по материалам">
          <Link href="/games">← К играм</Link>
          <ReleaseLink />
        </nav>
      </div>
    </ConsumerShell>
  );
}
