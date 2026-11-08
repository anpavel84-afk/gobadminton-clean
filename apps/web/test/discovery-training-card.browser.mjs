/* global process, document, window, console */
/** #521 discovery card geometry with exact DiscoveryGameCard SSR markup + live CSS.
 * Parent executes Playwright when local .tools is missing. Not Owner UAT / DEV claim. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = process.cwd();
const webRoot = fileURLToPath(new URL("..", import.meta.url));

async function loadPlaywright() {
  const candidates = [
    pathToFileURL(`${root}/.tools/node_modules/playwright/index.mjs`).href,
    "playwright",
    pathToFileURL(`${root}/node_modules/playwright/index.mjs`).href,
  ];
  const errors = [];
  for (const spec of candidates) {
    try {
      return await import(spec);
    } catch (error) {
      errors.push(`${spec}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `#521 browser helper: Playwright unavailable in this sandbox (parent executes). Tried: ${errors.join(" | ")}`,
  );
}

async function ssrExactCards() {
  const dir = await mkdtemp(join(tmpdir(), "gb521-"));
  const out = join(dir, "out.json");
  const result = spawnSync(
    join(root, "node_modules/.bin/vitest"),
    ["run", "test/discovery-training-card.test.tsx"],
    {
      cwd: webRoot,
      encoding: "utf8",
      env: { ...process.env, GB521_BROWSER_FIXTURE: out },
      shell: false,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout || "vitest SSR fixture failed");
  const payload = JSON.parse(await readFile(out, "utf8"));
  assert.match(payload.regularHtml, /gb-discovery-card/);
  assert.match(payload.trainerHtml, /data-activity="trainer_led"/);
  assert.doesNotMatch(payload.trainerHtml, /data-layout/);
  await rm(dir, { recursive: true, force: true });
  return payload;
}

const consumerTokens = await readFile(new URL("../src/styles/consumer-tokens.css", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/styles/discovery.css", import.meta.url), "utf8");
const roleRep = await readFile(new URL("../src/styles/role-reputation.css", import.meta.url), "utf8");
const { regularHtml, trainerHtml } = await ssrExactCards();

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(
      `<style>body{margin:0;background:#f4f6f1}*,*::before,*::after{box-sizing:border-box}
      .gb-c23-btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 13px;border:1px solid var(--gb-line,#dfe4dc);border-radius:10px;background:#fff;color:inherit;text-decoration:none;font:inherit}
      .gb-c23-btn--outline{background:#fff}
      .gb-game-share__button{width:44px;height:44px;border-radius:50%;border:1px solid var(--gb-line,#dfe4dc);background:#fff}
      .gb-discovery-card__actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none}
      .gb-discovery-icon{width:20px;height:20px}
      </style>
      <style>${consumerTokens}${discovery}${roleRep}</style>
      <main class="gb-consumer" style="padding:16px;width:${width}px;max-width:100%">
        <div class="gb-discovery-cards" id="feed">${regularHtml}${trainerHtml}</div>
      </main>`,
      { waitUntil: "domcontentloaded" },
    );

    await page.evaluate(() => {
      const trainer = document.querySelector('[data-activity="trainer_led"] .gb-discovery-card__content');
      if (!trainer) throw new Error("trainer content missing");
      const extra = document.createElement("div");
      extra.className = "gb-role-rep-footer";
      extra.innerHTML = "<span>3 проведённые игры по подтверждённой истории. История может быть неполной</span><button type='button'>Отзывы об организации · 2</button>";
      trainer.append(extra);
      window.dispatchEvent(new Event("resize"));
    });

    const metrics = await page.evaluate((viewportWidth) => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return [...document.querySelectorAll(".gb-discovery-card")].map((card) => {
        const image = card.querySelector(".gb-discovery-card__image");
        const content = card.querySelector(".gb-discovery-card__content");
        const details = card.querySelector(".gb-c23-btn");
        return {
          activity: card.getAttribute("data-activity"),
          layout: card.getAttribute("data-layout"),
          card: rect(card),
          image: rect(image),
          content: rect(content),
          details: details ? rect(details) : null,
          overflowX: card.scrollWidth > card.clientWidth + 1,
          viewportWidth,
        };
      });
    }, width);

    assert.equal(metrics.length, 2);
    for (const row of metrics) {
      assert.equal(row.layout, null);
      assert.equal(row.overflowX, false, `${width}:${row.activity} horizontal overflow`);
      assert.ok(row.details, `${width}:${row.activity} details CTA`);
      assert.ok(row.details.bottom <= row.card.bottom + 1, `${width}:${row.activity} CTA clipped`);
      assert.ok(row.details.right <= width + 1, `${width}:${row.activity} CTA beyond viewport`);
      if (width <= 390) {
        assert.ok(row.image.width >= row.card.width * 0.9, `${width}:${row.activity} mobile image width`);
        assert.ok(row.content.y >= row.image.bottom - 1, `${width}:${row.activity} mobile content below image`);
      } else {
        assert.ok(row.image.x < row.content.x, `${width}:${row.activity} image left of content`);
        assert.ok(row.image.width <= row.card.width * 0.45, `${width}:${row.activity} image not full-width banner`);
        assert.ok(row.content.x >= row.image.right - 2, `${width}:${row.activity} content starts after image`);
      }
    }
    if (width >= 1280) {
      const [regular, training] = metrics;
      assert.ok(training.image.width <= regular.image.width + 8, "trainer image must stay compact vs ordinary");
      assert.ok(training.content.x >= training.image.right - 2);
    }
    await page.close();
  }
  console.log("#521 discovery training card browser geometry OK (390 + 1280); not Owner UAT.");
} finally {
  await browser.close();
}
