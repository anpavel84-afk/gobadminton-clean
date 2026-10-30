"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api-client";
import { socialError } from "../../../lib/messaging-presentation";

type Pending = { path: string; body: object; key: string; method: string };
/** Persist unresolved identity across reload; explicit replay uses identical body/key. */
export function useSocialMutation<T>(scope: string, csrf: string, onSuccess: (data: T) => void, onRefresh: () => void, persist = true) {
  const storageKey = `gb-fr04-pending:${scope}`;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  /** Read-only last transport metadata; does not change pending/retry/clear semantics. */
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const lock = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!persist) return;
    try { const saved = sessionStorage.getItem(storageKey); if (saved) { setPending(JSON.parse(saved) as Pending); setNotice("Предыдущая отправка не подтверждена. Проверьте её результат."); } } catch { /* Storage may be disabled. */ }
  }, [storageKey, persist]);
  function save(value: Pending | null) {
    setPending(value);
    if (!persist) return;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory lock remains active. */ }
  }
  async function perform(value: Pending) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(""); setCode(""); setRetryAfterSeconds(null); setLastStatus(null); save(value);
    const result = await apiFetch<T>(value.path, { method: value.method, body: JSON.stringify(value.body), csrfToken: csrf, headers: { "Idempotency-Key": value.key } });
    if (!live.current) return;
    lock.current = false; setBusy(false);
    if (result.ok) { setLastStatus(result.status); setRetryAfterSeconds(null); save(null); onSuccess(result.data); }
    else {
      setLastStatus(result.status);
      setRetryAfterSeconds(result.retryAfterSeconds ?? null);
      setNotice(socialError(result)); setCode(result.problem?.code ?? String(result.status));
      if (result.status !== 0 && result.status < 500) { save(null); onRefresh(); }
    }
  }
  return { busy, pending: !!pending, pendingPath: pending?.path, notice, code, setNotice, retryAfterSeconds, lastStatus,
    run(path: string, body: object, method = "POST") { if (!pending && !lock.current) void perform({ path, body, method, key: crypto.randomUUID() }); },
    retry() { if (pending) void perform(pending); },
  };
}
