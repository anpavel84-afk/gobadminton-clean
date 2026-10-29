"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getMe,
  listLinkedProviders,
  startLinkProvider,
  unlinkProvider,
} from "../../../lib/api-client";
import { privateViews } from "../../../lib/private-view";
import type { LinkedProviderItem, Me } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, ProfileDialog, ProfileState } from "../players/ProfileComposition";

import { EmailCodeForm } from "../players/EmailCodeForm";
import { emailErrorCopy, listAuthMethods, listOwnAuthMethods, unlinkEmail, type MethodInventory } from "../../../lib/email-auth";

function statusCopy(item: LinkedProviderItem): string {
  if (item.status === "connected") return "Подключён";
  if (item.status === "available") return "Можно подключить";
  return "Сейчас недоступен";
}

function authErrorCopy(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "IDENTITY_COLLISION":
      return "Этот аккаунт уже связан с другим профилем GoBadminton. Слияние аккаунтов недоступно.";
    case "PROVIDER_ALREADY_LINKED":
      return "Этот способ входа уже подключён.";
    case "PROVIDER_CANCELLED":
      return "Подключение отменено.";
    case "LINK_SESSION_REQUIRED":
    case "LINK_SESSION_MISMATCH":
      return "Сессия истекла. Войдите снова и повторите подключение.";
    case "LAST_AUTH_METHOD":
      return "Нельзя отключить последний способ входа.";
    default:
      return "Не удалось подключить способ входа. Попробуйте ещё раз.";
  }
}

