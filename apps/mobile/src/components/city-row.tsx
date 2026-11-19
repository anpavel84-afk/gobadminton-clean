import { Pressable, View } from 'react-native';
import { colors } from '../theme.ts';
import { Label } from './ui.tsx';

/** Shared left-aligned city row for search-city and profile-city lists (#606). */
export function CityRow({ name, region, selected = false, onPress, accessibilityLabel }: {
  name: string;
  region?: string | null;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={accessibilityLabel ?? name}
    onPress={onPress}
    style={({ pressed }) => [{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      minHeight: 56, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.line,
      backgroundColor: pressed ? colors.paper : 'transparent',
    }]}>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Label style={{ fontWeight: '600', textAlign: 'left' }}>{name}</Label>
      {region ? <Label style={{ fontSize: 14, lineHeight: 20, color: colors.secondary, textAlign: 'left' }}>{region}</Label> : null}
    </View>
    <View accessible={false} style={{
      width: 24, height: 24, borderRadius: 12, borderWidth: 2,
      borderColor: selected ? colors.ink : colors.lineDark,
      backgroundColor: selected ? colors.lime : colors.card,
      alignItems: 'center', justifyContent: 'center',
    }}>
      {selected ? <Label style={{ fontSize: 14, lineHeight: 18, fontWeight: '700' }}>✓</Label> : null}
    </View>
  </Pressable>;
}
