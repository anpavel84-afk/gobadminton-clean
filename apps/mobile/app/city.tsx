import { useCallback, useState } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { publicApi } from '../src/public-api.ts';
import { filterCities } from '../src/entry.ts';
import { useResource } from '../src/hooks.ts';
import { usePreferences } from '../src/state.tsx';
import { ErrorState, Header, Label, Loading, Page, TextButton, styles } from '../src/components/ui.tsx';
export default function ManualCity() {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const task = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const { state, retry } = useResource('cities', task);
  const { chooseCity, storageError } = usePreferences();
  const router = useRouter();
  const matches = filterCities(state.data ?? [], all ? '' : query);
  function back() { if (router.canGoBack()) router.back(); else router.replace('/games'); }
  return <Page keyboard header={<Header back={back} />}>
    <Label accessibilityRole="header" style={styles.title}>Выберите город</Label>
    <Label>Выберите город вручную — без входа и геопозиции.</Label>
    <Label nativeID="city-label">Название города</Label>
    <TextInput accessibilityLabel="Название города" placeholder="Введите город" value={query}
      onChangeText={value => { setQuery(value); setAll(false); }} autoCorrect={false} autoCapitalize="words"
      allowFontScaling style={styles.input} returnKeyType="search" />
    <TextButton title="Все доступные города" onPress={() => { setAll(true); setQuery(''); }} />
    {storageError && <Label>Настройки не удалось сохранить или прочитать. Этот выбор будет действовать в текущем запуске.</Label>}
    {state.status === 'loading' && <Loading title="Загружаем города…" />}
    {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
    {state.status === 'ready' && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      {!matches.length && <Label>{query.trim() ? 'Такой город пока недоступен. Выберите другой или откройте все города.' : 'Доступных городов пока нет.'}</Label>}
      {matches.map(city => <View key={city.id} style={styles.card}>
        <TextButton title={city.nameRu} onPress={() => {
          Keyboard.dismiss();
          chooseCity(city.id);
          if (router.canGoBack()) router.back(); else router.replace('/games');
        }} />
      </View>)}
    </View>}
  </Page>;
}
