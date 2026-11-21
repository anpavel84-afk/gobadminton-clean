import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

/** Every screen/component of the I4 scope that renders a React Native Modal. */
const modalOwners = [
  '../src/components/ui.tsx',
  '../src/components/radar-controls.tsx',
  '../src/components/venue-sheet.tsx',
  '../src/components/postgame.tsx',
  '../src/components/safety.tsx',
  '../src/components/venue-community.tsx',
  '../src/components/friendly-match.tsx',
  '../app/players/index.tsx',
] as const;
const touched = [...modalOwners, '../src/components/create-game.tsx'] as const;

test('iOS Modal orientations: shared constant is iOS-only and matches the rotating app', () => {
  assert.ok(root.includes('mobile'));
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /export const iosModalOrientations = Platform\.OS === 'ios' \? \(\['portrait', 'landscape'\] as const\) : undefined;/);
  const app = JSON.parse(read('../app.json')) as { expo: { orientation: string } };
  assert.equal(app.expo.orientation, 'default');
});

test('iOS Modal orientations: every Modal in scope opts in, so landscape is not forced back to portrait', () => {
  for (const file of modalOwners) {
    const source = read(file);
    const modals = source.match(/<Modal\b[^>]*>/g) ?? [];
    assert.ok(modals.length > 0, `${file} renders a Modal`);
    for (const modal of modals) assert.match(modal, /supportedOrientations=\{iosModalOrientations\}/, `${file}: ${modal}`);
  }
});

test('iOS sheet safe area: nested provider only on iOS, plain fragment elsewhere', () => {
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /import \{ SafeAreaProvider, useSafeAreaInsets \} from 'react-native-safe-area-context';/);
  assert.match(ui, /export function IosSheetSafeArea\(\{ children \}: PropsWithChildren\) \{\s*return Platform\.OS === 'ios' \? <SafeAreaProvider>\{children\}<\/SafeAreaProvider> : <>\{children\}<\/>;\s*\}/);
});

test('radar pageSheet: iOS re-measures insets and pads the home indicator; swipe still closes via onRequestClose', () => {
  const radar = read('../src/components/radar-controls.tsx');
  assert.match(radar, /<Modal visible=\{open\} onRequestClose=\{close\} animationType="none" presentationStyle="pageSheet" supportedOrientations=\{iosModalOrientations\}>\s*<IosSheetSafeArea><RadarSheetBody>/);
  assert.match(radar, /<\/RadarSheetBody><\/IosSheetSafeArea>\s*<\/Modal>/);
  const body = radar.slice(radar.indexOf('function RadarSheetBody'));
  assert.match(body, /const insets = useSafeAreaInsets\(\);/);
  assert.match(body, /paddingBottom: Platform\.OS === 'ios' \? insets\.bottom \+ 20 : 20/);
  assert.match(body, /<ScreenFrame><ScrollView contentContainerStyle=\{\{ padding: 20, paddingBottom: [^}]+, gap: 16 \}\}>/);
  assert.doesNotMatch(radar, /allowSwipeDismissal/);
});

test('venue create formSheet: only the sheet route gets the nested iOS safe area', () => {
  const create = read('../src/components/create-game.tsx');
  assert.match(create, /const shell = \(body: ReactNode, opts\?: \{ footer\?: ReactNode \}\) => sheet \? <IosSheetSafeArea>\{frame\(body, opts\)\}<\/IosSheetSafeArea> : frame\(body, opts\);/);
  assert.match(create, /const frame = \(body: ReactNode, opts\?: \{ footer\?: ReactNode \}\) => <ScreenFrame keyboard header=\{sheet \? undefined : <Header \/>\}>/);
  assert.ok(create.indexOf('const frame =') < create.indexOf('const shell ='));
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /name="games\/create\/venue\/\[venueId\]" options=\{\{\s*presentation: 'formSheet'/);
});

test('expanded venue sheet: iOS-only landscape side insets; Android style object unchanged', () => {
  const sheet = read('../src/components/venue-sheet.tsx');
  assert.match(sheet, /presentationStyle=\{Platform\.OS === 'ios' \? 'overFullScreen' : undefined\} supportedOrientations=\{iosModalOrientations\}>/);
  assert.match(sheet, /<View style=\{\[\{ flex: 1, justifyContent: 'flex-end' \}, Platform\.OS === 'ios' && \{ paddingLeft: insets\.left, paddingRight: insets\.right \}\]\} pointerEvents="box-none">/);
});

test('players name search mirrors web type="search" on iOS only', () => {
  const players = read('../app/players/index.tsx');
  const input = players.slice(players.indexOf('accessibilityLabel="Имя игрока"'), players.indexOf('accessibilityLabel="Район / метро"'));
  assert.match(input, /clearButtonMode="while-editing"/);
  assert.match(input, /returnKeyType=\{Platform\.OS === 'ios' \? 'search' : undefined\}/);
  const web = readFileSync(new URL('../../web/src/components/consumer/pages/PlayersDirectoryPage.tsx', import.meta.url), 'utf8');
  assert.match(web, /aria-label="Найти игрока" type="search"/);
});

test('Android paths unchanged: no Android branches added, keyboard/inset owners intact, config pinned', () => {
  for (const file of touched) {
    const source = read(file);
    assert.doesNotMatch(source, /Platform\.OS === 'android'|Platform\.OS !== 'ios'|Platform\.select\(/, file);
  }
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' && keyboard \? 'padding' : undefined\}/);
  assert.match(ui, /paddingTop: insets\.top, paddingLeft: insets\.left, paddingRight: insets\.right/);
  assert.match(ui, /<Modal transparent visible animationType="none" onRequestClose=\{onClose\} supportedOrientations=\{iosModalOrientations\}/);
  const app = JSON.parse(read('../app.json')) as { expo: { android: { softwareKeyboardLayoutMode: string; package: string } } };
  assert.equal(app.expo.android.softwareKeyboardLayoutMode, 'resize');
  assert.equal(app.expo.android.package, 'ru.gobadminton.mobile.dev');
});

test('iOS shadows: every elevation in scope has matching shadow* props', () => {
  for (const file of ['../app/games/index.tsx', '../app/players/index.tsx'] as const) {
    const source = read(file);
    for (const match of source.matchAll(/elevation:\d+/g)) {
      const around = source.slice(Math.max(0, (match.index ?? 0) - 200), match.index);
      assert.match(around, /shadowColor:colors\.ink,shadowOffset:\{width:0,height:4\},shadowOpacity:0\.12,shadowRadius:12,$/, file);
    }
  }
});
