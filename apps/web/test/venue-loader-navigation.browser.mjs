/* global process, document, console, getComputedStyle, HTMLImageElement, window */
// Synthetic guest-only loopback regression for actual VenueGallery pointer/keyboard semantics.
// Reuses the venue-cover.browser.mjs loopback convention. No service startup, network install,
// credentials, authenticated user, or live writes. Run from repo root:
//   node apps/web/test/venue-loader-navigation.browser.mjs
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL, pathToFileURL } from "node:url";

const origin = process.env.P1_ORIGIN || "http://127.0.0.1:18984";
assert.equal(new URL(origin).hostname, "127.0.0.1", "Synthetic loopback only");

const { chromium } = await import(pathToFileURL(`${process.cwd()}/.tools/node_modules/playwright/index.mjs`));

const idMulti = "00000037-1111-4111-8111-111111111111";
const idSingle = "00000038-1111-4111-8111-111111111111";
const idEmpty = "00000039-1111-4111-8111-111111111111";
const imageA = "/v1/media/venue-covers/" + "a".repeat(64) + ".png";
const imageB = "/v1/media/venue-covers/" + "b".repeat(64) + ".png";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

function venueBody(id, items, uploadedUrl) {
  return {
    id,
    cityId: "synthetic",
    name: "Synthetic venue",
    address: "Synthetic address",
    timezone: "Europe/Moscow",
    latitude: 55.7,
    longitude: 37.6,
    dataStatus: "verified",
    provenance: "admin_created",
    cover: uploadedUrl
      ? { uploadedUrl, credit: { kind: "photo", text: "Фото: Клуб", url: "https://club.example" } }
      : { uploadedUrl: null },
    profile: {
      courtCount: null,
      amenities: { parking: null, showers: null },
      description: null,
      updatedAt: null,
      gallery: { coverage: "ordered", items },
    },
  };
}

