import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { PublicPlayer } from '../players.ts';
import { playerMediaUrl } from '../media.ts';
import { playerInitials, playerLevelLabel, profileHeroMeta } from '../presentation.ts';
import { profileHeroDecorationXml } from '../profile-hero-art.ts';
import { colors } from '../theme.ts';
import { DiscoveryArrow } from './discovery-icon.tsx';
import { Label, styles } from './ui.tsx';

export function PlayerAvatar({ player, large = false, size: sizeProp }: { player: PublicPlayer; large?: boolean; size?: number }) {
  const [failed, setFailed] = useState<string[]>([]);
  const sources = [player.avatar?.uploadedUrl, player.avatar?.providerUrl].map(url => playerMediaUrl(url, 'avatar'));
  const uri = sources.find(url => url && !failed.includes(url));
  const size = sizeProp ?? (large ? 96 : 46);
  const letter = size >= 96 ? 32 : 16;
  return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: player.trainer ? colors.lavender : colors.yellow }}>
    {uri ? <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailed(previous => [...previous, uri])} />
      : <Label style={{ fontSize: letter, lineHeight: letter + 10 }}>{playerInitials(player.displayName)}</Label>}
  </View>;
}
export function PlayerBadges({ player }: { player: PublicPlayer }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {player.lookingForGame && <Label style={{ backgroundColor: colors.lime, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>Ищу игру</Label>}
    {player.trainer && <Label style={{ backgroundColor: colors.lavender, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>Тренер</Label>}
    {!player.lookingForGame && !player.trainer && <Label>Игрок</Label>}
  </View>;
}
export function PlayerCard({ player, city, onOpen }: { player: PublicPlayer; city?: string; onOpen: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Профиль: ${player.displayName}`} onPress={onOpen}
    style={({ pressed }) => [styles.card, { padding: 17, minHeight: 48, backgroundColor: pressed ? colors.paper : colors.card }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <PlayerAvatar key={`${player.publicPlayerId}:${player.avatar?.uploadedUrl}:${player.avatar?.providerUrl}`} player={player} />
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Label accessibilityRole="header" style={{ fontSize: 19, lineHeight: 24, fontWeight: '700' }}>{player.displayName}</Label>
        <Label style={{ fontSize: 13, lineHeight: 18, fontWeight: '600' }}>{playerLevelLabel(player.level)}{city ? ` · ${city}` : ''}</Label>
        {player.areaKey && <Label style={{ color: colors.secondary, fontSize: 12, lineHeight: 17 }}>Район / метро: {player.areaKey}</Label>}
      </View>
      <View accessible={false} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}><DiscoveryArrow /></View>
    </View>
    {(player.bio || player.trainer || player.lookingForGame) && <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, gap: 8 }}>
      {player.bio && <Label style={{ color: colors.secondary, fontSize: 13, lineHeight: 19 }}>{player.bio}</Label>}
      {(player.trainer || player.lookingForGame) && <PlayerBadges player={player} />}
    </View>}
  </Pressable>;
}

// Exact accepted WEB canonical/ce252.svg; uploaded-cover load-failure fallback only in hero.
export const coverFailureXml = "<svg preserveAspectRatio=\"none\" overflow=\"visible\" style=\"display: block;\" width=\"200\" height=\"200\" viewBox=\"0 0 200 200\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g id=\"&#208;&#164;&#208;&#184;&#208;&#179;&#209;&#131;&#209;&#128;&#208;&#176; 3\">\n<circle id=\"Ellipse 63\" cx=\"25\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 64\" cx=\"75\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 65\" cx=\"125\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 66\" cx=\"175\" cy=\"125\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 67\" cx=\"25\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 68\" cx=\"75\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 69\" cx=\"125\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 70\" cx=\"175\" cy=\"175\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 71\" cx=\"25\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 72\" cx=\"75\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 73\" cx=\"125\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 74\" cx=\"175\" cy=\"25\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 75\" cx=\"25\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 76\" cx=\"75\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 77\" cx=\"125\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n<circle id=\"Ellipse 78\" cx=\"175\" cy=\"75\" r=\"25\" fill=\"#AB3232\"/>\n</g>\n</svg>\n";
export function PlayerCover({ uploadedUrl, source }: {
  uploadedUrl: string | null;
  /** Optional authenticated own-cover source (bearer headers). Public profiles omit this. */
  source?: { uri: string; headers: { Authorization: string } } | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const fallbackUri = playerMediaUrl(uploadedUrl, 'cover');
  const imageSource = source ?? (fallbackUri ? { uri: fallbackUri } : null);
  const failKey = imageSource?.uri ?? null;
  return <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden' }}>
    {imageSource && failKey !== failed
      ? <Image source={imageSource} style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => setFailed(failKey)} />
      : <SvgXml xml={coverFailureXml} width="100%" height="100%" accessible={false} />}
  </View>;
}

function HeroBadges({ player }: { player: PublicPlayer }) {
  const looking = player.lookingForGame === true;
  const trainer = player.trainer === true;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {looking && <Label style={{ backgroundColor: colors.lime, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, color: colors.ink }}>Ищу игру</Label>}
    {trainer && <Label style={{ backgroundColor: colors.lavender, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, color: colors.ink }}>Тренер</Label>}
    {!looking && !trainer && <Label style={{ backgroundColor: colors.lime, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, color: colors.ink }}>Игрок</Label>}
  </View>;
}

/** Shared ink/lime hero matching web PlayerProfileHero (own + public). */
export function PlayerProfileHero({ player, city, coverSource }: {
  player: PublicPlayer;
  city?: string;
  /** Optional authenticated own-cover source (bearer headers). Public profiles omit this. */
  coverSource?: { uri: string; headers: { Authorization: string } } | null;
}) {
  const uploadedUrl = player.cover?.uploadedUrl ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  const fallbackUri = playerMediaUrl(uploadedUrl, 'cover');
  const imageSource = coverSource ?? (fallbackUri ? { uri: fallbackUri } : null);
  const failKey = imageSource?.uri ?? null;
  const showUploaded = Boolean(uploadedUrl && imageSource && failKey !== failed);
  const showFailure = Boolean(uploadedUrl && (!imageSource || failKey === failed));
  const meta = profileHeroMeta(player.level, city, player.areaKey);
  return <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ink }}>
    <View style={{
      position: 'relative', overflow: 'hidden', minHeight: 180, backgroundColor: colors.lime,
      alignItems: 'center', justifyContent: 'center',
    }}>
      {showUploaded && imageSource ? (
        <Image
          source={imageSource}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={() => setFailed(failKey)}
        />
      ) : null}
      {showFailure ? (
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} accessible={false}>
          <SvgXml xml={coverFailureXml} width="100%" height="100%" />
        </View>
      ) : null}
      {!showUploaded ? (
        <View style={{ position: 'absolute', left: -20, bottom: -45, opacity: 0.18 }} accessible={false}>
          <SvgXml xml={profileHeroDecorationXml} width={200} height={200} />
        </View>
      ) : null}
      <View style={{
        zIndex: 2, borderWidth: 6, borderColor: colors.card, borderRadius: 66, overflow: 'hidden',
        width: 132, height: 132, alignItems: 'center', justifyContent: 'center',
      }}>
        <PlayerAvatar
          key={`${player.publicPlayerId}:${player.avatar?.uploadedUrl}:${player.avatar?.providerUrl}`}
          player={player}
          size={120}
        />
      </View>
    </View>
    <View style={{ padding: 24, gap: 12 }}>
      <HeroBadges player={player} />
      <Label accessibilityRole="header" style={{ color: colors.card, fontSize: 28, lineHeight: 34, fontWeight: '700' }}>
        {player.displayName}
      </Label>
      {meta ? <Label style={{ color: colors.lime, fontSize: 15, lineHeight: 22 }}>{meta}</Label> : null}
      {player.bio ? <Label style={{ color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 22 }}>{player.bio}</Label> : null}
    </View>
  </View>;
}

export function PlayerProfile({ player, city }: { player: PublicPlayer; city?: string }) {
  return <>
    <PlayerProfileHero player={player} city={city} />
    <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Игровой профиль</Label>
      <Label>Уровень: {playerLevelLabel(player.level)}</Label>
      <Label>Район / метро: {player.areaKey || 'Не указан'}</Label>
    </View>
  </>;
}
