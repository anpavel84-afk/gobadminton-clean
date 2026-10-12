"use client";
import { useEffect, useRef, useState } from "react";
import { changeMyAvatar, reconcileMyAvatar, type ApiResult } from "../../../lib/api-client";
import { AvatarSourceError, preprocessAvatar } from "../../../lib/avatar-preprocess";
import type { PlayerAvatar } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { Avatar } from "./ProfileComposition";

type Receipt = { version: number; avatar: PlayerAvatar };
export function AvatarEditor({ name, avatar, version, csrfToken, disabled, onBusy, onChange, onFailure }: {
  name: string; avatar?: PlayerAvatar; version: number; csrfToken: string; disabled: boolean;
  onBusy: (busy: boolean) => void; onChange: (value: Receipt) => void; onFailure: (result: ApiResult<Receipt>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const active = useRef<{ controller: AbortController; version: number } | null>(null);
  const uncertain = useRef(false);
  const callbacks = useRef({ onBusy, onChange, onFailure });
  useEffect(() => { callbacks.current = { onBusy, onChange, onFailure }; }, [onBusy, onChange, onFailure]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller.abort(); active.current = null;
      callbacks.current.onBusy(false);
    };
  }, []);
  useEffect(() => {
    if (active.current && active.current.version !== version) active.current.controller.abort();
  }, [version]);

  async function submit(next: File | null) {
    if (active.current || disabled) return;
    const operation = { controller: new AbortController(), version };
    active.current = operation;
    const current = () => mounted.current && active.current === operation && !operation.controller.signal.aborted;
    let dispatched = false;
    setError(""); setNotice(""); setBusy(true); callbacks.current.onBusy(true);
    try {
      // A cancelled write may already have committed. Never repeat it against the old version.
      if (uncertain.current) {
        const fresh = await reconcileMyAvatar(operation.controller.signal);
        if (!current()) return;
        if (!fresh.ok) { callbacks.current.onFailure(fresh); setError("Не удалось проверить результат. Обновите данные перед повтором."); return; }
        operation.version = fresh.data.version;
        uncertain.current = false;
        callbacks.current.onChange({ version: fresh.data.version, avatar: fresh.data.avatar ?? { uploadedUrl: null, providerUrl: null } });
        window.dispatchEvent(new Event("gb-profile-changed"));
      }
      const derivative = next ? await preprocessAvatar(next, operation.controller.signal) : null;
      if (!current()) return;
      dispatched = true;
      const result = await changeMyAvatar(derivative, operation.version, csrfToken, operation.controller.signal);
      if (!current()) return;
      if (!result.ok) {
        const ambiguous = result.status === 0 || result.status >= 500;
        uncertain.current = ambiguous;
        setError(result.status === 409 ? "Профиль изменился. Обновите данные перед повтором." : result.status === 422 || result.status === 415 ? "Фото не удалось прочитать. Выберите JPEG, PNG или WebP без анимации." : "Не удалось подтвердить сохранение фото. Проверьте соединение и попробуйте ещё раз.");
        if (ambiguous) {
          const fresh = await reconcileMyAvatar(operation.controller.signal);
          if (!current()) return;
          if (fresh.ok) {
            uncertain.current = false;
            // Authoritative avatar/version update only; a lost response is never advertised as success.
            active.current = null;
            callbacks.current.onChange({ version: fresh.data.version, avatar: fresh.data.avatar ?? { uploadedUrl: null, providerUrl: null } });
            window.dispatchEvent(new Event("gb-profile-changed"));
          } else callbacks.current.onFailure(fresh);
        } else callbacks.current.onFailure(result);
        return;
      }
      uncertain.current = false; active.current = null;
      callbacks.current.onChange(result.data); setFile(null);
      window.dispatchEvent(new Event("gb-profile-changed"));
      setNotice(next ? "Фото сохранено." : result.data.avatar.providerUrl ? "Загруженное фото удалено. Используется фото из способа входа." : "Фото удалено. Показываем инициалы.");
    } catch (failure) {
      if (current()) {
        setError(failure instanceof AvatarSourceError ? failure.message : "Не удалось подготовить фото. Выберите другое фото и попробуйте ещё раз.");
        if (dispatched) {
          uncertain.current = true;
          callbacks.current.onFailure({ ok: false, status: 0, error: "Avatar outcome unknown" });
        }
      }
    } finally {
      if (active.current === operation) active.current = null;
      if (mounted.current) { setBusy(false); callbacks.current.onBusy(false); }
    }
  }
  return <section className="avatar-editor" aria-label="Фото профиля" aria-busy={busy}>
    <Avatar name={name} avatar={avatar} />
    <div><strong>Фото профиля</strong><p>JPEG, PNG или WebP · до 10 МБ и 50 Мп, без анимации. Фото обрезается до квадрата на устройстве и доступно по ссылке. HEIC/HEIF сохраните как JPEG.</p>
      <input ref={fileInput} className="avatar-file-input" id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Выбрать или сделать фото профиля" disabled={busy || disabled} onChange={event => { const next = event.target.files?.[0]; event.target.value = ""; if (next) { setFile(next); void submit(next); } }} />
      <div className="profile-form-actions"><Button variant="outline" disabled={busy || disabled} onClick={() => fileInput.current?.click()}>Изменить фото</Button>{avatar?.uploadedUrl && <Button variant="ghost" disabled={busy || disabled} onClick={() => { setFile(null); void submit(null); }}>Удалить фото</Button>}</div>
      {busy && <p role="status">Сохраняем фото…</p>}{notice && <p role="status">{notice}</p>}{error && <div role="alert"><p>{error}</p>{!disabled && <Button variant="outline" disabled={busy} onClick={() => void submit(file)}>Повторить</Button>}</div>}
    </div>
  </section>;
}
