import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ refs: [] as { current: unknown }[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useRef(initial: unknown) { const i = h.cursor++; return h.refs[i] ??= { current: initial }; },
  // Replay the mount effect to exercise React Strict Mode's duplicate setup.
  useEffect(effect: () => void) { h.effects.push(effect); },
}));
import { GamesMapBackButton } from "../src/components/consumer/games/GamesMapBackButton";
class Element {}
let body: Element;
let focus: ReturnType<typeof vi.fn>;
function mount() {
  h.cursor = 0;
  const tree = GamesMapBackButton({ onClick: vi.fn() });
  h.refs[0]!.current = { focus };
  h.effects.splice(0).forEach(effect => { effect(); effect(); });
  return tree;
}
beforeEach(() => {
  h.refs = []; h.effects = []; body = new Element(); focus = vi.fn();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { body, documentElement: new Element(), activeElement: body, querySelector: () => null });
});
afterEach(() => vi.unstubAllGlobals());
it("focuses once on mount with preventScroll, including duplicate effect setup and rerender", () => {
  mount(); mount();
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});
it("preserves an open dialog's focus", () => {
  document.querySelector = vi.fn().mockReturnValue({});
  mount(); expect(focus).not.toHaveBeenCalled();
});
it("preserves focus on another real control, including a list/sidebar control", () => {
  Object.assign(document, { activeElement: new Element() });
  mount(); expect(focus).not.toHaveBeenCalled();
});
