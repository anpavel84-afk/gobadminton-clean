/* global process, document, console */
// Synthetic Playwright/CDP regression for venue loader skeleton + desktop gallery arrows.
// No service startup, network, credentials, or product UAT. Run from repo root:
//   node apps/web/test/venue-loader-navigation.browser.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL, pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(`${process.cwd()}/.tools/node_modules/playwright/index.mjs`));
const galleryCss = await readFile(new URL("../src/styles/venue-gallery.css", import.meta.url), "utf8");
const gamesCss = await readFile(new URL("../src/styles/games.css", import.meta.url), "utf8");
const illustrationSrc = await readFile(new URL("../src/lib/venue-illustration.ts", import.meta.url), "utf8");
const gallerySrc = await readFile(new URL("../src/components/consumer/venues/VenueGallery.tsx", import.meta.url), "utf8");

assert.match(illustrationSrc, /venueMediaSkeletonStyle/);
assert.doesNotMatch(illustrationSrc, /data:image\/svg\+xml/);
assert.doesNotMatch(illustrationSrc, /racket|ellipse cx="78"/);
assert.match(gallerySrc, /isGalleryInteractiveTarget/);
assert.match(gallerySrc, /closest\(/);
assert.match(gallerySrc, /setPointerCapture/);
assert.match(gamesCss, /gb-venue-cover\[data-pending\]/);
assert.match(gamesCss, /linear-gradient/);
assert.doesNotMatch(gamesCss, /@keyframes[^{]*pending|shimmer/i);
assert.match(galleryCss, /gb-venue-gallery__status/);
assert.match(galleryCss, /gb-venue-gallery__retry/);

const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:16px/1.4 sans-serif}
    *,*::before,*::after{box-sizing:border-box}
  </style></head><body></body></html>`);
  await page.addStyleTag({ content: `${gamesCss}\n${galleryCss}` });
  await page.evaluate(() => {
    const wrap = document.createElement("div");
    wrap.className = "gb-venue-gallery-wrap";
    wrap.innerHTML = `
      <div class="gb-venue-gallery" data-size="page" data-count="2" role="group" tabindex="0">
        <div class="gb-venue-gallery__frame" data-pending="uploaded"></div>
        <div class="gb-venue-gallery__nav">
          <button type="button" aria-label="Предыдущее фото"><span aria-hidden="true">←</span></button>
          <button type="button" aria-label="Следующее фото">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.75"/>
            </svg>
          </button>
        </div>
        <span class="gb-venue-gallery__count" aria-hidden="true">1/2</span>
      </div>
      <div class="gb-venue-gallery__credit"><p class="gb-venue-gallery__caption" role="status">Загружаем фотографию…</p></div>
    `;
    document.body.append(wrap);

    const cover = document.createElement("span");
    cover.className = "gb-venue-cover gb-venue-cover--thumb";
    cover.dataset.pending = "uploaded";
    document.body.append(cover);

    const gallery = wrap.querySelector(".gb-venue-gallery");
    const count = wrap.querySelector(".gb-venue-gallery__count");
    let index = 0;
    const AXIS_LOCK = 10;
    const SWIPE_THRESHOLD = 48;
    let drag = null;
    let suppressClick = false;

    function isGalleryInteractiveTarget(target) {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(target.closest(
        "button,a,input,select,textarea,summary,label,[role='button'],[role='link'],[role='textbox']",
      ));
    }
    function paint() {
      count.textContent = `${index + 1}/2`;
    }
    function go(delta) {
      index = (index + delta + 2) % 2;
      paint();
    }
    gallery.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (isGalleryInteractiveTarget(event.target)) return;
      suppressClick = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending" };
      gallery.setPointerCapture(event.pointerId);
    });
    gallery.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.axis === "pending") {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          drag = null;
          try { gallery.releasePointerCapture(event.pointerId); } catch { /* already released */ }
          return;
        }
        drag.axis = "x";
      }
    });
    gallery.addEventListener("pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const current = drag;
      drag = null;
      if (current.axis !== "x") return;
      const dx = event.clientX - current.x;
      if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        go(dx < 0 ? 1 : -1);
        suppressClick = true;
      }
    });
    gallery.addEventListener("click", (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    wrap.querySelector('[aria-label="Предыдущее фото"]').addEventListener("click", (event) => {
      event.stopPropagation();
      go(-1);
    });
    wrap.querySelector('[aria-label="Следующее фото"]').addEventListener("click", (event) => {
      event.stopPropagation();
      go(1);
    });
    gallery.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    });
  });

  const next = page.getByRole("button", { name: "Следующее фото" });
  const prev = page.getByRole("button", { name: "Предыдущее фото" });
  const count = page.locator(".gb-venue-gallery__count");
  assert.equal(await count.textContent(), "1/2");

  // Programmatic click works even with the old bug — keep as diagnostic control only.
  await next.evaluate((button) => button.click());
  assert.equal(await count.textContent(), "2/2");
  await prev.evaluate((button) => button.click());
  assert.equal(await count.textContent(), "1/2");

  // Real CDP mouse press/release on the control center — the alpha.44 failure mode.
  const nextBox = await next.boundingBox();
  assert.ok(nextBox, "next arrow geometry");
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await count.textContent(), "2/2", "native mouse click on Next must advance");

  // Nested SVG glyph must also keep the button as the interactive ancestor.
  const glyphBox = await next.locator("svg").boundingBox();
  assert.ok(glyphBox, "next arrow svg glyph");
  await page.mouse.move(glyphBox.x + glyphBox.width / 2, glyphBox.y + glyphBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await count.textContent(), "1/2", "native mouse click on nested SVG glyph must advance");

  await page.locator(".gb-venue-gallery").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await count.textContent(), "2/2");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await count.textContent(), "1/2");

  // Horizontal swipe on the media frame (not the buttons) still changes the index.
  const frame = page.locator(".gb-venue-gallery__frame");
  const frameBox = await frame.boundingBox();
  assert.ok(frameBox);
  await page.mouse.move(frameBox.x + frameBox.width * 0.7, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + frameBox.width * 0.2, frameBox.y + frameBox.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await count.textContent(), "2/2", "horizontal swipe advances");

  const pendingFrame = await page.locator(".gb-venue-gallery__frame[data-pending='uploaded']").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      animationName: style.animationName,
      backgroundImage: style.backgroundImage,
    };
  });
  assert.equal(pendingFrame.animationName === "none" || pendingFrame.animationName === "", true);
  assert.equal(pendingFrame.backgroundImage.includes("svg+xml"), false);

  const thumb = await page.locator(".gb-venue-cover[data-pending='uploaded']").evaluate((node) => {
    const style = getComputedStyle(node);
    return { backgroundImage: style.backgroundImage, animationName: style.animationName };
  });
  assert.match(thumb.backgroundImage, /linear-gradient/);
  assert.equal(thumb.backgroundImage.includes("svg+xml"), false);
  assert.equal(thumb.animationName === "none" || thumb.animationName === "", true);

  // Zero/one image: fixture without nav must not invent arrows.
  await page.evaluate(() => {
    document.querySelector(".gb-venue-gallery__nav")?.remove();
    document.querySelector(".gb-venue-gallery__count")?.remove();
    document.querySelector(".gb-venue-gallery").dataset.count = "1";
  });
  assert.equal(await page.getByRole("button", { name: "Следующее фото" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Предыдущее фото" }).count(), 0);

  console.log("Venue loader skeleton + desktop gallery pointer regression completed (fixture; not product UAT)");
} finally {
  await browser.close();
}
