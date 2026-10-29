"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deactivateTrainerProfile,
  getMe,
  getTrainerProfile,
  upsertTrainerProfile,
} from "../../../lib/api-client";
import type { Me, TrainerProfile } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, ProfileState, SectionHeader } from "../players/ProfileComposition";

export function TrainerProfileEditPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [existing, setExisting] = useState<TrainerProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    void (async () => {
      const m = await getMe();
      if (!live) return;
      if (!m.ok) {
        setState(m.status === 401 ? "auth" : "error");
        return;
      }
      const t = await getTrainerProfile();
      if (!live) return;
      if (!t.ok && t.status !== 404) {
        setState(t.status === 401 ? "auth" : "error");
        return;
      }
      setMe(m.data);
      setExisting(t.ok ? t.data : null);
      setDisplayName(t.ok ? t.data.displayName : m.data.displayName);
      setBio(t.ok ? (t.data.bio ?? "") : "");
      setRefresh(false);
      setState("ready");
    })();
    return () => {
      live = false;
    };
  }, [reload]);
  async function save() {
    if (!me || busy || refresh) return;
    setBusy(true);
    setNotice("");
    const r = await upsertTrainerProfile(
      {
        selfDeclared: true,
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        expectedVersion: existing?.version,
      },
      me.csrfToken,
    );
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) setState("auth");
      if (r.status === 0 || r.status >= 500 || r.status === 409) {
        setRefresh(true);
        setNotice(
          "Обновите данные, чтобы проверить результат перед следующим сохранением.",
        );
      } else {
        setNotice(
          "Не удалось сохранить профиль. Проверьте поля и попробуйте позже.",
        );
      }
      return;
    }
    router.push("/profile");
  }
  async function deactivate() {
    if (!me || !existing || existing.status !== "active" || busy || refresh) {
      return;
    }
    setBusy(true);
    setNotice("");
    const r = await deactivateTrainerProfile(existing.version, me.csrfToken);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) setState("auth");
      setRefresh(true);
      setNotice(
        r.status === 409
          ? "Профиль изменился. Обновите данные перед отключением."
          : "Не удалось отключить профиль тренера. Обновите данные и проверьте статус.",
      );
      return;
    }
    if (r.data.status !== "inactive") {
      setRefresh(true);
      setExisting(r.data);
      setNotice("Проверьте статус профиля тренера после обновления.");
      return;
    }
    router.push("/profile");
  }
  const active = existing?.status === "active";
  return (
    <ConsumerShell active="profile" title="Тренерский профиль" mode="local">
      <div className="fr3 trainer-editor">
        <header className="gb-page-local-header">
          <Link className="back-link" href="/profile">
            ← Мой профиль
          </Link>
          <h1>Тренерский профиль</h1>
        </header>
        {state === "loading" && <ProfileState title="Загрузка…" state="loading" />}
        {state === "error" && (
          <ProfileState
            title="Не удалось загрузить профиль"
            state="error"
            retry={() => setReload((n) => n + 1)}
          />
        )}
        {state === "auth" && (
          <section className="profile-section">
            <p>Войдите, чтобы рассказать о своих тренировках.</p>
            <AuthEntry returnPath="/profile/trainer" />
          </section>
        )}
        {state === "ready" && (
          <form
            className="profile-section"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <span className="eyebrow eyebrow--purple">Тренер</span>
            <p>Информация заполнена пользователем</p>
            <SectionHeader title="О ваших тренировках" />
            <label className="profile-field">
              Имя тренера
              <input
                required
                maxLength={160}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label className="profile-field">
              Коротко о себе
              <textarea
                rows={6}
                maxLength={1000}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </label>
            <p>
              Сохранение включает профиль тренера. Отключение не отзывает
              управление созданными играми.
            </p>
            {notice && <p role="status">{notice}</p>}
            {refresh && (
              <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
                Обновить данные
              </Button>
            )}
            <div className="profile-form-actions">
              <Button type="submit" disabled={busy || refresh}>
                Сохранить
              </Button>
              {active ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || refresh}
                  onClick={() => void deactivate()}
                >
                  Отключить профиль тренера
                </Button>
              ) : null}
              <Button variant="outline" href="/profile">
                Отмена
              </Button>
            </div>
          </form>
        )}
      </div>
    </ConsumerShell>
  );
}
