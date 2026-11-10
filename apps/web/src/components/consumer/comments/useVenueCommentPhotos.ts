"use client";
import { useEffect, useRef, useState } from "react";
import type { CommentPhoto } from "../../../lib/comments-types";
import { isPhotoId } from "../../../lib/comments-api";
import {
  getOwnedVenueCommentPhoto, isPhotoReceipt, PHOTO_RIGHTS, uploadVenueCommentPhoto,
  withdrawVenueCommentPhoto, type VenueCommentPhotoReceipt,
} from "../../../lib/venue-comment-photos-api";

type PhotoState = "checking" | "ready" | "rejected" | "retryable" | "unknown";
export type PhotoDraft = {
  key: string; target: string; hash: string; mime: string; size: number;
  state: PhotoState; selected: boolean; receipt?: VenueCommentPhotoReceipt;
  withdrawKey?: string; retained?: CommentPhoto; message?: string;
};
type Context = { scope: string; actor: string; venue: string; csrf: string; enabled: boolean };
const same = (a: Context, b: Context) => a.scope === b.scope && a.csrf === b.csrf && a.enabled === b.enabled;
const storagePrefix = "gb-venue-comment-photos:";
const MAX_BYTES = 5 * 1024 * 1024;
async function fileHash(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
/** Owned memory holds raw bytes. Session storage holds command recovery metadata only. */
export function useVenueCommentPhotos(venue: string, actor: string, csrf: string, enabled: boolean) {
  const scope = `${actor}:${venue}`;
  const context: Context = { scope, actor, venue, csrf, enabled };
  const live = useRef(context);
  live.current = context;
  const owner = useRef(context);
  const active = useRef(true);
  const generation = useRef(0);
  const entries = useRef<PhotoDraft[]>([]);
  const files = useRef(new Map<string, Blob>());
  const controllers = useRef(new Set<AbortController>());
  const running = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const selecting = useRef(0);
  const dirtyTargets = useRef(new Set<string>());
  const retainedTargets = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<{ scope: string; items: PhotoDraft[] }>({ scope, items: [] });
  const [notice, setNotice] = useState("");
  const storageKey = storagePrefix + scope;
  function current(c = context, epoch = generation.current) {
    return active.current && epoch === generation.current && same(c, live.current) && same(c, owner.current);
  }
  function save() {
    if (!current()) return;
    setSnapshot({ scope, items: [...entries.current] });
    if (entries.current.some((p) => p.key === "hold")) return;
    try {
      // Retained IDs belong to accepted comments, never private cleanup or recovery.
      const records = entries.current.filter((p) => !p.retained).map((p) => ({
        ...p, message: undefined, state: p.state === "checking" ? "unknown" : p.state,
      }));
      if (records.length) sessionStorage.setItem(storageKey, JSON.stringify({ rights: PHOTO_RIGHTS, actor, venue, records }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Memory retains the identity if browser storage is unavailable. */ }
  }
  function abort() {
    generation.current += 1;
    active.current = false;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); running.current.clear(); files.current.clear();
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    setSnapshot({ scope: "", items: [] });
  }
  useEffect(() => {
    generation.current += 1;
    owner.current = context;
    active.current = true;
    entries.current = []; selecting.current = 0; dirtyTargets.current.clear(); retainedTargets.current.clear();
    files.current.clear(); running.current.clear();
    setNotice("");
    if (enabled) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const stored = JSON.parse(raw);
          if (stored.actor !== actor || stored.venue !== venue || stored.rights !== PHOTO_RIGHTS
            || !Array.isArray(stored.records) || stored.records.length > 32) throw new Error("hold");
          const keys = new Set<string>();
          entries.current = stored.records.map((p: PhotoDraft): PhotoDraft => {
            if (!p || typeof p.key !== "string" || !isPhotoId(p.key) || keys.has(p.key)
              || typeof p.hash !== "string" || !/^[a-f0-9]{64}$/.test(p.hash)
              || !["image/jpeg", "image/png", "image/webp"].includes(p.mime)
              || !Number.isInteger(p.size) || p.size < 1 || p.size > MAX_BYTES
              || typeof p.target !== "string" || !/^(root|reply:[0-9a-f-]{36}|edit:[0-9a-f-]{36}:\d+)$/.test(p.target)
              || typeof p.selected !== "boolean" || p.retained
              || !["ready", "unknown", "checking", "retryable", "rejected"].includes(p.state)
              || (p.withdrawKey !== undefined && !isPhotoId(p.withdrawKey))
              || (p.receipt !== undefined && (!isPhotoId(p.receipt.id) || p.receipt.venueId !== venue))) throw new Error("hold");
            keys.add(p.key);
            return { ...p, state: p.state === "rejected" ? "rejected" : "unknown", message: "Проверьте прежнюю попытку. Для загрузки выберите тот же файл." };
          });
        }
      } catch {
        // Do not overwrite corrupt/unproven metadata, create keys or retry it.
        entries.current = [{ key: "hold", target: "root", hash: "", mime: "", size: 0, state: "unknown", selected: true, message: "Сохранённая операция повреждена. Загрузка заблокирована." }];
      }
    }
    setSnapshot({ scope, items: [...entries.current] });
    const onSession = () => abort();
    window.addEventListener("gb-private-expired", onSession);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      generation.current += 1;
      active.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear(); running.current.clear(); files.current.clear();
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
      window.removeEventListener("gb-private-expired", onSession);
      window.removeEventListener("gb-session-changed", onSession);
    };
    // Context values define the owner; no automatic upload/retry on restoration/auth.
  }, [scope, csrf, enabled]);

  async function perform(p: PhotoDraft, reconcile = false) {
    if (!current() || !enabled || !csrf || running.current.has(p.key) || p.key === "hold") return;
    if (!p.withdrawKey && !reconcile && !files.current.has(p.key)) {
      p.message = "Выберите тот же файл для этой попытки, затем повторите."; save(); return;
    }
    if (running.current.size >= 2) return;
    const c = context;
    const epoch = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller); running.current.add(p.key);
    const timer = setTimeout(() => controller.abort(), 45000);
    timers.current.add(timer);
    p.state = "checking"; p.message = undefined; save(); // durable UNKNOWN before request
    try {
      const result = p.withdrawKey && p.receipt
        ? await withdrawVenueCommentPhoto(p.receipt.id, p.withdrawKey, csrf, controller.signal)
        : reconcile && p.receipt
          ? await getOwnedVenueCommentPhoto(p.receipt.id, controller.signal)
          : await uploadVenueCommentPhoto(venue, files.current.get(p.key)!, p.key, csrf, controller.signal);
      if (!current(c, epoch)) return;
      if (result.ok) {
        if (!isPhotoReceipt(result.data, venue, p.withdrawKey ? "withdrawn" : "ready", p.receipt?.id)
          || entries.current.some((other) => other !== p && (other.receipt?.id ?? other.retained?.id) === (result.data as VenueCommentPhotoReceipt).id)) {
          p.state = "unknown"; p.message = "Ответ не подтверждён. Сохранена прежняя попытка.";
        } else if (p.withdrawKey) {
          entries.current = entries.current.filter((item) => item !== p); files.current.delete(p.key);
        } else {
          p.receipt = result.data; p.state = "ready"; p.message = "Готово к публикации";
        }
      } else if (result.status === 422) {
        p.state = "rejected"; p.message = "Фото отклонено. Удалите его из публикации.";
      } else if ([400, 403, 404, 413, 415].includes(result.status)) {
        p.state = p.withdrawKey ? "unknown" : "rejected";
        p.message = p.withdrawKey ? "Снятие не подтверждено. Проверьте доступ и повторите ту же операцию." : "Фото недоступно или не принято. Удалите его из публикации.";
      } else {
        p.state = result.status === 429 ? "retryable" : "unknown";
        p.message = result.status === 429 ? "Проверка временно недоступна. Повторите позже." : "Результат пока неизвестен. Повтор использует ту же попытку.";
      }
      save();
    } catch {
      if (current(c, epoch)) { p.state = "unknown"; p.message = "Результат пока неизвестен."; save(); }
    } finally {
      clearTimeout(timer); timers.current.delete(timer); controllers.current.delete(controller);
      if (current(c, epoch)) {
        running.current.delete(p.key);
        // Only first-admission queued uploads start automatically, never UNKNOWN retries.
        const next = entries.current.find((item) => item.state === "checking" && !running.current.has(item.key));
        if (next) void perform(next);
      }
    }
  }
  async function add(target: string, selected: FileList | File[]) {
    if (!current() || !enabled || selecting.current > 0 || entries.current.some((p) => p.key === "hold")) return;
    const c = context;
    const epoch = generation.current;
    selecting.current += 1; save();
    try {
      for (const file of Array.from(selected)) {
        if (!current(c, epoch)) break;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > MAX_BYTES) {
          setNotice("Выберите JPEG, PNG или WebP до 5 МиБ."); continue;
        }
        const hash = await fileHash(file);
        if (!current(c, epoch)) break;
        // Reselection is recovery of SAME bytes and key, never a fresh upload.
        const old = entries.current.find((p) => p.target === target && p.hash === hash && p.mime === file.type && p.size === file.size);
        if (old) { files.current.set(old.key, file); old.message = "Файл совпадает. Нажмите «Повторить»."; save(); continue; }
        if (entries.current.some((p) => p.target === target && p.state === "unknown" && !p.receipt)) {
          setNotice("Файл не совпадает с прежней попыткой. Выберите тот же файл или явно уберите её из публикации.");
          if (entries.current.some((p) => p.target === target && p.state === "unknown" && p.selected && !p.receipt)) continue;
        }
        if (entries.current.filter((p) => p.target === target && p.selected).length >= 4) { setNotice("Не больше четырёх фото в публикации."); break; }
        if (entries.current.filter((p) => !p.retained).length >= 8) { setNotice("Сначала завершите или снимите прежние загрузки (до 8 временных фото)."); break; }
        const p: PhotoDraft = { target, hash, mime: file.type, size: file.size, key: crypto.randomUUID(), state: "checking", selected: true };
        entries.current.push(p); files.current.set(p.key, file); save();
        if (running.current.size < 2) void perform(p);
      }
    } catch {
      if (current(c, epoch)) setNotice("Не удалось прочитать файл. Загрузка не начата; выберите файл снова.");
    } finally {
      if (current(c, epoch)) { selecting.current -= 1; save(); }
    }
  }
  const isVisible = snapshot.scope === scope && same(owner.current, context) && active.current && enabled;
  const visible = isVisible ? snapshot.items : [];
  return {
    notice, items: (target: string) => visible.filter((p) => p.target === target),
    unresolved: Boolean(isVisible && (visible.some((p) => !p.retained) || selecting.current > 0 || dirtyTargets.current.size > 0)),
    ready(target: string, text: string) {
      const selected = visible.filter((p) => p.target === target && p.selected);
      return selecting.current === 0 && selected.length <= 4 && selected.every((p) => p.state === "ready" && !p.withdrawKey
        && (p.retained || (p.receipt && Date.parse(p.receipt.expiresAt) > Date.now())))
        && Boolean(text.trim() || selected.length);
    },
    ids: (target: string) => visible.filter((p) => p.target === target && p.selected).map((p) => p.retained?.id ?? p.receipt!.id),
    add,
    retain(target: string, photos: CommentPhoto[]) {
      if (!current() || retainedTargets.current.has(target) || entries.current.some((p) => p.key === "hold")) return;
      retainedTargets.current.add(target);
      // Cancellation drops the accepted snapshot, not staged command identities. Restore
      // published IDs before those stages on reopening; never silently trim either set.
      entries.current.unshift(...photos.map((photo): PhotoDraft => ({ key: photo.id, target, hash: "", mime: "", size: 0, retained: photo, state: "ready", selected: true })));
      if (entries.current.filter((p) => p.target === target && p.selected).length > 4) {
        setNotice("Не больше четырёх фото в публикации. Уберите лишние фото перед сохранением.");
      }
      save();
    },
    retry(p: PhotoDraft) { if (p.state !== "rejected") void perform(p, Boolean(p.receipt && !p.withdrawKey)); },
    remove(p: PhotoDraft) {
      if (!current() || p.state === "checking" || p.key === "hold") return;
      if (p.retained) dirtyTargets.current.add(p.target);
      if (p.retained || p.state === "rejected") {
        entries.current = entries.current.filter((item) => item !== p); files.current.delete(p.key); save(); return;
      }
      p.selected = false;
      if (p.receipt && !p.withdrawKey) p.withdrawKey = crypto.randomUUID();
      save();
      if (p.withdrawKey) void perform(p);
      // Unknown upload without an ID stays recoverable, even when explicitly deselected.
    },
    move(p: PhotoDraft, delta: number) {
      if (!current()) return;
      const selected = entries.current.filter((item) => item.target === p.target && item.selected);
      const other = selected[selected.indexOf(p) + delta];
      if (!other) return;
      const a = entries.current.indexOf(p), b = entries.current.indexOf(other);
      dirtyTargets.current.add(p.target);
      [entries.current[a], entries.current[b]] = [entries.current[b]!, entries.current[a]!]; save();
    },
    discardRetained(target: string) {
      if (!current()) return;
      dirtyTargets.current.delete(target);
      retainedTargets.current.delete(target);
      entries.current = entries.current.filter((p) => p.target !== target || !p.retained); save();
    },
    published(ids: string[], target?: string) {
      if (!current() || !enabled) return;
      if (target) dirtyTargets.current.delete(target);
      // Publication is the sole proof these stages are now public. NEVER private DELETE.
      entries.current = entries.current.filter((p) => {
        if (!ids.includes(p.retained?.id ?? p.receipt?.id ?? "")) return true;
        files.current.delete(p.key); return false;
      }); save();
    },
  };
}
export type VenueCommentPhotosModel = ReturnType<typeof useVenueCommentPhotos>;