/** Style Guide §09 settings-list + Kit DataRow for provider rows. */
export function LoginMethodsPage() {
  const router = useRouter();
  const mutating = useRef(false);
  const epoch = useRef(0);
  const activeMe = useRef<Me | null>(null);
  const searchParams = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<LinkedProviderItem[]>([]);
  const [inventory, setInventory] = useState<MethodInventory>({items: []});
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [emailFlow, setEmailFlow] = useState<"link" | "change_current" | "change" | "unlink" | null>(null);
  const [proofId, setProofId] = useState<string>();
  const [emailBusy, setEmailBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    () => authErrorCopy(searchParams.get("authError")),
  );

  useEffect(() => {
    let live = true;
    let releaseView: (() => void) | undefined;
    const retire = (nextState: string, preserveNotice = false) => {
      ++epoch.current; activeMe.current = null; mutating.current = false;
      releaseView?.(); releaseView = undefined;
      setMe(null); setItems([]); setInventory({items: []}); setEmailAvailable(false);
      setEmailFlow(null); setProofId(undefined); setEmailBusy(false); setBusy(null);
      if (!preserveNotice) setNotice(null);
      setReauth(false); setState(nextState);
    };
    const load = (clearNotice = false) => {
      retire("loading", !clearNotice);
      const request = epoch.current, generation = privateViews.currentGeneration;
      void (async () => {
        const identity = await getMe();
        if (!live || request !== epoch.current) return;
        if (!identity.ok) { setState(identity.status === 401 ? "auth" : "error"); return; }
        releaseView = privateViews.retain(generation);
        if (!releaseView) return;
        activeMe.current = identity.data; setMe(identity.data);
        const [listed, all, discovery] = await Promise.all([listLinkedProviders(), listOwnAuthMethods(), listAuthMethods()]);
        if (!live || request !== epoch.current) return;
        if (!listed.ok || !all.ok || !discovery.ok) {
          if ((!listed.ok && listed.status === 401) || (!all.ok && all.status === 401)) retire("auth");
          else setState("error");
          return;
        }
        setInventory(all.data); setItems(listed.data.items);
        setEmailAvailable(discovery.data.items.some(item => item.method === "email" && item.available));
        setState("ready");
      })();
    };
    const expired = () => retire("auth");
    const session = () => load(true);
    window.addEventListener("gb-private-expired", expired);
    window.addEventListener("gb-session-changed", session);
    load();
    return () => {
      live = false; ++epoch.current; activeMe.current = null; releaseView?.();
      window.removeEventListener("gb-private-expired", expired);
      window.removeEventListener("gb-session-changed", session);
    };
  }, [reload]);

  async function onLink(provider: "vk" | "yandex") {
    if (!me || activeMe.current !== me || busy || emailBusy || mutating.current) return;
    const request = epoch.current;
    mutating.current = true;
    setBusy(provider);
    setNotice(null);
    const result = await startLinkProvider(
      provider,
      "/profile/settings/login-methods",
      me.csrfToken,
    );
    if (request !== epoch.current) return;
    mutating.current = false;
    setBusy(null);
    if (!result.ok) {
      setReauth(result.problem?.code === "RECENT_AUTH_REQUIRED");
      setNotice(
        result.problem?.code === "RECENT_AUTH_REQUIRED" ? emailErrorCopy(result.problem.code, result.status) : result.problem?.code === "PROVIDER_ALREADY_LINKED"
          ? "Этот способ входа уже подключён."
          : result.status === 503
            ? "Провайдер сейчас недоступен."
            : "Не удалось начать подключение. Попробуйте позже.",
      );
      if (result.status === 401) setState("auth");
      return;
    }
    window.location.assign(result.data.authorizationUrl);
  }

  async function onUnlink(provider: "vk" | "yandex") {
    if (!me || activeMe.current !== me || busy || emailBusy || mutating.current) return;
    const request = epoch.current;
    mutating.current = true;
    setBusy(provider);
    setNotice(null);
    const result = await unlinkProvider(provider, me.csrfToken);
    if (request !== epoch.current) return;
    mutating.current = false;
    setBusy(null);
    if (!result.ok) {
      setReauth(result.problem?.code === "RECENT_AUTH_REQUIRED");
      setNotice(
        result.problem?.code === "RECENT_AUTH_REQUIRED" ? emailErrorCopy(result.problem.code, result.status) : result.problem?.code === "LAST_AUTH_METHOD"
          ? "Нельзя отключить последний способ входа."
          : "Не удалось отключить способ входа.",
      );
      if (result.status === 401) setState("auth");
      return;
    }
    setItems(result.data.items);
    setReload(n => n + 1);

    setNotice("Способ входа отключён.");
  }

  const connectedCount = inventory.items.length;
  const email = inventory.items.find(item => item.method === "email");
  function closeEmail() { setEmailFlow(null); setProofId(undefined); setEmailBusy(false); setReload(n => n + 1); }
  async function revokeEmail() {
    if (!me || activeMe.current !== me || busy || mutating.current) return;
    const request = epoch.current;
    mutating.current = true;
    setBusy("email");
    const result = await unlinkEmail(me.csrfToken);
    if (request !== epoch.current) return;
    mutating.current = false;
    setBusy(null); setEmailFlow(null); setReload(n => n + 1);
    setNotice(result.ok ? "Email отключён." : emailErrorCopy(result.problem?.code, result.status));
    setReauth(!result.ok && result.problem?.code === "RECENT_AUTH_REQUIRED");
  }

  return (
    <ConsumerShell active="profile" title="Способы входа" mode="local">
      <div className="fr3 utility-page">
        <header className="gb-page-local-header">
          <Link className="back-link" href="/profile/settings">
            ← Настройки
          </Link>
          <h1>Способы входа</h1>
        </header>
        <div className="utility-page__body">
          <p>Подключайте только свои аккаунты и email. Совпадение email не объединяет профили.</p>
          {state === "loading" && <ProfileState title="Загружаем способы входа…" state="loading" />}
          {state === "error" && (
            <ProfileState title="Не удалось загрузить способы входа" state="error" retry={() => setReload((n) => n + 1)}>
              Попробуйте ещё раз.
            </ProfileState>
          )}
          {state === "auth" && (
            <section className="profile-section">
              <p>Войдите, чтобы управлять способами входа.</p>
              <AuthEntry returnPath="/profile/settings/login-methods" />
            </section>
          )}
          {state === "ready" && (
            <section className="settings-list account-security-list" aria-label="Способы входа">
              {items.map((item) => (
                <div className="data-row" key={item.provider}>
                  <span>
                    <small>{item.label}</small>
                    <strong>{statusCopy(item)}</strong>
                  </span>
                  <em>{item.status === "connected" && item.linkedAt ? new Date(item.linkedAt).toLocaleDateString("ru-RU") : ""}</em>
                  {item.status === "connected" ? (
                    <Button
                      variant="outline"
                      disabled={emailBusy || Boolean(busy) || connectedCount <= 1}
                      onClick={() => void onUnlink(item.provider)}
                    >
                      {busy === item.provider ? "Отключаем…" : "Отключить"}
                    </Button>
                  ) : item.status === "available" ? (
                    <Button
                      variant="dark"
                      disabled={emailBusy || Boolean(busy)}
                      onClick={() => void onLink(item.provider)}
                    >
                      {busy === item.provider ? "Подключаем…" : "Подключить"}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled>
                      Недоступен
                    </Button>
                  )}
                </div>
              ))}
              <div className="data-row" key="email">
                <span><small>Email</small><strong>{email?.maskedEmail ?? (emailAvailable ? "Можно подключить" : "Сейчас недоступен")}</strong></span>
                <em>{email ? new Date(email.linkedAt).toLocaleDateString("ru-RU") : ""}</em>
                <div className="profile-form-actions">
                  {email ? <><Button variant="outline" disabled={emailBusy || Boolean(busy) || !emailAvailable} onClick={() => { setNotice(null); setEmailFlow("change_current"); }}>Изменить email</Button>
                    <Button variant="outline" disabled={emailBusy || Boolean(busy) || !emailAvailable || connectedCount <= 1} onClick={() => setEmailFlow("unlink")}>Отключить email</Button></>
                    : <Button variant="dark" disabled={emailBusy || Boolean(busy) || !emailAvailable} onClick={() => { setNotice(null); setEmailFlow("link"); }}>Добавить email</Button>}
                </div>
              </div>
            </section>
          )}
          {state === "ready" && connectedCount <= 1 && <p className="account-security-hint">Последний способ входа нельзя отключить. Сначала подключите другой.</p>}
          {state === "ready" && emailFlow && me && <ProfileDialog title={emailFlow === "link" ? "Добавить email" : emailFlow === "unlink" ? "Отключить email?" : "Изменить email"} onClose={closeEmail}>
            {emailFlow === "unlink" ? <><p>Вы больше не сможете входить через {email?.maskedEmail}. Другой подключённый способ входа сохранится.</p><div className="profile-form-actions"><Button variant="outline" disabled={emailBusy || Boolean(busy)} onClick={closeEmail}>Отмена</Button><Button variant="danger" disabled={emailBusy || Boolean(busy)} onClick={() => void revokeEmail()}>Подтвердить отключение</Button></div></>
              : <><EmailCodeForm key={emailFlow} purpose={emailFlow} csrfToken={me.csrfToken} currentEmail={email?.maskedEmail} proofChallengeId={proofId} onCancel={closeEmail} onRestartProof={() => { setProofId(undefined); setEmailFlow("change_current"); }} onBusyChange={setEmailBusy} onSuccess={result => {
                if (activeMe.current !== me) return;
                if (result.proved && result.proofChallengeId) { setProofId(result.proofChallengeId); setEmailFlow("change"); }
                else { closeEmail(); setNotice(result.changed ? "Email изменён." : "Email подключён."); }
              }} /><p className="account-security-hint">Для изменения способов входа нужен недавний вход. Если запрос устарел, войдите снова своим подключённым способом.</p><AuthEntry returnPath="/profile/settings/login-methods">Войти снова</AuthEntry></>}
          </ProfileDialog>}
          {reauth && <AuthEntry returnPath="/profile/settings/login-methods">Войти снова</AuthEntry>}
          {notice && (
            <p className="profile-notice" role="alert">
              {notice}
            </p>
          )}
          {state === "ready" && (
            <p className="account-security-hint">
              <button type="button" className="text-link" onClick={() => router.push("/profile/settings/sessions")}>
                Активные сессии →
              </button>
            </p>
          )}
        </div>
      </div>
    </ConsumerShell>
  );
}
