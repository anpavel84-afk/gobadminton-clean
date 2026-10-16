/* global process, document, innerWidth, console */
// Standalone CSS geometry regression, not application UAT. No server or network.
// Run from repo root: node apps/web/test/venue-picker-geometry.browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const css = await readFile(new URL('../src/styles/games.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  for (const width of [390, 430, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>body{margin:0}*,*::before,*::after{box-sizing:border-box}</style>');
    await page.addStyleTag({ content: css });
    // Match the picker/trigger DOM structure; only CSS geometry is under test.
    // Actual VenueCover error transitions and application interactions need UAT.
    await page.evaluate(() => {
      const titles = ['Зал', 'Бадминтонный центр на севере Москвы', 'Клуб «Волан»', 'Оченьдлинноенеразрывноеназвание'.repeat(5)];
      const addresses = ['Москва', 'Москва, улица Спортивная, дом 123, корпус 4, вход со двора', 'ул. Мира, 1', 'Оченьдлинныйнеразрывныйадрес'.repeat(6)];
      const cover = mode => {
        const shell = document.createElement('span');
        shell.className = 'gb-venue-cover gb-venue-cover--thumb';
        shell.dataset.cover = mode === 'uploaded' ? 'uploaded' : 'default';
        if (mode === 'uploaded') {
          const image = document.createElement('img');
          image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=';
          shell.append(image);
        } else {
          shell.innerHTML = '<span class="gb-venue-cover__default"><span>▱</span></span>';
        }
        return shell;
      };
      const sheet = document.createElement('section');
      sheet.className = 'gb-venue-picker';
      const list = document.createElement('div');
      list.className = 'gb-venue-picker-scroll';
      sheet.append(list);
      document.body.append(sheet);
      for (let i = 0; i < 16; i++) {
        const row = document.createElement('button');
        row.className = 'gb-venue-picker-option';
        row.setAttribute('aria-pressed', String(i === 0));
        row.append(cover(i % 3 === 0 ? 'uploaded' : i % 3 === 1 ? 'default' : 'broken-fallback'));
        const copy = document.createElement('span');
        copy.className = 'gb-venue-picker-option-copy';
        const title = document.createElement('span'), address = document.createElement('span');
        title.className = 'gb-venue-picker-option-name';
        address.className = 'gb-venue-picker-option-address';
        title.textContent = titles[i % 4]; address.textContent = addresses[i % 4];
        copy.append(title, address); row.append(copy);
        if (i === 0) row.insertAdjacentHTML('beforeend', '<span class="gb-venue-picker-check">✓</span>');
        list.append(row);
        if (i < 4) {
          const trigger = row.cloneNode(true);
          trigger.className = 'gb-venue-picker-trigger';
          trigger.querySelector('.gb-venue-picker-option-copy').className = 'gb-venue-picker-trigger-copy';
          trigger.querySelector('.gb-venue-picker-option-name').className = 'gb-venue-picker-trigger-title';
          trigger.querySelector('.gb-venue-picker-option-address').className = 'gb-venue-picker-trigger-address';
          trigger.querySelector('.gb-venue-picker-check')?.remove();
          trigger.insertAdjacentHTML('beforeend', '<span>⌄</span>');
          document.body.append(trigger);
        }
      }
    });
    const measure = () => page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return ['option', 'trigger'].map(kind => Array.from(document.querySelectorAll('.gb-venue-picker-' + kind)).map(row => {
        const copy = row.querySelector('.gb-venue-picker-' + kind + '-copy');
        return { copy: rect(copy), title: rect(copy.children[0]), address: rect(copy.children[1]), thumb: rect(row.children[0]), overflow: row.scrollWidth > row.clientWidth };
      }));
    });
    const check = groups => {
      for (const rows of groups) {
        for (const row of rows) {
          assert.ok(Math.abs(row.title.x - rows[0].title.x) <= 1, `${width}: common title x`);
          assert.ok(Math.abs(row.address.x - row.title.x) <= 1, `${width}: address x`);
          assert.ok(Math.abs(row.copy.width - rows[0].copy.width) <= 1, `${width}: reserved indicator column`);
          assert.equal(row.thumb.width, 80); assert.equal(row.thumb.height, 45);
          assert.ok(row.address.y >= row.title.bottom, 'name above address');
          assert.equal(row.overflow, false);
        }
        assert.ok(rows[3].title.height > rows[0].title.height, 'long title wraps');
        assert.ok(rows[3].address.height > rows[0].address.height, 'long address wraps');
      }
    };
    check(await measure());
    // Moving the optional check must not move or resize any text column.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('.gb-venue-picker-option');
      rows[3].append(rows[0].querySelector('.gb-venue-picker-check'));
      rows[0].setAttribute('aria-pressed', 'false'); rows[3].setAttribute('aria-pressed', 'true');
    });
    check(await measure());
    assert.ok(await page.evaluate(() => {
      const list = document.querySelector('.gb-venue-picker-scroll');
      list.scrollTop = list.scrollHeight;
      return list.scrollTop > 0 && list.scrollWidth <= list.clientWidth && document.documentElement.scrollWidth <= innerWidth;
    }), `${width}: vertical scroll without horizontal overflow`);
    await page.close();
  }
  console.log('Venue picker CSS geometry regression completed (fixture only; not application UAT)');
} finally { await browser.close(); }
