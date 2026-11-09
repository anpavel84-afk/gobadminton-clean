/* global process, console, URL, WebSocket, Buffer, setTimeout, fetch */
/** #404 component geometry only: mounted React fixtures + real product CSS.
 * No authenticated DEV, messaging write, dependency install or product acceptance.
 * Run: node test/player-browse-match.browser.mjs <evidence-dir-outside-source>
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(webRoot, "../..");
const outDir = process.argv[2] && resolve(process.argv[2]);
if (!outDir || outDir === repoRoot || outDir.startsWith(repoRoot + "/")) {
  console.log(JSON.stringify({ status: "NOT_RUN", reason: "Provide an evidence directory outside source" }));
  process.exit(2);
}
const CHROME = process.env.GB404_CHROME || "/opt/gobadminton-qa/chromium-headless-1243/chrome-headless-shell";
const vitest = join(webRoot, "node_modules/.bin/vitest");
for (const path of [CHROME, vitest]) {
  try { accessSync(path, constants.X_OK); } catch {
    console.log(JSON.stringify({ status: "NOT_RUN", reason: "Required local executable unavailable", path }));
    process.exit(2);
  }
}
mkdirSync(outDir, { recursive: true });
const tmpdir = () => outDir;
const fixturePath = join(outDir, "mounted-fixtures.json");
const run = spawnSync(vitest, ["run", "test/player-browse-match.test.tsx"], {
  cwd: webRoot, encoding: "utf8", env: { ...process.env, GB404_BROWSER_FIXTURE: fixturePath },
});
assert.equal(run.status, 0, run.stderr || run.stdout || "Mounted fixture tests failed");
const fixtures = JSON.parse(await readFile(fixturePath, "utf8")).fixtures;
const css = (await Promise.all(["tokens.css", "consumer-tokens.css", "players.css", "desktop-overlays.css", "player-browse.css"]
  .map(name => readFile(join(webRoot, "src/styles", name), "utf8")))).join("\n");

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

const metrics = [];
await withChrome(async ({ call, evaluate }) => {
  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    for (const scenario of ["allowed", "blocked", "long-name"]) {
      const tree = (await call("Page.getFrameTree")).frameTree;
      await call("Page.setDocumentContent", { frameId: tree.frame.id,
        html: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;background:#f5f6f2}body{font-family:Arial,sans-serif}</style><style>${css}</style></head><body><p style="position:fixed;bottom:0">SYNTHETIC COMPONENT FIXTURE — NOT DEV</p>${fixtures[scenario]}</body></html>` });
      await evaluate(`(() => {
        const d = document.querySelector('dialog');
        d.removeAttribute('open');
        if (innerWidth < 1024) {
          const content = d.querySelector('.pb-match-shell');
          d.replaceChildren(content);
          d.className = 'gb-player-browse pb-mobile-fs pb-mobile-fs--match';
        }
        d.showModal();
        d.querySelector('.pb-match-title').focus();
      })()`);
      await evaluate("document.fonts.ready");
      const geo = await evaluate(`(() => {
        const d = document.querySelector('dialog');
        const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const buttons = [...d.querySelectorAll('.pb-match-primary,.pb-match-continue,.pb-match-top button')];
        return {dialog:rect(d),horizontal:d.scrollWidth>d.clientWidth,bodyHorizontal:document.documentElement.scrollWidth>innerWidth,
          controls:buttons.map(rect),href:d.querySelector('a')?.getAttribute('href') || null,
          names:[...d.querySelectorAll('.pb-match-player strong')].map(el=>({rect:rect(el),scroll:el.scrollWidth,client:el.clientWidth})),
          openDialogs:document.querySelectorAll('dialog[open]').length,focus:document.activeElement.id,font:getComputedStyle(d).fontFamily};
      })()`);
      assert.equal(geo.horizontal, false, `${width}/${scenario} horizontal dialog overflow`);
      assert.equal(geo.bodyHorizontal, false, `${width}/${scenario} horizontal page overflow`);
      assert.equal(geo.openDialogs, 1);
      assert.equal(geo.focus, "pb-match-title");
      for (const control of geo.controls) { assert.ok(control.width >= 44 && control.height >= 44); assert.ok(control.x >= 0 && control.right <= width + 1); }
      for (const name of geo.names) assert.ok(name.scroll <= name.client + 1, "long names must wrap");
      assert.equal(Boolean(geo.href), scenario !== "blocked");
      // The one dialog must make all actions reachable by scrolling, including long names.
      const reachable = await evaluate(`(() => { const d=document.querySelector('dialog'); d.scrollTop=d.scrollHeight; const r=d.querySelector('.pb-match-continue').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()`);
      assert.equal(reachable, true, `${width}/${scenario} continue unreachable`);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const filename = `${scenario}-${width}.png`;
      writeFileSync(join(outDir, filename), Buffer.from(shot.data, "base64"));
      metrics.push({ width, height, scenario, geo, shot: filename });
    }
  }
});
writeFileSync(join(outDir, "browser-geometry.json"), JSON.stringify({ status: "COMPONENT_GEOMETRY_PASS", fixtures: "SYNTHETIC_NOT_DEV", metrics, DEV: "NOT_TESTED", UAT: "NOT_TESTED" }, null, 2));
console.log(JSON.stringify({ status: "COMPONENT_GEOMETRY_PASS", scenarios: metrics.length, outDir, DEV: "NOT_TESTED", UAT: "NOT_TESTED" }));
