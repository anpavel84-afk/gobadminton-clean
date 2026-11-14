import { useLocalSearchParams } from 'expo-router';
import { GameManagement } from '../../../src/components/game-management.tsx';
export default function ManagedGameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GameManagement id={typeof id === 'string' ? id : ''} />;
}
