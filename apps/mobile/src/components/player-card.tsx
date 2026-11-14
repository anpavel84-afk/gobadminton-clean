import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { PublicPlayer } from '../players.ts';
import { playerMediaUrl } from '../media.ts';
import { playerInitials, playerLevelLabel } from '../presentation.ts';
import { colors } from '../theme.ts';
import { DiscoveryArrow } from './discovery-icon.tsx';
import { Label, styles } from './ui.tsx';

export function PlayerAvatar({ player, large = false }: { player: PublicPlayer; large?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const sources = [player.avatar?.uploadedUrl, player.avatar?.providerUrl].map(url => playerMediaUrl(url, 'avatar'));
  const uri = sources.find(url => url && !failed.includes(url));
  const size = large ? 96 : 64;
  return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: player.trainer ? colors.lavender : '#FFF0B8' }}>
    {uri ? <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailed(previous => [...previous, uri])} />
      : <Label style={{ fontSize: large ? 32 : 24, lineHeight: large ? 42 : 32 }}>{playerInitials(player.displayName)}</Label>}
  </View>;
}
function PlayerBadges({ player }: { player: PublicPlayer }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {player.lookingForGame && <Label style={{ backgroundColor: colors.lime, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>Ищу игру</Label>}
    {player.trainer && <Label style={{ backgroundColor: colors.lavender, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>Тренер</Label>}
    {!player.lookingForGame && !player.trainer && <Label>Игрок</Label>}
  </View>;
}
export function PlayerCard({ player, city, onOpen }: { player: PublicPlayer; city?: string; onOpen: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Профиль: ${player.displayName}`} onPress={onOpen}
    style={({ pressed }) => [styles.card, { minHeight: 44, backgroundColor: pressed ? colors.paper : colors.card }]}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <PlayerAvatar key={`${player.publicPlayerId}:${player.avatar?.uploadedUrl}:${player.avatar?.providerUrl}`} player={player} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Label accessibilityRole="header" style={styles.subtitle}>{player.displayName}</Label>
        <Label>{playerLevelLabel(player.level)}</Label>
        {[city, player.areaKey].filter(Boolean).length > 0 && <Label style={{ color: colors.secondary }}>{[city, player.areaKey].filter(Boolean).join(' · ')}</Label>}
      </View>
    </View>
    <PlayerBadges player={player} />
    {player.bio && <Label>{player.bio}</Label>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Label style={{ fontWeight: '600' }}>Профиль</Label><DiscoveryArrow /></View>
  </Pressable>;
}

// Exact accepted WEB canonical/ce252.svg; no invented fallback cover artwork.
const defaultCoverXml = "<svg preserveAspectRatio=\"none\" overflow=\"visible\" style=\"display: block;\" width=\"200\" height=\"200\" viewBox=\"0 0 200 200\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g id=\"&#208;&#164;&#208;&#184;&#208;&#179;&#209;&#131;&#209;&#128;&#208;&#176; 3\">\n<circle id=\"Ellipse 63\" cx=\"25\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 64\" cx=\"75\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 65\" cx=\"125\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 66\" cx=\"175\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 67\" cx=\"25\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 68\" cx=\"75\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 69\" cx=\"125\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 70\" cx=\"175\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 71\" cx=\"25\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 72\" cx=\"75\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 73\" cx=\"125\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 74\" cx=\"175\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 75\" cx=\"25\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 76\" cx=\"75\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 77\" cx=\"125\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 78\" cx=\"175\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n</g>\n</svg>\n";
export function PlayerProfile({ player, city }: { player: PublicPlayer; city?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const uri = playerMediaUrl(player.cover?.uploadedUrl, 'cover');
  return <>
    <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.paper }}>
      <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden' }}>
        {uri && uri !== failed ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => setFailed(uri)} />
          : <SvgXml xml={defaultCoverXml} width="100%" height="100%" accessible={false} />}
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <PlayerAvatar key={`${player.publicPlayerId}:${player.avatar?.uploadedUrl}:${player.avatar?.providerUrl}`} player={player} large />
        <PlayerBadges player={player} />
        <Label accessibilityRole="header" style={styles.title}>{player.displayName}</Label>
        <Label>{[playerLevelLabel(player.level), city, player.areaKey].filter(Boolean).join(' · ')}</Label>
        {player.bio && <Label>{player.bio}</Label>}
      </View>
    </View>
    <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Игровой профиль</Label>
      <Label>Уровень: {playerLevelLabel(player.level)}</Label>
      <Label>Район / метро: {player.areaKey || 'Не указан'}</Label>
    </View>
  </>;
}
