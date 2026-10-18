import { expect, it } from "vitest";
import { allowedMapResource, MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
const prefix = MOSCOW_BUNDLE.prefix;
it.each([
  `${prefix}style-dev.json`, `${prefix}moscow.pmtiles`, `pmtiles://${prefix}moscow.pmtiles`,
  `pmtiles://${prefix}moscow.pmtiles/14/9901/5120`,
  `${prefix}fonts/Noto%20Sans%20Regular/0-255.pbf`, `${prefix}fonts/{fontstack}/{range}.pbf`,
  `${prefix}sprites/sprite.json`, `${prefix}sprites/sprite.png`, `${prefix}sprites/sprite@2x.png`, `${prefix}metro.geojson`,
])("accepts bundle resource %s", url => expect(allowedMapResource(url)).toBe(true));
it.each([
  prefix.replace("dev.gobadminton.ru", "other.test") + "style-dev.json",
  prefix.slice(0, -1) + "-lookalike/style-dev.json",
  `${prefix}style-dev.json?token=secret`, `${prefix}style-dev.json#fragment`,
  prefix.replace("https://", "https://user:pass@") + "style-dev.json",
  `pmtiles://${prefix}moscow.pmtiles/1/1/1?token=secret`, `${prefix}../outside.json`,
])("rejects unapproved resource %s", url => expect(allowedMapResource(url)).toBe(false));
