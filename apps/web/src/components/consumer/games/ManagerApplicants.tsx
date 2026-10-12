"use client";

import { useState } from "react";
import type { Participation } from "../../../lib/consumer-types";
import {
  applicantLabel,
  DEFAULT_REJECT_REASON,
  DEFAULT_REMOVE_REASON,
  participationLabel,
} from "../../../lib/game-presentation";
import { Button } from "../Button";
import { GameStatusBadge } from "./GameDetailComposition";

type Action = "confirm" | "reject" | "remove";

export function ManagerApplicants({
  items,
  mutable,
  busyId,
  notice,
  onAction,
  onReload,
}: {
  items: Participation[];
  mutable: boolean;
  busyId: string | null;
  notice: string | null;
  onAction: (action: Action, item: Participation, reason: string) => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const pending = items.filter((item) => item.status === "pending");
  const confirmed = items.filter((item) => item.status === "confirmed");
  const others = items.filter(
    (item) => item.status !== "pending" && item.status !== "confirmed",
  );

  return (
    <section className="gb-applicants" data-surface="manager-applicants">
      <header className="gb-applicants__heading">
        <div>
          <span className="gb-game-kicker">Заявки и состав</span>
          <h2>Участники</h2>
          <p>
            Заявки ждут вашего ответа. Место занято после подтверждения.
          </p>
        </div>
        <Button variant="outline" onClick={onReload} disabled={busyId != null}>
          Обновить
        </Button>
      </header>

      {!mutable ? (
        <p className="gb-c23-helper">
          Управление заявками доступно только для опубликованной игры до её
          начала. Изменение вместимости и отмена игры здесь недоступны.
        </p>
      ) : null}

      {mutable ? (
        <label className="gb-applicants__reason">
          Причина отклонения или снятия
          <input
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Необязательно — будет использован короткий текст по умолчанию"
          />
        </label>
      ) : null}

      {notice ? (
        <p className="gb-game-notice" role="status">
          {notice}
        </p>
      ) : null}

      <ApplicantGroup
        title="Ждут ответа"
        empty="Новых заявок нет."
        items={pending}
        mutable={mutable}
        busyId={busyId}
        actions={["confirm", "reject"]}
        reason={reason}
        onAction={onAction}
      />
      <ApplicantGroup
        title="В составе"
        empty="Подтверждённых участников пока нет."
        items={confirmed}
        mutable={mutable}
        busyId={busyId}
        actions={["remove"]}
        reason={reason}
        onAction={onAction}
      />
      {others.length > 0 ? (
        <ApplicantGroup
          title="История заявок"
          empty=""
          items={others}
          mutable={false}
          busyId={busyId}
          actions={[]}
          reason={reason}
          onAction={onAction}
        />
      ) : null}
    </section>
  );
}

function ApplicantGroup({
  title,
  empty,
  items,
  mutable,
  busyId,
  actions,
  reason,
  onAction,
}: {
  title: string;
  empty: string;
  items: Participation[];
  mutable: boolean;
  busyId: string | null;
  actions: Action[];
  reason: string;
  onAction: (action: Action, item: Participation, reason: string) => void;
}) {
  return (
    <div className="gb-applicants__group">
      <h3>
        {title} <b>{items.length}</b>
      </h3>
      {items.length === 0 ? (
        <p className="gb-c23-helper">{empty}</p>
      ) : (
        <div className="gb-applicants__table" role="table">
          <div className="gb-applicants__row gb-applicants__row--head" role="row">
            <span role="columnheader">Участник</span>
            <span role="columnheader">Статус</span>
            <span role="columnheader">Заявка</span>
            <span role="columnheader" />
          </div>
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <div className="gb-applicants__row" role="row" key={item.id}>
                <span role="cell">
                  <strong>{applicantLabel(item.userId)}</strong>{item.isCreatorOrganizer && <small>Создатель игры · участник</small>}
                </span>
                <span role="cell">
                  <GameStatusBadge tone={item.status}>
                    {participationLabel(item.status)}
                  </GameStatusBadge>
                </span>
                <span role="cell">
                  <time dateTime={item.requestedAt}>
                    {new Date(item.requestedAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                <span className="gb-applicants__actions" role="cell">
                  {mutable && actions.includes("confirm") ? (
                    <Button
                      disabled={busy || busyId != null}
                      onClick={() => onAction("confirm", item, reason)}
                    >
                      {busy ? "…" : "Подтвердить"}
                    </Button>
                  ) : null}
                  {mutable && actions.includes("reject") ? (
                    <Button
                      variant="outline"
                      disabled={busy || busyId != null}
                      onClick={() =>
                        onAction(
                          "reject",
                          item,
                          reason.trim() || DEFAULT_REJECT_REASON,
                        )
                      }
                    >
                      Отклонить
                    </Button>
                  ) : null}
                  {mutable && actions.includes("remove") ? (
                    <Button
                      variant="outline"
                      disabled={busy || busyId != null}
                      onClick={() =>
                        onAction(
                          "remove",
                          item,
                          reason.trim() || DEFAULT_REMOVE_REASON,
                        )
                      }
                    >
                      Снять
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
