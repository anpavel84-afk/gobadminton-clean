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
const VIEWPORTS = [390, 820, 1280, 1920];
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
  assert.match(payload.trainerTypicalHtml, /Demo Morozov Coaching Hour/);
  assert.match(payload.trainerHtml, /data-activity="trainer_led"/);
  assert.match(payload.trainerSameStringIdsHtml, /data-role="trainer"/);
  assert.match(payload.trainerSameStringIdsHtml, /data-role="organizer"/);
  assert.doesNotMatch(payload.trainerSameStringIdsHtml, /trainer-organizer/);
  assert.match(payload.trainerMissingHtml, /data-trainer-unavailable/);
  assert.doesNotMatch(payload.trainerHtml, /data-layout/);
  assert.match(payload.trainerHtml, /gb-discovery-card__people/);
  assert.match(payload.trainerTypicalHtml, /gb-discovery-card__people/);
  assert.match(payload.trainerTypicalHtml, /gb-discovery-card__actions/);
  assert.doesNotMatch(payload.trainerTypicalHtml, /gb-discovery-card__footer/);
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
const games = await readFile(new URL("../src/styles/games.css", import.meta.url), "utf8");
const cssBundle = `${consumerTokens}\n${consumer}\n${discovery}\n${roleRep}\n${games}`;
const fixtures = await ssrExactCards();

const feedHtml = [
  fixtures.regularHtml,
  fixtures.trainerTypicalHtml,
  fixtures.trainerHtml,
  fixtures.trainerSameStringIdsHtml,
  fixtures.trainerMissingHtml,
].join("");

