import Svg, { Path, SvgXml } from 'react-native-svg';

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

// Exact canonical WEB discovery SVG paths, rendered by existing native SVG runtime.
export function DiscoveryIcon({ name }: { name: 'filter' | 'pin' | 'chevron' | 'refresh' | 'close' | 'search' | 'map' | 'list' }) {
  const paths = {
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    filter: 'M1.93333 3.38333H9.66667M1.93333 8.21667H9.66667M3.86667 1.93333V4.83333M7.73333 6.76667V9.66667',
    pin: 'M5.8 10.15C5.8 10.15 9.18333 7.25 9.18333 4.83333C9.18333 4.38903 9.09582 3.94907 8.92579 3.53859C8.75576 3.1281 8.50655 2.75513 8.19238 2.44096C7.87821 2.12678 7.50523 1.87757 7.09475 1.70754C6.68426 1.53751 6.24431 1.45 5.8 1.45C5.35569 1.45 4.91574 1.53751 4.50525 1.70754C4.09477 1.87757 3.72179 2.12678 3.40762 2.44096C3.09345 2.75513 2.84424 3.1281 2.67421 3.53859C2.50418 3.94907 2.41667 4.38903 2.41667 4.83333C2.41667 7.25 5.8 10.15 5.8 10.15Z',
    chevron: 'm7 10 5 5 5-5',
    refresh: 'M21 12a9 9 0 1 1-2.4-6.1M21 4v6h-6',
    close: 'm6 6 12 12M6 18 18 6',
    search: 'M7.25 7.25L10.15 10.15M4.83333 1.45C4.38903 1.45 3.94907 1.53751 3.53859 1.70754C3.1281 1.87757 2.75513 2.12678 2.44096 2.44096C2.12678 2.75513 1.87757 3.1281 1.70754 3.53859C1.53751 3.94907 1.45 4.38903 1.45 4.83333C1.45 5.27764 1.53751 5.71759 1.70754 6.12808C1.87757 6.53856 2.12678 6.91154 2.44096 7.22571C2.75513 7.53988 3.1281 7.7891 3.53859 7.95913C3.94907 8.12915 4.38903 8.21667 4.83333 8.21667C5.27764 8.21667 5.71759 8.12915 6.12808 7.95913C6.53856 7.7891 6.91154 7.53988 7.22571 7.22571C7.53988 6.91154 7.7891 6.53856 7.95913 6.12808C8.12915 5.71759 8.21667 5.27764 8.21667 4.83333C8.21667 4.38903 8.12915 3.94907 7.95913 3.53859C7.7891 3.1281 7.53988 2.75513 7.22571 2.44096C6.91154 2.12678 6.53856 1.87757 6.12808 1.70754C5.71759 1.53751 5.27764 1.45 4.83333 1.45Z',
  };
  const compact = name === 'filter' || name === 'pin' || name === 'search';
  return <Svg viewBox={compact ? '0 0 11.6 11.6' : '0 0 24 24'} width={name === 'chevron' ? 12 : 24} height={name === 'chevron' ? 12 : 24} fill="none" accessible={false}>
    <Path d={paths[name]} stroke="#192820" strokeWidth={compact ? 0.87 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

const createShapeXml = "<svg preserveAspectRatio=\"none\" overflow=\"visible\" style=\"display: block;\" width=\"184\" height=\"160\" viewBox=\"0 0 184 160\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g id=\"Group 16037\">\n<path id=\"Polygon 4\" d=\"M71.9999 79.9997L102 62.6792V97.3202L71.9999 79.9997Z\" fill=\"#34BB48\"/>\n<path id=\"Polygon 5\" d=\"M0 80.0004L30 62.6799V97.3209L0 80.0004Z\" fill=\"#34BB48\"/>\n<path id=\"Polygon 6\" d=\"M72.0006 19.9999L102.001 2.67936V37.3204L72.0006 19.9999Z\" fill=\"#34BB48\"/>\n<path id=\"Polygon 7\" d=\"M72 140L102 122.679V157.32L72 140Z\" fill=\"#34BB48\"/>\n<path id=\"Polygon 8\" d=\"M144 80.0004L174 62.6799V97.3209L144 80.0004Z\" fill=\"#34BB48\"/>\n</g>\n</svg>\n";
export function CreateShape() { return <SvgXml xml={createShapeXml} width={200} height={174} accessible={false} />; }
