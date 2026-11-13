import { Redirect } from 'expo-router';
import { usePreferences } from '../src/state.tsx';
import { entryRoute } from '../src/entry.ts';
import { BrandLockup, Page } from '../src/components/ui.tsx';
export default function Entry() {
  const { hydrated, preferences } = usePreferences();
  return hydrated ? <Redirect href={entryRoute(preferences)} /> : <Page><BrandLockup launch /></Page>;
}
