"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { VenueSummary } from "../../../lib/consumer-types";
import {
  buildVenueBookingDraft,
  copyVenueBookingText,
} from "../../../lib/venue-booking-help";
import { VenuePublicContacts } from "../venues/VenuePublicContacts";
import { Button } from "../Button";

const CHECKLIST = [
  "Уточните свободный корт на нужное время",
  "Спросите правила оплаты и отмены напрямую у площадки",
  "Согласуйте, кто подтвердит бронь и принесёт оплату",
  "Не полагайтесь на приложение: бронирование здесь не оформляется",
] as const;

export function VenueBookingHelp({
  venue,
  createNewVenue,
  startDate,
  startTime,
  durationMinutes,
  timezone,
  accountKey,
}: {
  venue: VenueSummary | null;
  createNewVenue: boolean;
  startDate: string;
  startTime: string;
  durationMinutes: string;
  timezone: string | null | undefined;
  /** Clears draft/copied state on account change / logout. */
  accountKey: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTarget = useRef(0);
  const knownVenue = !createNewVenue && venue ? venue : null;
  const draft = knownVenue && timezone
    ? buildVenueBookingDraft({
      venueName: knownVenue.name,
      venueAddress: knownVenue.address,
      startDate,
      startTime,
      durationMinutes,
      timezone,
    })
    : null;

  useEffect(() => {
    copyTarget.current += 1;
    setCopied(false);
    setCopyFailed(false);
  }, [
    accountKey,
    knownVenue?.id,
    knownVenue?.name,
    knownVenue?.address,
    startDate,
    startTime,
    durationMinutes,
    timezone,
    createNewVenue,
  ]);

  if (!knownVenue) return null;

  async function onCopy() {
    if (!draft) return;
    const token = ++copyTarget.current;
    setCopied(false);
    setCopyFailed(false);
    const result = await copyVenueBookingText(draft.text);
    if (token !== copyTarget.current) return;
    if (result === "copied") setCopied(true);
    else setCopyFailed(true);
  }

  return (
    <section className="gb-venue-booking-help" aria-label="Помощь с договорённостью о корте">
      <VenuePublicContacts value={knownVenue.publicContacts} />
      <details
        className="gb-venue-booking-help__checklist"
        open={open}
        onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary id={panelId}>Чек-лист перед обращением к площадке</summary>
        <ol aria-labelledby={panelId}>
          {CHECKLIST.map((item) => <li key={item}>{item}</li>)}
        </ol>
        <p className="gb-venue-booking-help__note">
          Приложение не бронирует корт и не принимает оплату. Текст ниже — черновик для вашего сообщения площадке.
        </p>
        {draft ? (
          <>
            <label className="gb-venue-booking-help__draft">
              <span>Черновик сообщения</span>
              <textarea readOnly rows={6} value={draft.text} aria-label="Черновик сообщения площадке" />
            </label>
            <div className="gb-venue-booking-help__actions">
              <Button type="button" variant="outline" onClick={() => void onCopy()}>
                Скопировать черновик
              </Button>
              {copied ? <p role="status">Черновик скопирован.</p> : null}
              {copyFailed ? (
                <p role="status">
                  Не удалось скопировать автоматически. Выделите текст выше и скопируйте вручную.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="gb-venue-booking-help__hint" role="status">
            Укажите дату, время и длительность, чтобы подготовить черновик с фактическими данными игры.
          </p>
        )}
      </details>
    </section>
  );
}
