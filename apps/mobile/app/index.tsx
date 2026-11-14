import { Redirect } from 'expo-router';
import { usePreferences } from '../src/state.tsx';
import { useAuth } from '../src/auth.tsx';
import { hydratedEntryRoute } from '../src/entry.ts';
import { BrandLockup, Loading, Page } from '../src/components/ui.tsx';
export default function Entry() {
  const { hydrated, preferences } = usePreferences();
  const auth = useAuth();
  const route = hydratedEntryRoute(preferences, hydrated, auth);
  return route ? <Redirect href={route as '/games'} /> : <Page><BrandLockup /><Loading title="Восстанавливаем настройки и сессию…" /></Page>;
}