const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let holdImages = true;
  const pendingImages = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const path = url.pathname;
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path.startsWith("/v1/admin/")) return reply({ title: "Forbidden" }, 403);
    if (path === "/v1/me") return reply({ title: "Synthetic guest" }, 401);
    if (path === `/v1/venues/${idMulti}`) {
      return reply(venueBody(idMulti, [
        { id: "a0000000-0000-4000-8000-000000000011", url: imageA, credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
        { id: "a0000000-0000-4000-8000-000000000012", url: imageB, credit: { kind: "photo", text: "Фото: Два", url: "https://club.example/2" } },
      ], imageA));
    }
    if (path === `/v1/venues/${idSingle}`) {
      return reply(venueBody(idSingle, [
        { id: "a0000000-0000-4000-8000-000000000011", url: imageA, credit: { kind: "photo", text: "Фото: Один", url: "https://club.example/1" } },
      ], imageA));
    }
    if (path === `/v1/venues/${idEmpty}`) {
      return reply(venueBody(idEmpty, [], null));
    }
    if (path === imageA || path === imageB) {
      if (holdImages) {
        await new Promise((resolve) => pendingImages.push(resolve));
      }
      return route.fulfill({ contentType: "image/png", body: png });
    }
    if (path === "/v1/venues") return reply({ items: [], nextCursor: null });
    if (path.startsWith("/v1/")) return reply({ items: [], nextCursor: null });
    return route.continue();
  });

  const page = await context.newPage();
  await page.goto(`${origin}/venues/${idMulti}`);
  await page.getByRole("heading", { name: "Synthetic venue", exact: true }).waitFor();
  const gallery = page.locator(".gb-venue-media .gb-venue-gallery");
  await gallery.waitFor();
  assert.equal(await gallery.getAttribute("data-count"), "2");

  const pendingFrame = page.locator(".gb-venue-media .gb-venue-gallery__frame[data-pending='uploaded']");
  await pendingFrame.waitFor();
  const pendingStyle = await pendingFrame.evaluate((node) => {
    const style = getComputedStyle(node);
    return { animationName: style.animationName, backgroundImage: style.backgroundImage };
  });
  // Pending skeleton: calm static gradient only — no shimmer animation, no inline equipment SVG.
  assert.equal(pendingStyle.animationName === "none" || pendingStyle.animationName === "", true);
  assert.equal(pendingStyle.backgroundImage.includes("svg+xml"), false);
  assert.match(pendingStyle.backgroundImage, /linear-gradient/);

  holdImages = false;
  pendingImages.splice(0).forEach((release) => release());
  await page.locator(`.gb-venue-media img[src="${imageA}"]`).waitFor();
  await page.waitForFunction(() => !document.querySelector(".gb-venue-media .gb-venue-gallery__frame[data-pending='uploaded']"));
  assert.equal(await page.locator(".gb-venue-media .gb-venue-gallery__caption").filter({ hasText: "Загружаем фотографию…" }).count(), 0);

  const next = page.getByRole("button", { name: "Следующее фото" });
  const prev = page.getByRole("button", { name: "Предыдущее фото" });
  const count = page.locator(".gb-venue-media .gb-venue-gallery__count");
  assert.equal(await count.textContent(), "1/2");
  assert.equal(await next.locator("svg").count(), 1);

  // Programmatic click is a diagnostic control only — alpha.44 failed on native mouse.
  await next.evaluate((button) => button.click());
  assert.equal(await count.textContent(), "2/2");
  await prev.evaluate((button) => button.click());
  assert.equal(await count.textContent(), "1/2");

  // Real CDP mouse on the control center — the alpha.44 click-retargeting failure mode.
  const nextBox = await next.boundingBox();
  assert.ok(nextBox, "next arrow geometry");
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await count.textContent(), "2/2", "native mouse click on Next must advance");

  // Nested SVG glyph must keep the button as the interactive ancestor (exact pointer cause).
  const glyphBox = await next.locator("svg path").boundingBox();
  assert.ok(glyphBox, "next arrow svg glyph");
  await page.mouse.move(glyphBox.x + glyphBox.width / 2, glyphBox.y + glyphBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal(await count.textContent(), "1/2", "native mouse click on nested SVG glyph must advance");

  await gallery.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await count.textContent(), "2/2");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await count.textContent(), "1/2");

  // Horizontal swipe starts on the gallery IMG (native HTML drag must not pointercancel).
  const photo = page.locator(`.gb-venue-media img[src="${imageA}"]`);
  await photo.waitFor();
  assert.equal(await photo.evaluate((node) => node instanceof HTMLImageElement && node.draggable === false), true);
  const imgBox = await photo.boundingBox();
  assert.ok(imgBox);
  await page.evaluate(() => {
    const root = document.querySelector(".gb-venue-media");
    if (!root) return;
    const trace = [];
    window.__gbSwipeTrace = trace;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "dragstart"]) {
      root.addEventListener(type, (event) => {
        trace.push({ type: event.type, target: event.target && event.target.nodeName });
      }, true);
    }
  });
  await page.mouse.move(imgBox.x + imgBox.width * 0.7, imgBox.y + imgBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(imgBox.x + imgBox.width * 0.2, imgBox.y + imgBox.height / 2, { steps: 8 });
  await page.mouse.up();
  const swipeTrace = await page.evaluate(() => window.__gbSwipeTrace || []);
  assert.equal(swipeTrace.some((event) => event.type === "dragstart"), false, "native image dragstart must not fire");
  assert.equal(swipeTrace.some((event) => event.type === "pointercancel"), false, "pointercancel must not abort swipe");
  assert.equal(await count.textContent(), "2/2", "horizontal swipe advances");

  // Single image: actual VenueGallery must not invent arrows.
  await page.goto(`${origin}/venues/${idSingle}`);
  await page.getByRole("heading", { name: "Synthetic venue", exact: true }).waitFor();
  await page.locator(".gb-venue-media .gb-venue-gallery[data-count='1']").waitFor();
  assert.equal(await page.getByRole("button", { name: "Следующее фото" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Предыдущее фото" }).count(), 0);

  // Zero gallery / no cover: real default illustration, no fake count/arrows.
  await page.goto(`${origin}/venues/${idEmpty}`);
  await page.getByRole("heading", { name: "Synthetic venue", exact: true }).waitFor();
  const emptyGallery = page.locator(".gb-venue-media .gb-venue-gallery[data-count='0']");
  await emptyGallery.waitFor();
  assert.equal(await page.getByRole("button", { name: "Следующее фото" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Предыдущее фото" }).count(), 0);
  const illustration = page.locator(".gb-venue-media img[src*='/discovery/venue-illustrations/']");
  await illustration.waitFor();
  assert.equal(await illustration.getAttribute("alt"), "Иллюстрация: бадминтон");
  assert.equal(await illustration.evaluate((node) => node instanceof HTMLImageElement && node.draggable === false), true);
  await page.locator(".gb-venue-media .gb-venue-cover[data-fallback='illustration']:not([data-pending])").waitFor();
  assert.notEqual(await emptyGallery.getAttribute("aria-busy"), "true", "aria-busy clears after default illustration ready");
  assert.equal(await page.getByText("Фотографии площадки пока нет", { exact: true }).count(), 0);
  assert.match(await page.locator(".gb-venue-media .gb-venue-cover__badge").textContent() || "", /Иллюстрация/);

  console.log("Venue loader skeleton + desktop gallery pointer regression completed (actual VenueGallery loopback; not product UAT)");
} finally {
  await browser.close();
}
