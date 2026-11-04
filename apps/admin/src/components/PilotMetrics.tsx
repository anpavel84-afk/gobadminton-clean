"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, type Session } from "../lib/admin-client";
import {
  PILOT_FILTER_LABELS,
  buildPilotMetricsPath,
  defaultPilotWindow,
  formatRate,
  type PilotCity,
  type PilotMetrics,
} from "../lib/pilot-metrics";

export function PilotMetricsPanel({
  session,
  busy,
  run,
  onAuthorityLoss,
}: {
  session: Session;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onAuthorityLoss: () => void;
}) {
  const initial = defaultPilotWindow();
  const [cityId, setCityId] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [cities, setCities] = useState<PilotCity[]>([]);
  const [data, setData] = useState<PilotMetrics | null>(null);
  const [empty, setEmpty] = useState(false);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void run(async () => {
      try {
        const catalogue = await adminRequest<PilotMetrics>("pilot-metrics");
        if (!session.roles.includes("superadmin")) {
          setData(null);
          setCities([]);
          onAuthorityLoss();
          return;
        }
        setCities(catalogue.cities);
        if (catalogue.cities[0]) setCityId(catalogue.cities[0].id);
      } catch (cause) {
        setData(null);
        setCities([]);
        if (
          cause instanceof AdminError &&
          (cause.status === 401 || cause.code === "ADMIN_PERMISSION_DENIED")
        ) {
          onAuthorityLoss();
        }
        throw cause;
      }
    });
  }, [onAuthorityLoss, run, session.roles]);

  async function load() {
    await run(async () => {
      setEmpty(false);
      try {
        const path = buildPilotMetricsPath({ cityId, from, to });
        const next = await adminRequest<PilotMetrics>(path);
        if (!session.roles.includes("superadmin")) {
          setData(null);
          onAuthorityLoss();
          throw new AdminError("ADMIN_PERMISSION_DENIED", 403);
        }
        setCities(next.cities);
        setData(next);
        setEmpty(next.games.dueInWindow === 0);
      } catch (cause) {
        setData(null);
        if (
          cause instanceof AdminError &&
          (cause.status === 401 || cause.code === "ADMIN_PERMISSION_DENIED")
        ) {
          onAuthorityLoss();
        }
        throw cause;
      }
    });
  }

  return (
    <div className="pilot-metrics">
      <h2>Сводка пилота</h2>
      <p>
        Агрегаты заявок, подтверждений, явных исходов и посещаемости по городу и окну UTC. Без
        персональных данных и коммерческих KPI.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="form-field">
          <span>{PILOT_FILTER_LABELS.city}</span>
          <select
            aria-label={PILOT_FILTER_LABELS.city}
            value={cityId}
            disabled={busy || cities.length === 0}
            onChange={(event) => {
              setCityId(event.target.value);
              setData(null);
            }}
          >
            <option value="">Выберите город</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.nameRu}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{PILOT_FILTER_LABELS.from}</span>
          <input
            type="date"
            aria-label={PILOT_FILTER_LABELS.from}
            value={from}
            disabled={busy}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>{PILOT_FILTER_LABELS.to}</span>
          <input
            type="date"
            aria-label={PILOT_FILTER_LABELS.to}
            value={to}
            disabled={busy}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button className="button" disabled={busy || !cityId}>
          {busy ? "Загружаем…" : PILOT_FILTER_LABELS.submit}
        </button>
      </form>
      {!data && cities.length === 0 && (
        <div className="notice" role="status">
          Загружаем каталог городов…
        </div>
      )}
      {data && (
        <>
          {empty && (
            <div className="notice" role="status">
              В выбранном окне нет подходящих игр для сводки.
            </div>
          )}
          {!data.coverage.sufficient && (
            <div className="notice" role="status">
              <strong>Недостаточно данных или неполное покрытие</strong>
              <ul>
                {data.coverage.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          <h3>Окно и город</h3>
          <dl>
            <dt>Город</dt>
            <dd>{data.city?.nameRu ?? "не выбран"}</dd>
            <dt>Окно UTC [from, to)</dt>
            <dd>
              {data.window.from} — {data.window.to}
            </dd>
            <dt>Снимок на</dt>
            <dd>{new Date(data.asOf).toLocaleString("ru-RU")}</dd>
          </dl>
          <h3>Игры</h3>
          <dl className="pilot-metrics-grid">
            <dt>Подходящие в окне</dt>
            <dd>{data.games.dueInWindow}</dd>
            <dt>Опубликованные</dt>
            <dd>{data.games.publishedEligible}</dd>
            <dt>Held / not_held / unknown</dt>
            <dd>
              {data.games.held} / {data.games.notHeld} / {data.games.unknownOutcome}
            </dd>
            <dt>Held rate</dt>
            <dd>{formatRate(data.games.heldRate)}</dd>
            <dt>Отмены (раскрыты отдельно)</dt>
            <dd>{data.games.cancelledDisclosed}</dd>
            <dt>Draft исключены</dt>
            <dd>{data.games.draftExcluded}</dd>
            <dt>DEMO исключены</dt>
            <dd>{data.games.demoExcluded}</dd>
          </dl>
          <h3>Заявки и подтверждения</h3>
          <dl className="pilot-metrics-grid">
            <dt>Заявки (попытки)</dt>
            <dd>{data.applications.count}</dd>
            <dt>Подтверждения</dt>
            <dd>{data.applications.confirmations}</dd>
            <dt>Confirmation rate</dt>
            <dd>{formatRate(data.applications.confirmationRate)}</dd>
            <dt>Текущие статусы</dt>
            <dd>
              pending {data.applications.currentStatus.pending}, confirmed{" "}
              {data.applications.currentStatus.confirmed}, withdrawn{" "}
              {data.applications.currentStatus.withdrawn}, rejected{" "}
              {data.applications.currentStatus.rejected}, removed{" "}
              {data.applications.currentStatus.removed}, expired{" "}
              {data.applications.currentStatus.expired}
            </dd>
          </dl>
          <h3>Посещаемость и повтор</h3>
          <dl className="pilot-metrics-grid">
            <dt>present / absent / unknown</dt>
            <dd>
              {data.attendance.present} / {data.attendance.absent} / {data.attendance.unknown}
            </dd>
            <dt>Повторное участие</dt>
            <dd>
              {data.repeatAttendance.usersWithRepeatPresent} из{" "}
              {data.repeatAttendance.usersWithAtLeastOnePresent} (
              {formatRate(data.repeatAttendance.rate)})
            </dd>
          </dl>
          <h3>Организаторы (только агрегаты)</h3>
          <dl className="pilot-metrics-grid">
            <dt>С подходящими играми</dt>
            <dd>{data.organizers.withEligiblePublishedGames}</dd>
            <dt>С held</dt>
            <dd>{data.organizers.withHeldGames}</dd>
            <dt>С повторными играми</dt>
            <dd>{data.organizers.withRepeatEligibleGames}</dd>
          </dl>
          <h3>Формулы</h3>
          <ul className="pilot-formulas">
            {Object.entries(data.formulas).map(([key, text]) => (
              <li key={key}>
                <strong>{key}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <h3>Исключения</h3>
          <p>{data.exclusionPolicy.unmarkedManualTestLimitation}</p>
          <p>
            DEMO UUID: {data.exclusionPolicy.demoUuidNamespace}; issuer:{" "}
            {data.exclusionPolicy.demoIssuerNamespace}
          </p>
        </>
      )}
    </div>
  );
}
