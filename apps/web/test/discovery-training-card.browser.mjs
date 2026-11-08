/* global process, console, URL, WebSocket, Buffer, setTimeout, fetch */
/** #521 discovery card geometry: exact DiscoveryGameCard SSR + live CSS via qualified Chromium CDP.
 * Playwright unavailable here; uses /opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell.
 * Component geometry only — not Owner UAT / DEV claim. Parent executes when Chromium missing. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell";
const VIEWPORTS = [390, 820, 1280];
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv[2] || join(tmpdir(), `gb521-browser-${process.pid}`);
mkdirSync(outDir, { recursive: true });

const receipt = {
  scope: "#521 DiscoveryGameCard SSR+CSS geometry via owned Chromium CDP; not DEV/Owner UAT",
  chrome: CHROME,
  viewports: VIEWPORTS,
  shots: [],
  metrics: [],
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

async function ssrExactCards() {
  const dir = await mkdtemp(join(tmpdir(), "gb521-"));
  const out = join(dir, "out.json");
  const vitestBin = join(webRoot, "node_modules/.bin/vitest");
  const result = spawnSync(vitestBin, ["run", "test/discovery-training-card.test.tsx"], {
    cwd: webRoot,
    encoding: "utf8",
    env: { ...process.env, GB521_BROWSER_FIXTURE: out },
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "vitest SSR fixture failed");
  const payload = JSON.parse(await readFile(out, "utf8"));
  assert.match(payload.regularHtml, /gb-discovery-card/);
  assert.match(payload.trainerHtml, /data-activity="trainer_led"/);
  assert.match(payload.trainerSameStringIdsHtml, /data-role="trainer"/);
  assert.match(payload.trainerSameStringIdsHtml, /data-role="organizer"/);
  assert.doesNotMatch(payload.trainerSameStringIdsHtml, /trainer-organizer/);
  assert.match(payload.trainerMissingHtml, /data-trainer-unavailable/);
  assert.doesNotMatch(payload.trainerHtml, /data-layout/);
  await rm(dir, { recursive: true, force: true });
  return payload;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withChrome(run) {
  const profile = await mkdtemp(join(tmpdir(), "gb521-chrome-"));
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
        // Abort all network asset GETs for isolated fixture; no cookies/live auth/writes.
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

function pageHtml(width, cardsHtml, cssBundle) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${width}, initial-scale=1"/>
<style>html,body{margin:0;padding:0;background:#f4f6f1}main.gb-consumer{padding:16px;width:${width}px;max-width:100%;box-sizing:border-box}</style>
<style>${cssBundle}</style>
</head><body><main class="gb-consumer"><div class="gb-discovery-cards" id="feed">${cardsHtml}</div></main></body></html>`;
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
const roleRep = await readFile(new URL("../src/styles/role-reputation.css", import.meta.url), "utf8");
const cssBundle = `${consumerTokens}\n${consumer}\n${discovery}\n${roleRep}`;
const fixtures = await ssrExactCards();

const feedHtml = [
  fixtures.regularHtml,
  fixtures.trainerHtml,
  fixtures.trainerSameStringIdsHtml,
  fixtures.trainerMissingHtml,
].join("");

await withChrome(async ({ call, evaluate }) => {
  for (const width of VIEWPORTS) {
    const height = width <= 390 ? 1600 : 1400;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 390,
    });
    await call("Page.setDocumentContent", {
      html: pageHtml(width, feedHtml, cssBundle),
    });
    await sleep(150);

    // Append an extra reputation block (loaded-reputation resize path) on the distinct trainer card.
    await evaluate(`(() => {
      const content = document.querySelector('#feed .gb-discovery-card[data-activity="trainer_led"] .gb-discovery-card__content');
      if (!content) throw new Error('trainer content missing');
      const extra = document.createElement('div');
      extra.className = 'gb-role-rep-footer';
      extra.setAttribute('data-browser-append', '1');
      extra.innerHTML = "<span>3 проведённые игры по подтверждённой истории. История может быть неполной</span><button type='button'>Отзывы об организации · 2</button>";
      content.append(extra);
      window.dispatchEvent(new Event('resize'));
      return true;
    })()`);

    // Force a viewport resize pulse after reputation append.
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: height + 40,
      deviceScaleFactor: 1,
      mobile: width <= 390,
    });
    await sleep(80);
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 390,
    });
    await sleep(80);

    const metrics = await evaluate(`(() => {
      const viewportWidth = ${width};
      const longTrainer = ${JSON.stringify(fixtures.longTrainerName)};
      const longOrganizer = ${JSON.stringify(fixtures.longOrganizerName)};
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const cards = [...document.querySelectorAll('.gb-discovery-card')].map((card) => {
        const image = card.querySelector('.gb-discovery-card__image');
        const content = card.querySelector('.gb-discovery-card__content');
        const details = card.querySelector('.gb-c23-btn');
        const strongs = [...card.querySelectorAll('.gb-discovery-host strong')].map((s) => ({
          text: s.textContent || '',
          rect: rect(s),
          scrollWidth: s.scrollWidth,
          clientWidth: s.clientWidth,
          whiteSpace: getComputedStyle(s).whiteSpace,
          textOverflow: getComputedStyle(s).textOverflow,
          overflowWrap: getComputedStyle(s).overflowWrap,
        }));
        const roles = [...card.querySelectorAll('.gb-discovery-host')].map((h) => h.getAttribute('data-role'));
        return {
          activity: card.getAttribute('data-activity'),
          layout: card.getAttribute('data-layout'),
          card: rect(card),
          image: rect(image),
          content: rect(content),
          details: rect(details),
          strongs,
          roles,
          overflowX: card.scrollWidth > card.clientWidth + 1,
          viewportWidth,
        };
      });
      return {
        cards,
        longTrainerVisible: document.body.innerText.includes(longTrainer),
        longOrganizerVisible: document.body.innerText.includes(longOrganizer),
        sameStringStillSeparate: (() => {
          const same = [...document.querySelectorAll('.gb-discovery-card')].find((c) =>
            c.querySelector('[data-trainer-profile="shared-looking-id"]')
            && c.querySelector('[data-organizer-id="shared-looking-id"]'));
          if (!same) return false;
          const roles = [...same.querySelectorAll('.gb-discovery-host')].map((h) => h.getAttribute('data-role'));
          return roles.includes('trainer') && roles.includes('organizer') && !roles.includes('trainer-organizer');
        })(),
        missingTrainer: !!document.querySelector('[data-trainer-unavailable="true"]'),
        appendedReputation: !!document.querySelector('[data-browser-append="1"]'),
      };
    })()`);

    assert.equal(metrics.cards.length, 4, `${width}: expected 4 fixture cards`);
    assert.equal(metrics.longTrainerVisible, true, `${width}: long trainer name must be in DOM text`);
    assert.equal(metrics.longOrganizerVisible, true, `${width}: long organizer name must be in DOM text`);
    assert.equal(metrics.sameStringStillSeparate, true, `${width}: coinciding id strings must stay separate roles`);
    assert.equal(metrics.missingTrainer, true, `${width}: missing trainer fixture`);
    assert.equal(metrics.appendedReputation, true, `${width}: reputation append`);

    for (const row of metrics.cards) {
      assert.equal(row.layout, null);
      assert.equal(row.overflowX, false, `${width}:${row.activity} horizontal overflow`);
      assert.ok(row.details, `${width}:${row.activity} details CTA`);
      assert.ok(row.details.bottom <= row.card.bottom + 1, `${width}:${row.activity} CTA clipped`);
      assert.ok(row.details.right <= width + 1, `${width}:${row.activity} CTA beyond viewport`);
      for (const s of row.strongs) {
        assert.notEqual(s.whiteSpace, "nowrap", `${width}: strong must wrap, got ${s.whiteSpace}`);
        assert.notEqual(s.textOverflow, "ellipsis", `${width}: strong must not ellipsis`);
        if (s.text.length > 24) {
          assert.ok(
            s.scrollWidth <= s.clientWidth + 2 || s.rect.height > 18,
            `${width}: long name should wrap or fit: ${s.text.slice(0, 40)}`,
          );
        }
      }
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
      const regular = metrics.cards.find((c) => c.activity === "regular");
      const training = metrics.cards.find((c) => c.activity === "trainer_led");
      assert.ok(regular && training);
      assert.ok(training.image.width <= regular.image.width + 8, "trainer image must stay compact vs ordinary");
      assert.ok(training.content.x >= training.image.right - 2);
    }

    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const shotName = `geometry-${width}.png`;
    writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
    receipt.shots.push(shotName);
    receipt.metrics.push({ width, summary: {
      cardCount: metrics.cards.length,
      longTrainerVisible: metrics.longTrainerVisible,
      longOrganizerVisible: metrics.longOrganizerVisible,
      sameStringStillSeparate: metrics.sameStringStillSeparate,
      missingTrainer: metrics.missingTrainer,
      appendedReputation: metrics.appendedReputation,
      activities: metrics.cards.map((c) => ({
        activity: c.activity,
        roles: c.roles,
        imageW: Math.round(c.image.width),
        contentX: Math.round(c.content.x),
        detailsBottom: Math.round(c.details.bottom),
        cardBottom: Math.round(c.card.bottom),
        overflowX: c.overflowX,
      })),
    } });
  }
});

receipt.pass = true;
receipt.status = "GEOMETRY_PASS";
writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
writeFileSync(join(outDir, "metrics.json"), JSON.stringify(receipt.metrics, null, 2));
console.log(JSON.stringify({
  status: receipt.status,
  pass: true,
  viewports: VIEWPORTS,
  shots: receipt.shots,
  outDir,
  note: "component geometry only; not DEV/Owner UAT",
}));
console.log("#521 discovery training card browser geometry OK (390 + 820 + 1280); not Owner UAT.");
