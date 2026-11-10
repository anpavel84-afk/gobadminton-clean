"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getVenueExperienceReviews, isWithdrawVenueReviewReceipt, listOwnVenueReviews,
  type OwnVenueReview, type VenueReviewMutationReceipt, type WithdrawVenueReviewCommand,
} from "../../../lib/venue-reviews-api";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import { useSocialMutation, type SocialMutationPending } from "../messages/useSocialMutation";
import "../../../styles/venue-reviews.css";

type Props = { actorId: string; csrfToken: string; onUnauthorized: () => void };

/** Keyed session host: private state and unresolved packets never migrate between actors. */
export function OwnVenueReviews(props: Props) {
  if (!props.actorId || !props.csrfToken) return null;
  return <OwnReviewsController key={JSON.stringify([props.actorId, props.csrfToken])} {...props} />;
}

function OwnReviewsController({ actorId, csrfToken, onUnauthorized }: Props) {
  const router = useRouter();
  const contentId = useId();
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<OwnVenueReview[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "auth">("idle");
  const [selected, setSelected] = useState<OwnVenueReview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [readRequired, setReadRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [readRevision, setReadRevision] = useState(0);
  const live = useRef(true);
  const revoked = useRef(false);
  const readSequence = useRef(0);
  const reading = useRef(false);
  const stale = useRef(false);
  const admitted = useRef<{ actorId: string; own: OwnVenueReview; body: WithdrawVenueReviewCommand; key: string | null } | null>(null);

  function revoke() {
    revoked.current = true;
    readSequence.current += 1;
    admitted.current = null;
    setItems([]); setSelected(null); setDialogOpen(false); setOpened(false);
    setNotice(""); setState("auth");
    onUnauthorized();
  }
  function matches(packet?: SocialMutationPending) {
    const request = admitted.current;
    if (!live.current || revoked.current || !request || request.actorId !== actorId || !packet) return false;
    const body = packet.body as Partial<WithdrawVenueReviewCommand>;
    if (packet.method !== "POST" || packet.path !== `/v1/me/venue-reviews/${encodeURIComponent(request.own.id)}/commands`
      || body.action !== "withdraw" || body.expectedVersion !== request.body.expectedVersion
      || Object.keys(body).length !== 2 || !packet.key) return false;
    if (request.key === null) request.key = packet.key;
    return packet.key === request.key;
  }
  const mutation = useSocialMutation<VenueReviewMutationReceipt>(
    `${actorId}:own-venue-withdraw`, csrfToken,
    receipt => {
      if (!live.current || revoked.current || !admitted.current) return;
      const target = admitted.current.own;
      setItems(rows => rows.map(row => row.id === target.id ? {
        ...row, ...receipt, text: null, topics: [], pendingRevision: null,
      } : row));
      admitted.current = null;
      setSelected(null); setDialogOpen(false);
      setNotice("Отзыв отозван. Публикация и ожидающая заявка сняты.");
      // Public reviews use no-store reads; discard our public quotations and refresh Next caches.
      setReadRevision(value => value + 1);
      router.refresh();
    },
    failure => {
      if (!live.current || revoked.current) return;
      admitted.current = null;
      if (failure?.status === 401 || failure?.status === 403) { revoke(); return; }
      if (failure?.code === "VERSION_CONFLICT") {
        stale.current = true; setReadRequired(true);
        setNotice("Версия отзыва изменилась. Сначала обновите список, затем подтвердите отзыв заново.");
      }
    },
    false,
    {
      validatePending: matches,
      validateSuccess: (receipt, packet) => matches(packet) && Boolean(admitted.current
        && isWithdrawVenueReviewReceipt(receipt, admitted.current.own)),
    },
  );

  useEffect(() => {
    live.current = true;
    const fence = () => revoke();
    window.addEventListener("gb-private-expired", fence);
    window.addEventListener("gb-session-changed", fence);
    return () => {
      live.current = false; readSequence.current += 1;
      window.removeEventListener("gb-private-expired", fence);
      window.removeEventListener("gb-session-changed", fence);
    };
  }, []);

  async function read() {
    // An own GET is never evidence resolving an UNKNOWN command.
    if (reading.current || admitted.current || revoked.current || !live.current) return;
    reading.current = true;
    const sequence = ++readSequence.current;
    setState("loading");
    try {
      const result = await listOwnVenueReviews();
      if (!live.current || revoked.current || sequence !== readSequence.current) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) revoke();
        else setState("error");
        return;
      }
      if (!Array.isArray(result.data?.items) || result.data.items.length > 50
        || result.data.items.some(row => !row || typeof row.id !== "string" || !row.id
          || typeof row.reviewHandle !== "string" || !row.reviewHandle || typeof row.venueId !== "string"
          || !Number.isSafeInteger(row.version) || row.version < 1)
        || new Set(result.data.items.map(row => row.id)).size !== result.data.items.length) {
        setState("error"); return;
      }
      setItems(result.data.items);
      stale.current = false; setReadRequired(false);
      setSelected(null); setDialogOpen(false); setNotice("");
      setReadRevision(value => value + 1); setState("ready");
    } catch {
      if (live.current && !revoked.current && sequence === readSequence.current) setState("error");
    } finally {
      if (sequence === readSequence.current) reading.current = false;
    }
  }
  function toggle() {
    setOpened(value => !value);
    if (state === "idle") void read();
  }
  function confirm() {
    if (!selected || admitted.current || reading.current || stale.current || state !== "ready"
      || revoked.current || !live.current || selected.status === "withdrawn"
      || !items.some(row => row.id === selected.id && row.version === selected.version)) return;
    const body: WithdrawVenueReviewCommand = Object.freeze({ action: "withdraw", expectedVersion: selected.version });
    admitted.current = { actorId, own: Object.freeze({ ...selected }), body, key: null };
    if (!mutation.run(`/v1/me/venue-reviews/${encodeURIComponent(selected.id)}/commands`, body)) admitted.current = null;
  }
  const locked = mutation.busy || mutation.pending;
  if (state === "auth") return null;
  return <section className="profile-section gb-own-reviews" aria-label="Отзывы о площадках">
    <header className="gb-own-reviews__heading"><h2>Отзывы о площадках</h2><span className="gb-venue-reviews__badge gb-venue-reviews__badge--muted">Только вам</span></header>
    <Button variant="outline" aria-expanded={opened} aria-controls={contentId} onClick={toggle}>{opened ? "Свернуть отзывы" : "Открыть отзывы"}</Button>
    {notice && <p role="status">{notice}</p>}
    {locked && <div role="status" className="gb-own-reviews__hint"><p>{mutation.busy ? "Отзываем…" : "Результат отзыва не подтверждён. Новые операции заблокированы; обновление списка не подтвердит эту отправку."}</p><Button variant="outline" onClick={() => setDialogOpen(true)}>Вернуться к операции</Button></div>}
    <div id={contentId} hidden={!opened} className="gb-own-reviews__collection">
      <p className="gb-venue-reviews__hint">Здесь до 50 последних отзывов. Это неполная история: отсутствие отзыва в списке не означает, что он удалён или не существует.</p>
      {state === "loading" && <p role="status">Загружаем ваши отзывы…</p>}
      {state === "error" && <p role="alert">Не удалось загрузить ваши отзывы. Последнее подтверждённое состояние сохранено; действия недоступны до успешного чтения.</p>}
      {readRequired && <p role="alert">Нужно успешное обновление списка. Ошибка чтения не снимает блокировку устаревшей версии.</p>}
      <Button variant="outline" disabled={locked || state === "loading"} onClick={() => void read()}>Обновить список</Button>
      {state === "ready" && items.length === 0 && <p>В последних 50 отзывах записей нет. Более ранняя история здесь недоступна.</p>}
      <ul className="gb-venue-reviews__list">{items.map(row => <li key={row.id} className="gb-venue-reviews__card">
        <header className="gb-own-reviews__heading"><h3>Ваш отзыв о площадке</h3><span className="gb-venue-reviews__badge gb-venue-reviews__badge--muted">{row.status === "withdrawn" ? "Отозван" : row.pendingRevision !== null || row.receiptToken ? "Ожидает обработки" : row.publicVisible ? "Опубликован" : "Не опубликован"}</span></header>
        <Link href={`/venues/${encodeURIComponent(row.venueId)}`}>Открыть площадку</Link>
        {row.status === "withdrawn" ? <p>Публикация снята. Повторная отправка этого отзыва недоступна.</p> : <>
          <div className="gb-own-reviews__own"><strong>{row.pendingRevision !== null || row.receiptToken ? "Ваш текст · ожидает обработки" : "Ваш текст"}</strong><p className="gb-venue-reviews__card-text">{row.text ?? "Текст не возвращён."}</p><p className="gb-venue-reviews__hint">Это ваш текст из личного списка, а не подтверждённая публичная цитата. Обработка может задержать публикацию.</p></div>
          {row.publicVisible ? <PublicQuotation key={`${row.id}:${readRevision}`} own={row} live={live} revoked={revoked} /> : <p>Публичная видимость не подтверждена.</p>}
          <p className="gb-own-reviews__hint">Редактирование пока недоступно: в личном списке нет подтверждённой связи с исходной игрой. Отозвать отзыв можно независимо от срока редактирования.</p>
          <Button variant="dark" disabled={locked || readRequired || state !== "ready"} onClick={() => { setSelected(row); setDialogOpen(true); mutation.setNotice(""); }}>Отозвать отзыв</Button>
        </>}
      </li>)}</ul>
    </div>
    {dialogOpen && selected && <ProfileDialog title="Отозвать отзыв?" className="gb-own-reviews-dialog" lockBodyScroll onClose={() => setDialogOpen(false)} onNativeClose={() => setDialogOpen(false)}>
      <div className="gb-own-reviews"><p>Публикация и ожидающая заявка будут сняты. Повторная отправка этого отзыва недоступна.</p>
        <div className="gb-own-reviews__hint"><strong>Ваш текст</strong><p className="gb-venue-reviews__card-text">{selected.text ?? "Текст не возвращён."}</p></div>
        {mutation.notice && <p role="alert">{mutation.notice}</p>}
        {readRequired && <p role="alert">Сначала успешно обновите список и подтвердите действие заново.</p>}
        {mutation.pending && !mutation.busy && <p>Исходный запрос сохранён в этой сессии. Повтор отправит тот же запрос с тем же ключом; закрытие окна не отменяет операцию.</p>}
        <div className="gb-venue-reviews__actions"><Button variant="outline" onClick={() => setDialogOpen(false)}>{locked ? "Скрыть окно" : "Отмена"}</Button>
          {mutation.pending ? <Button variant="dark" disabled={mutation.busy} onClick={() => mutation.retry()}>Повторить исходный запрос</Button> : <Button variant="dark" disabled={readRequired || state !== "ready" || mutation.busy} onClick={confirm}>Да, отозвать</Button>}
        </div>
      </div>
    </ProfileDialog>}
  </section>;
}

