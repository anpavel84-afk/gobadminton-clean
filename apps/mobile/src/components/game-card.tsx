import { useRef, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, View } from 'react-native';
import { gamePath, publicGameUrl } from '../native-auth-protocol.ts';
import type { PublicGame } from '../public-api.ts';
import { gameCoverSources, playerMediaUrl } from '../media.ts';
import { canShareGame, cardWhen, gamePeople, playerInitials, formatLabel, levelLabel, settlementTerms, statusLabel } from '../presentation.ts';
import { colors, interaction } from '../theme.ts';
import { Label, TextButton } from './ui.tsx';
import { DiscoveryArrow, DiscoveryIcon, ShareIcon } from './discovery-icon.tsx';
import { GameRoleReputationDisclosure } from './game-role-reputation.tsx';

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
  const [trainerExpanded, setTrainerExpanded] = useState(false);
  const hasMedia = gameCoverSources(game).length > 0;
  const trainerLed = game.activityKind === 'trainer_led';
  return <View style={card.surface}>
    <View><PublicGameMedia game={game} />
      {hasMedia && <View style={{ position: 'absolute', top: 14, left: 14 }}><Label style={[card.activity, game.activityKind === 'trainer_led' && { backgroundColor: colors.lavender, color: colors.purple }]}>{game.activityKind === 'trainer_led' ? 'С тренером' : 'Обычная игра'}</Label></View>}
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
      <Label accessibilityLabel={`${when.day}, ${when.time}, ${game.timezone}`} style={card.time}>{when.time}</Label>
      <Pressable accessibilityRole="link" accessibilityLabel={game.title} onPress={onOpen}
        style={({ pressed }) => [card.titleLink, pressed && { backgroundColor: colors.paper }]}>
        <Label accessibilityRole="header" style={card.title}>{game.title}</Label>
      </Pressable>
      <Label style={{ fontWeight: '600' }}>{game.venue.name}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}><DiscoveryIcon name="pin" /><Label style={[card.secondary, { flex: 1 }]}>{cityName ? `${cityName} · ` : ''}{game.venue.address}</Label></View>
      <View style={card.meta}>
        <Label style={card.secondary}>Уровень: {levelLabel(game.levelRule)}</Label>
        {format && <Label style={card.secondary}>{format}</Label>}
      </View>
      <Label style={card.secondary}>{settlementTerms(game.settlement)}</Label>
      {/* #521/#522 order: TRAINER → ORGANIZER → Отзывы и история → details/share → expanded body. */}
      {gamePeople(game).map(person => <View key={person.role} style={card.host}>
        <GamePersonAvatar key={`${game.id}:${person.role}:${person.name}:${person.avatar?.uploadedUrl}:${person.avatar?.providerUrl}`} name={person.trainer && !game.trainer ? '' : person.name} avatar={person.avatar} trainer={person.trainer} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Label style={{ color: colors.secondary, fontSize: 10, lineHeight: 14 }}>{person.role}</Label>
          <Label style={{ fontSize: 13, lineHeight: 18, fontWeight: '600' }}>{person.name}</Label>
        </View>
        {person.trainer && game.trainingDescription && <Pressable accessibilityRole="button" accessibilityLabel="Подробнее о тренировке" accessibilityState={{ expanded: trainerExpanded }} onPress={() => setTrainerExpanded(v => !v)} style={card.details}><DiscoveryIcon name="chevron" /></Pressable>}
        {!person.trainer && !trainerLed && <GameActions game={game} onOpen={onOpen} />}
        {person.trainer && trainerExpanded && game.trainingDescription && <Label style={[card.secondary, { width: '100%' }]}>{game.trainingDescription}</Label>}
      </View>)}
      <GameRoleReputationDisclosure
        game={game}
        actions={trainerLed ? <View style={card.actionsRow}><GameActions game={game} onOpen={onOpen} /></View> : undefined}
      />
    </View>
  </View>;
}
function GameActions({ game, onOpen }: { game: PublicGame; onOpen: () => void }) {
  return <View style={card.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Подробнее: ${game.title}`} onPress={onOpen}
      style={({ pressed }) => [card.details, pressed && { backgroundColor: colors.paper }]}><DiscoveryArrow /></Pressable>
    {canShareGame(game) && <GameShare gameId={game.id} />}
  </View>;
}
function GamePersonAvatar({ name, avatar, trainer }: { name: string; avatar?: PublicGame['organizer']['avatar']; trainer: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const uri = [avatar?.uploadedUrl, avatar?.providerUrl].map(value => playerMediaUrl(value, 'avatar')).find(value => value && !failed.includes(value));
  return <View accessible={false} style={{ width: 38, height: 38, borderRadius: 19, overflow: 'hidden', backgroundColor: trainer ? colors.lavender : colors.lime, alignItems: 'center', justifyContent: 'center' }}>
    {uri ? <Image source={{ uri }} style={{ width: 38, height: 38 }} onError={() => setFailed(values => [...values, uri])} /> : <Label style={{ fontSize: 12, lineHeight: 17 }}>{playerInitials(name)}</Label>}
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
  return <View style={{ gap: 4, flexShrink: 1 }}>
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
  activity: { alignSelf: 'flex-start', borderRadius: 8, backgroundColor: colors.limeSoft, paddingHorizontal: 10, paddingVertical: 4, fontWeight: '600', fontSize: 12, lineHeight: 17 },
  topline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 },
  secondary: { color: colors.secondary, fontSize: 13, lineHeight: 19 },
  seats: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.limeSoft, fontWeight: '600', fontSize: 13, lineHeight: 19 },
  time: { fontSize: 19, lineHeight: 26, fontWeight: '700' },
  title: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  titleLink: { minHeight: interaction.minHeight, justifyContent: 'center', borderRadius: 8 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  host: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginLeft: 'auto', flexShrink: 1, maxWidth: '100%' },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', width: '100%', marginTop: 4 },
  details: { ...interaction, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: colors.lineDark, borderRadius: 12, justifyContent: 'center' },
});
