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
  assert.match(payload.trainerTypicalHtml, /gb-discovery-card__people-summary/);
  assert.match(payload.trainerTypicalHtml, /gb-discovery-card__disclosure/);
  assert.match(payload.trainerTypicalHtml, /gb-discovery-card__actions/);
  assert.match(payload.trainerTypicalHtml, /aria-expanded="false"/);
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

    const measureExpression = `(() => {
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
        const peopleBand = card.querySelector('.gb-discovery-card__people');
        const peopleSummary = peopleBand?.querySelector('.gb-discovery-card__people-summary');
        const actions = peopleSummary?.querySelector(':scope > .gb-discovery-card__actions')
          || card.querySelector('.gb-discovery-card__actions');
        const details = actions?.querySelector('.gb-c23-btn') || card.querySelector('.gb-c23-btn');
        const detailsSpan = details?.querySelector(':scope > span') || null;
        // Product DiscoveryIcon is an accessible <img src="/discovery/arrow.svg">, not inline <svg>.
        const detailsArrowImg = details?.querySelector('img.gb-discovery-icon[src*="arrow.svg"], img[src="/discovery/arrow.svg"]') || null;
        const shareBtn = actions?.querySelector('.gb-game-share__button') || null;
        const disclosure = peopleSummary?.querySelector(':scope > .gb-discovery-card__disclosure') || null;
        const roleDetails = peopleBand?.querySelector('.gb-discovery-card__role-details') || null;
        const historyEl = roleDetails && !roleDetails.hidden
          ? roleDetails.querySelector('.gb-discovery-card__history')
          : null;
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
        const peopleHosts = [...(peopleSummary?.querySelectorAll(':scope > .gb-discovery-host') || [])];
        const people = peopleHosts.map(rect);
        const summaryStyle = peopleSummary ? getComputedStyle(peopleSummary) : null;
        const roleNameMetrics = peopleHosts.map((host) => {
          const strong = host.querySelector('strong');
          const r = strong ? rect(strong) : null;
          const cs = strong ? getComputedStyle(strong) : null;
          return {
            role: host.getAttribute('data-role'),
            text: strong?.textContent || '',
            rect: r,
            // Inline <strong> often reports clientWidth 0; use bounding rect for readable-name geometry.
            nameWidth: r ? r.width : 0,
            nameHeight: r ? r.height : 0,
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
        const peopleSummaryRect = peopleSummary ? rect(peopleSummary) : null;
        const peopleBandStyle = peopleBand ? getComputedStyle(peopleBand) : null;
        const unusedUnderPhoto = peopleBandRect && slot
          ? Math.max(0, peopleBandRect.y - slot.bottom)
          : null;
        const visibleControls = [...card.querySelectorAll('a,button')].filter((el) => el.getClientRects().length > 0);
        const summaryChildren = peopleSummary
          ? [...peopleSummary.children].filter((el) => el.getClientRects().length > 0)
          : [];
        const summaryChildHeights = summaryChildren.map((el) => Math.round(el.getBoundingClientRect().height));
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
          detailsHasArrowImg: !!detailsArrowImg,
          detailsArrowSrc: detailsArrowImg?.getAttribute('src') || null,
          detailsWidth: details ? Math.round(details.getBoundingClientRect().width) : null,
          detailsHeight: details ? Math.round(details.getBoundingClientRect().height) : null,
          shareWidth: shareBtn ? Math.round(shareBtn.getBoundingClientRect().width) : null,
          shareHeight: shareBtn ? Math.round(shareBtn.getBoundingClientRect().height) : null,
          disclosure: disclosure ? {
            ...rect(disclosure),
            ariaExpanded: disclosure.getAttribute('aria-expanded'),
            width: Math.round(disclosure.getBoundingClientRect().width),
            height: Math.round(disclosure.getBoundingClientRect().height),
          } : null,
          roleDetailsHidden: roleDetails ? !!roleDetails.hidden : null,
          strongs,
          roles,
          people,
          roleNameMetrics,
          peopleBand: peopleBandRect,
          peopleSummary: peopleSummaryRect,
          peopleBandGridColumns: summaryStyle?.gridTemplateColumns || null,
          peopleBandPaddingTop: peopleBandStyle ? parseFloat(peopleBandStyle.paddingTop) || 0 : null,
          peopleBandPaddingBottom: peopleBandStyle ? parseFloat(peopleBandStyle.paddingBottom) || 0 : null,
          peopleBandBorderTop: peopleBandStyle ? parseFloat(peopleBandStyle.borderTopWidth) || 0 : null,
          peopleSummaryGap: summaryStyle ? parseFloat(summaryStyle.rowGap || summaryStyle.gap) || 0 : null,
          peopleSummaryChildCount: summaryChildren.length,
          peopleSummaryChildHeights: summaryChildHeights,
          peopleActions: actions ? rect(actions) : null,
          history: historyEl ? rect(historyEl) : null,
          unusedUnderPhoto,
          crop: imgStyle ? { fit: imgStyle.objectFit, position: imgStyle.objectPosition } : null,
          overflowX: card.scrollWidth > card.clientWidth + 1,
          controlsOverflow: visibleControls.some((el) => {
            const r = el.getBoundingClientRect();
            return r.right > cardBox.right + 1 || r.bottom > cardBox.bottom + 1 || r.x < cardBox.x - 1;
          }),
          viewportWidth,
        };
      });
      return {
        cards,
        longTrainerVisible: document.body.innerText.includes(longTrainer),
        longOrganizerVisible: document.body.innerText.includes(longOrganizer),
        sourceCssHasPeopleSummary: ${JSON.stringify(/\.gb-discovery-card__people-summary/.test(discovery))},
        sourceCssHasDisclosure: ${JSON.stringify(/\.gb-discovery-card__disclosure/.test(discovery))},
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
    })()`;

    const assertViewportMetrics = (metrics, { expanded }) => {
    const state = expanded ? "expanded" : "collapsed";

    assert.equal(metrics.cards.length, 5, `${width}/${state}: expected 5 fixture cards`);
    assert.equal(metrics.longTrainerVisible, true, `${width}/${state}: long trainer name must be in DOM text`);
    assert.equal(metrics.longOrganizerVisible, true, `${width}/${state}: long organizer name must be in DOM text`);
    assert.equal(metrics.sameStringStillSeparate, true, `${width}/${state}: coinciding id strings must stay separate roles`);
    assert.equal(metrics.missingTrainer, true, `${width}/${state}: missing trainer fixture`);
    assert.equal(metrics.typicalPeople, true, `${width}/${state}: compact people row present`);
    assert.equal(metrics.sourceCssHasPeopleSummary, true, `${width}/${state}: source CSS people-summary present`);
    assert.equal(metrics.sourceCssHasDisclosure, true, `${width}/${state}: source CSS disclosure present`);

    const ordinary = metrics.cards[0];
    const typical = metrics.cards[1];
    assert.ok(ordinary && typical);
    if (width <= 390) {
      assert.equal(ordinary.activity, "regular");
      assert.equal(typical.activity, "trainer_led");
      assert.ok(
        Math.abs(ordinary.detailsWidth - typical.detailsWidth) <= 1,
        `${width}/${state}: ordinary/trainer primary action widths must match (${ordinary.detailsWidth} vs ${typical.detailsWidth})`,
      );
      assert.ok(
        Math.abs(ordinary.detailsHeight - typical.detailsHeight) <= 1,
        `${width}/${state}: ordinary/trainer primary action heights must match (${ordinary.detailsHeight} vs ${typical.detailsHeight})`,
      );
    }

    // #521 R3: role names need usable width / normal text height (reject one-character-wide vertical letters).
    for (const trainerCard of metrics.cards.filter((c) => c.activity === "trainer_led" && c.peopleBand)) {
      assert.ok(trainerCard.disclosure, `${width}/${state}: disclosure control present`);
      assert.equal(
        trainerCard.disclosure.ariaExpanded,
        expanded ? "true" : "false",
        `${width}/${state}: disclosure aria-expanded`,
      );
      assert.ok(
        trainerCard.disclosure.width >= 44 && trainerCard.disclosure.height >= 44,
        `${width}/${state}: disclosure target >=44px (got ${trainerCard.disclosure.width}x${trainerCard.disclosure.height})`,
      );
      assert.equal(
        trainerCard.roleDetailsHidden,
        !expanded,
        `${width}/${state}: role-details hidden=${!expanded}`,
      );
      assert.ok(trainerCard.peopleBandGridColumns, `${width}/${state}: people-summary grid-template-columns present`);
      {
        // Used values are pixel tracks (not authored minmax tokens).
        const tracks = trainerCard.peopleBandGridColumns.trim().split(/\s+/).filter(Boolean);
        if (width <= 390) {
          assert.equal(
            tracks.length,
            1,
            `${width}/${state}: mobile people-summary stays single-column, got ${trainerCard.peopleBandGridColumns}`,
          );
        } else {
          assert.ok(
            tracks.length === 3 || tracks.length === 4,
            `${width}/${state}: desktop people-summary roles+disclosure+actions, got ${trainerCard.peopleBandGridColumns}`,
          );
        }
      }
      // Owner #521 footer order: disclosure precedes details/share in visual reading order;
      // details/share sit at the people-summary right edge (ordinary card action alignment).
      if (trainerCard.disclosure && trainerCard.peopleActions && trainerCard.peopleSummary) {
        if (width <= 390) {
          assert.ok(
            trainerCard.disclosure.y + trainerCard.disclosure.height <= trainerCard.peopleActions.y + 2,
            `${width}/${state}: mobile disclosure must stack above details/share (disclosure.bottom=${trainerCard.disclosure.y + trainerCard.disclosure.height}, actions.y=${trainerCard.peopleActions.y})`,
          );
        } else {
          assert.ok(
            trainerCard.disclosure.x + trainerCard.disclosure.width <= trainerCard.peopleActions.x + 2,
            `${width}/${state}: disclosure must precede details/share horizontally (disclosure.right=${trainerCard.disclosure.x + trainerCard.disclosure.width}, actions.x=${trainerCard.peopleActions.x})`,
          );
          assert.ok(
            Math.abs(trainerCard.peopleActions.right - trainerCard.peopleSummary.right) <= 2,
            `${width}/${state}: details/share must sit at people-summary right edge (actions.right=${trainerCard.peopleActions.right}, summary.right=${trainerCard.peopleSummary.right})`,
          );
        }
      }
      for (const name of trainerCard.roleNameMetrics || []) {
        if (!name.text || name.text.length < 4) continue;
        const measuredWidth = name.nameWidth ?? name.rect?.width ?? 0;
        const measuredHeight = name.nameHeight ?? name.rect?.height ?? 0;
        assert.ok(
          measuredWidth >= 48,
          `${width}/${state}:${name.role} role name width ${measuredWidth}px too narrow for "${name.text.slice(0, 32)}"`,
        );
        if (name.text.length <= 40) {
          const maxNameHeight = Math.max(56, (name.lineHeight || 18) * 3 + 4);
          assert.ok(
            measuredHeight <= maxNameHeight,
            `${width}/${state}:${name.role} role name height ${measuredHeight}px looks vertical/stacked (max ${maxNameHeight}) for "${name.text.slice(0, 32)}"`,
          );
        }
        assert.notEqual(name.whiteSpace, "nowrap", `${width}/${state}:${name.role} must wrap`);
        assert.notEqual(name.textOverflow, "ellipsis", `${width}/${state}:${name.role} must not ellipsis`);
        if (name.rect && trainerCard.peopleSummary) {
          assert.ok(
            name.rect.right <= trainerCard.peopleSummary.right + 1,
            `${width}/${state}:${name.role} name rect.right ${name.rect.right} outside people-summary`,
          );
        }
      }
      if (expanded && trainerCard.history && trainerCard.people?.[0] && width > 390) {
        assert.ok(
          trainerCard.history.y + 1 >= trainerCard.people[0].bottom - 2,
          `${width}/${state}: history must sit below roles (history.y=${trainerCard.history.y}, role.bottom=${trainerCard.people[0].bottom})`,
        );
        assert.ok(
          trainerCard.history.width >= trainerCard.peopleBand.width * 0.45,
          `${width}/${state}: history should use a full row under roles`,
        );
      }
      if (!expanded) {
        assert.equal(trainerCard.history, null, `${width}/${state}: history hidden while collapsed`);
      }
      assert.ok(
        trainerCard.peopleBand.bottom <= trainerCard.card.bottom + 1,
        `${width}/${state}: people band must stay inside card`,
      );
      assert.equal(trainerCard.controlsOverflow, false, `${width}/${state}: controls must stay in card`);
      const hasLongRoleName = (trainerCard.roleNameMetrics || []).some((n) => (n.text || "").length > 40);
      if (!hasLongRoleName && !expanded) {
        // Collapsed summary only — mobile stacks; desktop stays compact.
        const maxPeopleBandHeight = width <= 720 ? 240 : 180;
        assert.ok(
          trainerCard.peopleBand.height <= maxPeopleBandHeight,
          `${width}/${state}: collapsed people band height ${trainerCard.peopleBand.height} too tall (max ${maxPeopleBandHeight})`,
        );
        if (width <= 390) {
          // Regression: four 44px rows + gaps + vertical pad + border must stay under the same strict 240.
          assert.equal(
            trainerCard.peopleSummaryChildCount,
            4,
            `${width}/${state}: collapsed mobile summary must stack 4 rows (roles+disclosure+actions)`,
          );
          for (const h of trainerCard.peopleSummaryChildHeights || []) {
            assert.ok(
              h >= 44,
              `${width}/${state}: collapsed mobile summary child height ${h} must keep ≥44px target`,
            );
          }
          const padY =
            (trainerCard.peopleBandPaddingTop ?? 0) + (trainerCard.peopleBandPaddingBottom ?? 0);
          const gapY = trainerCard.peopleSummaryGap ?? 0;
          const borderY = trainerCard.peopleBandBorderTop ?? 0;
          const stack =
            44 * 4 + gapY * 3 + padY + borderY;
          assert.ok(
            stack <= maxPeopleBandHeight,
            `${width}/${state}: authored mobile spacing stack ${stack} (padY=${padY}, gap=${gapY}, border=${borderY}) exceeds max ${maxPeopleBandHeight}`,
          );
          assert.ok(
            trainerCard.peopleBand.height <= stack + 1,
            `${width}/${state}: measured peopleBand.height ${trainerCard.peopleBand.height} exceeds authored stack ${stack}`,
          );
        }
      }
    }

    for (const row of metrics.cards) {
      assert.equal(row.layout, null);
      assert.equal(row.overflowX, false, `${width}/${state}:${row.activity} horizontal overflow`);
      assert.ok(row.details, `${width}/${state}:${row.activity} details CTA`);
      assert.ok(row.details.bottom <= row.card.bottom + 1, `${width}/${state}:${row.activity} CTA clipped`);
      assert.ok(row.details.right <= width + 1, `${width}/${state}:${row.activity} CTA beyond viewport`);
      assert.ok(row.imageSlot && row.image, `${width}/${state}:${row.activity} image metrics`);
      assert.ok(Math.abs(row.image.width - row.imageSlot.width) <= 1, `${width}/${state}:${row.activity} img width fills slot`);
      assert.ok(Math.abs(row.image.height - row.imageSlot.height) <= 1, `${width}/${state}:${row.activity} img height fills slot`);
      if (row.crop) {
        assert.equal(row.crop.fit, "cover", `${width}/${state}:${row.activity} object-fit`);
        assert.match(row.crop.position, /50%\s*50%/, `${width}/${state}:${row.activity} object-position`);
      }
      for (const s of row.strongs) {
        assert.notEqual(s.whiteSpace, "nowrap", `${width}/${state}: strong must wrap, got ${s.whiteSpace}`);
        assert.notEqual(s.textOverflow, "ellipsis", `${width}/${state}: strong must not ellipsis`);
        if (s.text.length > 24) {
          const fittedWidth = s.rect?.width ?? s.clientWidth;
          assert.ok(
            s.scrollWidth <= fittedWidth + 2 || s.rect.height > 18,
            `${width}/${state}: long name should wrap or fit: ${s.text.slice(0, 40)}`,
          );
        }
      }
      if (width <= 390) {
        assert.ok(Math.abs(row.imageSlot.height - 210) <= 1, `${width}/${state}:${row.activity} mobile image height 210`);
        assert.ok(row.imageSlot.width >= row.card.width * 0.9, `${width}/${state}:${row.activity} mobile image width`);
        assert.ok(row.content.y >= row.imageSlot.bottom - 1, `${width}/${state}:${row.activity} mobile content below image`);
        assert.ok(row.detailsAriaLabel && /Подробнее/.test(row.detailsAriaLabel), `${width}/${state}:${row.activity} details aria-label`);
        assert.equal(row.detailsSpanDisplay, "none", `${width}/${state}:${row.activity} Подробнее text hidden on mobile`);
        assert.equal(row.detailsHasArrowImg, true, `${width}/${state}:${row.activity} details keeps discovery arrow image asset`);
        assert.match(
          row.detailsArrowSrc || "",
          /\/discovery\/arrow\.svg$/,
          `${width}/${state}:${row.activity} details arrow src must be /discovery/arrow.svg (got ${row.detailsArrowSrc})`,
        );
        assert.ok(
          row.detailsWidth != null && Math.abs(row.detailsWidth - 44) <= 1,
          `${width}/${state}:${row.activity} details width ${row.detailsWidth} must be 44px arrow footprint`,
        );
        assert.ok(
          row.detailsHeight != null && Math.abs(row.detailsHeight - 44) <= 1,
          `${width}/${state}:${row.activity} details height ${row.detailsHeight} must be 44px`,
        );
        assert.ok(
          row.shareWidth != null && Math.abs(row.shareWidth - 44) <= 1,
          `${width}/${state}:${row.activity} share width ${row.shareWidth} must stay 44px`,
        );
        assert.ok(
          row.shareHeight != null && Math.abs(row.shareHeight - 44) <= 1,
          `${width}/${state}:${row.activity} share height ${row.shareHeight} must stay 44px`,
        );
      } else {
        assert.ok(Math.abs(row.imageSlot.width - row.imageSlot.height) <= 1, `${width}/${state}:${row.activity} desktop square slot`);
        assert.ok(Math.abs(row.image.width - row.image.height) <= 1, `${width}/${state}:${row.activity} desktop square img`);
        assert.ok(row.imageSlot.x < row.content.x, `${width}/${state}:${row.activity} image left of content`);
        assert.ok(row.imageSlot.width <= row.card.width * 0.45, `${width}/${state}:${row.activity} image not full-width banner`);
        assert.ok(row.content.x >= row.imageSlot.right - 2, `${width}/${state}:${row.activity} content starts after image`);
        if (width >= 1280) {
          assert.notEqual(row.detailsSpanDisplay, "none", `${width}/${state}:${row.activity} desktop Подробнее text visible`);
          assert.ok(
            row.detailsWidth != null && row.detailsWidth > 80,
            `${width}/${state}:${row.activity} desktop details stays wide text CTA (got ${row.detailsWidth})`,
          );
        }
      }
    }

    if (width >= 820 && !expanded) {
      assert.ok(typical.peopleBand, `${width}/${state}: typical people band`);
      assert.ok(typical.peopleActions, `${width}/${state}: typical details/share in people-summary`);
      assert.ok(typical.peopleBand.bottom <= typical.card.bottom + 1, `${width}/${state}: typical people band must stay in card`);
      if (typical.unusedUnderPhoto != null) {
        assert.ok(
          typical.unusedUnderPhoto <= 1,
          `${width}/${state}: typical unused gap under photo before people=${typical.unusedUnderPhoto}`,
        );
      }
      // Ordinary host actions and trainer people-band actions share the same card right-edge family.
      assert.ok(ordinary.peopleActions, `${width}/${state}: ordinary details/share actions present`);
      assert.ok(
        Math.abs(ordinary.peopleActions.right - typical.peopleActions.right) <= 2,
        `${width}/${state}: trainer details/share right edge must match ordinary actions (ordinary=${ordinary.peopleActions.right}, trainer=${typical.peopleActions.right})`,
      );
    }

    if (width >= 1280 && !expanded) {
      assert.ok(Math.abs(ordinary.imageSlot.width - typical.imageSlot.width) <= 1, "regular/trainer same square crop width");
      assert.ok(Math.abs(ordinary.imageSlot.height - typical.imageSlot.height) <= 1, "regular/trainer same square crop height");
      const delta = typical.card.height - ordinary.card.height;
      const maxDelta = width >= 1920 ? 120 : 140;
      assert.ok(
        delta <= maxDelta,
        `${width}/${state}: collapsed typical trainer must stay compact vs ordinary, delta=${delta} max=${maxDelta}`,
      );
      assert.ok(typical.card.height >= typical.imageSlot.height - 1, `${width}/${state}: typical card must wrap image slot`);
      assert.ok(typical.content.bottom <= typical.card.bottom + 1, `${width}/${state}: typical content must stay in card`);
      for (const person of typical.people || []) {
        assert.ok(person.width >= 0 && person.height >= 0, `${width}/${state}: typical people geometry nonnegative`);
        assert.ok(person.bottom <= typical.card.bottom + 1, `${width}/${state}: typical people must stay in card`);
      }
    }

    return { ordinary, typical };
    };

    const collapsedMetrics = await evaluate(measureExpression);
    const collapsedSummary = assertViewportMetrics(collapsedMetrics, { expanded: false });

    // Harness must expose unique disclosure region ids (SSR identifierPrefix per root).
    // Do not scope around duplicate ids — each toggle must open its OWN card region.
    const expandResult = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('.gb-discovery-card__disclosure')];
      const controlled = btns.map((btn) => {
        const id = btn.getAttribute('aria-controls');
        const card = btn.closest('.gb-discovery-card');
        const region = id ? document.getElementById(id) : null;
        return {
          id,
          hasRegion: !!region,
          regionInSameCard: !!(card && region && card.contains(region)),
          wasHidden: region ? !!region.hidden : null,
        };
      });
      const ids = controlled.map((c) => c.id).filter(Boolean);
      const unique = new Set(ids);
      if (unique.size !== ids.length) {
        throw new Error('duplicate disclosure region ids in joined SSR feed: ' + ids.join(','));
      }
      for (const row of controlled) {
        if (!row.id) throw new Error('disclosure missing aria-controls');
        if (!row.hasRegion) throw new Error('aria-controls id not found: ' + row.id);
        if (!row.regionInSameCard) {
          throw new Error('aria-controls resolves outside owning card: ' + row.id);
        }
      }
      for (const btn of btns) {
        btn.setAttribute('aria-expanded', 'true');
        const label = btn.querySelector('span');
        if (label) label.textContent = 'Свернуть';
        const region = document.getElementById(btn.getAttribute('aria-controls'));
        if (!region) throw new Error('missing region for expand');
        // Own region only — never fall back to querySelectorAll first match.
        if (!btn.closest('.gb-discovery-card')?.contains(region)) {
          throw new Error('refusing to expand foreign region');
        }
        region.hidden = false;
      }
      const after = btns.map((btn) => {
        const region = document.getElementById(btn.getAttribute('aria-controls'));
        return {
          id: btn.getAttribute('aria-controls'),
          hidden: region ? !!region.hidden : null,
          inCard: !!(btn.closest('.gb-discovery-card')?.contains(region)),
        };
      });
      if (after.some((r) => r.hidden !== false || !r.inCard)) {
        throw new Error('per-card expand failed: ' + JSON.stringify(after));
      }
      return { ids, uniqueCount: unique.size, expanded: after.length };
    })()`);
    assert.ok(expandResult?.uniqueCount >= 1, `${width}: expected unique disclosure region ids`);
    assert.equal(
      expandResult.uniqueCount,
      expandResult.ids.length,
      `${width}: disclosure region ids must be unique (got ${JSON.stringify(expandResult.ids)})`,
    );
    await sleep(80);

    const expandedMetrics = await evaluate(measureExpression);
    const expandedSummary = assertViewportMetrics(expandedMetrics, { expanded: true });

    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const shotName = `geometry-${width}.png`;
    writeFileSync(join(outDir, shotName), Buffer.from(shot.data, "base64"));
    receipt.shots.push(shotName);
    receipt.metrics.push({ width, summary: {
      cardCount: collapsedMetrics.cards.length,
      longTrainerVisible: collapsedMetrics.longTrainerVisible,
      longOrganizerVisible: collapsedMetrics.longOrganizerVisible,
      sameStringStillSeparate: collapsedMetrics.sameStringStillSeparate,
      missingTrainer: collapsedMetrics.missingTrainer,
      ordinaryH: Math.round(collapsedSummary.ordinary.card.height),
      typicalHCollapsed: Math.round(collapsedSummary.typical.card.height),
      typicalHExpanded: Math.round(expandedSummary.typical.card.height),
      slotSquare: Math.abs(collapsedSummary.ordinary.imageSlot.width - collapsedSummary.ordinary.imageSlot.height) <= 1,
      activities: collapsedMetrics.cards.map((c) => ({
        activity: c.activity,
        roles: c.roles,
        imageW: Math.round(c.imageSlot.width),
        imageH: Math.round(c.imageSlot.height),
        contentX: Math.round(c.content.x),
        detailsBottom: Math.round(c.details.bottom),
        cardBottom: Math.round(c.card.bottom),
        overflowX: c.overflowX,
        disclosureExpanded: c.disclosure?.ariaExpanded ?? null,
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
