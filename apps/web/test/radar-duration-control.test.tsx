import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RadarDurationChoice } from "../src/components/consumer/radar/RadarSessionProvider";
it("offers labelled native duration selection with honest lease help", () => {
  const html = renderToStaticMarkup(<RadarDurationChoice />);
  expect(html).toContain("<label>");
  expect(html).toContain("<select");
  for (const label of ["15 минут", "1 час", "До выключения", "Сервер ограничивает срок", "после истечения потребуется снова включить Radar с согласием"]) expect(html).toContain(label);
});
