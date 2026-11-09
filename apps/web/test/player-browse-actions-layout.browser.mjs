/* global process, console, URL, WebSocket, Buffer, setTimeout, fetch */
/** #523 desktop browse actions + #526 Players map CTA geometry via Chromium CDP.
 * Playwright unavailable here; uses /opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell.
 * Component geometry only — not DEV/Owner UAT / signed-in send / geolocation. Parent executes when Chromium missing. */
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
const PLAYERS526_VIEWPORTS = [320, 390, 1280];
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv[2] || join(tmpdir(), `gb523-526-browser-${process.pid}`);
mkdirSync(outDir, { recursive: true });

const receipt = {
  scope: "#523 desktop actions + #526 Players map CTA via owned Chromium CDP; not DEV/Owner UAT",
  chrome: CHROME,
  viewports: [...DESKTOP_VIEWPORTS, MOBILE_VIEWPORT, ...PLAYERS526_VIEWPORTS],
  shots: [],
  metrics: [],
  pass: false,
  status: "PENDING",
  signedInSend: "NOT_TESTED",
  geolocation: "NOT_TESTED",
  players526: "PENDING",
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
  assert.ok(payload.players526?.mobileRadarOnHtml?.includes("pb-finder-map-secondary"), "missing #526 mobile fixture");
  assert.ok(payload.players526?.desktopHtml?.includes("gb-players-map-cta"), "missing #526 desktop fixture");
  assert.ok(payload.players526.mobileRadarOnHtml.includes('aria-label="Игроки на карте"'));
  assert.ok(payload.players526.mobileRadarOnHtml.includes("На карте"));
  assert.ok(payload.players526.mobileRadarOnHtml.includes("Свайп"));
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

function pageHtml(width, bodyHtml, cssBundle, { wrapConsumer = true } = {}) {
  const body = wrapConsumer
    ? `<main class="gb-consumer">${bodyHtml}</main>`
    : bodyHtml;
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${width}, initial-scale=1"/>
<style>html,body{margin:0;padding:0;background:#13221a;color:#fff;overflow-x:hidden}main{padding:24px;width:${width}px;max-width:100%;box-sizing:border-box}</style>
<style>${cssBundle}</style>
</head><body>${body}</body></html>`;
}

/** Same bottom measure as PlayersDirectoryPage mobileCtaZoneRef / GamesViewAction. */
const MEASURE_FINDER_ZONE = `(() => {
  const element = document.querySelector('.pb-mobile-finder-zone');
  const nav = document.querySelector('.gb-app-shell .gb-bottom-nav') || document.querySelector('.gb-bottom-nav');
  if (!element || !nav) return { measured: false };
  const viewport = window.visualViewport;
  const navDisplayed = window.getComputedStyle(nav).display !== 'none';
  if (!navDisplayed) {
    element.style.bottom = '';
    return { measured: true, navDisplayed: false };
  }
  const bottom = Math.min(
    nav.getBoundingClientRect().top,
    (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
  );
  element.style.bottom = Math.max(0, window.innerHeight - bottom) + 'px';
  return { measured: true, navDisplayed: true, bottomPx: element.style.bottom };
})()`;

const PLAYERS526_MOBILE_METRICS = `(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, left: r.left, right: r.right };
  };
  const overlaps = (a, b) => !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
  const zone = document.querySelector('.pb-mobile-finder-zone');
  const swipe = document.querySelector('.pb-finder-cta');
  const mapAction = document.querySelector('.pb-finder-map-secondary');
  const mapLink = document.querySelector('.pb-finder-map-secondary a, .pb-finder-map-secondary button');
  const shortLabel = document.querySelector('.pb-finder-map-secondary .gb-map-cta-label--short');
  const fullLabel = document.querySelector('.pb-finder-map-secondary .gb-map-cta-label--full');
  const tile = document.querySelector('.pb-finder-map-secondary .gb-map-entry-tile');
  const group = document.querySelector('.pb-finder-map-group');
  const nav = document.querySelector('.gb-bottom-nav');
  const zr = rect(zone);
  const sr = rect(swipe);
  const mr = rect(mapAction);
  const lr = rect(mapLink);
  const nr = rect(nav);
  const shortStyle = shortLabel ? getComputedStyle(shortLabel) : null;
  const fullStyle = fullLabel ? getComputedStyle(fullLabel) : null;
  const tileStyle = tile ? getComputedStyle(tile) : null;
  return {
    hasZone: !!zone,
    hasSwipe: !!swipe,
    hasMap: !!mapAction,
    hasNav: !!nav,
    swipeLabel: (swipe?.getAttribute('aria-label') || swipe?.textContent || '').trim(),
    mapAria: (mapLink?.getAttribute('aria-label') || group?.getAttribute('aria-label') || '').trim(),
    mapHref: mapLink?.getAttribute('href') || '',
    shortVisible: !!(shortLabel && shortStyle && shortStyle.display !== 'none' && shortStyle.visibility !== 'hidden'),
    shortText: (shortLabel?.textContent || '').trim(),
    fullHidden: !fullLabel || !fullStyle || fullStyle.display === 'none',
    limeTile: !!(tile && tileStyle && tileStyle.display !== 'none'),
    limeBg: tileStyle?.backgroundColor || '',
    zone: zr,
    swipe: sr,
    map: mr,
    mapLink: lr,
    nav: nr,
    navDisplay: nav ? getComputedStyle(nav).display : 'missing',
    overlapSwipeMap: overlaps(sr, mr),
    overlapZoneNav: overlaps(zr, nr),
    mapClearOfNav: lr && nr ? lr.bottom <= nr.top + 1 : null,
    swipeClearOfNav: sr && nr ? sr.bottom <= nr.top + 1 : null,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
})()`;

const PLAYERS526_DESKTOP_METRICS = `(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, left: r.left, right: r.right };
  };
  const desktopCta = document.querySelector('.gb-players-map-cta');
  const mobileZone = document.querySelector('.pb-mobile-finder-zone');
  const mapLink = document.querySelector('.gb-players-map-cta a, .gb-players-map-cta button');
  const fullLabel = document.querySelector('.gb-players-map-cta .gb-map-cta-label--full');
  const tile = document.querySelector('.gb-players-map-cta .gb-map-entry-tile');
  const nav = document.querySelector('.gb-bottom-nav');
  const ctaStyle = desktopCta ? getComputedStyle(desktopCta) : null;
  const fullStyle = fullLabel ? getComputedStyle(fullLabel) : null;
  const tileStyle = tile ? getComputedStyle(tile) : null;
  const cr = rect(desktopCta);
  const accessibleName = (
    mapLink?.getAttribute('aria-label') ||
    (fullLabel?.textContent || '') ||
    (mapLink?.textContent || '')
  ).replace(/\\s+/g, ' ').trim();
  return {
    hasDesktopCta: !!desktopCta,
    desktopVisible: !!(desktopCta && ctaStyle && ctaStyle.display !== 'none' && cr && cr.height > 0),
    hasMobileZone: !!mobileZone,
    mobileZoneDisplay: mobileZone ? getComputedStyle(mobileZone).display : 'absent',
    mapAria: accessibleName,
    fullLabelVisible: !!(fullLabel && fullStyle && fullStyle.display !== 'none'),
    mapHref: mapLink?.getAttribute('href') || '',
    limeTile: !!(tile && tileStyle && tileStyle.display !== 'none'),
    limeBg: tileStyle?.backgroundColor || '',
    cta: cr,
    navDisplay: nav ? getComputedStyle(nav).display : 'missing',
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

if (!chromeAvailable()) {
  receipt.status = "NOT_TESTED";
  receipt.players526 = "NOT_TESTED";
  receipt.reason = `Qualified Chromium missing at ${CHROME}; parent executes helper. Geometry assertions preserved in source. Exact command: node apps/web/test/player-browse-actions-layout.browser.mjs <evidence-dir>`;
  writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({
    status: "NOT_TESTED",
    reason: receipt.reason,
    outDir,
    signedInSend: "NOT_TESTED",
    players526: "NOT_TESTED",
    command: `node apps/web/test/player-browse-actions-layout.browser.mjs ${outDir}`,
  }));
  process.exit(0);
}

const tokens = await readFile(new URL("../src/styles/consumer-tokens.css", import.meta.url), "utf8");
const foundation = await readFile(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
const radarGeo = await readFile(new URL("../src/styles/radar-geographic.css", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/styles/discovery.css", import.meta.url), "utf8");
const browse = await readFile(new URL("../src/styles/player-browse.css", import.meta.url), "utf8");
const cssBundle = `${tokens}\n${foundation}\n${radarGeo}\n${discovery}\n${browse}`;
const css523 = `${tokens}\n${browse}`;
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
    const { frameTree } = await call("Page.getFrameTree");
    await call("Page.setDocumentContent", { frameId: frameTree.frame.id, html: pageHtml(width, body, css523) });
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
    const { frameTree } = await call("Page.getFrameTree");
    await call("Page.setDocumentContent", { frameId: frameTree.frame.id,
      html: pageHtml(width, fixtures.mobileHtml, css523),
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

  // #526 Players map CTA: real GamesViewAction fixture at 320 / 390 / 1280.
  for (const width of PLAYERS526_VIEWPORTS) {
    const height = width >= 1280 ? 900 : 844;
    const mobileMode = width < 1024;
    const bodyHtml = mobileMode
      ? fixtures.players526.mobileRadarOnHtml
      : fixtures.players526.desktopHtml;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: mobileMode,
    });
    const { frameTree } = await call("Page.getFrameTree");
    await call("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: pageHtml(width, bodyHtml, cssBundle, { wrapConsumer: false }),
    });
    await sleep(150);
    if (mobileMode) {
      await evaluate(MEASURE_FINDER_ZONE);
      await sleep(50);
      const geo = await evaluate(PLAYERS526_MOBILE_METRICS);
      assert.equal(geo.hasZone, true, `${width} #526 missing finder zone`);
      assert.equal(geo.hasSwipe, true, `${width} #526 missing Свайп`);
      assert.equal(geo.hasMap, true, `${width} #526 missing map action`);
      assert.equal(geo.hasNav, true, `${width} #526 missing bottom nav`);
      assert.equal(geo.swipeLabel, "Свайп", `${width} #526 Свайп aria`);
      assert.equal(geo.mapAria, "Игроки на карте", `${width} #526 accessible map name`);
      assert.equal(geo.mapHref, "/players/radar", `${width} #526 map href`);
      assert.equal(geo.shortVisible, true, `${width} #526 «На карте» must be visible`);
      assert.equal(geo.shortText, "На карте", `${width} #526 short label text`);
      assert.equal(geo.fullHidden, true, `${width} #526 full label stays hidden on mobile`);
      assert.equal(geo.limeTile, true, `${width} #526 lime folded-map tile`);
      assert.ok(geo.navDisplay !== "none", `${width} #526 bottom nav must display on mobile`);
      assert.equal(geo.overlapSwipeMap, false, `${width} #526 Свайп/map overlap ${JSON.stringify(geo)}`);
      assert.equal(geo.overlapZoneNav, false, `${width} #526 zone/nav overlap ${JSON.stringify(geo)}`);
      assert.equal(geo.mapClearOfNav, true, `${width} #526 map must clear bottom nav`);
      assert.equal(geo.swipeClearOfNav, true, `${width} #526 Свайп must clear bottom nav`);
      assert.equal(geo.horizontalOverflow, false, `${width} #526 horizontal overflow scrollWidth=${geo.docScrollWidth}`);
      assert.ok(geo.swipe.height >= 44, `${width} #526 Свайп hit target`);
      assert.ok(geo.mapLink && geo.mapLink.height >= 44, `${width} #526 map hit target`);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const shotName = `players526-mobile-${width}.png`;
      writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
      receipt.shots.push(shotName);
      receipt.metrics.push({ width, kind: "players526-mobile", geo });
    } else {
      const geo = await evaluate(PLAYERS526_DESKTOP_METRICS);
      assert.equal(geo.hasDesktopCta, true, `${width} #526 missing desktop map CTA`);
      assert.equal(geo.desktopVisible, true, `${width} #526 desktop CTA must be visible`);
      assert.equal(geo.hasMobileZone, false, `${width} #526 must not force mobile finder overlay`);
      assert.equal(geo.mapAria, "Игроки на карте", `${width} #526 desktop accessible name`);
      assert.equal(geo.fullLabelVisible, true, `${width} #526 desktop full label visible`);
      assert.equal(geo.mapHref, "/players/radar", `${width} #526 desktop href`);
      assert.equal(geo.limeTile, true, `${width} #526 desktop lime tile`);
      assert.equal(geo.navDisplay, "none", `${width} #526 desktop bottom nav stays CSS-hidden`);
      assert.equal(geo.horizontalOverflow, false, `${width} #526 desktop overflow`);
      assert.ok(geo.cta && geo.cta.height >= 44, `${width} #526 desktop CTA geometry`);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const shotName = `players526-desktop-${width}.png`;
      writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
      receipt.shots.push(shotName);
      receipt.metrics.push({ width, kind: "players526-desktop", geo });
    }
  }
});

receipt.pass = true;
receipt.status = "GEOMETRY_PASS";
receipt.players526 = "GEOMETRY_PASS";
writeFileSync(join(outDir, "capture-receipt.json"), JSON.stringify(receipt, null, 2));
writeFileSync(join(outDir, "metrics.json"), JSON.stringify(receipt.metrics, null, 2));
console.log(JSON.stringify({
  status: receipt.status,
  pass: true,
  viewports: receipt.viewports,
  shots: receipt.shots,
  outDir,
  signedInSend: "NOT_TESTED",
  players526: receipt.players526,
  note: "component geometry only; not DEV/Owner UAT / signed-in send / geolocation",
}));
console.log("#523+#526 browser geometry OK (523: 1280/1920/390; 526: 320/390/1280); signed-in send NOT_TESTED.");
