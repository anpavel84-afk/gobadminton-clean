import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { OwnSocialProfile } from "../src/lib/consumer-types";
import type { PlayInterestView } from "@gobadminton/contracts/friendship-types";
import { PlayerBrowseFinderGate } from "../src/components/consumer/players/PlayerBrowseOffers";
import {
  classifyFinderBatchEmpty,
  ownSocialFinderStatusFromProfile,
  type FinderEligibility,
} from "../src/components/consumer/players/usePlayerBrowseOffers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const offersHookSource = readFileSync(
  join(root, "src/components/consumer/players/usePlayerBrowseOffers.ts"),
  "utf8",
);
const offersUiSource = readFileSync(
  join(root, "src/components/consumer/players/PlayerBrowseOffers.tsx"),
  "utf8",
);

const baseProfile = (over: Partial<OwnSocialProfile> = {}): OwnSocialProfile => ({
  publicPlayerId: "own-1",
  version: 1,
  displayName: "Я",
  cityId: null,
  areaKey: null,
  level: null,
  bio: null,
  directoryVisible: true,
  contactPolicy: "requests",
  consentPolicyVersion: null,
  optedInAt: null,
  radarConsented: false,
  radarConsentPolicyVersion: null,
  radarConsentedAt: null,
  socialEligible: true,
  trainer: false,
  lookingForGame: null,
  ...over,
});

describe("player browse eligibility · own profile gate (#438)", () => {
  it("delayed own profile stays loading — not exhausted — until social profile resolves", () => {
    expect(ownSocialFinderStatusFromProfile(null, false).status).toBe("error");
    expect(offersHookSource).toContain('ownSocialStatus === "loading"');
    expect(offersHookSource).toContain('setEligibilityKind("checking")');
    expect(offersHookSource).toMatch(/Auth may be ready before own social profile/);
    expect(offersHookSource).toContain("retireEligibilityBookkeeping()");
    expect(offersHookSource).toContain("ownSocialFinderStatusFromProfile");
    // Premature batch must not run while own gate is unresolved.
    expect(offersHookSource).toContain('ownSocialStatus !== "ready"');
    expect(offersHookSource).not.toMatch(/setAuthState\("ready"\);\s*const social = await getMySocialProfile/);
  });

  it("own private/hidden profile maps to prerequisite and blocks sends", () => {
    const hidden = ownSocialFinderStatusFromProfile(
      baseProfile({ directoryVisible: false }),
      true,
    );
    expect(hidden).toEqual({ status: "hidden", publicPlayerId: "own-1" });
    const ineligible = ownSocialFinderStatusFromProfile(
      baseProfile({ socialEligible: false }),
      true,
    );
    expect(ineligible.status).toBe("hidden");
    expect(offersHookSource).toContain('own_prerequisite');
    expect(offersHookSource).toContain('ownSocialStatus === "hidden"');
    expect(offersHookSource).toContain('admitSend');
    expect(offersHookSource).toMatch(/ownSocialStatus !== "ready"\) return false/);
    expect(offersUiSource).toContain("К настройкам профиля");
    expect(offersUiSource).toContain('href="/profile"');
    expect(offersUiSource).not.toContain("directoryVisible: true");
    const gate: FinderEligibility = {
      kind: "own_prerequisite",
      players: [],
      message: "В режиме «Свайп» предложения доступны, когда ваш профиль виден в каталоге.",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, { eligibility: gate }));
    expect(html).toContain("Сначала откройте свой профиль");
    expect(html).toContain("К настройкам профиля");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
  });

  it("own visible + eligible peers stay ready path; missing profile is retry error not empty", () => {
    expect(ownSocialFinderStatusFromProfile(baseProfile(), true)).toEqual({
      status: "ready",
      publicPlayerId: "own-1",
    });
    expect(ownSocialFinderStatusFromProfile(baseProfile({ publicPlayerId: null }), true).status).toBe("error");
    expect(offersHookSource).toContain("Не удалось загрузить профиль");
    expect(offersUiSource).toContain("Не удалось загрузить профиль");
    expect(offersUiSource).toContain("Повторить");
    const errGate: FinderEligibility = {
      kind: "error",
      players: [],
      message: "Не удалось загрузить профиль",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: errGate,
      onRetry: () => undefined,
    }));
    expect(html).toContain("Не удалось загрузить профиль");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
    expect(html).not.toContain("В этой части списка новых предложений нет");
  });

  it("all peers unavailable is not exhausted; outgoing/mutual still classify as end", () => {
    const unavailable = "unavailable" as PlayInterestView["relationship"];
    const outgoing = "outgoing" as PlayInterestView["relationship"];
    const mutual = "mutual" as PlayInterestView["relationship"];
    expect(classifyFinderBatchEmpty({
      hasMore: false,
      relationships: [unavailable, unavailable],
    })).toBe("peers_unavailable");
    expect(classifyFinderBatchEmpty({
      hasMore: true,
      relationships: [unavailable],
    })).toBe("peers_unavailable");
    expect(classifyFinderBatchEmpty({
      hasMore: false,
      relationships: [outgoing, mutual],
    })).toBe("exhausted");
    expect(classifyFinderBatchEmpty({
      hasMore: true,
      relationships: [outgoing, unavailable],
    })).toBe("empty_page");
    expect(offersHookSource).toContain("classifyFinderBatchEmpty");
    expect(offersHookSource).toContain("peers_unavailable");
    expect(offersUiSource).toContain("Сейчас нельзя предложить игру");
    const gate: FinderEligibility = {
      kind: "peers_unavailable",
      players: [],
      message: "Подходящие предложения временно недоступны.",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: gate,
      onRetry: () => undefined,
    }));
    expect(html).toContain("Сейчас нельзя предложить игру");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
    expect(html).not.toMatch(/недоступен.*приват|скрыт.*игрок/i);
  });

  it("preserves account-switch / UNKNOWN bookkeeping and does not invent privacy bypass", () => {
    const expire = offersHookSource.indexOf("const expire = () =>");
    expect(expire).toBeGreaterThan(-1);
    const expireBody = offersHookSource.slice(expire, expire + 1200);
    expect(expireBody).toContain("batchGen.current += 1");
    expect(expireBody).toContain('setEligibilityKind("guest")');
    expect(expireBody).toContain("setOwnPublicPlayerId(null)");
    expect(expireBody).toContain('setOwnSocialStatus("loading")');
    expect(offersHookSource).toContain("gb-session-changed");
    expect(offersHookSource).toContain("gb-private-expired");
    expect(offersHookSource).toContain("unresolvedRef.current.some");
    expect(offersHookSource).toContain("readValidatedPending");
    expect(offersHookSource).not.toContain("directoryVisible: true");
    expect(offersHookSource).not.toContain("putMySocialProfileVisibility");
    expect(offersUiSource).not.toContain("putMySocialProfileVisibility");
  });
});
