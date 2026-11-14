import Svg, { Path } from 'react-native-svg';

/** Native path port of accepted apps/web/public/discovery/arrow.svg; no new icon. */
export function DiscoveryArrow() {
  return <Svg viewBox="0 0 10.44 10.44" width={20} height={20} fill="none" accessible={false}>
    <Path d="M2.175 5.22H8.265M6.09 7.395L8.265 5.22L6.09 3.045" stroke="#192820" strokeWidth={0.783} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
