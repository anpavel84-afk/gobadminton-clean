/* global process, console, URL, WebSocket, Buffer, setTimeout, fetch */
/** #523 desktop browse actions geometry: StableActionFooter + DesktopBrowseActionsShell via Chromium CDP.
 * Playwright unavailable here; uses /opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell.
 * Component geometry only — not DEV/Owner UAT / signed-in send. Parent executes when Chromium missing. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell";
const DESKTOP_VIEWPORTS = [1280, 1920];
const MOBILE_VIEWPORT = 390;
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv[2] || join(tmpdir(), `gb523-browser-${process.pid}`);
mkdirSync(outDir, { recursive: true });

const receipt = {
  scope: "#523 desktop actions equal-height row via owned Chromium CDP; not DEV/Owner UAT",
  chrome: CHROME,
  viewports: [...DESKTOP_VIEWPORTS, MOBILE_VIEWPORT],
  shots: [],
  metrics: [],
  pass: false,
  status: "PENDING",
  signedInSend: "NOT_TESTED",
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
  const dir = await mkdtemp(join(tmpdir(), "gb523-"));
  const out = join(dir, "out.json");
  const vitestBin = join(webRoot, "node_modules/.bin/vitest");
  const result = spawnSync(vitestBin, ["run", "test/player-browse-actions-layout.test.tsx"], {
    cwd: webRoot,
    encoding: "utf8",
    env: { ...process.env, GB523_BROWSER_FIXTURE: out },
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "vitest SSR fixture failed");
  const payload = JSON.parse(await readFile(out, "utf8"));
  assert.ok(payload.desktopStates?.ready?.includes("pb-btn-next"));
  assert.ok(payload.mobileHtml?.includes("pb-btn-skip"));
  await rm(dir, { recursive: true, force: true });
  return payload;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withChrome(run) {
  const profile = await mkdtemp(join(tmpdir(), "gb523-chrome-"));
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

function pageHtml(width, bodyHtml, cssBundle) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${width}, initial-scale=1"/>
<style>html,body{margin:0;padding:0;background:#13221a;color:#fff}main{padding:24px;width:${width}px;max-width:100%;box-sizing:border-box}</style>
<style>${cssBundle}</style>
</head><body><main class="gb-consumer">${bodyHtml}</main></body></html>`;
}

if (!chromeAvailable()) {
  receipt.status = "NOT_TESTED";
  receipt.reason = `Qualified Chromium missing at ${CHROME}; parent executes helper. Geometry assertions preserved in source.`;
  writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: "NOT_TESTED", reason: receipt.reason, outDir, signedInSend: "NOT_TESTED" }));
  process.exit(0);
}

const tokens = await readFile(new URL("../src/styles/consumer-tokens.css", import.meta.url), "utf8");
const browse = await readFile(new URL("../src/styles/player-browse.css", import.meta.url), "utf8");
const cssBundle = `${tokens}\n${browse}`;
const fixtures = await ssrFixtures();

await withChrome(async ({ call, evaluate }) => {
  for (const width of DESKTOP_VIEWPORTS) {
    const height = 900;
    const body = Object.entries(fixtures.desktopStates)
      .map(([id, html]) => `<section data-state="${id}" style="margin-bottom:28px">${html}</section>`)
      .join("");
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.setDocumentContent", { html: pageHtml(width, body, cssBundle) });
    await sleep(150);

    const metrics = await evaluate(`(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, left: r.left, right: r.right };
      };
      return [...document.querySelectorAll('section[data-state]')].map((section) => {
        const root = section.querySelector('.gb-player-browse');
        const primary = section.querySelector('.pb-main-actions--desktop .pb-btn-request, .pb-main-actions--desktop .pb-btn-withdraw, .pb-main-actions--desktop .btn, .pb-main-actions--desktop button');
        const next = section.querySelector('.pb-btn-next');
        const status = section.querySelector('.pb-action-status');
        const caption = section.querySelector('.pb-action-caption');
        const primaryBox = section.querySelector('.pb-main-actions--desktop');
        const pr = rect(primary || primaryBox);
        const nr = rect(next);
        const sr = rect(status);
        return {
          state: section.getAttribute('data-state'),
          primary: pr,
          next: nr,
          status: sr,
          captionVisible: !!(caption && (caption.textContent || '').trim()),
          primaryOverflow: primary ? primary.scrollWidth > primary.clientWidth + 1 : false,
          nextOverflow: next ? next.scrollWidth > next.clientWidth + 1 : false,
          equalTop: pr && nr ? Math.abs(pr.top - nr.top) <= 1 : null,
          equalBottom: pr && nr ? Math.abs(pr.bottom - nr.bottom) <= 1 : null,
          equalHeight: pr && nr ? Math.abs(pr.height - nr.height) <= 1 : null,
          statusAboveButtons: sr && pr ? sr.bottom <= pr.top + 1 : null,
          nextNotTallerThanPrimaryAlone: pr && nr && sr ? nr.height <= pr.height + 1 : null,
          hasPrimary: !!primary,
        };
      });
    })()`);

    for (const row of metrics) {
      assert.ok(row.next, `${width}:${row.state} missing Next`);
      assert.ok(row.status, `${width}:${row.state} missing status`);
      assert.equal(row.captionVisible, true, `${width}:${row.state} caption`);
      assert.equal(row.nextOverflow, false, `${width}:${row.state} Next clipped`);
      if (row.hasPrimary) {
        assert.equal(row.equalTop, true, `${width}:${row.state} top mismatch ${JSON.stringify(row)}`);
        assert.equal(row.equalBottom, true, `${width}:${row.state} bottom mismatch ${JSON.stringify(row)}`);
        assert.equal(row.equalHeight, true, `${width}:${row.state} height mismatch ${JSON.stringify(row)}`);
        assert.equal(row.statusAboveButtons, true, `${width}:${row.state} status must stay above buttons`);
        assert.equal(row.nextNotTallerThanPrimaryAlone, true, `${width}:${row.state} Next must not grow with status`);
        assert.equal(row.primaryOverflow, false, `${width}:${row.state} primary clipped`);
        assert.ok(row.primary.height >= 47, `${width}:${row.state} primary min geometry`);
        assert.ok(row.next.height >= 47, `${width}:${row.state} next min geometry`);
      }
    }

    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const shotName = `actions-desktop-${width}.png`;
    writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
    receipt.shots.push(shotName);
    receipt.metrics.push({ width, kind: "desktop", rows: metrics });
  }

  // Natural 390: mobile footer geometry preserved (Skip + primary), not desktop stretch path.
  {
    const width = MOBILE_VIEWPORT;
    const height = 844;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await call("Page.setDocumentContent", {
      html: pageHtml(width, fixtures.mobileHtml, cssBundle),
    });
    await sleep(150);
    const mobile = await evaluate(`(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
      };
      const skip = document.querySelector('.pb-btn-skip');
      const primary = document.querySelector('.pb-btn-request');
      const next = document.querySelector('.pb-btn-next');
      return {
        skip: rect(skip),
        primary: rect(primary),
        hasDesktopNext: !!next,
        equalHeight: skip && primary ? Math.abs(skip.getBoundingClientRect().height - primary.getBoundingClientRect().height) <= 2 : false,
      };
    })()`);
    assert.equal(mobile.hasDesktopNext, false, "390 mobile fixture must not mount desktop Next");
    assert.ok(mobile.skip && mobile.primary, "390 mobile skip+primary");
    assert.ok(mobile.skip.height >= 44, "390 skip hit target");
    assert.ok(mobile.primary.height >= 44, "390 primary hit target");
    assert.equal(mobile.equalHeight, true, "390 skip/primary shared baseline");
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const shotName = `actions-mobile-${width}.png`;
    writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
    receipt.shots.push(shotName);
    receipt.metrics.push({ width, kind: "mobile", mobile });
  }
});

receipt.pass = true;
receipt.status = "GEOMETRY_PASS";
writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
writeFileSync(join(outDir, "metrics.json"), JSON.stringify(receipt.metrics, null, 2));
console.log(JSON.stringify({
  status: receipt.status,
  pass: true,
  viewports: receipt.viewports,
  shots: receipt.shots,
  outDir,
  signedInSend: "NOT_TESTED",
  note: "component geometry only; not DEV/Owner UAT / signed-in send",
}));
console.log("#523 desktop actions browser geometry OK (1280 + 1920 + mobile 390); signed-in send NOT_TESTED.");
