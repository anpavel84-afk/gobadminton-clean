import { useRouter } from 'expo-router';
import { Header, Label, Page, PrimaryButton } from '../src/components/ui.tsx';
export default function NotFound() {
  const router = useRouter();
  return <Page><Header /><Label>Такой страницы нет.</Label>
    <PrimaryButton title="К каталогу игр" onPress={() => router.replace('/games')} /></Page>;
}
