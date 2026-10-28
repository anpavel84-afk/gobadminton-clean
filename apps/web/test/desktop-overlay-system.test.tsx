import { Children, isValidElement, type ReactNode } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DesktopOverlayHeader } from "../src/components/consumer/DesktopOverlayHeader";
import { CloseButton } from "../src/components/consumer/CloseButton";

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

it("DesktopOverlayHeader keeps Back independent of title and reuses CloseButton", () => {
  const onClose = vi.fn();
  const onBack = vi.fn();
  const tree = (
    <DesktopOverlayHeader
      title="Capital Club"
      back={{ label: "К площадке", onClick: onBack }}
      onClose={onClose}
      closeLabel="Закрыть"
    />
  );
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("gb-desktop-overlay-header");
  expect(html).toContain("gb-desktop-overlay-header__back");
  expect(html).toContain("К площадке");
  expect(html).toContain("Capital Club");
  expect(html).toContain("gb-desktop-overlay-header__close");
  expect(html).toContain('aria-label="Закрыть"');
  const close = elements(tree).find(node => node.type === CloseButton);
  expect(close?.props.onClick).toBe(onClose);
  const back = elements(tree).find(node => node.props.className === "gb-desktop-overlay-header__back");
  (back!.props.onClick as () => void)();
  expect(onBack).toHaveBeenCalledOnce();
});

it("DesktopOverlayHeader without Back still places shell X via CloseButton", () => {
  const html = renderToStaticMarkup(
    <DesktopOverlayHeader title="Профиль игрока" kicker="Игрок" onClose={() => {}} />,
  );
  expect(html).toContain("Игрок");
  expect(html).toContain("Профиль игрока");
  expect(html).not.toContain("gb-desktop-overlay-header__back");
  expect(html).toContain("gb-close-button");
});

it("CloseButton SVG contract stays 24px glyph for overlay X", () => {
  const html = renderToStaticMarkup(<CloseButton aria-label="Закрыть панель" />);
  expect(html).toContain('viewBox="0 0 24 24"');
  expect(html).toContain("gb-close-button");
});
