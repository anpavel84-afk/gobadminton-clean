import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLabel, levelLabel } from '../src/presentation.ts';

test('formats use accepted discovery labels; unknown keys are omitted', () => {
  assert.equal(formatLabel('doubles'), 'Парная игра');
  assert.equal(formatLabel('singles'), 'Одиночная игра');
  assert.equal(formatLabel('mixed'), 'Микст');
  assert.equal(formatLabel('mixed_doubles'), 'Микст');
  assert.equal(formatLabel('unknown-internal-key'), null);
});

test('levels respect exact accepted scale/version, numeric half-steps and pilot labels without raw-key fallbacks', () => {
  const rule = { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['1', '3.0', '3,5', '7.0'] };
  assert.equal(levelLabel(rule), 'NTRP 1,0 · 3,0 · 3,5 · 7,0');
  assert.equal(levelLabel({ scaleId: 'gb-social-pilot', scaleVersion: 1,
    allowedLevelIds: ['beginner', 'intermediate', 'advanced'] }), 'Начинающий · Средний · Продвинутый');
  for (const unsupported of [
    { ...rule, scaleId: 'foreign-scale' },
    { ...rule, scaleVersion: 2 },
    ...['0.5', '7.5', '3.2', '', 'internal-level'].map(id => ({ ...rule, allowedLevelIds: ['3.0', id] })),
    { scaleId: 'gb-social-pilot', scaleVersion: 1, allowedLevelIds: ['internal-level'] },
    { scaleId: 'gb-social-pilot', scaleVersion: 2, allowedLevelIds: ['beginner'] },
  ]) assert.equal(levelLabel(unsupported), 'Уточните у организатора');
  assert.equal(levelLabel({ ...rule, allowedLevelIds: [] }), 'Не указаны');
});