/** At most three existing public pages, exact handle only; own COALESCE text is never substituted. */
function PublicQuotation({ own, live, revoked }: { own: OwnVenueReview; live: RefObject<boolean>; revoked: RefObject<boolean> }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing" | "ready">("idle");
  const current = useRef(true);
  const lock = useRef(false);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  async function load() {
    if (lock.current || !live.current || revoked.current) return;
    lock.current = true; setState("loading");
    let cursor: string | undefined;
    const seen = new Set<string>();
    try {
      for (let page = 0; page < 3; page += 1) {
        const result = await getVenueExperienceReviews(own.venueId, { cursor, limit: 20 });
        if (!current.current || !live.current || revoked.current) return;
        if (!result.ok || result.data.venueId !== own.venueId || !Array.isArray(result.data.items)) break;
        const item = result.data.items.find(item => item.reviewHandle === own.reviewHandle);
        if (item && typeof item.text === "string") { setText(item.text); setState("ready"); return; }
        const next = result.data.nextCursor;
        if (!next || seen.has(next)) break;
        seen.add(next); cursor = next;
      }
    } catch { /* Visibility remains confirmed by own DTO; quotation remains unknown. */ }
    finally { lock.current = false; }
    if (current.current && live.current && !revoked.current) setState("missing");
  }
  return <div className="gb-own-reviews__public"><strong>Публичная версия</strong><p>Публичная видимость подтверждена.</p>
    {state === "ready" ? <blockquote>{text}</blockquote> : <><p>Публичная цитата {state === "loading" ? "загружается" : "недоступна"}. Ваш личный текст её не заменяет.</p><Button variant="outline" disabled={state === "loading"} onClick={() => void load()}>Показать публичный текст</Button></>}
  </div>;
}
