"use client";
import { useEffect, useRef, useState } from "react";
import { emailCommand, emailErrorCopy, requestEmail, type EmailChallenge, type EmailProofResult, type EmailPurpose } from "../../../lib/email-auth";
import { Button } from "../Button";

/** Kit Modal/Form/Input/Validation. Every proof is bound by the server; no mailbox accessor. */
export function EmailCodeForm({ purpose, csrfToken, returnPath, proofChallengeId, currentEmail, onSuccess, onCancel, onBusyChange, onRestartProof }: {
  purpose: EmailPurpose; csrfToken?: string; returnPath?: string; proofChallengeId?: string; currentEmail?: string;
  onSuccess: (result: EmailProofResult) => void; onCancel?: () => void; onBusyChange?: (busy: boolean) => void; onRestartProof?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(false), sending = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; generation.current++; clearInterval(timer); }; }, []);
  useEffect(() => {
    if (!challenge || uncertain) return;
    const id = challenge.challengeId;
    const timer = setInterval(() => { if (sending.current) return; const version = generation.current; void emailCommand<EmailChallenge>(purpose, `/${id}/status`, {}, csrfToken).then(result => {
      if (!alive.current || version !== generation.current) return;
      if (result.ok) setChallenge(result.data);
      else if ([401,403,409].includes(result.status)) { setNotice(emailErrorCopy(result.problem?.code, result.status)); setUncertain(true); }
    }); }, 3000);
    return () => clearInterval(timer);
  }, [challenge?.challengeId, csrfToken, purpose, uncertain]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const seconds = Math.max(0, Math.ceil((Math.max(retryAt, challenge ? Date.parse(challenge.resendAvailableAt) : 0) - now) / 1000));
  const terminal = uncertain || Boolean(challenge && (["expired", "consumed"].includes(challenge.deliveryState) || Date.parse(challenge.expiresAt) <= now));
  async function perform(action: "issue" | "verify" | "resend") {
    if (sending.current) return;
    sending.current = true; setBusy(true); setNotice("");
    const version = ++generation.current;
    const result = action === "issue" ? await requestEmail(purpose, purpose === "change_current" ? {} : {email, ...(returnPath ? {returnPath} : {}), ...(proofChallengeId ? {proofChallengeId} : {})}, csrfToken)
      : await emailCommand<EmailChallenge & EmailProofResult>(purpose, `/${challenge!.challengeId}/${action}`, action === "verify" ? {code} : {}, csrfToken);
    if (!alive.current || version !== generation.current) return;
    sending.current = false; setBusy(false);
    if (action === "verify") setCode("");
    if (!result.ok) {
      setNotice(emailErrorCopy(result.problem?.code, result.status));
      if (result.retryAfterSeconds) setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      if (result.status === 0 || [401,403,409].includes(result.status)) setUncertain(true);
      return;
    }
    if (action === "verify") onSuccess(result.data as EmailProofResult);
    else { setChallenge(result.data as EmailChallenge); setCode(""); setUncertain(false); }
  }
  function restart() { generation.current++; setChallenge(null); setCode(""); setNotice(""); setUncertain(false); }
  return <form className="email-auth-form" onSubmit={event => { event.preventDefault(); void perform(challenge ? "verify" : "issue"); }}>
    {!challenge ? purpose === "change_current" ? <p>Сначала подтвердите текущий email: <strong>{currentEmail}</strong>. Отправим код на этот адрес.</p>
      : <label className="profile-field">{purpose === "change" ? "Новый email" : "Email"}<input type="email" autoComplete="email" required maxLength={320} value={email} disabled={busy} onChange={event => { setEmail(event.target.value); setUncertain(false); }} /></label>
      : <><p>Введите код из письма для <strong className="email-address">{purpose === "change_current" ? currentEmail : email}</strong>.</p>
        <label className="profile-field">Код из письма<input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} required aria-describedby="email-code-help" value={code} disabled={busy || terminal} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0,8))} /></label>
        <small id="email-code-help">8 цифр. Каждый код можно использовать один раз.</small>
        <p role="status">{terminal ? "Запрос завершён или истёк. Запросите новый код." : challenge.deliveryState === "delivery_failed" ? "Не удалось доставить письмо. Попробуйте отправить код снова." : challenge.deliveryState === "queued" ? "Письмо готовится к отправке…" : "Письмо отправлено."}</p>
      </>}
    {notice && <p className="profile-notice" role="alert">{notice}</p>}
    <div className="profile-form-actions">
      <Button type="submit" disabled={busy || terminal || seconds > 0 && !challenge} loading={busy}>{challenge ? "Подтвердить код" : "Получить код"}</Button>
      {challenge && <Button variant="outline" disabled={busy || seconds > 0 || terminal} onClick={() => void perform("resend")}>{seconds > 0 ? `Отправить снова через ${seconds} с` : "Отправить код снова"}</Button>}
      {(challenge || uncertain) && <Button variant="ghost" disabled={busy} onClick={restart}>{purpose === "change_current" ? "Новый запрос" : "Изменить email"}</Button>}
      {purpose === "change" && (terminal || notice) && onRestartProof && <Button variant="outline" disabled={busy} onClick={onRestartProof}>Подтвердить текущий email заново</Button>}
      {onCancel && <Button variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button>}
    </div>
    {!challenge && seconds > 0 && <p role="status">Повторить через {seconds} с</p>}
  </form>;
}
