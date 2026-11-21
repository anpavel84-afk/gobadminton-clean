import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

const iosProp = (value: string) =>
  new RegExp(`Platform\\.OS === 'ios' \\? ${value} : undefined`);

function inputSlice(source: string, label: string, nextLabel?: string) {
  const start = source.indexOf(`accessibilityLabel="${label}"`);
  assert.ok(start >= 0, `missing TextInput ${label}`);
  const end = nextLabel ? source.indexOf(`accessibilityLabel="${nextLabel}"`, start + 1) : source.indexOf('/>', start) + 2;
  assert.ok(end > start, `unbounded TextInput ${label}`);
  return source.slice(start, end);
}

test('city search: iOS clearButtonMode while-editing; existing returnKeyType kept', () => {
  assert.ok(root.includes('mobile'));
  const city = read('../app/city.tsx');
  const input = inputSlice(city, 'Название города');
  assert.match(input, /returnKeyType="search"/);
  assert.match(input, iosProp("'while-editing'"));
  assert.match(input, /clearButtonMode=\{Platform\.OS === 'ios' \? 'while-editing' : undefined\}/);
});

test('profile-editor name/city: iOS textContentType, autoCorrect off, returnKeyType', () => {
  const editor = read('../src/components/profile-editor.tsx');
  const name = inputSlice(editor, 'Публичное имя', 'Найти город профиля');
  assert.match(name, iosProp("'name'"));
  assert.match(name, /textContentType=\{Platform\.OS === 'ios' \? 'name' : undefined\}/);
  assert.match(name, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(name, /returnKeyType=\{Platform\.OS === 'ios' \? 'done' : undefined\}/);

  const city = inputSlice(editor, 'Найти город профиля');
  assert.match(city, /textContentType=\{Platform\.OS === 'ios' \? 'addressCity' : undefined\}/);
  assert.match(city, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(city, /returnKeyType=\{Platform\.OS === 'ios' \? 'search' : undefined\}/);
});

test('contact-editor message: iOS textContentType none, autoCorrect off, returnKeyType', () => {
  const contact = read('../src/components/contact-editor.tsx');
  const input = inputSlice(contact, 'Текст сообщения');
  assert.match(input, /textContentType=\{Platform\.OS === 'ios' \? 'none' : undefined\}/);
  assert.match(input, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(input, /returnKeyType=\{Platform\.OS === 'ios' \? 'default' : undefined\}/);
});

test('create-game-controls GameField: iOS returnKeyType done or next', () => {
  const controls = read('../src/components/create-game-controls.tsx');
  const field = controls.slice(controls.indexOf('export function GameField'), controls.indexOf('export function FormSection'));
  assert.match(field, /returnKeyType=\{Platform\.OS === 'ios' \? \(multiline \|\| numeric \? 'done' : 'next'\) : undefined\}/);
});

test('game-management and postgame reason inputs: iOS returnKeyType and autoCorrect off', () => {
  const management = read('../src/components/game-management.tsx');
  const reason = inputSlice(management, 'Причина отклонения или снятия');
  assert.match(reason, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(reason, /returnKeyType=\{Platform\.OS === 'ios' \? 'done' : undefined\}/);

  const postgame = read('../src/components/postgame.tsx');
  for (const label of ['Причина исхода или исправления', 'Причина исправления посещения'] as const) {
    const input = inputSlice(postgame, label);
    assert.match(input, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/, label);
    assert.match(input, /returnKeyType=\{Platform\.OS === 'ios' \? 'done' : undefined\}/, label);
  }
});

test('Android paths unchanged: new TextInput semantics are iOS-gated only', () => {
  const files = [
    '../app/city.tsx',
    '../src/components/profile-editor.tsx',
    '../src/components/contact-editor.tsx',
    '../src/components/create-game-controls.tsx',
    '../src/components/game-management.tsx',
    '../src/components/postgame.tsx',
  ] as const;
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /Platform\.OS === 'android'|Platform\.OS !== 'ios'|Platform\.select\(/, file);
  }
});
