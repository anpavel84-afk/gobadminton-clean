import { useLocalSearchParams } from 'expo-router';
import { NativeMessageThread } from '../../../src/components/messages.tsx';
import { canonicalMessagePath } from '../../../src/native-auth-protocol.ts';
import { Label, Page } from '../../../src/components/ui.tsx';
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!canonicalMessagePath(`/messages/invitations/${id}`)) return <Page><Label>Недопустимый адрес</Label></Page>;
  return <NativeMessageThread resource={{ kind: 'invitation', id }} />;
}
