import { createElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DesktopBrowseActionsFixture,
  PlusIcon,
  SkipArrowIcon,
  StableActionFooter,
} from "../src/components/consumer/players/PlayerBrowsePlayInterest";

const css = readFileSync(
  fileURLToPath(new URL("../src/styles/player-browse.css", import.meta.url)),
  "utf8",
);

describe("player browse action buttons Style Guide (#526)", () => {
  it("mobile StableActionFooter keeps labels and adds aria-hidden icons", () => {
    const html = renderToStaticMarkup(
      createElement(StableActionFooter, {
        desktop: false,
        status: "",
        showSkip: true,
        skipDisabled: false,
        onSkip: () => {},
        primary: createElement(
          "button",
          { type: "button", className: "pb-btn-request" },
          createElement(PlusIcon),
          "Давай сыграем",
        ),
      }),
    );
    expect(html).toContain("Пропустить");
    expect(html).toContain("Давай сыграем");
    expect(html).toContain("pb-btn-skip");
    expect(html).toContain("pb-btn-request");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toMatch(/pb-btn-skip[\s\S]*aria-hidden="true"[\s\S]*Пропустить/);
    expect(html).toMatch(/pb-btn-request[\s\S]*aria-hidden="true"[\s\S]*Давай сыграем/);
  });

  it("desktop fixture keeps labels and plus on «Давай сыграем» only", () => {
    const ready = renderToStaticMarkup(createElement(DesktopBrowseActionsFixture, { status: "" }));
    expect(ready).toContain("Давай сыграем");
    expect(ready).toContain("Следующий");
    expect(ready).toContain("pb-btn-request");
    expect(ready).toContain("pb-btn-next");
    expect(ready).toContain('aria-hidden="true"');
    expect(ready).toMatch(/pb-btn-request[\s\S]*aria-hidden="true"[\s\S]*Давай сыграем/);

    const withdraw = renderToStaticMarkup(
      createElement(DesktopBrowseActionsFixture, {
        status: "Предложение отправлено",
        statusTone: "success",
        primaryLabel: "Отменить предложение",
        primaryClassName: "pb-btn-withdraw",
      }),
    );
    expect(withdraw).toContain("Отменить предложение");
    expect(withdraw).not.toContain("Давай сыграем");
    expect(withdraw).not.toMatch(/pb-btn-withdraw[\s\S]*aria-hidden="true"/);

    const skipIcon = renderToStaticMarkup(createElement(SkipArrowIcon));
    expect(skipIcon).toContain('aria-hidden="true"');
    expect(skipIcon).toContain('focusable="false"');
  });

  it("CSS pins mobile 1.65fr/50px and desktop 1.6fr / 56px columns", () => {
    const mobileBlock = css.slice(css.indexOf(".gb-player-browse .pb-controls--mobile .pb-main-actions {"));
    const mobileRule = mobileBlock.slice(0, mobileBlock.indexOf("}") + 1);
    expect(mobileRule).toContain("minmax(0, 1fr) minmax(0, 1.65fr)");
    expect(mobileRule).toContain("min-height: 50px");
    expect(mobileRule).toContain("gap: 8px");

    const mobileBtn = css.slice(
      css.indexOf(".gb-player-browse .pb-controls--mobile .pb-main-actions button,"),
    );
    expect(mobileBtn.slice(0, 220)).toContain("min-height: 50px");

    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-profile-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.6fr\)\s+minmax\(138px,\s*1fr\)/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-btn-next\s*\{[^}]*min-height:\s*56px/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-btn-request,\s*\n\s*\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-btn-withdraw,\s*\n\s*\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-main-actions--desktop\s+\.btn\s*\{[^}]*min-height:\s*56px/s,
    );
    expect(css).toMatch(
      /\.gb-player-browse\[data-browse-desktop="true"\]\s+\.pb-main-actions--desktop\s*\{[^}]*grid-column:\s*1[^}]*min-height:\s*56px/s,
    );
  });
});
