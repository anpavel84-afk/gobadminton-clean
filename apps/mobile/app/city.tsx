import { useCallback, useState } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { publicApi } from '../src/public-api.ts';
import { filterCities, selectedCity } from '../src/entry.ts';
import { useResource } from '../src/hooks.ts';
import { usePreferences } from '../src/state.tsx';
import { CityRow } from '../src/components/city-row.tsx';
import { colors } from '../src/theme.ts';
import { BackLink, ErrorState, Header, Label, Loading, OutlineButton, Page, TextButton, styles } from '../src/components/ui.tsx';
export default function ManualCity() {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const task = useCallback((signal: AbortSignal) => publicApi.cities(signal), []);
  const { state, retry } = useResource('cities', task);
  const { preferences, chooseCity, storageError } = usePreferences();
  const router = useRouter();
  const matches = filterCities(state.data ?? [], all ? '' : query);
  const current = selectedCity(state.data ?? [], preferences.cityId);
  function back() { if (router.canGoBack()) router.back(); else router.replace('/games'); }
  function pick(cityId: string) {
    Keyboard.dismiss();
    chooseCity(cityId);
    if (router.canGoBack()) router.back(); else router.replace('/games');
  }
  return <Page keyboard header={<Header />}>
    <BackLink title="← К играм" onPress={back} />
    <Label accessibilityRole="header" style={styles.title}>Где хотите играть?</Label>
    <Label>Выберите город, в котором хотите играть.</Label>
    <Label nativeID="city-label">Название города</Label>
    <TextInput accessibilityLabel="Название города" placeholder="Введите город" value={query}
      onChangeText={value => { setQuery(value); setAll(false); }} autoCorrect={false} autoCapitalize="words"
      allowFontScaling style={styles.input} returnKeyType="search" />
    <TextButton title="Все доступные города" onPress={() => { setAll(true); setQuery(''); }} />
    {storageError && <Label>Настройки не удалось сохранить или прочитать. Этот выбор будет действовать в текущем запуске.</Label>}
    {state.status === 'loading' && <Loading title="Загружаем города…" />}
    {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
    {state.status === 'ready' && <View accessibilityLiveRegion="polite" style={{ gap: 16 }}>
      {!matches.length && <Label>{query.trim() ? 'Такой город пока недоступен. Выберите другой или откройте все города.' : 'Доступных городов пока нет.'}</Label>}
      {matches.length > 0 && <View style={styles.card} accessibilityLabel="Город">
        <Label accessibilityRole="header" style={styles.subtitle}>Город</Label>
        {matches.map(city => <CityRow key={city.id} variant="select" name={city.nameRu}
          selected={city.id === preferences.cityId}
          onPress={() => pick(city.id)} />)}
        {current && <OutlineButton title={`Оставить «${current.nameRu}»`} onPress={() => pick(current.id)} />}
      </View>}
    </View>}
    <View style={{ gap: 4 }}>
      <Label style={{ fontWeight: '700' }}>Город поиска</Label>
      <Label style={{ color: colors.secondary }}>Выбор города поиска не меняет город игрового профиля.</Label>
    </View>
  </Page>;
}
