/* global process, console, URL, WebSocket, Buffer, setTimeout, fetch */
/** #458 compact discovery filters: actual source composition geometry via owned Chromium CDP.
 * Playwright unavailable here; uses /opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell.
 * Interaction keyboard coverage lives in games-discovery-filters.test.tsx.
 * Not DEV / Owner UAT / GoBad. Parent executes when Chromium missing. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell";
const VIEWPORTS = [390, 1280];
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const outDirArg = process.argv[2];
const privateTmp = tmpdir();

function resolveEvidenceDir(arg) {
  const candidate = arg && String(arg).trim() ? String(arg).trim() : join(privateTmp, `gb458-browser-${process.pid}`);
  const resolved = candidate.startsWith("/") ? candidate : join(process.cwd(), candidate);
  const underSource =
    resolved === repoRoot ||
    resolved.startsWith(`${repoRoot}/`) ||
    resolved === webRoot ||
    resolved.startsWith(`${webRoot}/`);
  if (underSource) return join(privateTmp, `gb458-browser-${process.pid}`);
  return resolved;
}

const outDir = resolveEvidenceDir(outDirArg);
mkdirSync(outDir, { recursive: true });

const receipt = {
  scope: "#458/#547 DiscoveryLevelFilters SSR+CSS geometry + labelled D1 browser fixture via owned Chromium CDP; not DEV/Owner/GoBad UAT",
  chrome: CHROME,
  viewports: VIEWPORTS,
  shots: [],
  metrics: [],
  d1: null,
  pass: false,
  status: "PENDING",
};

function chromeAvailable() {
  try {
    accessSync(CHROME, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function ssrFixtures() {
  const dir = await mkdtemp(join(tmpdir(), "gb458-"));
  const out = join(dir, "out.json");
  const vitestBin = join(webRoot, "node_modules/.bin/vitest");
  const result = spawnSync(vitestBin, ["run", "test/games-discovery-filters.test.tsx"], {
    cwd: webRoot,
    encoding: "utf8",
    env: { ...process.env, GB458_BROWSER_FIXTURE: out },
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "vitest SSR fixture failed");
  const payload = JSON.parse(await readFile(out, "utf8"));
  assert.match(payload.closedHtml, /gb-discovery-filters-trigger/);
  assert.doesNotMatch(payload.closedHtml, /Выходите на корт|По времени|data-level-guide/);
  assert.match(payload.closedHtml, /Все ближайшие/);
  assert.match(payload.closedHtml, /С тренером/);
  assert.match(payload.closedHtml, /Найдено: 12 · из 40 загруженных/);
  assert.match(payload.openHtml, /gb-discovery-filters-dialog/);
  assert.match(payload.openHtml, /data-presentation="compact"/);
  assert.match(payload.openHtml, /value="2\.0"/);
  assert.equal(payload.halfSteps?.length, 13);
  assert.match(String(payload.d1InteractiveHtml || ""), /games547-d1-exact-2\.0-controlled-reset/);
  await rm(dir, { recursive: true, force: true });
  return payload;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withChrome(run) {
  const profile = await mkdtemp(join(tmpdir(), "gb458-chrome-"));
  const child = spawn(
    CHROME,
    [
      "--headless",
      "--no-first-run",
      "--enable-unsafe-swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let endpoint = "";
  let log = "";
  child.stderr.on("data", (b) => {
    log += b;
    endpoint = log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] || endpoint;
  });
  let socket;
  try {
    for (let i = 0; i < 100 && !endpoint; i++) await sleep(100);
    if (!endpoint) throw new Error(`Chromium endpoint unavailable: ${log.slice(0, 400)}`);
    const port = new URL(endpoint).port;
    const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    socket = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.addEventListener("message", (e) => {
      const d = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString());
      if (d.id) {
        const p = pending.get(d.id);
        if (p) {
          pending.delete(d.id);
          if (d.error) p.reject(new Error(d.error.message));
          else p.resolve(d.result);
        }
      } else if (d.method === "Fetch.requestPaused") {
        const q = d.params;
        call("Fetch.failRequest", { requestId: q.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      }
    });
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || "evaluate failed");
      }
      return r.result?.value;
    };
    await call("Page.enable");
    await call("Page.bringToFront");
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Network.setCacheDisabled", { cacheDisabled: true });
    await call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await run({ call, evaluate });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      sleep(3000).then(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }),
    ]);
    await rm(profile, { recursive: true, force: true });
  }
}

function pageHtml(width, bodyHtml, cssBundle, safeAreaBottom = 0) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=${width}, initial-scale=1"/>
<style>
html,body{margin:0;padding:0;background:#f4f6f1}
:root{--sat:0px;--sab:${safeAreaBottom}px}
@supports (padding: env(safe-area-inset-bottom)) {
  /* fixture mirrors env via CSS variable substitution below */
}
main.gb-consumer{padding:16px;width:${width}px;max-width:100%;box-sizing:border-box;min-height:100dvh}
</style>
<style>${cssBundle.replaceAll("env(safe-area-inset-bottom, 0px)", `${safeAreaBottom}px`).replaceAll("env(safe-area-inset-bottom)", `${safeAreaBottom}px`)}</style>
</head><body><main class="gb-consumer">${bodyHtml}</main></body></html>`;
}

if (!chromeAvailable()) {
  receipt.status = "NOT_TESTED";
  receipt.reason = `Qualified Chromium missing at ${CHROME}; parent executes helper. Geometry assertions preserved in source.`;
  writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: "NOT_TESTED", reason: receipt.reason, outDir }));
  process.exit(0);
}

const consumerTokens = await readFile(new URL("../src/styles/consumer-tokens.css", import.meta.url), "utf8");
const consumerRaw = await readFile(new URL("../src/styles/consumer.css", import.meta.url), "utf8");
const consumer = consumerRaw.replace(/@import\s+["'][^"']+["']\s*;?/g, "/* inlined tokens separately */");
const discovery = await readFile(new URL("../src/styles/discovery.css", import.meta.url), "utf8");
const levelGuide = await readFile(new URL("../src/styles/level-guide.css", import.meta.url), "utf8");
const cssBundle = `${consumerTokens}\n${consumer}\n${discovery}\n${levelGuide}`;
const fixtures = await ssrFixtures();

await withChrome(async ({ call, evaluate }) => {
  for (const width of VIEWPORTS) {
    const height = width <= 390 ? 900 : 1000;
    const safeArea = width <= 390 ? 34 : 0;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 390,
    });
    const { frameTree } = await call("Page.getFrameTree");

    await call("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: pageHtml(width, fixtures.closedHtml, cssBundle, safeArea),
    });
    await sleep(120);
    const closed = await evaluate(`(() => {
      const trigger = document.querySelector('.gb-discovery-filters-trigger');
      const tr = trigger?.getBoundingClientRect();
      const guide = document.querySelector('[data-level-guide]');
      const eyebrow = (document.body.textContent || '').includes('Выходите на корт');
      const sortText = (document.body.textContent || '').includes('По времени');
      const overflowX = document.documentElement.scrollWidth > ${width} + 1;
      const heading = document.querySelector('.gb-discovery-feed-heading');
      const title = heading?.querySelector('h2');
      const count = heading?.querySelector('.gb-discovery-feed-actions > span');
      const titleBox = title?.getBoundingClientRect();
      const countBox = count?.getBoundingClientRect();
      const chips = document.querySelector('.gb-discovery-chips');
      const chipsStyle = chips ? getComputedStyle(chips) : null;
      const filtersStyle = getComputedStyle(document.querySelector('.gb-discovery-filters'));
      const dateSelect = document.querySelector('.gb-discovery-date select');
      const dateOpt = dateSelect && Array.from(dateSelect.options).find((o) => o.value === '');
      const dateTextOk = dateOpt ? dateOpt.label === 'Все ближайшие' || dateOpt.textContent === 'Все ближайшие' : false;
      const dateBox = dateSelect?.getBoundingClientRect();
      const overlap =
        titleBox && countBox
          ? !(titleBox.right <= countBox.left + 1 || countBox.right <= titleBox.left + 1 || titleBox.bottom <= countBox.top + 1 || countBox.bottom <= titleBox.top + 1)
            && Math.min(titleBox.right, countBox.right) - Math.max(titleBox.left, countBox.left) > 4
            && Math.min(titleBox.bottom, countBox.bottom) - Math.max(titleBox.top, countBox.top) > 4
          : false;
      return {
        trigger: tr ? { width: tr.width, height: tr.height, x: tr.x, y: tr.y } : null,
        guidePresent: Boolean(guide),
        eyebrow,
        sortText,
        overflowX,
        triggerCount: document.querySelectorAll('.gb-discovery-filters-trigger').length,
        titleCountOverlap: overlap,
        chipsScrollbarWidth: chipsStyle?.scrollbarWidth || null,
        filtersScrollbarWidth: filtersStyle.scrollbarWidth || null,
        chipsPaddingEnd: chipsStyle?.paddingInlineEnd || null,
        dateTextOk,
        dateWidth: dateBox ? Math.round(dateBox.width) : 0,
      };
    })()`);
    assert.ok(closed.trigger, `${width}: trigger present`);
    assert.equal(closed.triggerCount, 1, `${width}: exactly one filters trigger`);
    assert.ok(Math.abs(closed.trigger.width - 44) <= 1, `${width}: trigger width 44`);
    assert.ok(Math.abs(closed.trigger.height - 44) <= 1, `${width}: trigger height 44`);
    assert.equal(closed.guidePresent, false, `${width}: no LevelGuide when closed`);
    assert.equal(closed.eyebrow, false, `${width}: no feed eyebrow`);
    assert.equal(closed.sortText, false, `${width}: no По времени`);
    assert.equal(closed.overflowX, false, `${width}: no horizontal overflow closed`);
    assert.equal(closed.titleCountOverlap, false, `${width}: title/count no collision`);
    assert.equal(closed.dateTextOk, true, `${width}: date option Все ближайшие present`);
    if (width >= 1280) {
      assert.ok(closed.dateWidth >= 120, `${width}: date control wide enough for Все ближайшие`);
    }
    if (width <= 390) {
      assert.equal(closed.chipsScrollbarWidth, "none", `${width}: chips scrollbar hidden`);
      assert.equal(closed.filtersScrollbarWidth, "none", `${width}: filters scrollbar hidden`);
      assert.ok(Number.parseFloat(closed.chipsPaddingEnd) >= 12, `${width}: chips end padding`);
    }
    receipt.metrics.push({ width, state: "closed", ...closed });

    await call("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: pageHtml(width, fixtures.openHtml, cssBundle, safeArea),
    });
    await sleep(120);
    const open = await evaluate(`(() => {
      const dialog = document.querySelector('.gb-discovery-filters-dialog');
      const body = dialog?.querySelector('.gb-discovery-filters-dialog__body');
      const footer = dialog?.querySelector('.gb-discovery-filters-dialog__footer');
      const reset = dialog?.querySelector('.gb-discovery-filters-dialog__reset');
      const listBtn = footer?.querySelector('.gb-c23-btn');
      const closeBtn = dialog?.querySelector('.gb-close-button');
      const select = dialog?.querySelector('select');
      const dr = dialog?.getBoundingClientRect();
      const fr = footer?.getBoundingClientRect();
      const cr = closeBtn?.getBoundingClientRect();
      const bodyOverflow = body ? getComputedStyle(body).overflowY : null;
      const footerPad = footer ? getComputedStyle(footer).paddingBottom : null;
      const overflowX = document.documentElement.scrollWidth > ${width} + 1;
      const definitions = dialog ? dialog.querySelectorAll('.gb-level-guide__list li').length : 0;
      return {
        dialog: dr ? { width: dr.width, height: dr.height, top: dr.y, bottom: dr.bottom } : null,
        footer: fr ? { bottom: fr.bottom, height: fr.height } : null,
        close: cr ? { width: cr.width, height: cr.height, top: cr.y, right: ${width} - cr.right } : null,
        resetMinHeight: reset ? Math.round(reset.getBoundingClientRect().height) : 0,
        listBtnMinHeight: listBtn ? Math.round(listBtn.getBoundingClientRect().height) : 0,
        selectMinHeight: select ? Math.round(select.getBoundingClientRect().height) : 0,
        selectValue: select ? select.value : null,
        selectFontSize: select ? getComputedStyle(select).fontSize : null,
        bodyOverflow,
        footerPad,
        overflowX,
        definitions,
        viewportHeight: ${height},
      };
    })()`);
    assert.ok(open.dialog, `${width}: dialog present`);
    assert.equal(open.overflowX, false, `${width}: no horizontal overflow open`);
    assert.equal(open.definitions, 13, `${width}: 13 level definitions`);
    assert.ok(open.close && Math.abs(open.close.width - 44) <= 1, `${width}: close 44`);
    assert.ok(open.close && Math.abs(open.close.height - 44) <= 1, `${width}: close height 44`);
    assert.ok(open.resetMinHeight >= 48, `${width}: reset ≥48 (44 floor retained)`);
    assert.ok(open.listBtnMinHeight >= 48, `${width}: list btn ≥48`);
    assert.ok(open.selectMinHeight >= 48, `${width}: compact select ≥48`);
    assert.equal(open.selectValue, "2.0", `${width}: open fixture exact 2.0`);
    if (width <= 390) {
      assert.ok(open.dialog.width >= width - 2, `${width}: bottomsheet full width`);
      assert.ok(open.dialog.top > 0, `${width}: sheet leaves top breathing room`);
      assert.ok(open.selectFontSize === "16px", `${width}: select 16px`);
      assert.match(String(open.footerPad || ""), /34px|54px|20px/, `${width}: footer accounts for safe-area`);
    } else {
      assert.ok(open.dialog.width <= 480 + 1, `${width}: filters family ≤480`);
    }
    assert.ok(["auto", "scroll", "overlay"].includes(open.bodyOverflow), `${width}: single body scroll`);
    receipt.metrics.push({ width, state: "open", safeArea, ...open });
  }

  /* Labelled browser fixture: controlled reset mirror for exact 2.0 — not live Next GET / GoBad UAT. */
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const { frameTree: d1Tree } = await call("Page.getFrameTree");
  await call("Page.setDocumentContent", {
    frameId: d1Tree.frame.id,
    html: fixtures.d1InteractiveHtml,
  });
  await sleep(80);
  const before = await evaluate(`window.__gb547D1()`);
  assert.equal(before.selectValue, "2.0", "D1 fixture starts at 2.0");
  assert.equal(before.dotActive, true, "D1 fixture active dot before reset");
  assert.equal(before.resetDisabled, false, "D1 fixture reset enabled before");
  await evaluate(`document.getElementById('gb547-reset').click()`);
  const after = await evaluate(`window.__gb547D1()`);
  assert.equal(after.selectValue, "", "D1 fixture select cleared");
  assert.equal(after.dotActive, false, "D1 fixture dot absent");
  assert.equal(after.resetDisabled, true, "D1 fixture reset disabled");
  assert.equal(after.helperHidden, true, "D1 fixture helper hidden");
  assert.match(String(after.summary || ""), /Все ближайшие/, "D1 fixture other filters preserved");
  receipt.d1 = {
    fixture: "BROWSER_FIXTURE games547-d1-exact-2.0-controlled-reset",
    before,
    after,
    note: "Source controlled reset clears exact 2.0; GoBad #547 no-op report remains NOT_REPRODUCED here; parent installed-556 evidence retained separately.",
  };

  receipt.pass = true;
  receipt.status = "PASS";
});

writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, metrics: receipt.metrics.length, outDir }));
