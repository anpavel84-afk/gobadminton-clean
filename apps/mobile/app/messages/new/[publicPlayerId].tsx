import { useLocalSearchParams } from 'expo-router';
import { ContactEditor } from '../../../src/components/contact-editor.tsx';
import { Label, Page } from '../../../src/components/ui.tsx';
export default function NewContact() {
  const { publicPlayerId } = useLocalSearchParams<{ publicPlayerId: string }>();
  if (typeof publicPlayerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(publicPlayerId)) return <Page><Label>Недопустимый адрес</Label></Page>;
  return <ContactEditor target={publicPlayerId} />;
}
