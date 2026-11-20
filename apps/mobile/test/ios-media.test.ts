import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  AVATAR_FORMATS,
  AVATAR_HEIF_CONVERT_FAILED,
  AVATAR_TRANSPARENCY_USER,
  AvatarSourceError,
  inspectAvatarSource,
  inspectHeifSource,
  isHeifSource,
} from '../src/profile-avatar.ts';
import {
  avatarDownsampleCrop,
  coverCrop,
  prepareOwnAvatarDerivative,
  prepareOwnCoverDerivative,
  type AvatarRuntimeDeps,
} from '../src/profile-avatar-runtime.ts';

const ascii = (text: string) => [...text].map(c => c.charCodeAt(0));
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [size >>> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...ascii(type), ...payload];
}
const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const fullBox = (type: string, payload: number[]) => box(type, [0, 0, 0, 0, ...payload]);
const ispe = (w: number, h: number) => fullBox('ispe', [...u32(w), ...u32(h)]);
const auxC = (urn: string) => fullBox('auxC', [...ascii(urn), 0]);

/** Apple-like HEIC layout: ftyp(heic mif1 MiHE heic) · meta{hdlr pict, iprp{ipco{…}}} · mdat. */
function heic(options: { major?: string; compat?: string[]; handler?: string; properties?: number[][] } = {}) {
  const { major = 'heic', compat = ['mif1', 'MiHE', 'heic'], handler = 'pict' } = options;
  const properties = options.properties ?? [ispe(512, 512), ispe(4032, 3024)];
  const ftyp = box('ftyp', [...ascii(major), 0, 0, 0, 0, ...compat.flatMap(ascii)]);
  const hdlr = fullBox('hdlr', [0, 0, 0, 0, ...ascii(handler), ...new Array(12).fill(0), 0]);
  const meta = fullBox('meta', [...hdlr, ...box('iprp', box('ipco', properties.flat()))]);
  return new Uint8Array([...ftyp, ...meta, ...box('mdat', [1, 2, 3, 4])]);
}
function jpeg(w = 512, h = 512, orientation = 1) {
  return new Uint8Array([
    255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0,
    255, 192, 0, 8, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 255, 217,
  ]);
}

function fakeDeps(files: Map<string, Uint8Array>, calls: string[], ios: boolean, converted = jpeg(2048, 1536)): AvatarRuntimeDeps {
  const deps: AvatarRuntimeDeps = {
    launchLibrary: async () => ({ canceled: true }),
    openReadOnly: uri => {
      const data = files.get(uri);
      if (!data) throw new Error(`missing ${uri}`);
      let offset = 0;
      return {
        readBytes: async n => {
          const slice = data.slice(offset, offset + n);
          offset += slice.length;
          return slice;
        },
        close: () => undefined,
      };
    },
    deleteTracked: async uri => {
      calls.push(`delete:${uri}`);
      files.delete(uri);
    },
    isOwnedCacheUri: uri => uri.startsWith('file:///cache/'),
    centerSquare512: async (uri, meta, maxEdge) => {
      calls.push(`square:${uri}:${meta.width}x${meta.height}:${meta.orientation}:${maxEdge}`);
      files.set('file:///cache/ImageManipulator/square.jpg', jpeg(512, 512));
      return { uri: 'file:///cache/ImageManipulator/square.jpg', width: 512, height: 512 };
    },
    coverFrame1200x400: async (uri, meta, position, maxEdge) => {
      calls.push(`cover:${uri}:${meta.width}x${meta.height}:${position.x},${position.y}:${maxEdge}`);
      files.set('file:///cache/ImageManipulator/cover.jpg', jpeg(1200, 400));
      return { uri: 'file:///cache/ImageManipulator/cover.jpg', width: 1200, height: 400 };
    },
    saveDerivative: async (renderedUri, format) => {
      const uri = `file:///cache/ImageManipulator/out.${format}`;
      const cover = renderedUri.endsWith('cover.jpg');
      files.set(uri, format === 'jpeg' ? jpeg(cover ? 1200 : 512, cover ? 400 : 512) : new Uint8Array([0]));
      return { uri };
    },
  };
  if (ios) {
    deps.heicToJpeg = async (uri, maxEdge) => {
      calls.push(`heic:${uri}:${maxEdge}`);
      const meta = inspectAvatarSource(converted);
      files.set('file:///cache/ImageManipulator/heic.jpg', converted);
      return { uri: 'file:///cache/ImageManipulator/heic.jpg', width: meta.width, height: meta.height };
    };
  }
  return deps;
}

const HEIC_URI = 'file:///cache/ImagePicker/IMG_0001.heic';

