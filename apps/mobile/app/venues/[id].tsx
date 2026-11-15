import { useLocalSearchParams } from 'expo-router';
import { VenueDetail } from '../../src/components/venue-detail.tsx';
export default function VenuePage() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <VenueDetail id={typeof id === 'string' ? id : ''} />;
}
