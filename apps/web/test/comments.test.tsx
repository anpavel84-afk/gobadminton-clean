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
});
