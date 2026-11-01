import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConsumerShell } from "../../components/consumer/ConsumerShell";
import { ReleaseLink } from "../../components/consumer/ReleaseLink";
import {
  FIRST_ALPHA_FEATURES,
  FIRST_ALPHA_KNOWN_LIMITATIONS,
  groupFeatures,
  shortSha,
} from "../../lib/releases";
import {
  isTrustedDevReleasesRuntime,
  loadReleasesPageModel,
  type EnvironmentLiveStatus,
  type HistoryRow,
  type LiveEndpointState,
} from "../../lib/releases-server";

export const dynamic = "force-dynamic";

function liveLabel(state: LiveEndpointState): string {
  if (state.state === "ok") return shortSha(state.gitSha);
  if (state.state === "mismatch") return "расхождение";
  if (state.state === "unavailable") return "недоступно";
  return "неизвестно";
}

function acceptanceLabel(env: EnvironmentLiveStatus): string {
  switch (env.acceptance.state) {
    case "accepted_current":
      return "ACCEPTED · совпадает с live SHA";
    case "projection_only":
      return "Запись ACCEPTED есть, live SHA не подтверждены";
    case "mismatch":
      return "ACCEPTED не совпадает с live";
    case "pending_or_none":
      return "Текущий ACCEPTED отсутствует";
    default:
      return "Projection недоступен";
  }
}

function EnvironmentCard({ env }: { env: EnvironmentLiveStatus }) {
  const title = env.environment === "dev" ? "DEV" : "PROD";
  const accepted =
    env.acceptance.state === "accepted_current"
    || env.acceptance.state === "projection_only"
    || env.acceptance.state === "mismatch"
      ? env.acceptance.accepted
      : null;
  return (
    <article className="gb-releases-env-card" data-environment={env.environment} data-acceptance={env.acceptance.state}>
      <header>
        <h2>{title}</h2>
        <p>{acceptanceLabel(env)}</p>
      </header>
      <dl>
        <div>
          <dt>Web SHA</dt>
          <dd>{liveLabel(env.web)}{env.web.state === "ok" && env.web.applicationVersion ? ` · ${env.web.applicationVersion}` : ""}</dd>
        </div>
        <div>
          <dt>API SHA</dt>
          <dd>{liveLabel(env.api)}{env.api.state === "ok" && env.api.apiVersion ? ` · контракт ${env.api.apiVersion}` : ""}</dd>
        </div>
        <div>
          <dt>Accepted SHA</dt>
          <dd>{accepted ? shortSha(accepted.source_sha) : "—"}</dd>
        </div>
        <div>
          <dt>Принято</dt>
          <dd>{accepted ? accepted.finished_at : "—"}</dd>
        </div>
        <div>
          <dt>Release id</dt>
          <dd>{accepted?.release_id ?? (accepted ? "managed / нет pipeline id" : "—")}</dd>
        </div>
      </dl>
      {env.acceptance.state === "mismatch" || env.acceptance.state === "projection_only" || env.acceptance.state === "unavailable" ? (
        <p className="gb-releases-note" role="status">
          {"reason" in env.acceptance ? env.acceptance.reason : env.projection.state !== "ok" ? env.projection.detail : ""}
        </p>
      ) : null}
      {env.web.state !== "ok" && env.web.state !== "mismatch" ? (
        <p className="gb-releases-note">{env.web.detail}</p>
      ) : null}
      {env.api.state !== "ok" && env.api.state !== "mismatch" ? (
        <p className="gb-releases-note">{env.api.detail}</p>
      ) : null}
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
            <strong>{row.version_label}</strong>
            <span>{row.environment.toUpperCase()}</span>
          </div>
          <p>{row.title}</p>
          <p className="gb-releases-meta">
            {shortSha(row.source_sha)} · {row.accepted_at}
            {row.release_id ? ` · ${row.release_id}` : " · managed"}
            {" · UAT "}{row.owner_uat}
          </p>
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
          <span className="eyebrow">История выпусков · только DEV</span>
          <h1>GoBadminton {model.build.applicationVersion}</h1>
          <p>
            Каталог доступных функций этой сборки и подтверждённая история принятий.
            Номер приложения не путать с версией API-контракта.
            UAT владельца: <strong>NOT_TESTED</strong>.
          </p>
          <p className="gb-releases-meta">
            Сборка страницы: {shortSha(model.build.gitSha)} · проверка {model.checkedAt}
          </p>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-live">
          <h2 id="releases-live">Текущие среды</h2>
          <p>Сверка live SHA web/API с sanitized projection. Старый projection не выдаётся за новый ACCEPTED.</p>
          <div className="gb-releases-env-grid">
            {model.environments.map((env) => <EnvironmentCard key={env.environment} env={env} />)}
          </div>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-named">
          <h2 id="releases-named">{model.named.application_version}</h2>
          <p>{model.named.title}. {model.named.source_sha
            ? `Принятие текущего номера подтверждено live: ${shortSha(model.named.source_sha)}.`
            : "Фактическое принятие номера появится после deploy и совпадения live SHA с projection — candidate merge SHA здесь не подставляется."}</p>
          {model.named.additions.length > 0 ? (
            <div className="gb-releases-list-block">
              <h3>Добавлено</h3>
              <ul>{model.named.additions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          {model.named.fixes.length > 0 ? (
            <div className="gb-releases-list-block">
              <h3>Исправлено</h3>
              <ul>{model.named.fixes.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-features">
          <h2 id="releases-features">Доступные функции</h2>
          <p>
            Базовый каталог первой alpha по коду и runtime-допуску.
            «Доступно» не означает пройденный авторизованный UAT.
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
            Служебные admin-сценарии и тестовая геопозиция не публикуются как функции продукта.
            Email-вход, postgame и push выключены.
          </p>
        </section>

        <section className="gb-releases-section" aria-labelledby="releases-history">
          <h2 id="releases-history">История принятий</h2>
          <p>Только подтверждённые receipts и live projection. Исторические выпуски без формального номера alpha сохранены.</p>
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