await withChrome(async ({ call, evaluate }) => {
  for (const width of VIEWPORTS) {
    const height = width <= 390 ? 2200 : width >= 1920 ? 1800 : 1600;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 390,
    });
    const { frameTree } = await call("Page.getFrameTree");
    await call("Page.setDocumentContent", { frameId: frameTree.frame.id,
      html: pageHtml(width, feedHtml, cssBundle),
    });
    await sleep(150);

    const metrics = await evaluate(`(() => {
      const viewportWidth = ${width};
      const longTrainer = ${JSON.stringify(fixtures.longTrainerName)};
      const longOrganizer = ${JSON.stringify(fixtures.longOrganizerName)};
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const cards = [...document.querySelectorAll('.gb-discovery-card')].map((card, index) => {
        const imageSlot = card.querySelector('.gb-discovery-card__image');
        const imageEl = imageSlot?.querySelector('img') || imageSlot?.querySelector('.gb-venue-cover');
        const content = card.querySelector('.gb-discovery-card__content');
        const actions = card.querySelector('.gb-discovery-card__actions');
        const details = actions?.querySelector('.gb-c23-btn') || card.querySelector('.gb-c23-btn');
        const detailsSpan = details?.querySelector(':scope > span') || null;
        const detailsSvg = details?.querySelector('svg') || null;
        const shareBtn = actions?.querySelector('.gb-game-share__button') || null;
        const spanCs = detailsSpan ? getComputedStyle(detailsSpan) : null;
        const imgStyle = imageEl ? getComputedStyle(imageEl.tagName === 'IMG' ? imageEl : (imageEl.querySelector('img') || imageEl)) : null;
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
        const peopleHosts = [...card.querySelectorAll('.gb-discovery-card__people > .gb-discovery-host')];
        const people = peopleHosts.map(rect);
        const peopleBand = card.querySelector('.gb-discovery-card__people');
        const peopleActions = peopleBand?.querySelector(':scope > .gb-discovery-card__actions');
        const historyEl = peopleBand?.querySelector(':scope > .gb-discovery-card__history, :scope > .gb-discovery-card__band-spacer');
        const roleNameMetrics = peopleHosts.map((host) => {
          const strong = host.querySelector('strong');
          const r = strong ? rect(strong) : null;
          const cs = strong ? getComputedStyle(strong) : null;
          return {
            role: host.getAttribute('data-role'),
            text: strong?.textContent || '',
            rect: r,
            clientWidth: strong?.clientWidth ?? 0,
            clientHeight: strong?.clientHeight ?? 0,
            scrollWidth: strong?.scrollWidth ?? 0,
            scrollHeight: strong?.scrollHeight ?? 0,
            lineHeight: cs ? parseFloat(cs.lineHeight) || 0 : 0,
            whiteSpace: cs?.whiteSpace || null,
            textOverflow: cs?.textOverflow || null,
          };
        });
        const slot = rect(imageSlot);
        const image = rect(imageEl?.tagName === 'IMG' ? imageEl : (imageEl?.querySelector('img') || imageEl));
        const cardBox = rect(card);
        const peopleBandRect = peopleBand ? rect(peopleBand) : null;
        const peopleBandStyle = peopleBand ? getComputedStyle(peopleBand) : null;
        const unusedUnderPhoto = peopleBandRect && slot
          ? Math.max(0, peopleBandRect.y - slot.bottom)
          : null;
        return {
          index,
          activity: card.getAttribute('data-activity'),
          layout: card.getAttribute('data-layout'),
          card: cardBox,
          imageSlot: slot,
          image,
          content: rect(content),
          details: rect(details),
          detailsAriaLabel: details?.getAttribute('aria-label') || null,
          detailsSpanDisplay: spanCs?.display || null,
          detailsSpanVisibleText: detailsSpan ? ((detailsSpan.textContent || '').trim()) : null,
          detailsHasSvg: !!detailsSvg,
          detailsWidth: details ? Math.round(details.getBoundingClientRect().width) : null,
          detailsHeight: details ? Math.round(details.getBoundingClientRect().height) : null,
          shareWidth: shareBtn ? Math.round(shareBtn.getBoundingClientRect().width) : null,
          shareHeight: shareBtn ? Math.round(shareBtn.getBoundingClientRect().height) : null,
          strongs,
          roles,
          people,
          roleNameMetrics,
          peopleBand: peopleBandRect,
          peopleBandGridColumns: peopleBandStyle?.gridTemplateColumns || null,
          peopleActions: peopleActions ? rect(peopleActions) : null,
          history: historyEl ? rect(historyEl) : null,
          unusedUnderPhoto,
          crop: imgStyle ? { fit: imgStyle.objectFit, position: imgStyle.objectPosition } : null,
          overflowX: card.scrollWidth > card.clientWidth + 1,
          viewportWidth,
        };
      });
      return {
        cards,
        longTrainerVisible: document.body.innerText.includes(longTrainer),
        longOrganizerVisible: document.body.innerText.includes(longOrganizer),
        sourceCssHasHistorySpan: ${JSON.stringify(/\.gb-discovery-card__people\s*>\s*\.gb-discovery-card__history/.test(discovery))},
        sameStringStillSeparate: (() => {
          const same = [...document.querySelectorAll('.gb-discovery-card')].find((c) =>
            c.querySelector('[data-trainer-profile="shared-looking-id"]')
            && c.querySelector('[data-organizer-id="shared-looking-id"]'));
          if (!same) return false;
          const roles = [...same.querySelectorAll('.gb-discovery-host')].map((h) => h.getAttribute('data-role'));
          return roles.includes('trainer') && roles.includes('organizer') && !roles.includes('trainer-organizer');
        })(),
        missingTrainer: !!document.querySelector('[data-trainer-unavailable="true"]'),
        typicalPeople: !!document.querySelector('#feed .gb-discovery-card[data-activity="trainer_led"] .gb-discovery-card__people'),
      };
    })()`);

    assert.equal(metrics.cards.length, 5, `${width}: expected 5 fixture cards`);
    assert.equal(metrics.longTrainerVisible, true, `${width}: long trainer name must be in DOM text`);
    assert.equal(metrics.longOrganizerVisible, true, `${width}: long organizer name must be in DOM text`);
    assert.equal(metrics.sameStringStillSeparate, true, `${width}: coinciding id strings must stay separate roles`);
    assert.equal(metrics.missingTrainer, true, `${width}: missing trainer fixture`);
    assert.equal(metrics.typicalPeople, true, `${width}: compact people row present`);
    assert.equal(metrics.sourceCssHasHistorySpan, true, `${width}: source CSS must span history on its own row`);

    const ordinary = metrics.cards[0];
    const typical = metrics.cards[1];
    assert.ok(ordinary && typical);
    if (width <= 390) {
      assert.equal(ordinary.activity, "regular");
      assert.equal(typical.activity, "trainer_led");
      assert.ok(
        Math.abs(ordinary.detailsWidth - typical.detailsWidth) <= 1,
        `${width}: ordinary/trainer primary action widths must match (${ordinary.detailsWidth} vs ${typical.detailsWidth})`,
      );
      assert.ok(
        Math.abs(ordinary.detailsHeight - typical.detailsHeight) <= 1,
        `${width}: ordinary/trainer primary action heights must match (${ordinary.detailsHeight} vs ${typical.detailsHeight})`,
      );
    }

    // #507: role names need usable width / normal text height (reject one-character-wide vertical letters).
    for (const trainerCard of metrics.cards.filter((c) => c.activity === "trainer_led" && c.peopleBand)) {
      assert.ok(trainerCard.peopleBandGridColumns, `${width}: people band grid-template-columns present`);
      {
        // Used values are pixel tracks (not authored minmax tokens).
        const tracks = trainerCard.peopleBandGridColumns.trim().split(/\s+/).filter(Boolean);
        if (width <= 390) {
          assert.equal(
            tracks.length,
            1,
            `${width}: mobile people band stays single-column, got ${trainerCard.peopleBandGridColumns}`,
          );
        } else {
          // Author template keeps 4 tracks; empty 4th collapses when history spans its own row.
          assert.ok(
            tracks.length === 3 || tracks.length === 4,
            `${width}: desktop people band roles+actions (+optional collapsed track), got ${trainerCard.peopleBandGridColumns}`,
          );
        }
      }
      for (const name of trainerCard.roleNameMetrics || []) {
        if (!name.text || name.text.length < 4) continue;
        assert.ok(
          name.clientWidth >= 48,
          `${width}:${name.role} role name width ${name.clientWidth}px too narrow for "${name.text.slice(0, 32)}"`,
        );
        const maxNameHeight = Math.max(56, (name.lineHeight || 18) * 3 + 4);
        assert.ok(
          name.clientHeight <= maxNameHeight,
          `${width}:${name.role} role name height ${name.clientHeight}px looks vertical/stacked (max ${maxNameHeight}) for "${name.text.slice(0, 32)}"`,
        );
        assert.notEqual(name.whiteSpace, "nowrap", `${width}:${name.role} must wrap`);
        assert.notEqual(name.textOverflow, "ellipsis", `${width}:${name.role} must not ellipsis`);
      }
      if (trainerCard.history && trainerCard.people?.[0] && width > 390) {
        assert.ok(
          trainerCard.history.y + 1 >= trainerCard.people[0].bottom - 2,
          `${width}: history must sit on its own row below roles (history.y=${trainerCard.history.y}, role.bottom=${trainerCard.people[0].bottom})`,
        );
      }
      // Mobile (CSS max-width:720) stacks roles — normal 390 layout ~229px; keep desktop ≤220.
      const maxPeopleBandHeight = width <= 720 ? 240 : 220;
      assert.ok(
        trainerCard.peopleBand.height <= maxPeopleBandHeight,
        `${width}: people band height ${trainerCard.peopleBand.height} still crushed/tall (max ${maxPeopleBandHeight})`,
      );
    }

    for (const row of metrics.cards) {
      assert.equal(row.layout, null);
      assert.equal(row.overflowX, false, `${width}:${row.activity} horizontal overflow`);
      assert.ok(row.details, `${width}:${row.activity} details CTA`);
      assert.ok(row.details.bottom <= row.card.bottom + 1, `${width}:${row.activity} CTA clipped`);
      assert.ok(row.details.right <= width + 1, `${width}:${row.activity} CTA beyond viewport`);
      assert.ok(row.imageSlot && row.image, `${width}:${row.activity} image metrics`);
      assert.ok(Math.abs(row.image.width - row.imageSlot.width) <= 1, `${width}:${row.activity} img width fills slot`);
      assert.ok(Math.abs(row.image.height - row.imageSlot.height) <= 1, `${width}:${row.activity} img height fills slot`);
      if (row.crop) {
        assert.equal(row.crop.fit, "cover", `${width}:${row.activity} object-fit`);
        assert.match(row.crop.position, /50%\s*50%/, `${width}:${row.activity} object-position`);
      }
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
        assert.ok(Math.abs(row.imageSlot.height - 210) <= 1, `${width}:${row.activity} mobile image height 210`);
        assert.ok(row.imageSlot.width >= row.card.width * 0.9, `${width}:${row.activity} mobile image width`);
        assert.ok(row.content.y >= row.imageSlot.bottom - 1, `${width}:${row.activity} mobile content below image`);
        // Shared mobile CardActions: ordinary + trainer use the same 44px arrow-only primary + share.
        assert.ok(row.detailsAriaLabel && /Подробнее/.test(row.detailsAriaLabel), `${width}:${row.activity} details aria-label`);
        assert.equal(row.detailsSpanDisplay, "none", `${width}:${row.activity} Подробнее text hidden on mobile`);
        assert.equal(row.detailsHasSvg, true, `${width}:${row.activity} details keeps SVG arrow`);
        assert.ok(
          row.detailsWidth != null && Math.abs(row.detailsWidth - 44) <= 1,
          `${width}:${row.activity} details width ${row.detailsWidth} must be 44px arrow footprint`,
        );
        assert.ok(
          row.detailsHeight != null && Math.abs(row.detailsHeight - 44) <= 1,
          `${width}:${row.activity} details height ${row.detailsHeight} must be 44px`,
        );
        assert.ok(
          row.shareWidth != null && Math.abs(row.shareWidth - 44) <= 1,
          `${width}:${row.activity} share width ${row.shareWidth} must stay 44px`,
        );
        assert.ok(
          row.shareHeight != null && Math.abs(row.shareHeight - 44) <= 1,
          `${width}:${row.activity} share height ${row.shareHeight} must stay 44px`,
        );
      } else {
        assert.ok(Math.abs(row.imageSlot.width - row.imageSlot.height) <= 1, `${width}:${row.activity} desktop square slot`);
        assert.ok(Math.abs(row.image.width - row.image.height) <= 1, `${width}:${row.activity} desktop square img`);
        assert.ok(row.imageSlot.x < row.content.x, `${width}:${row.activity} image left of content`);
        assert.ok(row.imageSlot.width <= row.card.width * 0.45, `${width}:${row.activity} image not full-width banner`);
        assert.ok(row.content.x >= row.imageSlot.right - 2, `${width}:${row.activity} content starts after image`);
        if (width >= 1280) {
          // Desktop keeps visible text CTA (not icon-only).
          assert.notEqual(row.detailsSpanDisplay, "none", `${width}:${row.activity} desktop Подробнее text visible`);
          assert.ok(
            row.detailsWidth != null && row.detailsWidth > 80,
            `${width}:${row.activity} desktop details stays wide text CTA (got ${row.detailsWidth})`,
          );
        }
      }
    }

    if (width >= 1280) {
      assert.ok(Math.abs(ordinary.imageSlot.width - typical.imageSlot.width) <= 1, "regular/trainer same square crop width");
      assert.ok(Math.abs(ordinary.imageSlot.height - typical.imageSlot.height) <= 1, "regular/trainer same square crop height");
      // D2: no equal-height latch / no forced blank below photo. Compact typical grows only if needed.
      // #507: history may occupy its own row under roles — allow that dedicated line, not a crushed vertical stack.
      const delta = typical.card.height - ordinary.card.height;
      const maxDelta = width >= 1920 ? 140 : 160;
      assert.ok(
        delta <= maxDelta,
        `${width}: typical trainer must stay compact vs ordinary, delta=${delta} max=${maxDelta}`,
      );
      // Card wraps image + content; geometry nonnegative / contained (no clip). No extra-height requirement.
      assert.ok(typical.card.height >= typical.imageSlot.height - 1, `${width}: typical card must wrap image slot`);
      assert.ok(typical.content.bottom <= typical.card.bottom + 1, `${width}: typical content must stay in card`);
      assert.ok(typical.peopleBand, `${width}: typical people band`);
      assert.ok(typical.peopleActions, `${width}: typical details/share in people band`);
      assert.ok(typical.peopleBand.bottom <= typical.card.bottom + 1, `${width}: typical people band must stay in card`);
      if (typical.unusedUnderPhoto != null) {
        assert.ok(
          typical.unusedUnderPhoto <= 1,
          `${width}: typical unused gap under photo before people=${typical.unusedUnderPhoto}`,
        );
      }
      for (const person of typical.people || []) {
        assert.ok(person.width >= 0 && person.height >= 0, `${width}: typical people geometry nonnegative`);
        assert.ok(person.bottom <= typical.card.bottom + 1, `${width}: typical people must stay in card`);
      }
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
      ordinaryH: Math.round(ordinary.card.height),
      typicalH: Math.round(typical.card.height),
      slotSquare: Math.abs(ordinary.imageSlot.width - ordinary.imageSlot.height) <= 1,
      activities: metrics.cards.map((c) => ({
        activity: c.activity,
        roles: c.roles,
        imageW: Math.round(c.imageSlot.width),
        imageH: Math.round(c.imageSlot.height),
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
console.log("#521 discovery training card browser geometry OK (390 + 820 + 1280 + 1920); not Owner UAT.");
