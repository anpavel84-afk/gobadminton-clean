"use client";
import { adminPath } from "../lib/admin-path";
import { Venues } from "./Venues";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, errorMessage, freshStepUp, visibleNavigation, type Session, type Ticket } from "../lib/admin-client";
import { Cases } from "./Cases";
import { UserRestrictions } from "./UserRestrictions";
import { GameModeration } from "./GameModeration";
import { webauthn, type OptionsJSON } from "../lib/webauthn";

const roleLabels: Record<string, string> = { superadmin: "Суперадминистратор", content_manager: "Контент-менеджер", moderator: "Модератор", support: "Поддержка" };
export function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activation, setActivation] = useState("");
  const [section, setSection] = useState("overview");
  const [audit, setAudit] = useState<{ items: { id: string; action_key: string; created_at: string }[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [logoutPending, setLogoutPending] = useState(false);
  const action = useRef(false);
  const mounted = useRef(false);
  const authenticator = useRef<AbortController | null>(null);
  const logoutKey = useRef<string | null>(null);
  const logoutCsrf = useRef<string | null>(null);
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    setSession(null); setTicket(null); setAudit(null); setActivation(""); setSection("overview");
    authenticator.current?.abort();
  }, []);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try {
      const current = await adminRequest<Session>("auth/me");
      if (mounted.current && version === generation.current) {
        setSession(current);
        if (!current.roles.includes("superadmin")) setAudit(null);
        setSection(old => visibleNavigation(current.roles).some(item => item.id === old) ? old : "overview");
      }
      return current;
    } catch (cause) {
      if (mounted.current && version === generation.current) {
        // A failed authority refresh must hide privileged content even on a network outage.
        setSession(null); setAudit(null); setSection("overview");
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    async function init() {
      const status = new URLSearchParams(location.search).get("auth");
      history.replaceState(null, "", adminPath("/"));
      try {
        if (status === "complete") {
          const response = await fetch(adminPath("/internal/auth-ticket"), { cache: "no-store", credentials: "same-origin" });
          if (!response.ok) throw new AdminError("ADMIN_MFA_REQUIRED", 401);
          const pending = await response.json() as Ticket;
          if (mounted.current) setTicket(pending);
        } else if (status === "failed") {
          setError("Не удалось подтвердить учётную запись. Начните вход заново.");
        } else {
          try { await refresh(); } catch (cause) {
            if (!(cause instanceof AdminError && cause.status === 401)) throw cause;
          }
        }
      } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
      finally { if (mounted.current) setLoading(false); }
    }
    void init();
    return () => { mounted.current = false; generation.current++; authenticator.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const update = () => {
      if (action.current || !mounted.current) return;
      void refresh().catch(cause => { if (mounted.current) setError(errorMessage(cause)); });
    };
    const timer = setInterval(() => { setNow(Date.now()); update(); }, 15000);
    const focus = () => { if (document.visibilityState === "visible") update(); };
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", focus); };
  }, [session, refresh]);

  async function run(work: () => Promise<void>) {
    if (action.current) return;
    action.current = true; generation.current++; setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause));
        if (cause instanceof AdminError && cause.status === 401) clear();
        else if (cause instanceof AdminError && cause.code === "ADMIN_STEP_UP_REQUIRED") { setAudit(null); setSection("overview"); setNow(Date.now()); }
        else if (cause instanceof AdminError && cause.code === "ADMIN_PERMISSION_DENIED") {
          setAudit(null);
          try { await refresh(); } catch { clear(); }
        }
      }
    } finally { action.current = false; if (mounted.current) setBusy(false); }
  }
  async function start(provider: string) {
    await run(async () => {
      clear();
      const result = await adminRequest<{ authorizationUrl: string }>(`auth/${provider}/start`, {});
      const url = new URL(result.authorizationUrl);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid provider redirect");
      location.assign(url.href);
    });
  }
  async function prove(purpose: "enroll" | "login" | "step_up") {
    await run(async () => {
      const csrf = purpose === "step_up" ? session?.csrfToken : ticket?.csrfToken;
      if (!csrf) throw new AdminError("ADMIN_MFA_REQUIRED", 401);
      const activationToken = purpose === "enroll" ? activation.trim() : undefined;
      const input = { purpose, ...(activationToken ? { activationToken } : {}) };
      const challenge = await adminRequest<{ challengeId: string; options: OptionsJSON }>("auth/webauthn/options", input, csrf);
      const controller = new AbortController(); authenticator.current = controller;
      const response = await webauthn(challenge.options, purpose === "enroll", controller.signal);
      await adminRequest("auth/webauthn/verify", { challengeId: challenge.challengeId, response, ...(activationToken ? { activationToken } : {}) }, csrf);
      authenticator.current = null;
      if (!mounted.current) return;
      setActivation("");
      if (purpose === "enroll") {
        setTicket(old => old ? { ...old, status: "active" } : null);
        setNotice("Ключ добавлен. Подтвердите им вход, чтобы открыть кабинет.");
      } else {
        setTicket(null); await refresh(); setNow(Date.now()); setNotice(purpose === "step_up" ? "Вход подтверждён." : "Вы вошли в кабинет.");
      }
    });
  }
  async function logout() {
    await run(async () => {
      logoutKey.current ??= crypto.randomUUID();
      logoutCsrf.current ??= session?.csrfToken ?? null;
      try {
        await adminRequest("auth/logout", {}, logoutCsrf.current ?? undefined, logoutKey.current);
      } catch (cause) {
        clear();
        if (!(cause instanceof AdminError && cause.status === 401)) { setLogoutPending(true); throw cause; }
        // A completed-but-lost logout response leaves a revoked session; 401 confirms loss of authority.
      }
      logoutKey.current = null; logoutCsrf.current = null; setLogoutPending(false); clear(); setNotice("Вы вышли из кабинета.");
    });
  }
  async function navigate(id: string) {
    await run(async () => {
      setAudit(null);
      const current = await refresh();
      if (!visibleNavigation(current.roles).some(item => item.id === id)) throw new AdminError("ADMIN_PERMISSION_DENIED", 403);
      setSection(id);
      if (id === "security") setAudit(await adminRequest("audit/security"));
    });
  }
  const nav = visibleNavigation(session?.roles ?? []);
  const fresh = session && freshStepUp(session, now);
  return <>
    <header className="topbar"><div className="topbar-inner"><img src={adminPath("/brand/go-badminton.svg")} width="144" height="40" alt="GoBadminton" /><span className="badge">Администрирование</span>{session && <button className="button outline" disabled={busy} onClick={() => void logout()}>Выйти</button>}</div></header>
    <main className={`container ${session ? "" : "narrow"}`}>
      <div className="section-header"><span className="eyebrow">Команда GoBadminton</span><h1>{session ? "Рабочий кабинет" : ticket ? "Подтверждение входа" : "Вход для команды"}</h1><p>{session ? "Доступные разделы зависят от ваших текущих ролей." : "Вход доступен только сотрудникам с предоставленным доступом."}</p></div>
      {error && <div className="notice danger" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {logoutPending && <div className="notice"><p>Проверим, что выход завершён.</p><button className="button outline" disabled={busy} onClick={() => void logout()}>Повторить выход</button></div>}
      {loading ? <section className="panel" aria-busy="true"><p role="status">Проверяем вход…</p><div className="skeleton" /></section> : session ? <div className="shell">
        <nav className="panel navigation" aria-label="Разделы администрирования">{nav.map(item => <button key={item.id} className={section === item.id ? "selected" : ""} aria-current={section === item.id ? "page" : undefined} disabled={busy} onClick={() => void navigate(item.id)}>{item.label}</button>)}</nav>
        <section className="panel content">
          {section === "overview" ? <><h2>Ваш доступ</h2><div className="roles">{session.roles.length ? session.roles.map(role => <span className="badge" key={role}>{roleLabels[role] ?? "Неизвестная роль"}</span>) : <p>Активных ролей нет. Обратитесь к ответственному за доступ.</p>}</div><dl><dt>Учётная запись</dt><dd>{session.principalId}</dd><dt>Вход действует до</dt><dd>{new Date(session.expiresAt).toLocaleString("ru-RU")}</dd></dl><div className="notice"><strong>{fresh ? "Подтверждение входа актуально" : "Требуется повторное подтверждение"}</strong><p>Для чувствительных действий понадобится ключ доступа.</p><button className="button outline" disabled={busy} onClick={() => void prove("step_up")}>{busy ? "Подтверждение…" : "Подтвердить вход"}</button></div></>
          : section === "cases" ? <Cases key={session.principalId+session.roles.join(",")} session={session} busy={busy} fresh={Boolean(fresh)} run={run} stepup={() => prove("step_up")} />
          : section === "users" ? <UserRestrictions key={session.principalId} session={session} busy={busy} fresh={Boolean(fresh)} run={run} stepup={() => prove("step_up")} />
          : section === "games" ? <GameModeration key={session.principalId} session={session} busy={busy} fresh={Boolean(fresh)} run={run} stepup={() => prove("step_up")} />
          : section === "security" ? <><h2>Журнал безопасности</h2><p>Последние события доступа и изменения учётных записей.</p>{audit ? audit.items.length ? <ul className="events">{audit.items.map(item => <li key={item.id}><strong>{item.action_key}</strong><small>{new Date(item.created_at).toLocaleString("ru-RU")}</small></li>)}</ul> : <div className="notice">Событий пока нет.</div> : <p role="status">Загружаем журнал…</p>}</>
          : section === "venues" ? <Venues session={session} stepup={() => prove("step_up")} onAuthorityLoss={clear} />
          : <><h2>{nav.find(item => item.id === section)?.label}</h2><div className="notice"><strong>Раздел готовится</strong><p>Работа с этими данными пока недоступна.</p></div></>}
        </section>
      </div> : ticket ? <section className="panel">
        <h2>{ticket.status === "pending_mfa" ? "Добавьте ключ доступа" : "Используйте ключ доступа"}</h2><p>{ticket.status === "pending_mfa" ? "Введите полученный код активации и зарегистрируйте ключ на этом устройстве." : "Подтвердите вход с помощью зарегистрированного ключа или passkey."}</p>
        {ticket.status === "pending_mfa" && <label className="form-field"><span>Код активации</span><input type="password" autoComplete="off" value={activation} maxLength={256} onChange={event => setActivation(event.target.value)} disabled={busy} /></label>}
        <div className="actions"><button className="button" disabled={busy || (ticket.status === "pending_mfa" && activation.trim().length < 32)} onClick={() => void prove(ticket.status === "pending_mfa" ? "enroll" : "login")}>{busy ? "Ожидаем подтверждение…" : ticket.status === "pending_mfa" ? "Добавить ключ" : "Подтвердить ключом"}</button><button className="button outline" disabled={busy} onClick={() => { clear(); setError(""); setNotice(""); }}>Начать вход заново</button></div>
      </section> : <section className="panel"><h2>Выберите способ входа</h2><p>После подтверждения учётной записи потребуется ключ доступа.</p><div className="actions"><button className="button" disabled={busy || logoutPending} onClick={() => void start("vk")}>Войти через VK</button><button className="button outline" disabled={busy || logoutPending} onClick={() => void start("yandex")}>Войти через Яндекс</button></div></section>}
    </main>
  </>;
}
