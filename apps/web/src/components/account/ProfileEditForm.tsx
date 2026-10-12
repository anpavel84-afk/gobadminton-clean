"use client";

import { useMemo, useState } from "react";
import { AccountShell } from "./AccountShell";
import { Button } from "./Button";
import { Field } from "./Field";
import { LinkButton } from "./LinkButton";
import { Notice } from "./Notice";

/**
 * Visual profile form only. P-07 validation contract is gated.
 * Local required-name check demonstrates field-error presentation (M11), not final policy.
 */
export function ProfileEditForm({
  showErrorDemo = false,
  showSubmittingDemo = false,
}: {
  showErrorDemo?: boolean;
  showSubmittingDemo?: boolean;
}) {
  const [name, setName] = useState(showErrorDemo ? "" : "Анна Петрова");
  const [level, setLevel] = useState("Средний");
  const [city, setCity] = useState("Москва");
  const [attempted, setAttempted] = useState(showErrorDemo);
  const [gateNotice, setGateNotice] = useState(false);

  const nameError = useMemo(() => {
    if (!attempted) return null;
    if (!name.trim()) return "Укажите, как к вам обращаться.";
    return null;
  }, [attempted, name]);

  return (
    <AccountShell title="Редактирование" globalActive="profile" localActive="profile">
      <form
        className="gb-panel gb-panel--desktop gb-form"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          setGateNotice(false);
          if (!name.trim()) return;
          // P-07: local presentation only — never persist or claim success.
          setGateNotice(true);
        }}
        noValidate
      >
        <Notice
          tone="info"
          title="Визуальная форма"
          body="Сохранение профиля не выполняется: каталог уровня/города и контракт валидации остаются P-07."
        />

        {gateNotice ? (
          <Notice
            tone="conflict"
            title="Сохранение отключено"
            body="Локальная проверка имени прошла, но запись профиля не выполняется (P-07). Успешная мутация не имитируется."
          />
        ) : null}

        <Field
          id="profile-name"
          label="Как к вам обращаться"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          autoComplete="nickname"
        />

        <Field
          id="profile-level"
          as="select"
          label="Уровень (самооценка)"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          options={[
            { value: "Начальный", label: "Начальный" },
            { value: "Средний", label: "Средний" },
            { value: "Продвинутый", label: "Продвинутый" },
          ]}
          helper="Фикстурные значения. Финальный каталог — P-07."
        />

        <Field
          id="profile-city"
          label="Предпочтительный город"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          helper="Москва · необязательно — provisional source copy, not final requiredness."
        />

        {showSubmittingDemo ? (
          <Button type="button" variant="primary" widthClass="block" disabled data-gated="P-07">
            Проверяем условия…
          </Button>
        ) : (
          <Button type="submit" variant="primary" widthClass="block">
            Сохранить изменения
          </Button>
        )}

        <LinkButton href="/account" variant="secondary">
          Отмена
        </LinkButton>
      </form>
    </AccountShell>
  );
}
