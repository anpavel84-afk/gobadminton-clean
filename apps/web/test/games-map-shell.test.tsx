import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GamesMapBackButton } from "../src/components/consumer/games/GamesMapBackButton";
import { GamesViewAction } from "../src/components/consumer/games/GamesViewAction";
it("renders one explicitly named return capsule and no bottom action on the map", () => {
  const html = renderToStaticMarkup(<><GamesMapBackButton onClick={() => {}} /><GamesViewAction view="map" onClick={() => {}} /></>);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('aria-label="К списку игр"');
  expect(html).not.toContain('gb-games-view-action');
});
it("passes activation to the existing list switch", () => {
  const changeView = vi.fn();
  const button = GamesMapBackButton({ onClick: () => changeView("list") });
  button.props.onClick();
  expect(changeView).toHaveBeenCalledWith("list");
});
it("preserves the list map-entry capsule", () => {
  expect(renderToStaticMarkup(<GamesViewAction view="list" onClick={() => {}} />)).toContain("На карте");
});
