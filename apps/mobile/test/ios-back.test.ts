import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { bindIosBack, isNativeStackDismiss } from '../src/ios-back.ts';
import type { IosBackRemoval, PreventRemoveHook } from '../src/ios-back.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function fakePreventRemove() {
  const calls: boolean[] = [];
  let listener: ((event: IosBackRemoval) => void) | null = null;
  let released = 0;
  const hook: PreventRemoveHook = (prevent, callback) => { calls.push(prevent); listener = callback; return () => { released++; }; };
  const emit = (action: IosBackRemoval['data']['action']) => {
    let repeated = 0;
    listener?.({ data: { action }, repeat: () => { repeated++; } });
    return repeated;
  };
  return { hook, calls, emit, released: () => released };
}

test('only native-stack dismissals (POP stamped with the route source) count as an iOS swipe-back', () => {
  assert.equal(isNativeStackDismiss({ type: 'POP', payload: { count: 1 }, source: 'profile-1', target: 'stack' }), true);
  assert.equal(isNativeStackDismiss({ type: 'POP', payload: { count: 1 } }), false);
  for (const type of ['GO_BACK', 'NAVIGATE', 'REPLACE', 'POP_TO', 'POP_TO_TOP', 'RESET']) {
    assert.equal(isNativeStackDismiss({ type, source: 'profile-1' }), false);
  }
});

test('off iOS the guard is inert: no prevent-remove hook call at all', () => {
  for (const os of ['android', 'web', 'windows', 'macos']) {
    const fake = fakePreventRemove();
    let closed = 0;
    bindIosBack(os, fake.hook)(true, () => { closed++; });
    assert.deepEqual(fake.calls, []);
    assert.equal(closed, 0);
  }
});

test('on iOS a swipe closes the open layer; other removals continue; closed layer does not prevent', () => {
  const fake = fakePreventRemove();
  const useIosBack = bindIosBack('ios', fake.hook);
  let closed = 0;
  useIosBack(true, () => { closed++; });
  assert.deepEqual(fake.calls, [true]);
  assert.equal(fake.emit({ type: 'POP', payload: { count: 1 }, source: 'route' }), 0);
  assert.equal(closed, 1);
  assert.equal(fake.emit({ type: 'GO_BACK' }), 1);
  assert.equal(fake.emit({ type: 'REPLACE', payload: { name: 'city' } }), 1);
  assert.equal(fake.emit({ type: 'POP', payload: { count: 1 } }), 1);
  assert.equal(closed, 1);
  useIosBack(false, () => { closed++; });
  assert.deepEqual(fake.calls, [true, false]);
});

test('a layer that leaves the screen (story) can release prevention before navigating', () => {
  const fake = fakePreventRemove();
  const order: string[] = [];
  bindIosBack('ios', fake.hook)(true, release => { release(); order.push('finish'); });
  fake.emit({ type: 'POP', payload: { count: 1 }, source: 'story' });
  assert.equal(fake.released(), 1);
  assert.deepEqual(order, ['finish']);
});

test('ios-back helper uses the real expo-router removal API and checks the platform itself', () => {
  const helper = read('../src/ios-back.ts');
  assert.match(helper, /^import type \{ NavigationAction \} from 'expo-router';$/m);
  assert.doesNotMatch(helper, /^import (?!type)/m);
  assert.match(helper, /if \(os !== 'ios'\) return \(\) => \{\};/);
});

const screens = {
  profile: '../app/profile.tsx',
  story: '../app/story.tsx',
  map: '../app/games/map.tsx',
  browse: '../src/components/player-browse.tsx',
} as const;

test('Android hardwareBackPress handlers stay byte-identical in all four screens', () => {
  const profile = read(screens.profile);
  assert.ok(profile.includes(`function ProfileHardwareBack({ editing, onClose }: { editing: boolean; onClose: () => void }) {
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) {
        onClose();
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [editing, onClose]));
  return null;
}`));
  assert.ok(profile.includes('<ProfileHardwareBack editing={editing} onClose={() => setEditing(false)} />'));
  const story = read(screens.story);
  assert.ok(story.includes(`  const finish = useCallback(() => { finishStory(); router.replace('/city'); }, [finishStory, router]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { finish(); return true; });
    return () => back.remove();
  }, [finish]));`));
  const map = read(screens.map);
  assert.ok(map.includes(`  const back = useCallback(() => {
    const next = mapBack(overlay);
    if (next) setOverlay(next); else returnToList();
    return true;
  },[overlay,returnToList]);
  useFocusEffect(useCallback(() => {const listener = BackHandler.addEventListener('hardwareBackPress',back);return () => listener.remove();},[back]));`));
  const browse = read(screens.browse);
  assert.ok(browse.includes(`  useEffect(() => {
    if (!focused) return;
    const back=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(owner.getSnapshot().match)owner.dismiss();
      else if(tutorial!==0)setTutorial(0);
      else if(info!==null)setInfo(null);
      else onClose();
      return true;
    });
    return ()=>back.remove();
  }, [focused,owner,tutorial,info,onClose]);`));
});

