import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('#623 contact-scroll path is keyed on contactAlert; generic notice scroll gated off', () => {
  const create = read('../src/components/create-game.tsx');
  const controls = read('../src/components/create-game-controls.tsx');

  assert.equal(
    fileURLToPath(new URL('../test/create-contact-scroll.test.ts', import.meta.url)).endsWith('create-contact-scroll.test.ts'),
    true,
  );

  // Contact-scroll path: measureLayout against ScrollView content host (getInnerViewRef), keyed on contactAlert.
  assert.match(create, /contactAlert=\{contactAlert\}/);
  assert.match(create, /onContactAlertLayout=\{anchor => \{/);
  assert.match(create, /getInnerViewRef/);
  assert.match(create, /anchor\.measureLayout\(content,/);
  assert.match(create, /scrollRef\.current\?\.scrollTo\(\{\s*y:\s*Math\.max\(0,\s*y - 24\)/);
  assert.match(controls, /contactAlert/);
  assert.match(controls, /onContactAlertLayout/);
  assert.match(controls, /if \(!contactAlert/);
  assert.match(controls, /contactAnchorRef\.current/);

  // NEGATIVE / regression: section-relative onLayout offset must not drive scroll (short by BackLink/Step/title).
  assert.doesNotMatch(controls, /participationSectionY/);
  assert.doesNotMatch(controls, /participationSectionRef/);
  assert.doesNotMatch(create, /participationSectionY/);

  // NEGATIVE / regression: bottom generic notice must not steal scroll when contactAlert is set.
  const noticeOnLayout = create.slice(
    create.indexOf('{state.notice && <Label accessibilityRole="alert" onLayout='),
    create.indexOf('>{state.notice}</Label>}'),
  );
  assert.match(noticeOnLayout, /if \(contactAlert\) return/);
  assert.match(noticeOnLayout, /scrollTo/);
  assert.doesNotMatch(
    noticeOnLayout.replace(/if \(contactAlert\) return;/, ''),
    /if \(contactAlert\) return/,
  );

  // Field-level alert text next to the contact field.
  assert.match(controls, /Публичный контакт для этой игры/);
  const contactBlock = controls.slice(
    controls.indexOf('Публичный контакт для этой игры'),
    controls.indexOf('Будет виден на странице игры.'),
  );
  assert.match(contactBlock, /accessibilityRole="alert"/);
  assert.match(contactBlock, /Укажите публичный контакт для этой игры\.|\{contactAlert\}/);
  assert.match(create, /Укажите публичный контакт для этой игры\./);
});
