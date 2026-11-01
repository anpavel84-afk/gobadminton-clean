"use client";
import { CloseButton } from "../CloseButton";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { startAuth } from "../../../lib/api-client";
import type { PublicPlayer, PlayerAvatar } from "../../../lib/consumer-types";
import { writeAuthIntent, type AuthIntent } from "../../../lib/location-context";
import { formatSocialLevel, initialsFromName } from "../../../lib/player-presentation";
import { profileSetupPath, safeAuthReturnPath } from "../../../lib/auth-return";
import { Button } from "../Button";
import { listAuthMethods } from "../../../lib/email-auth";
import { EmailCodeForm } from "./EmailCodeForm";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../../../lib/original-http-authority";

export function safeAvatarUrl(raw: string): boolean {
  if (/^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(raw)) return true;
  if (raw.length > 2048 || !httpUrlAgreesWithOriginalAuthority(raw, forbiddenUrlScalars)) return false;
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "avatars.yandex.net" || url.hostname.endsWith(".userapi.com")); } catch { return false; }
}
export function Avatar({ name, tone = "lime", avatar, className }: {
  name: string;
  tone?: "lime" | "purple" | "yellow";
  avatar?: PlayerAvatar;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = [avatar?.uploadedUrl, avatar?.providerUrl].filter((url): url is string => Boolean(url) && safeAvatarUrl(url!));
  const src = candidates.find(url => !failed.includes(url));
  return <span className={className ?? `avatar avatar--${tone}`} aria-hidden="true">{src ? <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(previous => [...previous, src])} /> : initialsFromName(name)}</span>;
}
export function Badge({ children, trainer = false }: { children: ReactNode; trainer?: boolean }) {
  return <span className={`status-badge status-badge--${trainer ? "attention" : "available"}`}>{children}</span>;
}
export function PlayerCard({ player, city, metadata, onSelect }: { player: PublicPlayer; city?: string; metadata?: ReactNode; onSelect?: () => void }) {
  const meta = [player.level ? formatSocialLevel(player.level) : "Уровень не указан", city].filter(Boolean).join(" · ");
  const content = <>
    <div className="player-card__identity">
      <Avatar avatar={player.avatar} name={player.displayName} tone={player.trainer ? "purple" : "yellow"} />
      <div className="player-card__main">
        <div className="player-card__title"><h3>{player.displayName}</h3>{player.lookingForGame && <Badge>Ищу игру</Badge>}</div>
        <strong>{meta}</strong>
        {(city || player.areaKey) && <span className="player-card__area"><img className="profile-icon" src="/discovery/pin.svg" alt="" />{[city, player.areaKey].filter(Boolean).join(" · ")}</span>}
        {metadata}
      </div>
      <span className="player-card__arrow" aria-hidden="true"><img className="profile-icon" src="/discovery/arrow.svg" alt="" /><span className="player-card__arrow-label">Профиль</span></span>
    </div>
    {(player.bio || player.trainer || player.canRequestContact === true) && <div className="player-card__bio">
      {player.bio && <p>{player.bio}</p>}
      {player.trainer && <em>Тренер</em>}
      {player.canRequestContact === true && <small>Можно написать</small>}
    </div>}
  </>;
  return onSelect ? <button type="button" className="player-card" onClick={onSelect}>{content}</button> : <Link className="player-card" href={`/players/${player.publicPlayerId}`}>{content}</Link>;
}
export function SectionHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return <header className="editable-section-header"><span>{eyebrow && <small>{eyebrow}</small>}<h2>{title}</h2></span>{action}</header>;
}
export function ProfileState({ title, children, state = "unavailable", retry }: { title: string; children?: ReactNode; state?: string; retry?: () => void }) {
  return <section className="profile-section profile-state" data-state={state} role={state === "error" ? "alert" : "status"}><h2>{title}</h2>{children && <p>{children}</p>}{retry && <Button variant="outline" onClick={retry}>Повторить</Button>}</section>;
}
export function VisibilityRow({ label, value, shown }: { label: string; value: string; shown: boolean }) {
  return <div><span className={`visibility-mark ${shown ? "" : "is-off"}`}>{shown ? "✓" : "—"}</span><span><small>{label}</small><strong>{value}</strong></span><em>{shown ? "Показывается" : "Скрыто"}</em></div>;
}
export function Toggle({ label, helper, on, disabled, onClick, describedBy, id }: { label: string; helper?: string; on: boolean; disabled?: boolean; onClick?: () => void; describedBy?: string; id?: string }) {
  return <button type="button" id={id} className={`toggle-row ${on ? "is-on" : ""}`} aria-label={label} aria-describedby={describedBy} role="switch" aria-checked={on} disabled={disabled} onClick={onClick}><span><strong>{label}</strong>{helper && <small>{helper}</small>}</span><i aria-hidden="true"><b /></i></button>;
}
/** Native modal provides focus containment, Escape and focus restoration. */
export function ProfileDialog({ title, onClose, children, size = "normal", className, describedBy, lockBodyScroll = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Functional width family; callers inherit desktop overlay skin without rewrite. */
  size?: "normal" | "small";
  /** Opt-in shell family (e.g. invitation, postgame) without wrapping the page in .fr3. */
  className?: string;
  /** Optional aria-describedby for the dialog hint. */
  describedBy?: string;
  /** Opt-in body scroll lock (supported overlay families); default leaves overflow untouched. */
  lockBodyScroll?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = lockBodyScroll ? document.body.style.overflow : null;
    if (lockBodyScroll) document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (lockBodyScroll && overflow !== null) document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [lockBodyScroll]);
  const classes = ["profile-dialog", size === "small" ? "profile-dialog--small" : "", className].filter(Boolean).join(" ");
  return <dialog ref={ref} className={classes} aria-label={title} aria-describedby={describedBy} onCancel={e => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><header><h2>{title}</h2><CloseButton onClick={onClose} /></header><div className="profile-dialog__body">{children}</div></dialog>;
}
/** Shared chooser: provider starts only after an explicit selection, even for one provider. */
export function AuthChooser({ returnPath, intent, onClose }: { returnPath: string; intent?: AuthIntent; onClose: () => void }) {
  const [providers, setProviders] = useState<Array<"vk" | "yandex">>([]);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const starting = useRef(false);
  async function load() {
    setState("loading"); setError("");
    const result = await listAuthMethods();
    if (!alive.current) return;
    if (!result.ok) { setState("error"); return; }
    setProviders(result.data.items.filter(item => item.available && item.method !== "email").map(item => item.method as "vk" | "yandex"));
    setEmailAvailable(result.data.items.some(item => item.method === "email" && item.available)); setState("ready");
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, []);
  async function begin(provider: "vk" | "yandex") {
    if (starting.current || emailBusy) return;
    starting.current = true;
    setBusy(true); setError("");
    const safeReturn = safeAuthReturnPath(returnPath);
    writeAuthIntent(intent ?? { kind: "return", path: safeReturn });
    const result = await startAuth(provider, profileSetupPath(safeReturn));
    if (!alive.current) return;
    if (!result.ok) { starting.current = false; setBusy(false); setError("Не удалось начать вход. Попробуйте ещё раз."); return; }
    window.location.href = result.data.authorizationUrl;
  }
  function continueEmail() {
    window.dispatchEvent(new Event("gb-session-changed"));
    const safeReturn = safeAuthReturnPath(emailSuccess ?? returnPath);
    writeAuthIntent(intent ?? {kind: "return", path: safeReturn});
    window.location.assign(profileSetupPath(safeReturn));
  }
  return <div className="fr3"><ProfileDialog title="Войти в GoBadminton" onClose={onClose}>
    {emailSuccess ? <><p role="status">Вы вошли в GoBadminton. Продолжите, чтобы вернуться к выбранному действию.</p><Button onClick={continueEmail}>Продолжить</Button></> : <>
      <p>Выберите способ входа. После входа вы вернётесь на эту страницу.</p>
      {state === "loading" && <p role="status">Загружаем способы входа…</p>}
      {state === "error" && <ProfileState title="Вход сейчас недоступен" state="error" retry={() => void load()}>Попробуйте немного позже.</ProfileState>}
      {state === "ready" && <><div className="profile-form-actions">{providers.map(p => <Button key={p} variant="outline" disabled={busy || emailBusy} onClick={() => void begin(p)}>{p === "vk" ? "ВКонтакте" : "Яндекс"}</Button>)}</div>
        <div className="email-auth-divider"><span>или</span></div>
        {emailAvailable && !busy ? <><p>Войти или зарегистрироваться по email</p><p className="account-security-hint">Если вы уже входили через VK или Яндекс, войдите этим способом и добавьте email в «Способы входа». Совпадение адресов не объединяет профили.</p>
          <EmailCodeForm purpose="login_signup" returnPath={safeAuthReturnPath(returnPath)} onBusyChange={setEmailBusy} onSuccess={result => setEmailSuccess(safeAuthReturnPath(result.returnPath, safeAuthReturnPath(returnPath)))} /></>
          : <p role="status">Вход по email сейчас недоступен.</p>}
      </>}
      {error && <p role="alert">{error}</p>}
    </>}
  </ProfileDialog></div>;
}
export function AuthEntry({ returnPath, intent, children = "Войти" }: { returnPath: string; intent?: AuthIntent; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>{children}</Button>{open && <AuthChooser returnPath={returnPath} intent={intent} onClose={() => setOpen(false)} />}</>;
}
