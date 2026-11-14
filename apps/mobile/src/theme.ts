export const colors = {
  purple: '#7945DE', lime: '#A7F447', primaryLabel: '#000000', pressed: '#94DE37',
  disabled: '#C9DDB1', disabledBorder: '#8B9C78', paper: '#F5F6F2', card: '#FFFFFF',
  ink: '#13221A', secondary: '#536159', lavender: '#EEE6FF', purpleInk: '#6131B5',
  line: '#DFE4DC', lineDark: '#CBD3CA', limeSoft: '#EAFFCD', onPurple: '#FFFFFF', storyBody: '#F0E9FF',
} as const;
export const typography = { fontFamily: 'Onest', allowFontScaling: true } as const;
export const primaryLabelStyle = { color: '#000000', opacity: 1, fontFamily: 'Onest', fontSize: 16, lineHeight: 23, fontWeight: '700', textAlign: 'center' } as const;
export function primarySurface(disabled: boolean, pressed: boolean) {
  return {
    backgroundColor: disabled ? colors.disabled : pressed ? colors.pressed : colors.lime,
    borderColor: disabled ? colors.disabledBorder : 'transparent', borderWidth: 1,
    opacity: 1, minHeight: 52, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    justifyContent: 'center',
  } as const;
}
export const interaction = { minHeight: 48, minWidth: 48 } as const;
// E orbits, artwork and placeholders are static even with Reduce Motion off.
export const motionPolicy = { orbitAnimated: false, arrivalAnimated: false, shimmerAnimated: false } as const;