test('iOS guard is bound to Platform.OS and wired with the same layers in all four screens', () => {
  for (const path of Object.values(screens)) {
    const source = read(path);
    assert.match(source, /import \{ bindIosBack \} from '\.\.?\/(\.\.\/)?(src\/)?ios-back\.ts';/);
    assert.match(source, /const useIosBack = bindIosBack\(Platform\.OS, usePreventRemove\);/);
    assert.match(source, /import \{[^}]*\busePreventRemove\b[^}]*\} from 'expo-router';/);
    assert.match(source, /import \{[^}]*\bPlatform\b[^}]*\} from 'react-native';/);
    assert.equal(source.match(/useIosBack\(/g)?.length, 1);
  }
  const profile = read(screens.profile);
  assert.match(profile, /function ProfileIosBack\(\{ editing, onClose \}: \{ editing: boolean; onClose: \(\) => void \}\) \{\n {2}useIosBack\(editing, onClose\);\n {2}return null;\n\}/);
  assert.match(profile, /<ProfileHardwareBack editing=\{editing\} onClose=\{\(\) => setEditing\(false\)\} \/>\n {4}<ProfileIosBack editing=\{editing\} onClose=\{\(\) => setEditing\(false\)\} \/>/);
  const story = read(screens.story);
  assert.match(story, /useIosBack\(!\(hydrated && preferences\.storyCompleted\), release => \{ release\(\); finish\(\); \}\);/);
  assert.ok(story.indexOf('useIosBack(') < story.indexOf('return <Redirect'));
  assert.match(read(screens.map), /useIosBack\(mapBack\(overlay\) !== null,back\);/);
  const browse = read(screens.browse);
  assert.match(browse, /function BrowseIosBack\(\{open,onBack\}:\{open:boolean;onBack:\(\)=>void\}\) \{\n {2}useIosBack\(open,onBack\);\n {2}return null;\n\}/);
  const guard = browse.slice(browse.indexOf('<BrowseIosBack'));
  assert.match(guard, /^<BrowseIosBack open=\{focused && \(!!state\.match \|\| tutorial!==0 \|\| info!==null\)\} onBack=\{\(\)=>\{\n {6}if\(owner\.getSnapshot\(\)\.match\)owner\.dismiss\(\);\n {6}else if\(tutorial!==0\)setTutorial\(0\);\n {6}else if\(info!==null\)setInfo\(null\);\n {4}\}\} \/>\n {2}<\/ScreenFrame>;/);
});

test('every iOS layer keeps a visible on-screen close/back control', () => {
  assert.match(read(screens.profile), /← Мой профиль/);
  const story = read(screens.story);
  assert.match(story, /title="Пропустить" onPress=\{finish\}/);
  assert.match(story, /title="Продолжить гостем" onPress=\{finish\}/);
  const map = read(screens.map);
  assert.match(map, /accessibilityLabel="К списку игр" onPress=\{returnToList\}/);
  assert.match(read('../src/components/ui.tsx'), /accessibilityLabel=\{`Закрыть: \$\{title\}`\} onPress=\{onClose\}/);
  assert.match(read('../src/components/venue-sheet.tsx'), /accessibilityLabel=\{expanded \? 'Свернуть площадку' : 'Закрыть площадку'\}/);
  assert.match(read('../src/components/friendly-match.tsx'), /accessibilityLabel="Закрыть дружеский матч" onPress=\{onDismiss\}/);
  const browse = read(screens.browse);
  assert.match(browse, /accessibilityLabel="Закрыть подсказку" onPress=\{\(\)=>setTutorial\(0\)\}/);
  assert.match(browse, /info===0\?'К обложке':'Назад'/);
  assert.match(browse, /accessibilityLabel="Закрыть свайп и вернуться к игрокам" onPress=\{onClose\}/);
});
