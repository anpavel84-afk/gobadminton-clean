"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api-client";
import { socialError } from "../../../lib/messaging-presentation";

type Pending = { path: string; body: object; key: string; method: string };
export type SocialMutationPending = Pending;
export type SocialMutationOptions<T> = {
  /**
   * Opt-in: when set, a 2xx body must pass before pending clears / onSuccess runs.
   * Failed validation keeps unresolved identity (UNKNOWN) — default callers omit this.
   * Optional second arg is the frozen pending identity (path/body/key/method) for
   * target reconciliation; old single-arg validators remain valid.
   */
  validateSuccess?: (data: T, pending?: Pending) => boolean;
  /**
   * Opt-in: restored / admitted pending must belong to the assigned host.
   * Invalid marker stays in storage (HOLD) — no retry, no delete, no new keys.
   */
  validatePending?: (pending: Pending) => boolean;
  /**
   * Opt-in (postgame host): unparseable persisted JSON stays in storage, HOLD is set,
   * and new writes/retries are blocked until the marker can be proven parseable.
   * Default callers keep silent ignore of corrupt storage.
   */
  holdCorruptStorage?: boolean;
};
/** Persist unresolved identity across reload; explicit replay uses identical body/key. */
export function useSocialMutation<T>(
  scope: string,
  csrf: string,
  onSuccess: (data: T) => void,
  onRefresh: () => void,
  persist = true,
  options?: SocialMutationOptions<T>,
) {
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
  /** Bumped on scope change / unmount so a late prior-scope response cannot settle new state. */
  const generation = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  const holdRef = useRef(false);
  const validateRef = useRef(options?.validateSuccess);
  validateRef.current = options?.validateSuccess;
  const validatePendingRef = useRef(options?.validatePending);
  validatePendingRef.current = options?.validatePending;
  const holdCorruptRef = useRef(Boolean(options?.holdCorruptStorage));
  holdCorruptRef.current = Boolean(options?.holdCorruptStorage);
  pendingRef.current = pending;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    generation.current += 1;
    const gen = generation.current;
    lock.current = false;
    holdRef.current = false;
    setBusy(false);
    setCode("");
    setRetryAfterSeconds(null);
    setLastStatus(null);

    if (!persist) {
      pendingRef.current = null;
      setPending(null);
      setNotice("");
      return;
    }

    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) {
        // Scope has no marker: drop prior in-memory pending (do not touch other scopes' storage).
        pendingRef.current = null;
        setPending(null);
        setNotice("");
        return;
      }
      const parsed = JSON.parse(saved) as Pending;
      if (gen !== generation.current) return;
      const validatePending = validatePendingRef.current;
      const valid = !validatePending || validatePending(parsed);
      holdRef.current = !valid;
      pendingRef.current = parsed;
      setPending(parsed);
      setNotice(
        valid
          ? "Предыдущая отправка не подтверждена. Проверьте её результат."
          : "Сохранённая операция не принадлежит текущему контексту. Не повторяйте отправку.",
      );
      if (!valid) setCode("hold");
    } catch {
      if (!holdCorruptRef.current) {
        /* Default callers: storage may be disabled or unreadable — leave clear. */
        return;
      }
      if (gen !== generation.current) return;
      // Opt-in: preserve raw unresolved marker; block writes/retries without parse proof.
      holdRef.current = true;
      // In-memory pending only — do not rewrite/delete the raw storage value.
      const corruptHold: Pending = { path: "", body: {}, key: "", method: "" };
      pendingRef.current = corruptHold;
      setPending(corruptHold);
      setNotice("Сохранённая операция повреждена. Не повторяйте отправку.");
      setCode("hold");
    }
  }, [storageKey, persist]);

  function save(value: Pending | null) {
    pendingRef.current = value;
    setPending(value);
    if (!persist) return;
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory lock remains active. */
    }
  }

  async function perform(value: Pending, gen: number, token: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    setCode("");
    setRetryAfterSeconds(null);
    setLastStatus(null);
    holdRef.current = false;
    save(value);
    const result = await apiFetch<T>(value.path, {
      method: value.method,
      body: JSON.stringify(value.body),
      csrfToken: token,
      headers: { "Idempotency-Key": value.key },
    });
    if (!live.current || gen !== generation.current) return;
    lock.current = false;
    setBusy(false);
    if (result.ok) {
      setLastStatus(result.status);
      setRetryAfterSeconds(null);
      const validate = validateRef.current;
      if (validate) {
        let accepted = false;
        try {
          accepted = invokeValidate(validate, result.data, value);
        } catch {
          // Validator throw ≡ UNKNOWN: keep pending, no onSuccess, no unhandled JS error.
          accepted = false;
        }
        if (!accepted) {
          setNotice("Результат не подтверждён. Не повторяйте отправку.");
          setCode("unconfirmed");
          return;
        }
      }
      save(null);
      onSuccess(result.data);
    } else {
      setLastStatus(result.status);
      setRetryAfterSeconds(result.retryAfterSeconds ?? null);
      setNotice(socialError(result));
      setCode(result.problem?.code ?? String(result.status));
      if (result.status !== 0 && result.status < 500) {
        save(null);
        onRefresh();
      }
    }
  }

  return {
    busy,
    pending: !!pending,
    pendingPath: pending?.path,
    notice,
    code,
    setNotice,
    retryAfterSeconds,
    lastStatus,
    /** Synchronous admission: true only when this call starts the write (lock+pending latched before await). */
    run(path: string, body: object, method = "POST"): boolean {
      if (pending || lock.current || holdRef.current) return false;
      const value = { path, body, method, key: crypto.randomUUID() };
      const validatePending = validatePendingRef.current;
      if (validatePending && !validatePending(value)) return false;
      const gen = generation.current;
      void perform(value, gen, csrf);
      return lock.current;
    },
    retry() {
      const current = pendingRef.current;
      if (!current || lock.current || holdRef.current) return;
      const validatePending = validatePendingRef.current;
      if (validatePending && !validatePending(current)) {
        holdRef.current = true;
        setNotice("Сохранённая операция не принадлежит текущему контексту. Не повторяйте отправку.");
        setCode("hold");
        return;
      }
      void perform(current, generation.current, csrf);
    },
  };
}

// Ensure validateSuccess receives frozen pending identity when callers opt in.
function invokeValidate<T>(
  validate: ((data: T, pending?: Pending) => boolean) | undefined,
  data: T,
  pending: Pending,
): boolean {
  if (!validate) return true;
  return Boolean(validate(data, pending));
}
