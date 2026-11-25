import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('messages inbox: iOS-only RefreshControl tintColor reuses brand purple', () => {
  assert.ok(root.includes('mobile'));
  const messages = read('../src/components/messages.tsx');
  const rnImport = messages.match(/import \{([^}]+)\} from 'react-native';/)?.[1] ?? '';
  for (const name of ['AppState', 'FlatList', 'Image', 'Platform', 'Pressable', 'RefreshControl', 'TextInput', 'View']) {
    assert.match(rnImport, new RegExp(`\\b${name}\\b`));
  }
  assert.match(messages, /refreshControl=\{<RefreshControl refreshing=\{state\.inboxStatus === 'loading'\} onRefresh=\{\(\) => \{ void owner\.loadInbox\(\); \}\}[\s\S]*?tintColor=\{Platform\.OS === 'ios' \? colors\.purple : undefined\} \/>\}/);
  assert.doesNotMatch(messages, /<FlatList[^>]*\brefreshing=/);
  assert.doesNotMatch(messages, /Platform\.OS === 'android'|Platform\.OS !== 'ios'|Platform\.select\(/);
  assert.doesNotMatch(messages, /colors=\{|progressBackgroundColor=/);
  const theme = read('../src/theme.ts');
  assert.match(theme, /purple: '#7945DE'/);
});

test('venue date strip: iOS disables alwaysBounceHorizontal; Android keeps default', () => {
  const sheet = read('../src/components/venue-sheet.tsx');
  assert.match(sheet, /<ScrollView horizontal alwaysBounceHorizontal=\{Platform\.OS === 'ios' \? false : undefined\} contentContainerStyle=\{\{gap:8\}\} accessibilityLabel="Даты игр">/);
  assert.doesNotMatch(sheet, /Platform\.OS === 'android'|Platform\.OS !== 'ios'|Platform\.select\(/);
});
