import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseButton } from "../src/components/consumer/CloseButton";

// Included in the web tsconfig: both React 19 ref forms must receive a native button.
function ButtonRefFixture() {
  const ref = createRef<HTMLButtonElement>();
  return <><CloseButton ref={ref} /><CloseButton ref={button => {
    const native: HTMLButtonElement | null = button;
    native?.focus();
  }} /></>;
}

describe("production CloseButton via React SSR", () => {
  it("renders a native non-submit button with the default label", () => {
    const html = renderToStaticMarkup(<CloseButton />);
    expect(html).toMatch(/^<button\b/);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Закрыть"');
    expect(html).toContain('class="gb-close-button"');
    expect(html).toMatch(/<\/button>$/);
  });

  it("renders only a decorative centered 24px SVG X", () => {
    const html = renderToStaticMarkup(<CloseButton />);
    expect(html).toContain('<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">');
    expect(html.match(/<svg\b/g)).toHaveLength(1);
    expect(html.match(/<line\b/g)).toHaveLength(2);
    expect(html).toContain('<line x1="6" y1="6" x2="18" y2="18"></line>');
    expect(html).toContain('<line x1="18" y1="6" x2="6" y2="18"></line>');
    expect(html).not.toMatch(/[×✕]|<img|<title/);
  });

  it.each(["Закрыть выбор площадки", "Закрыть карточку игрока", "Закрыть список"] as const)("keeps contextual label %s", label => {
    expect(renderToStaticMarkup(<CloseButton aria-label={label} />)).toContain(`aria-label="${label}"`);
  });

  it("preserves disabled and native button/ARIA/placement props", () => {
    const html = renderToStaticMarkup(<CloseButton disabled id="close" name="dismiss" value="venue"
      title="Закрыть площадку" tabIndex={-1} aria-controls="venue" aria-describedby="hint"
      data-placement="header" className="placement" onClick={event => event.currentTarget.focus()} />);
    for (const attribute of ['disabled=""', 'id="close"', 'name="dismiss"', 'value="venue"',
      'title="Закрыть площадку"', 'tabindex="-1"', 'aria-controls="venue"', 'aria-describedby="hint"',
      'data-placement="header"', 'class="gb-close-button placement"', 'type="button"']) {
      expect(html).toContain(attribute);
    }
    expect(renderToStaticMarkup(<CloseButton disabled={false} />)).not.toContain("disabled");
  });

  it("accepts the compile-checked native ref fixture (SSR does not attach refs)", () => {
    expect(renderToStaticMarkup(<ButtonRefFixture />).match(/<button\b/g)).toHaveLength(2);
  });
});
