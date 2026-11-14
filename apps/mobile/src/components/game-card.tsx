import { useRef, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, View } from 'react-native';
import { gamePath, publicGameUrl } from '../native-auth-protocol.ts';
import type { PublicGame } from '../public-api.ts';
import { gameCoverSources } from '../media.ts';
import { cardWhen, formatLabel, levelLabel, settlementLabel, statusLabel } from '../presentation.ts';
import { colors, interaction } from '../theme.ts';
import { Label, TextButton } from './ui.tsx';
import { DiscoveryArrow, ShareIcon } from './discovery-icon.tsx';

export function PublicGameMedia({ game }: { game: PublicGame }) {
  const sources = gameCoverSources(game);
  // Changing the server's projection remounts the phase; late old-image callbacks
  // cannot hide the new game's cover (including recycled FlatList rows).
  return sources.length ? <CoverPhase key={`${game.id}|${sources.join('|')}`} sources={sources} name={game.venue.name} /> : null;
}
function CoverPhase({ sources, name }: { sources: string[]; name: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find(uri => !failed.includes(uri));
  return <View style={card.media}>
    {source ? <Image key={source} source={{ uri: source }} resizeMode="cover" accessibilityLabel={`Обложка: ${name}`}
      style={StyleSheet.absoluteFill} onError={() => setFailed(previous => [...previous, source])} />
      : <View style={card.mediaError} accessibilityLiveRegion="polite">
        <Label>Фото не загрузилось</Label>
        <TextButton title="Повторить загрузку фото" onPress={() => setFailed([])} />
      </View>}
  </View>;
}
export function GameCard({ game, cityName, onOpen }: { game: PublicGame; cityName?: string; onOpen: () => void }) {
  const when = cardWhen(game);
  const format = formatLabel(game.formatKey);
  const hasMedia = gameCoverSources(game).length > 0;
  return <View style={card.surface}>
    <View><PublicGameMedia game={game} />
      {hasMedia && <View style={{ position: 'absolute', top: 12, left: 12 }}><Label style={card.activity}>{game.activityKind === 'trainer_led' ? 'С тренером' : 'Обычная игра'}</Label></View>}
    </View>
    <View style={card.content}>
      {!hasMedia && <Label style={[card.activity, game.activityKind === 'trainer_led' && { backgroundColor: colors.lavender, color: colors.purple }]}>
        {game.activityKind === 'trainer_led' ? 'С тренером' : 'Обычная игра'}
      </Label>}
      <View style={card.topline}>
        <Label style={card.secondary}>{when.day}</Label>
        <Label style={[card.seats, (game.availablePlaces <= 0 || game.status !== 'published') && { backgroundColor: colors.paper }]}>
          {game.status !== 'published' ? statusLabel(game) : game.availablePlaces > 0 ? `Свободно ${game.availablePlaces} из ${game.capacity}` : 'Мест нет'}
        </Label>
      </View>
      <Label style={card.time}>{when.time}</Label>
      <Label style={card.secondary}>{game.timezone}</Label>
      <Pressable accessibilityRole="button" accessibilityLabel={`Подробнее: ${game.title}`} onPress={onOpen} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Label accessibilityRole="header" style={card.title}>{game.title}</Label>
      </Pressable>
      <Label style={{ fontWeight: '600' }}>{game.venue.name}</Label>
      <Label style={card.secondary}>{cityName ? `${cityName} · ` : ''}{game.venue.address}</Label>
      <View style={card.meta}>
        <Label style={card.secondary}>Уровень: {levelLabel(game.levelRule)}</Label>
        {format && <Label style={card.secondary}>{format}</Label>}
      </View>
      <Label style={card.secondary}>{settlementLabel(game)}</Label>
      <View style={card.host}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          {game.activityKind === 'trainer_led' && <>
            <Label style={card.secondary}>Тренер</Label>
            <Label style={{ fontWeight: '600' }}>{game.trainer?.displayName ?? 'Профиль недоступен'}</Label>
          </>}
          <Label style={card.secondary}>Организатор</Label>
          <Label style={{ fontWeight: '600' }}>{game.organizer.displayName}</Label>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginLeft: 'auto' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Подробнее: ${game.title}`} onPress={onOpen}
            style={({ pressed }) => [card.details, pressed && { backgroundColor: colors.paper }]}><DiscoveryArrow /></Pressable>
          <GameShare gameId={game.id} />
        </View>
      </View>
    </View>
  </View>;
}
function GameShare({ gameId }: { gameId: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const locked = useRef(false);
  const sharePath = gamePath(gameId);
  async function share() {
    if (locked.current) return;
    locked.current = true; setNotice(null); setFailed(false);
    try {
      const result = await Share.share({ message: publicGameUrl(gameId) });
      setNotice(result.action === Share.dismissedAction ? 'Отправка отменена.' : 'Ссылка передана системной отправке.');
    } catch { setFailed(true); setNotice('Не удалось открыть отправку. Ссылку можно выделить и скопировать.'); }
    finally { locked.current = false; }
  }
  if (!sharePath) return null;
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Поделиться игрой" onPress={() => void share()} style={card.details}><ShareIcon /></Pressable>
    {notice && <Label accessibilityLiveRegion="polite" style={card.secondary}>{notice}</Label>}
    {failed && <Label selectable style={card.secondary}>{publicGameUrl(gameId)}</Label>}
  </View>;
}
const card = StyleSheet.create({
  surface: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  media: { height: 210, backgroundColor: colors.paper },
  mediaError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 18, gap: 6 },
  activity: { alignSelf: 'flex-start', borderRadius: 8, backgroundColor: colors.limeSoft, paddingHorizontal: 10, paddingVertical: 4, fontWeight: '600' },
  topline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 },
  secondary: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  seats: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.limeSoft, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  time: { fontSize: 19, lineHeight: 26, fontWeight: '700' },
  title: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  host: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, marginTop: 6 },
  details: { ...interaction, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: colors.lineDark, borderRadius: 24, justifyContent: 'center' },
});
