"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, errorMessage, freshStepUp, isDefiniteAdminFailure, type Session } from "../lib/admin-client";
import { adminPath } from "../lib/admin-path";

type Evidence = {
  creditKind: "photo"; creditText: string; creditUrl: string; sourceUrl: string;
  sourceAuthor?: string | null; permissionBasis: string; sourceFingerprint?: string | null;
};
type Candidate = {
  id: string; venueId: string; status: "awaiting_review" | "accepted" | "rejected" | "withdrawn";
  version: number; width: number; height: number; evidence: Evidence; previewPath: string | null;
};
type Packet = Readonly<{
  path: string; body: string; key: string; scope: string; candidate: Candidate; action: "accept" | "reject";
}>;
type Mode = "loading" | "empty" | "pending" | "denied" | "stepup" | "sending" | "confirmed" | "conflict" | "unknown" | "error";
type Props = {
  id: string; version: number; selection: number; session: Session; disabled: boolean; authorityBlocked: boolean;
  canStart: () => boolean; onBusy: (busy: boolean) => void; authorityLoss: () => void;
  stepup: () => Promise<void>; changed: () => Promise<void>;
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const clean = (value: unknown, min: number, max: number): value is string => typeof value === "string"
  && value.trim().length >= min && value.length <= max && ![...value].some(char => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
function safeUrl(value: unknown): value is string {
  if (!clean(value, 1, 300) || !value.startsWith("https://") || /[\s\\]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && (!url.port || url.port === "443"); }
  catch { return false; }
}
function validCandidate(value: unknown, venueId: string): value is Candidate {
  if (!value || typeof value !== "object") return false;
  const c = value as Candidate, e = c.evidence;
  return uuid(c.id) && uuid(c.venueId) && c.venueId === venueId
    && ["awaiting_review", "accepted", "rejected", "withdrawn"].includes(c.status)
    && c.version === (c.status === "awaiting_review" ? 1 : 2) && c.width === 1200 && c.height === 400
    && c.previewPath === (c.status === "awaiting_review" ? `/v1/admin/venues/${venueId}/photo-candidates/${c.id}/content` : null)
    && !!e && e.creditKind === "photo" && clean(e.creditText, 7, 120) && e.creditText.startsWith("Фото: ")
    && safeUrl(e.creditUrl) && safeUrl(e.sourceUrl) && clean(e.permissionBasis, 1, 600)
    && (e.sourceAuthor == null || clean(e.sourceAuthor, 1, 120))
    && (e.sourceFingerprint == null || (typeof e.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(e.sourceFingerprint)));
}
const evidenceIdentity = (e: Evidence) => JSON.stringify([e.creditKind,e.creditText,e.creditUrl,e.sourceUrl,e.sourceAuthor ?? null,e.permissionBasis,e.sourceFingerprint ?? null]);

export function VenuePhotoCandidates(props: Props) {
  const { id, version, selection, session, disabled, authorityBlocked, onBusy } = props;
  // Fresh step-up and CSRF rotation do not change the actor or dispatch an earlier packet.
  const scope = JSON.stringify([id,selection,session.principalId,session.userId,session.sessionId,session.version,
    session.status,session.expiresAt,[...session.roles].sort(),authorityBlocked]);
  const latest = useRef({ props, scope }); latest.current = { props, scope };
  const lifetime = useRef(0), mounted = useRef(false), latch = useRef(false);
  const controllers = useRef(new Set<AbortController>()), privateUrl = useRef("");
  const packet = useRef<Packet | null>(null), confirmed = useRef(false);
  const contentScope = useRef("");
  const [mode,setMode] = useState<Mode>("loading"), [candidate,setCandidate] = useState<Candidate | null>(null);
  const [preview,setPreview] = useState(""), [message,setMessage] = useState(""), [hasPacket,setHasPacket] = useState(false);
  const [working,setWorking] = useState(false);
  const authorized = () => uuid(latest.current.props.id) && !latest.current.props.authorityBlocked && latest.current.props.session.status === "active"
    && Date.parse(latest.current.props.session.expiresAt) > Date.now();
  const live = (generation: number, identity: string) => mounted.current && lifetime.current === generation && latest.current.scope === identity && authorized();
  function revoke() {
    if (privateUrl.current) URL.revokeObjectURL(privateUrl.current);
    privateUrl.current = ""; setPreview("");
  }
  function lock(value: boolean) { latch.current = value; setWorking(value); latest.current.props.onBusy(value || !!packet.current); }
  async function request<T>(path: string, parse: (response: Response) => Promise<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); controllers.current.add(controller);
    const aborted = new Promise<never>((_resolve,reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once:true }));
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 20000);
    try {
      return await Promise.race([aborted, (async () => {
        const response = await fetch(adminPath(path), { ...init, credentials:"same-origin", cache:"no-store", redirect:"error", signal:controller.signal });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new AdminError(typeof problem?.code === "string" ? problem.code : "ADMIN_REQUEST_FAILED", response.status);
        }
        return parse(response);
      })()]);
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }
  function failure(error: unknown) {
    revoke();
    if (error instanceof AdminError && error.code === "ADMIN_STEP_UP_REQUIRED") {
      setMode("stepup"); setMessage("Подтвердите вход. Решение автоматически не отправляется.");
    } else if (error instanceof AdminError && [401,403,404].includes(error.status)) {
      setMode("denied"); setCandidate(null);
      setMessage("Кандидат недоступен для текущего доступа или выбранной площадки.");
      if (error.status !== 404) latest.current.props.authorityLoss();
    } else if (error instanceof AdminError && error.status === 409) {
      setMode("conflict"); setCandidate(null);
      setMessage(`Данные, вместимость, источник или политика изменились (${error.code}). Обновите площадку и очередь перед новым решением.`);
    } else { setCandidate(null); setMode("error"); setMessage(errorMessage(error)); }
  }
  async function read(generation: number, identity: string, keepConfirmation = false) {
    revoke(); setCandidate(null); if (!keepConfirmation) { setMode("loading"); setMessage(""); }
    const queue = await request(`/v1/admin/venues/${id}/photo-candidates`, r => r.json()) as {items?:unknown};
    if (!live(generation,identity)) return;
    if (!Array.isArray(queue?.items) || queue.items.length > 1 || queue.items.some(c => !validCandidate(c,id) || c.status !== "awaiting_review")) throw new Error("Invalid candidate queue");
    const next = queue.items[0] as Candidate | undefined;
    if (!next) { if (!keepConfirmation) setMode("empty"); return; }
    contentScope.current = identity; setCandidate(next); if (!keepConfirmation) setMode("loading");
    const bytes = await request(next.previewPath!, async r => {
      if (r.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "image/png") throw new Error("Invalid private preview");
      const blob = await r.blob();
      if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error("Invalid private preview");
      return blob;
    });
    if (!live(generation,identity)) return;
    privateUrl.current = URL.createObjectURL(bytes); setPreview(privateUrl.current);
    if (!keepConfirmation) setMode("pending");
  }
  useEffect(() => {
    mounted.current = true;
    const generation = ++lifetime.current;
    revoke(); setCandidate(null);
    if (packet.current) {
      lock(false); setMode("unknown"); setMessage("UNKNOWN: прежний пакет сохранён; доступ или сессия изменились. Новое решение заблокировано.");
    } else if (authorized()) {
      lock(true);
      void read(generation,scope).catch(error => { if (live(generation,scope)) failure(error); }).finally(() => { if (live(generation,scope)) lock(false); });
    } else { setMode("denied"); setMessage("Вход истёк или доступ отозван."); lock(false); }
    const remaining = Date.parse(session.expiresAt) - Date.now();
    const expiry = remaining > 0 && remaining <= 2147483647 ? setTimeout(() => {
      if (!mounted.current || lifetime.current !== generation || latest.current.scope !== scope) return;
      revoke(); setCandidate(null);
      for (const controller of controllers.current) controller.abort();
      setMode(packet.current ? "unknown" : "denied");
      setMessage(packet.current ? "UNKNOWN: сессия истекла. Исходный пакет сохранён; новое решение заблокировано." : "Вход истёк.");
      latest.current.props.authorityLoss();
    }, remaining) : undefined;
    return () => {
      clearTimeout(expiry);
      mounted.current = false; ++lifetime.current;
      for (const controller of controllers.current) controller.abort();
      if (privateUrl.current) URL.revokeObjectURL(privateUrl.current);
      privateUrl.current = ""; latch.current = false; onBusy(false);
    };
    // scope contains only actor/authority/selection identity; restoring step-up never sends a command.
  }, [scope]);

  async function refresh(keepConfirmation = false) {
    if (latch.current || !authorized() || latest.current.props.disabled || (!keepConfirmation && packet.current)) return;
    const generation = lifetime.current, identity = scope;
    lock(true);
    try {
      await latest.current.props.changed();
      if (!live(generation,identity)) return;
      await read(generation,identity,keepConfirmation);
      if (!live(generation,identity)) return;
      if (keepConfirmation) { packet.current = null; setHasPacket(false); }
    } catch (error) {
      if (live(generation,identity)) {
        if (keepConfirmation) { setMode("confirmed"); setMessage("Решение подтверждено. Обновление данных не завершено; повторяется только чтение."); }
        else failure(error);
      }
    } finally { if (live(generation,identity)) lock(false); }
  }
  async function send(action?: "accept" | "reject") {
    if (latch.current || !authorized() || latest.current.props.disabled || !latest.current.props.canStart()) return;
    if (packet.current && action) return;
    if (!freshStepUp(latest.current.props.session)) { setMode("stepup"); setMessage("Перед решением подтвердите вход."); return; }
    const reconciliation = !!packet.current;
    if (!packet.current) {
      if (!action || !candidate || mode !== "pending" || !preview || !Number.isInteger(version) || version < 1 || version > 2147483647) return;
      // Freeze target, evidence, action, both versions and actor/selection before the first dispatch.
      packet.current = Object.freeze({ scope, candidate: structuredClone(candidate), action,
        path:`/v1/admin/venues/${id}/photo-candidates/${candidate.id}/decision`, key:crypto.randomUUID(),
        body:JSON.stringify({ action, expectedVersion:version, expectedCandidateVersion:1 }) });
      confirmed.current = false; setHasPacket(true);
    }
    const p = packet.current;
    if (p.scope !== scope || confirmed.current) return;
    const generation = lifetime.current, identity = scope;
    lock(true); revoke(); setMode("sending"); setMessage("");
    try {
      const result: unknown = await request(p.path, r => r.json(), { method:"POST", body:p.body,
        headers:{"Content-Type":"application/json", "X-CSRF-Token":latest.current.props.session.csrfToken, "Idempotency-Key":p.key} });
      if (!live(generation,identity)) return;
      if (!validCandidate(result,id) || result.id !== p.candidate.id || result.status !== (p.action === "accept" ? "accepted" : "rejected")
        || evidenceIdentity(result.evidence) !== evidenceIdentity(p.candidate.evidence)) throw new Error("Unconfirmed decision receipt");
      confirmed.current = true; setCandidate(null); setMode("confirmed");
      setMessage(p.action === "accept" ? "Фото принято в галерею. Прежняя основная фотография сохранена." : "Кандидат отклонён. Официальные фотографии сохранены.");
      // A validated receipt settles the command. A failed refresh must never resend it.
      await latest.current.props.changed();
      if (!live(generation,identity)) return;
      await read(generation,identity,true);
      if (!live(generation,identity)) return;
      packet.current = null; setHasPacket(false);
    } catch (error) {
      if (!live(generation,identity)) return;
      if (confirmed.current) {
        if (error instanceof AdminError && [401,403].includes(error.status) && error.code !== "ADMIN_STEP_UP_REQUIRED") latest.current.props.authorityLoss();
        setMode("confirmed"); setMessage("Решение подтверждено. Обновление данных не завершено; повторяется только чтение.");
      } else if (reconciliation && isDefiniteAdminFailure(error)) {
        setMode("unknown"); setMessage(`UNKNOWN: сверка недоступна (${error instanceof AdminError ? error.code : "ошибка"}). Исходный пакет сохранён; отказ при сверке не доказывает исход прежнего решения.`);
        if (error instanceof AdminError && [401,403].includes(error.status)) latest.current.props.authorityLoss();
      } else if (isDefiniteAdminFailure(error)) {
        packet.current = null; setHasPacket(false); failure(error);
      } else if (error instanceof AdminError && error.code === "ADMIN_STEP_UP_REQUIRED") failure(error);
      else {
        setMode("unknown"); setMessage("UNKNOWN: результат решения неизвестен. Пустая очередь не подтверждает исход. Сверка отправляет только исходный пакет с прежним ключом; новая попытка заблокирована.");
      }
    } finally { if (live(generation,identity)) lock(false); }
  }
  async function confirmAccess() {
    if (latch.current || !authorized() || latest.current.props.disabled) return;
    const generation = lifetime.current, identity = scope;
    lock(true);
    try {
      await latest.current.props.stepup();
      if (!live(generation,identity)) return;
      if (packet.current) { setMode("unknown"); setMessage("Вход подтверждён. Для сверки исходного решения нажмите отдельную кнопку; автоматической отправки нет."); }
      else await read(generation,identity);
    } catch (error) { if (live(generation,identity)) failure(error); }
    finally { if (live(generation,identity)) lock(false); }
  }
  const blocked = disabled || authorityBlocked || working || !authorized();
  const visiblePreview = contentScope.current === scope && authorized() ? preview : "";
  const e = contentScope.current === scope && authorized() ? candidate?.evidence : undefined;
  return <div className="panel venue-photo-candidates"><h3>Кандидат в официальную галерею</h3>
    <p>Фото выбранной площадки ожидает решения. Принятие добавляет его в галерею до 8 изображений, сохраняя существующую основную фотографию.</p>
    {mode === "loading" && <p role="status">{candidate ? "Загрузка приватного предпросмотра…" : "Загрузка кандидата…"}</p>}
    {mode === "empty" && <p role="status">Нет кандидатов на проверке.</p>}
    {mode === "sending" && <p role="status">Сохранение решения…</p>}
    {message && <div className={`notice${["denied","conflict","error"].includes(mode) ? " danger" : ""}`} role={mode === "confirmed" ? "status" : "alert"}>{message}</div>}
    {e && <><p><strong>{e.creditText}</strong> · <a href={e.creditUrl} target="_blank" rel="noopener noreferrer">Кредит</a></p>
      <p>Источник: <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceUrl}</a></p>
      <p>Автор источника: {e.sourceAuthor ?? "не указан"}</p><p>Основание права: {e.permissionBasis}</p>
      {e.sourceFingerprint && <p>Отпечаток источника: {e.sourceFingerprint}</p>}</>}
    {visiblePreview && <img className="venue-cover" src={visiblePreview} alt="Приватный предпросмотр кандидата площадки"/>}
    {mode === "pending" && <div className="actions"><button className="button" disabled={blocked || hasPacket || !preview} onClick={() => void send("accept")}>Принять фото</button>
      <button className="button outline" disabled={blocked || hasPacket || !preview} onClick={() => void send("reject")}>Отклонить фото</button></div>}
    {(mode === "stepup" || mode === "unknown") && <button className="button outline" disabled={blocked} onClick={() => void confirmAccess()}>Подтвердить вход для проверки фото</button>}
    {hasPacket && !confirmed.current && <><p>Пакет: {packet.current?.candidate.id} · {packet.current?.action === "accept" ? "принять" : "отклонить"}</p>
      <button className="button outline" disabled={blocked || packet.current?.scope !== scope} onClick={() => void send()}>Сверить исходное решение</button></>}
    {hasPacket && confirmed.current && <button className="button outline" disabled={blocked} onClick={() => void refresh(true)}>Обновить данные после решения</button>}
    {!hasPacket && ["empty","pending","conflict","error","denied","confirmed"].includes(mode) && <button className="button outline" disabled={blocked} onClick={() => void refresh()}>Обновить площадку и очередь</button>}
  </div>;
}
