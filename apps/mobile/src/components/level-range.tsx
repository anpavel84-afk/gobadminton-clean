import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { Label } from './ui.tsx';
import { colors } from '../theme.ts';
import {
  applyLevelBoundChange,
  levelSelectedFill,
  levelVisualPercent,
  levelFromTrackX,
  resolveLevelPointerBound,
  snapLevel,
  stepLevel,
  type LevelBound,
} from '../level-range.ts';

const THUMB = 28;
const TRACK_H = 4;

export function LevelRange({ lower, upper, onUpdate }: {
  lower: number;
  upper: number;
  onUpdate: (patch: { lower: number; upper: number }) => void;
}) {
  const lo = snapLevel(lower);
  const hi = snapLevel(upper);
  const fill = levelSelectedFill(lo, hi);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valuesRef = useRef({ lower: lo, upper: hi });
  const boundRef = useRef<LevelBound | null>(null);
  const onUpdateRef = useRef(onUpdate);
  valuesRef.current = { lower: lo, upper: hi };
  onUpdateRef.current = onUpdate;

  const apply = (bound: LevelBound, x: number) => {
    const next = applyLevelBoundChange(bound, levelFromTrackX(x, widthRef.current), valuesRef.current.lower, valuesRef.current.upper);
    if (next.lower === valuesRef.current.lower && next.upper === valuesRef.current.upper) return;
    valuesRef.current = next;
    onUpdateRef.current(next);
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      const x = event.nativeEvent.locationX;
      const bound = resolveLevelPointerBound(x, widthRef.current, valuesRef.current.lower, valuesRef.current.upper) ?? 'lower';
      boundRef.current = bound;
      apply(bound, x);
    },
    onPanResponderMove: (event: GestureResponderEvent) => {
      const bound = boundRef.current;
      if (!bound) return;
      apply(bound, event.nativeEvent.locationX);
    },
    onPanResponderRelease: () => { boundRef.current = null; },
    onPanResponderTerminate: () => { boundRef.current = null; },
  }), []);

  const onTrackLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const thumbStyle = (value: number, zIndex: number) => ({
    position: 'absolute' as const,
    left: Math.max(0, (levelVisualPercent(value) / 100) * width - THUMB / 2),
    top: (TRACK_H + 16) / 2 - THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.limeDeep,
    zIndex,
  });

  return <View style={{ gap: 12 }}>
    <Label style={{ textAlign: 'left' }}>Уровни игроков · от {lo.toFixed(1)} до {hi.toFixed(1)}</Label>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Label style={{ textAlign: 'left', color: colors.secondary }}>От {lo.toFixed(1)}</Label>
      <Label style={{ textAlign: 'right', color: colors.secondary }}>До {hi.toFixed(1)}</Label>
    </View>
    <View
      {...responder.panHandlers}
      onLayout={onTrackLayout}
      style={{ height: TRACK_H + 16, justifyContent: 'center' }}
      accessible={false}
    >
      <View style={{ height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: colors.lineDark }} />
      <View style={{
        position: 'absolute', left: `${fill.left}%`, width: `${fill.width}%`, height: TRACK_H,
        top: 8, borderRadius: TRACK_H / 2, backgroundColor: colors.limeDeep,
      }} />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="От"
        accessibilityValue={{ text: lo.toFixed(1) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          const dir = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (!dir) return;
          onUpdate(stepLevel('lower', dir, lo, hi));
        }}
        style={thumbStyle(lo, 2)}
      />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="До"
        accessibilityValue={{ text: hi.toFixed(1) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          const dir = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (!dir) return;
          onUpdate(stepLevel('upper', dir, lo, hi));
        }}
        style={thumbStyle(hi, 3)}
      />
    </View>
  </View>;
}
