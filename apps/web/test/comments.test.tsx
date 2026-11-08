import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CommentsSection } from "../src/components/consumer/comments/CommentsSection";

vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, props.children),
}));

vi.mock("../src/lib/comments-api", () => ({
  listEntityComments: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      entityKind: "game",
      entityId: "10000000-0000-4000-8000-000000000001",
      parentCommentId: null,
      items: [],
      nextCursor: null,
      visibleCount: 0,
      canCreate: false,
    },
  })),
  createEntityCommentPath: (kind: string, id: string) => `/v1/${kind}s/${id}/comments`,
  updateEntityCommentPath: (id: string) => `/v1/comments/${id}`,
  deleteEntityCommentPath: (id: string) => `/v1/comments/${id}`,
  isCommentView: () => false,
  publicCommentModerationNotice: () => null,
}));

describe("#394 CommentsSection", () => {
  it("renders empty guest surface without demo content or verification badges", () => {
    const html = renderToStaticMarkup(
      createElement(CommentsSection, {
        kind: "game",
        entityId: "10000000-0000-4000-8000-000000000001",
        me: null,
        parentPublic: true,
        authReturnPath: "/games/10000000-0000-4000-8000-000000000001",
        description: "Вопросы об этой игре и короткий разговор до встречи",
      }),
    );
    expect(html).toContain("Комментарии");
    expect(html).toContain("Вопросы об этой игре");
    expect(html).toContain("Войдите, чтобы оставить комментарий");
    expect(html).not.toMatch(/демо|verified|верифиц/i);
  });

  it("does not mount when parent is not public", () => {
    const html = renderToStaticMarkup(
      createElement(CommentsSection, {
        kind: "venue",
        entityId: "10000000-0000-4000-8000-000000000002",
        me: null,
        parentPublic: false,
        authReturnPath: "/venues/x",
        description: "hidden",
      }),
    );
    expect(html).toBe("");
  });

  it("VenuePage mounts #507 community discussion via CommentsSection; game guest entry unchanged", () => {
    const venueSrc = readFileSync(
      resolve(__dirname, "../src/components/consumer/venues/VenuePage.tsx"),
      "utf8",
    );
    expect(venueSrc).toContain("VenueReviewsPanel");
    expect(venueSrc).toContain("VenueCommunityRating");
    expect(venueSrc).toContain("CommentsSection");
    expect(venueSrc).toContain('kind="venue"');
    expect(venueSrc).toContain("Обсуждение площадки");
    expect(venueSrc).toContain('sectionId="discussion"');
    expect(venueSrc).toMatch(/SurfacePanel/);
    expect(venueSrc).not.toContain("Обсуждение и фотографии");
    expect(venueSrc).not.toContain("Добавление фотографий к публикациям появится позже");

    const gameHtml = renderToStaticMarkup(
      createElement(CommentsSection, {
        kind: "game",
        entityId: "10000000-0000-4000-8000-000000000001",
        me: null,
        parentPublic: true,
        authReturnPath: "/games/10000000-0000-4000-8000-000000000001",
        description: "Вопросы об этой игре и короткий разговор до встречи",
      }),
    );
    expect(gameHtml).toContain("Войдите, чтобы оставить комментарий");
    expect(gameHtml).toContain("Вопросы об этой игре");
  });

  it("own-menu and tombstone policy are wired in CommentsSection source", () => {
    const src = readFileSync(
      resolve(__dirname, "../src/components/consumer/comments/CommentsSection.tsx"),
      "utf8",
    );
    expect(src).toContain("!item.mine");
    expect(src).toContain("canAuthorSafety");
    expect(src).toContain("Комментарий удалён");
    expect(src).toMatch(/item\.deleted[\s\S]*?gb-comment__tombstone/);
  });

  it("wires moderation inline notice and clears drafts only on success", () => {
    const src = readFileSync(
      resolve(__dirname, "../src/components/consumer/comments/CommentsSection.tsx"),
      "utf8",
    );
    expect(src).toContain("publicCommentModerationNotice");
    expect(src).toContain("moderationNotice ?? mutation.notice");
    expect(src).toContain('setDraft("")');
    expect(src).toMatch(/onSuccess[\s\S]*setDraft\(""\)/);
    expect(src).not.toMatch(/onRefresh[\s\S]*setDraft\(""\)/);
  });
});
