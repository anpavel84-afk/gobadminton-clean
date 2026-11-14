import Svg, { Path } from 'react-native-svg';

/** Native path port of accepted apps/web/public/discovery/arrow.svg; no new icon. */
export function DiscoveryArrow() {
  return <Svg viewBox="0 0 10.44 10.44" width={20} height={20} fill="none" accessible={false}>
    <Path d="M2.175 5.22H8.265M6.09 7.395L8.265 5.22L6.09 3.045" stroke="#192820" strokeWidth={0.783} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

/** Exact accepted web GameShare path. */
export function ShareIcon() {
  return <Svg viewBox="0 0 24 24" width={20} height={20} fill="none" accessible={false}>
    <Path d="M12 16V3m-4 4 4-4 4 4M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" stroke="#192820" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
