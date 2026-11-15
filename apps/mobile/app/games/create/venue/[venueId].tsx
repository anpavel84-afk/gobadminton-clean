import { useLocalSearchParams, useRouter } from 'expo-router';
import { CreateGame } from '../../../../src/components/create-game.tsx';
import { isVenueId } from '../../../../src/venues.ts';
import { Header, Label, Page } from '../../../../src/components/ui.tsx';
export default function VenueCreation() {
  const { venueId } = useLocalSearchParams<{ venueId?: string | string[] }>();
  const router = useRouter();
  const id = typeof venueId === 'string' ? venueId : '';
  if (!isVenueId(id)) return <Page header={<Header back={() => router.canGoBack() ? router.back() : router.replace('/games')} />}><Label>Некорректная ссылка на площадку.</Label></Page>;
  return <CreateGame key={id} venueId={id} />;
}
