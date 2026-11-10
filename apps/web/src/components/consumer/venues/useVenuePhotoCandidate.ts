"use client";
import { useEffect, useRef, useState } from "react";
import { preprocessAvatar, AVATAR_DERIVATIVE_MAX_BYTES } from "../../../lib/avatar-preprocess";
import { isPhotoId } from "../../../lib/comments-api";
import {
  candidatePrivatePreview, getOwnedVenuePhotoCandidate, isCandidateEvidence, isVenuePhotoCandidate,
  uploadVenuePhotoCandidate, VENUE_CANDIDATE_RIGHTS, withdrawVenuePhotoCandidate,
} from "../../../lib/venue-photo-candidates-api";
import type { CandidateEvidence, VenuePhotoCandidate } from "../../../lib/venue-photo-candidates-api";

type Packet = Readonly<{
  bytes: Blob; hash: string; evidence: Readonly<CandidateEvidence>; rights: typeof VENUE_CANDIDATE_RIGHTS;
  actor: string; scope: string; generation: number; venueId: string; key: string;
}>;
type Stage = "empty" | "preparing" | "prepared" | "confirmed" | "sending" | "unknown" | "settled" | "failed";
const emptyEvidence = (): CandidateEvidence => ({ creditKind: "photo", creditText: "", creditUrl: "", sourceUrl: "", permissionBasis: "", sourceAuthor: null });
function sameEvidence(a: CandidateEvidence, b: CandidateEvidence) {
  return (["creditKind", "creditText", "creditUrl", "sourceUrl", "permissionBasis", "sourceAuthor", "sourceFingerprint"] as const)
    .every(key => (a[key] ?? null) === (b[key] ?? null));
}
async function digest(blob: Blob) {
  const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

/** Commands and bytes live only in this host, never in browser storage. Scope loss retires authority. */
export function useVenuePhotoCandidate(actor: string, csrf: string, host: string, enabled: boolean) {
  const scope = `${actor}:${csrf}:${host}`;
  const live = useRef({ scope, enabled }); live.current = { scope, enabled };
  const generation = useRef(0);
  const active = useRef(false);
  const owner = useRef(scope);
  const controllers = useRef(new Set<AbortController>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const urls = useRef(new Set<string>());
  const running = useRef(false);
  const packet = useRef<Packet | null>(null);
  const venue = useRef("");
  const owned = useRef<VenuePhotoCandidate | null>(null);
  const withdrawal = useRef<{ id: string; key: string; version: 1 } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("empty");
  const [canCorrectUpload, setCanCorrectUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: .5, y: .5 });
  const [prepared, setPrepared] = useState<{ bytes: Blob; hash: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<CandidateEvidence>(emptyEvidence);
  const [rights, setRights] = useState(false);
  const [receipt, setReceipt] = useState<VenuePhotoCandidate | null>(null);
  const [notice, setNotice] = useState("");
  const [visibleScope, setVisibleScope] = useState(scope);
  function current(epoch = generation.current) {
    return active.current && enabled && live.current.enabled && live.current.scope === scope
      && owner.current === scope && epoch === generation.current;
  }
  function revokePreview() {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear(); setPreview(null);
  }
  function showPreview(bytes: Blob) {
    revokePreview(); const url = URL.createObjectURL(bytes); urls.current.add(url); setPreview(url);
  }
  useEffect(() => {
    owner.current = scope; active.current = enabled; ++generation.current;
    packet.current = null; venue.current = ""; owned.current = null; withdrawal.current = null; running.current = false; setBusy(false);
    setVisibleScope(scope); setFile(null); setPrepared(null); setReceipt(null); setStage("empty"); setCanCorrectUpload(false); setRights(false); setEvidence(emptyEvidence()); setNotice("");
    const retire = () => {
      active.current = false; ++generation.current;
      for (const c of controllers.current) c.abort();
      controllers.current.clear(); running.current = false;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
      // No restoration-triggered upload. A lost session cannot reuse this authority or bytes.
      packet.current = null; owned.current = null; withdrawal.current = null;
      setFile(null); setPrepared(null); setReceipt(null); setVisibleScope(""); revokePreview();
    };
    window.addEventListener("gb-session-changed", retire);
    window.addEventListener("gb-private-expired", retire);
    return () => {
      retire();
      window.removeEventListener("gb-session-changed", retire);
      window.removeEventListener("gb-private-expired", retire);
    };
  }, [scope, enabled]);

  useEffect(() => {
    if (!file || !current()) return;
    const epoch = generation.current;
    const c = new AbortController(); controllers.current.add(c);
    setStage("preparing"); setPrepared(null); revokePreview();
    void (async () => {
      try {
        const bytes = await preprocessAvatar(file, c.signal, crop);
        if (c.signal.aborted || !current(epoch)) return;
        if (!bytes.size || bytes.size > AVATAR_DERIVATIVE_MAX_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(bytes.type)) throw new Error("Invalid derivative");
        const hash = await digest(bytes);
        if (c.signal.aborted || !current(epoch)) return;
        setPrepared({ bytes, hash }); showPreview(bytes); setStage("prepared");
      } catch {
        if (!c.signal.aborted && current(epoch)) { setStage("failed"); setNotice("Не удалось подготовить фото. Выберите JPEG, PNG или WebP до 10 МиБ и 50 Мп."); }
      } finally { controllers.current.delete(c); }
    })();
    return () => { c.abort(); controllers.current.delete(c); };
  }, [file, crop, scope, enabled]);

  const locked = busy || running.current || stage === "sending" || stage === "unknown" || receipt?.status === "awaiting_review";
  function edit() {
    if (!current() || locked) return false;
    packet.current = null; withdrawal.current = null; owned.current = null;
    setReceipt(null); setRights(false); setStage(prepared ? "prepared" : "empty"); setNotice(""); return true;
  }
  function confirm() {
    if (!current() || locked || !prepared || !rights || !isCandidateEvidence(evidence)) return;
    // Immutable derivative, evidence, rights and identity. Canonical venue is filled exactly once before dispatch.
    packet.current = Object.freeze({ ...prepared, evidence: Object.freeze({ ...evidence, permissionBasis: evidence.permissionBasis.trim(), sourceAuthor: evidence.sourceAuthor?.trim() || null }),
      rights: VENUE_CANDIDATE_RIGHTS, actor, scope, generation: generation.current, venueId: venue.current, key: crypto.randomUUID() });
    setStage("confirmed"); setNotice(venue.current ? "Фото подтверждено. Отправьте его отдельно от игры." : "Фото подтверждено. Отправка начнётся только после сохранения площадки.");
  }

  async function perform(action: "upload" | "refresh" | "withdraw") {
    if (!current() || running.current) return;
    const p = packet.current;
    const known = owned.current;
    if (action === "upload" && (!p || !p.venueId || p.scope !== scope || p.actor !== actor || p.generation !== generation.current || withdrawal.current || known)) return;
    if (action !== "upload" && !known) return;
    if (action === "withdraw") {
      if (known?.status !== "awaiting_review" || known.version !== 1) return;
      withdrawal.current ??= { id: known.id, key: crypto.randomUUID(), version: 1 };
    }
    const epoch = generation.current;
    const c = new AbortController(); controllers.current.add(c); running.current = true; setBusy(true);
    const timer = setTimeout(() => c.abort(), 45000); timers.current.add(timer);
    setStage("sending");
    if (action === "upload") setCanCorrectUpload(false);
    if (action !== "upload") revokePreview();
    try {
      const result = action === "upload"
        ? await uploadVenuePhotoCandidate(p!.venueId, p!.bytes, p!.evidence, p!.key, csrf, c.signal)
        : action === "withdraw"
          ? await withdrawVenuePhotoCandidate(known!.id, withdrawal.current!.key, csrf, c.signal)
          : await getOwnedVenuePhotoCandidate(known!.id, c.signal);
      if (!current(epoch)) return;
      if (c.signal.aborted) {
        setStage("unknown"); revokePreview();
        setNotice("Время ожидания фото истекло. Результат неизвестен; сохранены исходная команда и ключ."); return;
      }
      if (result.ok && isVenuePhotoCandidate(result.data, venue.current, known?.id)
        && (!known || result.data.version >= known.version)
        && (action !== "upload" || (result.data.status === "awaiting_review"
          && sameEvidence(result.data.evidence, p!.evidence)))
        && (action !== "withdraw" || result.data.status === "withdrawn")) {
        owned.current = result.data; setReceipt(result.data); setStage(withdrawal.current && result.data.status === "awaiting_review" ? "unknown" : "settled");
        setNotice(result.data.status === "awaiting_review" ? "Фото отправлено на рассмотрение. Оно приватное и ещё не является официальным фото площадки."
          : result.data.status === "accepted" ? "Фото принято. Официальные фотографии управляются отдельно; снять его здесь нельзя."
            : result.data.status === "withdrawn" ? "Предложение фото снято. Официальные фото не изменены." : "Предложение фото отклонено. Официальные фото не изменены.");
        revokePreview();
        if (result.data.status === "awaiting_review") {
          try {
            const bytes = await candidatePrivatePreview(result.data, c.signal);
            if (current(epoch) && !c.signal.aborted) showPreview(bytes);
          } catch {
            if (current(epoch)) setNotice("Кандидат ожидает рассмотрения. Приватный предпросмотр недоступен; обновите статус.");
          }
        }
      } else if (!result.ok && result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 409) {
        // A failed refresh does not prove withdrawal or acceptance. Retain exact command for recovery.
        setStage(action === "upload" ? "failed" : "unknown"); revokePreview();
        // Only a definite validation rejection permits a new command in the saved-game view.
        // Auth/ownership denial and uncertain outcomes do not grant this recovery path.
        setCanCorrectUpload(action === "upload" && result.status === 422);
        setNotice(result.status === 404 ? "Фото недоступно: право автора проверяет сервер, в том числе при совпадении с чужой площадкой. Площадка сохранена; создание игры можно продолжить."
          : "Сервер не подтвердил фото. Проверьте права, источник и текущий статус. Площадка сохранена; создание игры можно продолжить.");
      } else {
        setStage("unknown"); revokePreview();
        setNotice("Результат фото неизвестен. Сохранены те же байты и ключ. Автоматического повтора нет; площадку и игру повторно создавать не нужно.");
      }
    } catch {
      if (current(epoch)) { setStage("unknown"); revokePreview(); setNotice("Результат фото неизвестен. Проверьте статус или явно повторите ту же команду с тем же ключом."); }
    } finally {
      clearTimeout(timer); timers.current.delete(timer); controllers.current.delete(c);
      if (current(epoch)) { running.current = false; setBusy(false); }
    }
  }
  function submitForVenue(id: string) {
    if (!current() || !isPhotoId(id) || (venue.current && venue.current !== id)) return;
    venue.current = id;
    const p = packet.current;
    if (!p || p.venueId || owned.current || running.current) return;
    packet.current = Object.freeze({ ...p, venueId: id });
    void perform("upload");
  }
  const visible = visibleScope === scope && active.current && enabled;
  return {
    busy: visible && busy, stage: visible ? stage : "empty", preview: visible ? preview : null, evidence, rights,
    receipt: visible ? receipt : null, notice: visible ? notice : "", locked: !visible || locked,
    hasFile: visible && Boolean(file), crop, canonicalVenueId: visible ? venue.current : "",
    canCorrectUpload: visible && canCorrectUpload,
    canConfirm: visible && !locked && Boolean(prepared) && rights && isCandidateEvidence(evidence),
    select(next: File) { if (edit()) { setPrepared(null); setFile(next); setCrop({ x: .5, y: .5 }); } },
    changeCrop(next: { x: number; y: number }) { if (edit()) { setPrepared(null); setCrop(next); } },
    changeEvidence(next: CandidateEvidence) { if (edit()) setEvidence(next); },
    changeRights(next: boolean) { if (edit()) setRights(next); },
    clear() { if (edit()) { setFile(null); setPrepared(null); revokePreview(); setStage("empty"); } },
    confirm, submitForVenue, invalidateConfirmation: edit,
    send() { if (stage === "confirmed") void perform("upload"); },
    retry() { if (stage === "unknown") void perform(withdrawal.current ? "withdraw" : owned.current ? "refresh" : "upload"); },
    refresh() { void perform("refresh"); },
    withdraw() { void perform("withdraw"); },
  };
}
export type VenuePhotoCandidateModel = ReturnType<typeof useVenuePhotoCandidate>;