test('iOS HEIC/HEIF header gate: still brands, pict handler, largest ispe, alpha and 50 Mp budget', () => {
  assert.equal(isHeifSource(heic()), true);
  assert.equal(isHeifSource(heic({ major: 'mif1', compat: ['mif1', 'heic'] })), true);
  assert.equal(isHeifSource(heic({ major: 'avif', compat: ['avif', 'mif1', 'miaf'] })), false);
  assert.equal(isHeifSource(jpeg()), false);
  assert.equal(isHeifSource(new Uint8Array(8)), false);
  assert.deepEqual(inspectHeifSource(heic(), 'image/heic'), { width: 4032, height: 3024, hasAlpha: false });
  assert.deepEqual(inspectHeifSource(heic(), 'image/heif'), { width: 4032, height: 3024, hasAlpha: false });
  assert.deepEqual(inspectHeifSource(heic()), { width: 4032, height: 3024, hasAlpha: false });
  // Apple depth/gain-map auxiliaries are not alpha; only the alpha URNs fail closed.
  assert.equal(inspectHeifSource(heic({ properties: [ispe(4032, 3024), auxC('urn:com:apple:photo:2020:aux:hdrgainmap')] })).hasAlpha, false);
  assert.equal(inspectHeifSource(heic({ properties: [ispe(4032, 3024), auxC('urn:mpeg:hevc:2015:auxid:1')] })).hasAlpha, true);
  assert.equal(inspectHeifSource(heic({ properties: [ispe(64, 64), auxC('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha')] })).hasAlpha, true);
  assert.throws(() => inspectHeifSource(heic(), 'image/jpeg'), (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_FORMATS);
  assert.throws(() => inspectHeifSource(heic({ major: 'msf1', compat: ['msf1', 'heic'] })), (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_FORMATS);
  assert.throws(() => inspectHeifSource(heic({ handler: 'vide' })), (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_FORMATS);
  assert.throws(() => inspectHeifSource(heic({ properties: [ispe(10000, 5001)] })), /50 Мп/);
  assert.throws(() => inspectHeifSource(heic({ properties: [] })), /повреждено/);
  assert.throws(() => inspectHeifSource(heic().slice(0, 60)), /повреждено/);
});

test('iOS HEIC pick → upright JPEG via heicToJpeg → existing 512 crop; converted cache file is cleaned up', async () => {
  const files = new Map([[HEIC_URI, heic()]]);
  const calls: string[] = [];
  const derivative = await prepareOwnAvatarDerivative(fakeDeps(files, calls, true), { uri: HEIC_URI, mimeType: 'image/heic' }, () => false);
  assert.equal(derivative.mime, 'image/jpeg');
  assert.equal(calls[0], `heic:${HEIC_URI}:2048`);
  assert.equal(calls[1], 'square:file:///cache/ImageManipulator/heic.jpg:2048x1536:1:2048');
  assert.ok(calls.includes('delete:file:///cache/ImageManipulator/heic.jpg'));
  assert.ok(calls.includes(`delete:${HEIC_URI}`));
});

test('iOS HEIC cover path crops the converted JPEG, never the HEIC container', async () => {
  const files = new Map([[HEIC_URI, heic()]]);
  const calls: string[] = [];
  const derivative = await prepareOwnCoverDerivative(fakeDeps(files, calls, true), { uri: HEIC_URI, mimeType: 'image/heic' }, { x: 0.5, y: 0.2 }, () => false);
  assert.equal(derivative.mime, 'image/jpeg');
  assert.equal(calls[0], `heic:${HEIC_URI}:2048`);
  assert.equal(calls[1], 'cover:file:///cache/ImageManipulator/heic.jpg:2048x1536:0.5,0.2:2048');
});

test('iOS HEIC fails closed on alpha, unverifiable conversion and mismatched declared type', async () => {
  const alpha = new Map([[HEIC_URI, heic({ properties: [ispe(4032, 3024), auxC('urn:mpeg:hevc:2015:auxid:1')] })]]);
  const calls: string[] = [];
  await assert.rejects(prepareOwnAvatarDerivative(fakeDeps(alpha, calls, true), { uri: HEIC_URI, mimeType: 'image/heic' }, () => false),
    (e: unknown) => e instanceof AvatarSourceError && e.code === 'WHITE_FLATTEN_UNPROVEN' && e.message === AVATAR_TRANSPARENCY_USER);
  assert.equal(calls.some(c => c.startsWith('heic:')), false);
  const rotated = new Map([[HEIC_URI, heic()]]);
  await assert.rejects(prepareOwnAvatarDerivative(fakeDeps(rotated, [], true, jpeg(2048, 1536, 6)), { uri: HEIC_URI, mimeType: 'image/heic' }, () => false),
    (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_HEIF_CONVERT_FAILED);
  const mislabeled = new Map([[HEIC_URI, heic()]]);
  await assert.rejects(prepareOwnAvatarDerivative(fakeDeps(mislabeled, [], true), { uri: HEIC_URI, mimeType: 'image/png' }, () => false),
    (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_FORMATS);
});

test('Android (no heicToJpeg) keeps the exact previous behaviour: HEIC rejected, JPEG cropped from the picked URI', async () => {
  const files = new Map([[HEIC_URI, heic()]]);
  const calls: string[] = [];
  await assert.rejects(prepareOwnAvatarDerivative(fakeDeps(files, calls, false), { uri: HEIC_URI, mimeType: 'image/heic' }, () => false),
    (e: unknown) => e instanceof AvatarSourceError && e.message === AVATAR_FORMATS);
  assert.equal(calls.some(c => c.startsWith('heic:') || c.startsWith('square:')), false);
  const source = 'content://media/picker/0/photo.jpg';
  const jpegFiles = new Map([[source, jpeg(800, 600, 6)]]);
  const jpegCalls: string[] = [];
  await prepareOwnAvatarDerivative(fakeDeps(jpegFiles, jpegCalls, false), { uri: source, mimeType: 'image/jpeg' }, () => false);
  assert.equal(jpegCalls[0], `square:${source}:800x600:6:800`);
  assert.equal(jpegCalls.includes(`delete:${source}`), false);
  // iOS JPEG/PNG/WebP originals bypass the converter too.
  const iosJpeg = new Map([['file:///cache/ImagePicker/a.jpeg', jpeg(800, 600)]]);
  const iosCalls: string[] = [];
  await prepareOwnAvatarDerivative(fakeDeps(iosJpeg, iosCalls, true), { uri: 'file:///cache/ImagePicker/a.jpeg', mimeType: 'image/jpeg' }, () => false);
  assert.equal(iosCalls[0], 'square:file:///cache/ImagePicker/a.jpeg:800x600:1:800');
});

test('iOS crop uses the decoded bitmap size: a 1 px ImageIO rounding difference stays in bounds', () => {
  // iPhone screenshot 1179×2556 downsampled to 2048: JS predicts 945 px wide; ImageIO may yield 944.
  const predicted = avatarDownsampleCrop({ width: 1179, height: 2556 }, 2048);
  assert.equal(predicted.width, 945);
  assert.ok(predicted.originX + predicted.width > 944);
  const exact = avatarDownsampleCrop({ width: 944, height: 2048 }, 2048);
  assert.deepEqual(exact, { originX: 0, originY: 552, width: 944, height: 944, decodeMax: 2048 });
  const cover = coverCrop(944, 2048, 0.5, 0.5);
  assert.ok(cover.originX + cover.width <= 944 && cover.originY + cover.height <= 2048);
});

test('live adapter wires heicToJpeg and decoded-size crop only behind Platform.OS === ios; Android branch unchanged', () => {
  const source = readFileSync(new URL('../src/profile-avatar-runtime.ts', import.meta.url), 'utf8');
  const adapter = source.slice(source.indexOf('export function createExpoAvatarRuntime'));
  const lines = (...parts: string[]) => parts.join('\n');
  const count = (text: string, needle: string) => text.split(needle).length - 1;
  assert.ok(adapter.includes(lines(
    "  const { Platform } = require('react-native') as typeof ReactNativeModule;",
    "  const ios = Platform.OS === 'ios';",
  )));
  assert.ok(adapter.includes(lines('  if (ios) {', '    runtime.heicToJpeg = async (inputUri, maxEdge) => {')));
  assert.equal(count(adapter, 'heicToJpeg'), 1);
  assert.equal(count(adapter, lines('      if (ios) {', '        return iosDecodedCrop(')), 2);
  assert.ok(adapter.includes('manipulator.ImageManipulator.manipulate(decoded)'));
  assert.ok(adapter.includes('decoded.release();'));
  // Android keeps the single-pass crop from JS-predicted downsample dimensions.
  for (const decodeMax of ['crop.decodeMax', 'decodeMax']) {
    assert.ok(adapter.includes(lines(
      '      const image = await manipulator.ImageManipulator.manipulate(inputUri, {',
      `        maxWidth: ${decodeMax},`,
      `        maxHeight: ${decodeMax},`,
      '      })',
      '        .crop({',
    )));
  }
  // react-native stays a lazy require so node tests and the type-only SDK imports keep working.
  assert.doesNotMatch(source, /^import \{[^}]*\} from 'react-native'/m);
  assert.match(source, /^import type \* as ReactNativeModule from 'react-native';$/m);
  // Picker options and app config remain exactly the verified PHPicker fast path.
  assert.ok(source.includes(lines(
    '  quality: 1,',
    '  base64: false,',
    '  exif: false,',
    '  legacy: false,',
    "  preferredAssetRepresentationMode: 'current' as const,",
  )));
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const picker = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker');
  assert.deepEqual(picker[1], { photosPermission: false, cameraPermission: false, microphonePermission: false });
});
