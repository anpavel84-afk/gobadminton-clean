"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { changeMyCover, getMyCover, type CoverReceipt } from "../../../lib/api-client";
import { AvatarSourceError, preprocessAvatar } from "../../../lib/avatar-preprocess";
import { Button } from "../Button";
import { ProfileDialog } from "./ProfileComposition";

export function ProfileCover({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = url && /^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/.test(url) && failed !== url;
  return <div className="profile-cover" data-cover={safe ? "uploaded" : "default"}>
    {safe ? <img src={url ?? undefined} alt="Обложка профиля" onError={() => setFailed(url ?? null)} /> : <img src="/canonical/ce252.svg" alt="" className="profile-cover__fallback" />}
  </div>;
}

export function CoverEditor({ frameRef, cover, version, csrfToken, disabled, onBusy, onChange, onRefresh }: {
  frameRef?: RefObject<HTMLDivElement | null>;
  cover?: CoverReceipt["cover"]; version: number; csrfToken: string; disabled: boolean;
  onBusy: (value: boolean) => void; onChange: (value: CoverReceipt) => void; onRefresh: () => void;
}) {
  const [frameRatio, setFrameRatio] = useState<number | null>(null);
  useEffect(() => {
    const frame = frameRef?.current;
    if (!frame) return;
    // Observe the actual canonical panel, including content-driven desktop height.
    // The dialog can scale it down, but must preserve its object-fit crop.
    const measure = () => {
      const { width, height } = frame.getBoundingClientRect();
      if (width > 0 && height > 0) setFrameRatio(width / height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: .5, y: .5 });
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const callbacks = useRef({ onBusy, onChange, onRefresh });
  useEffect(() => { callbacks.current = { onBusy, onChange, onRefresh }; }, [onBusy, onChange, onRefresh]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); callbacks.current.onBusy(false); }; }, []);
  useEffect(() => { operation.current?.abort(); }, [version]);
  useEffect(() => {
    if (!file || !open) return;
    const controller = new AbortController();
    let url: string | undefined;
    setPreparing(true); setPreview(null); setError("");
    const timer = setTimeout(() => {
      void preprocessAvatar(file, controller.signal, crop).then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setPreview({ blob, url }); setPreparing(false);
      }, failure => {
        if (controller.signal.aborted) return;
        setPreparing(false); setError(failure instanceof AvatarSourceError ? failure.message : "Не удалось подготовить обложку. Выберите другое фото.");
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file, crop, open]);

  async function reconcile() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setSaving(true);
    try {
      const result = await getMyCover(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (result.ok) { operation.current = null; setUncertain(false); callbacks.current.onRefresh(); }
      else setError("Не удалось проверить результат. Повторите обновление данных.");
    } finally { if (operation.current === controller) operation.current = null; if (mounted.current) setSaving(false); }
  }
  async function save(blob: Blob | null) {
    if (operation.current || disabled || uncertain) return;
    const controller = new AbortController(); operation.current = controller;
    setSaving(true); setError(""); setNotice(""); callbacks.current.onBusy(true);
    try {
      const result = await changeMyCover(blob, version, csrfToken, controller.signal);
      if (!mounted.current) return;
      if (controller.signal.aborted) { setUncertain(true); return; }
      if (!result.ok) {
        if (result.status === 401) { callbacks.current.onRefresh(); return; }
        if (result.status === 0 || result.status >= 500 || result.status === 409) setUncertain(true);
        setError(result.status === 429 ? "Слишком много попыток. Попробуйте позже." : result.status === 422 ? "Обложка не прошла проверку. Выберите другое фото." : "Сохранение не подтверждено. Обновите данные перед повтором.");
        return;
      }
      operation.current = null; callbacks.current.onChange(result.data);
      setOpen(false); setFile(null); setPreview(null);
      setNotice(blob ? "Обложка сохранена." : "Обложка удалена. Используется стандартное оформление.");
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) { setSaving(false); callbacks.current.onBusy(false); }
    }
  }
  return <section className="profile-cover-controls" aria-label="Обложка профиля" aria-busy={saving || preparing}>
    <Button variant="outline" disabled={disabled || saving} onClick={() => { setOpen(true); setError(""); }}>Изменить обложку</Button>
    {notice && <p role="status">{notice}</p>}
    {open && <ProfileDialog title="Обложка профиля" onClose={() => { if (!saving) { setOpen(false); setFile(null); setPreview(null); } }}>
      <p>JPEG, PNG или WebP · до 10 МБ и 50 Мп, без анимации. На сервер отправляется только выбранный фрагмент. Обложка следует видимости профиля.</p>
      <input ref={input} className="avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Выбрать изображение обложки" disabled={saving} onChange={event => { const next = event.target.files?.[0]; event.target.value = ""; if (next) { setFile(next); setCrop({ x: .5, y: .5 }); } }} />
      <Button variant="outline" disabled={saving} onClick={() => input.current?.click()}>Выбрать изображение</Button>
      {file && <>
        <label className="profile-field">По горизонтали<input type="range" min="0" max="1" step="0.01" value={crop.x} disabled={saving} onChange={e => setCrop({ ...crop, x: Number(e.target.value) })} /></label>
        <label className="profile-field">По вертикали<input type="range" min="0" max="1" step="0.01" value={crop.y} disabled={saving} onChange={e => setCrop({ ...crop, y: Number(e.target.value) })} /></label>
      </>}
      {preparing && <p role="status">Готовим фрагмент…</p>}
      {preview && frameRatio && <div aria-label="Предпросмотр обложки"><p>Фрагмент в шапке профиля при текущем размере экрана</p><div className="profile-cover profile-cover--preview" style={{ aspectRatio: frameRatio }}><img src={preview.url} alt="Выбранный фрагмент в шапке профиля" /></div></div>}
      {!file && <ProfileCover url={cover?.uploadedUrl} />}
      {saving && <p role="status">Сохраняем обложку…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="profile-form-actions">
        {uncertain ? <Button disabled={saving} onClick={() => void reconcile()}>Обновить данные</Button> : <>
          <Button disabled={disabled || saving || preparing || !preview || !frameRatio} onClick={() => void save(preview!.blob)}>Сохранить фрагмент</Button>
          {cover?.uploadedUrl && <Button variant="ghost" disabled={disabled || saving} onClick={() => void save(null)}>Удалить обложку</Button>}
        </>}
        <Button variant="outline" disabled={saving} onClick={() => { setOpen(false); setFile(null); setPreview(null); }}>Отмена</Button>
      </div>
    </ProfileDialog>}
  </section>;
}
