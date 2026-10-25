import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GamesMapBackButton } from "../src/components/consumer/games/GamesMapBackButton";
import { GamesViewAction } from "../src/components/consumer/games/GamesViewAction";
it("renders one explicitly named return capsule and no bottom action on the map", () => {
  const html = renderToStaticMarkup(<><GamesMapBackButton onClick={() => {}} /><GamesViewAction view="map" onClick={() => {}} /></>);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('aria-label="К списку игр"');
  expect(html).not.toContain('gb-games-view-action');
});
it("preserves the list map-entry capsule", () => {
  expect(renderToStaticMarkup(<GamesViewAction view="list" onClick={() => {}} />)).toContain("На карте");
});
