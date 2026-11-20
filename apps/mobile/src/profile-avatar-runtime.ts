import {
  AVATAR_DERIVATIVE_MAX_BYTES,
  AVATAR_DERIVATIVE_OVERSIZE,
  AVATAR_HEIF_CONVERT_FAILED,
  AVATAR_PREPROCESS_MS,
  AVATAR_SIZE,
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_TRANSPARENCY_USER,
  AvatarSourceError,
  assertDerivativeReady,
  assertOpaqueAvatarSource,
  avatarDeadline,
  avatarOrientedSize,
  cloneDerivativeBytes,
  inspectAvatarSource,
  inspectHeifSource,
  isHeifSource,
  stripAvatarMetadata,
  type AvatarDerivative,
  type AvatarMetadata,
} from './profile-avatar.ts';
import type * as ExpoFileSystemModule from 'expo-file-system';
import type * as ExpoImageManipulatorModule from 'expo-image-manipulator';
import type * as ExpoImagePickerModule from 'expo-image-picker';
import type * as ReactNativeModule from 'react-native';

/** Server cover output size (sanitized 1200×400 PNG). */
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 400;
/** Server cover upload ceiling; native derivative stays at or below this. */
export const COVER_DERIVATIVE_MAX_BYTES = 5 * 1024 * 1024;

/** Largest 3:1 rectangle positioned by x,y ∈ [0,1] (0.5 = centre). Pure crop math. */
export function coverCrop(width: number, height: number, x: number, y: number): {
  originX: number; originY: number; width: number; height: number;
} {
  const cropW = Math.min(width, height * 3);
  const cropH = cropW / 3;
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  return {
    originX: Math.max(0, Math.floor((width - cropW) * cx)),
    originY: Math.max(0, Math.floor((height - cropH) * cy)),
    width: Math.max(1, Math.round(cropW)),
    height: Math.max(1, Math.round(cropH)),
  };
}

export function assertCoverDerivativeReady(bytes: Uint8Array, mime: string): AvatarDerivative {
  const meta = inspectAvatarSource(bytes, mime);
  if (meta.width !== COVER_WIDTH || meta.height !== COVER_HEIGHT || meta.orientation !== 1) {
    throw new AvatarSourceError('Не удалось подготовить фрагмент обложки 1200×400. Выберите другое фото.');
  }
  if (meta.hasAlpha) throw new AvatarSourceError(AVATAR_TRANSPARENCY_USER, 'WHITE_FLATTEN_UNPROVEN');
  const stripped = stripAvatarMetadata(bytes, meta.mime);
  if (stripped.byteLength > COVER_DERIVATIVE_MAX_BYTES) {
    throw new AvatarSourceError(AVATAR_DERIVATIVE_OVERSIZE, 'DERIVATIVE_OVERSIZE');
  }
  const verified = inspectAvatarSource(stripped, meta.mime);
  if (verified.width !== COVER_WIDTH || verified.height !== COVER_HEIGHT || verified.orientation !== 1) {
    throw new AvatarSourceError('Не удалось очистить метаданные фото.');
  }
  return Object.freeze({
    mime: meta.mime,
    bytes: cloneDerivativeBytes(stripped),
  });
}

/** Exact verified picker options for Expo image-picker 58.0.10. */
export const AVATAR_PICKER_OPTIONS = Object.freeze({
  mediaTypes: Object.freeze(['images'] as const),
  allowsEditing: false,
  allowsMultipleSelection: false,
  quality: 1,
  base64: false,
  exif: false,
  legacy: false,
  preferredAssetRepresentationMode: 'current' as const,
});

export type PickedAvatarAsset = Readonly<{
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string | null;
  fileSize?: number | null;
}>;

export type AvatarPickerResult =
  | { canceled: true }
  | { canceled: false; assets: readonly PickedAvatarAsset[] };

export type AvatarFileHandle = {
  readBytes: (length: number) => Promise<Uint8Array>;
  close: () => void;
};

export type AvatarRuntimeDeps = {
  launchLibrary: (options: typeof AVATAR_PICKER_OPTIONS) => Promise<AvatarPickerResult>;
  openReadOnly: (uri: string) => AvatarFileHandle;
  deleteTracked: (uri: string) => Promise<void> | void;
  /** True only for closed verified SDK/app-cache provenance — never arbitrary user/provider URIs. */
  isOwnedCacheUri: (uri: string) => boolean;
  /**
   * Center-crop + resize using orientation-normalized visible dimensions (one native orientation pass).
   * Android Glide auto-EXIF remains DEVICE UNKNOWN — no guessed double rotate.
   */
  centerSquare512: (
    inputUri: string,
    meta: Pick<AvatarMetadata, 'width' | 'height' | 'orientation'>,
    maxEdge: number,
  ) => Promise<{ uri: string; width: number; height: number }>;
  /** Largest 3:1 crop at (x,y) then resize to exactly 1200×400. Required for cover prepare. */
  coverFrame1200x400?: (
    inputUri: string,
    meta: Pick<AvatarMetadata, 'width' | 'height' | 'orientation'>,
    position: { x: number; y: number },
    maxEdge: number,
  ) => Promise<{ uri: string; width: number; height: number }>;
  saveDerivative: (
    renderedUri: string,
    format: 'jpeg' | 'webp',
    compress: number,
  ) => Promise<{ uri: string }>;
  /**
   * iOS only (absent on Android): PHPicker `current` originals are often HEIC/HEIF.
   * Decode with one native orientation pass and save an upright app-cache JPEG ≤ maxEdge.
   */
  heicToJpeg?: (inputUri: string, maxEdge: number) => Promise<{ uri: string; width: number; height: number }>;
};

/**
 * Inspected source container and the URI the crop reads from. Without `heicToJpeg` this is exactly
 * the picked asset; with it, HEIC/HEIF bytes become a tracked JPEG that passes the same JPEG gates.
 */
export async function resolveAvatarSource(
  deps: Pick<AvatarRuntimeDeps, 'openReadOnly' | 'heicToJpeg'>,
  asset: PickedAvatarAsset,
  sourceBytes: Uint8Array,
  track: (uri: string) => void,
  retired: () => boolean,
): Promise<{ uri: string; meta: AvatarMetadata }> {
  if (!deps.heicToJpeg || !isHeifSource(sourceBytes)) {
    return { uri: asset.uri, meta: inspectAvatarSource(sourceBytes, asset.mimeType ?? '') };
  }
  const heif = inspectHeifSource(sourceBytes, asset.mimeType ?? '');
  if (heif.hasAlpha) throw new AvatarSourceError(AVATAR_TRANSPARENCY_USER, 'WHITE_FLATTEN_UNPROVEN');
  const converted = await deps.heicToJpeg(asset.uri, Math.min(2048, Math.max(heif.width, heif.height)));
  track(converted.uri);
  if (retired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
  const bytes = await readBoundedAvatarBytes(deps.openReadOnly, converted.uri);
  const meta = inspectAvatarSource(bytes, 'image/jpeg');
  if (meta.orientation !== 1 || meta.width !== converted.width || meta.height !== converted.height) {
    throw new AvatarSourceError(AVATAR_HEIF_CONVERT_FAILED);
  }
  return { uri: converted.uri, meta };
}

/** Bound actual bytes via sequential read of limit+1 — never trust picker fileSize/base64. */
export async function readBoundedAvatarBytes(
  openReadOnly: AvatarRuntimeDeps['openReadOnly'],
  uri: string,
  limit = AVATAR_SOURCE_MAX_BYTES,
  oversizeMessage?: string,
): Promise<Uint8Array> {
  const handle = openReadOnly(uri);
  try {
    const bytes = await handle.readBytes(limit + 1);
    if (bytes.byteLength > limit) {
      throw new AvatarSourceError(
        oversizeMessage ??
          (limit <= AVATAR_DERIVATIVE_MAX_BYTES
            ? AVATAR_DERIVATIVE_OVERSIZE
            : 'Фото должно быть не больше 10 МБ. Выберите фото меньшего размера.'),
        'OVERSIZE',
      );
    }
    if (!bytes.byteLength) {
      throw new AvatarSourceError('Фото повреждено или не удалось прочитать его размеры. Выберите другое фото.');
    }
    return bytes;
  } finally {
    handle.close();
  }
}

export async function pickOwnAvatarAsset(
  deps: Pick<AvatarRuntimeDeps, 'launchLibrary'>,
  retired: () => boolean,
): Promise<PickedAvatarAsset | 'cancelled'> {
  const result = await deps.launchLibrary(AVATAR_PICKER_OPTIONS);
  if (retired()) return 'cancelled';
  if (result.canceled || !result.assets?.length) return 'cancelled';
  if (result.assets.length !== 1) throw new AvatarSourceError('Выберите одно статичное изображение.');
  const asset = result.assets[0]!;
  if (!asset.uri) throw new AvatarSourceError('Не удалось получить выбранное фото.');
  return asset;
}

export function avatarDownsampleCrop(
  meta: Pick<AvatarMetadata, 'width' | 'height'>,
  maxEdge: number,
): { originX: number; originY: number; width: number; height: number; decodeMax: number } {
  const decodeMax = Math.max(1, Math.min(maxEdge, Math.max(meta.width, meta.height)));
  const scale = Math.min(1, decodeMax / Math.max(meta.width, meta.height));
  const dw = Math.max(1, Math.round(meta.width * scale));
  const dh = Math.max(1, Math.round(meta.height * scale));
  const side = Math.min(dw, dh);
  return {
    originX: Math.max(0, Math.floor((dw - side) / 2)),
    originY: Math.max(0, Math.floor((dh - side) / 2)),
    width: side,
    height: side,
    decodeMax,
  };
}

/**
 * Cover derivative: same source gates as avatar, 3:1 crop at (x,y), output exactly 1200×400 ≤ 5 MiB.
 */
export async function prepareOwnCoverDerivative(
  deps: AvatarRuntimeDeps,
  asset: PickedAvatarAsset,
  position: { x: number; y: number },
  retired: () => boolean,
): Promise<AvatarDerivative> {
  const tracked: string[] = [];
  let localRetired = false;
  const effectivelyRetired = () => retired() || localRetired;
  const track = (uri: string) => {
    if (!uri) return;
    if (uri === asset.uri && !deps.isOwnedCacheUri(uri)) return;
    if (!tracked.includes(uri)) tracked.push(uri);
  };
  if (deps.isOwnedCacheUri(asset.uri)) track(asset.uri);
  const cleanup = async () => {
    for (const uri of tracked.splice(0)) {
      try {
        await deps.deleteTracked(uri);
      } catch {
        /* Best-effort app-owned cache only. */
      }
    }
  };
  try {
    const work = (async () => {
      const sourceBytes = await readBoundedAvatarBytes(deps.openReadOnly, asset.uri);
      if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      const source = await resolveAvatarSource(deps, asset, sourceBytes, track, effectivelyRetired);
      const meta = source.meta;
      assertOpaqueAvatarSource(meta);
      if (!deps.coverFrame1200x400) {
        throw new AvatarSourceError('Не удалось подготовить фрагмент обложки 1200×400. Выберите другое фото.');
      }
      const oriented = avatarOrientedSize(meta);
      const maxEdge = Math.min(2048, Math.max(oriented.width, oriented.height));
      const rendered = await deps.coverFrame1200x400(source.uri, meta, position, maxEdge);
      track(rendered.uri);
      if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      if (rendered.width !== COVER_WIDTH || rendered.height !== COVER_HEIGHT) {
        throw new AvatarSourceError('Не удалось подготовить фрагмент обложки 1200×400. Выберите другое фото.');
      }
      const qualities = [0.9, 0.8, 0.65, 0.5, 0.35];
      for (const format of ['webp', 'jpeg'] as const) {
        for (const compress of qualities) {
          if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
          const saved = await deps.saveDerivative(rendered.uri, format, compress);
          track(saved.uri);
          let out: Uint8Array;
          try {
            out = await readBoundedAvatarBytes(
              deps.openReadOnly,
              saved.uri,
              COVER_DERIVATIVE_MAX_BYTES,
              AVATAR_DERIVATIVE_OVERSIZE,
            );
          } catch (error) {
            if (error instanceof AvatarSourceError && error.code === 'OVERSIZE') continue;
            throw error;
          }
          try {
            return assertCoverDerivativeReady(out, `image/${format}`);
          } catch (error) {
            if (error instanceof AvatarSourceError && error.code === 'DERIVATIVE_OVERSIZE') continue;
            if (error instanceof AvatarSourceError && error.message.includes('уменьшить')) continue;
            if (error instanceof AvatarSourceError && error.code === 'WHITE_FLATTEN_UNPROVEN') throw error;
            continue;
          }
        }
      }
      throw new AvatarSourceError(AVATAR_DERIVATIVE_OVERSIZE, 'DERIVATIVE_OVERSIZE');
    })();
    return await avatarDeadline(
      work,
      AVATAR_PREPROCESS_MS,
      () => {
        localRetired = true;
        void cleanup();
      },
      () => {
        void cleanup();
      },
      () => {
        void cleanup();
      },
    );
  } finally {
    await cleanup();
  }
}

/**
 * Android quality:1 copies selected original bytes to cache, but OS/provider import may precede validation.
 * iOS may silently fall back to decoded/reencoded PNG — original-container parity is unproved.
 * iOS HEIC/HEIF originals are converted to an upright JPEG first (resolveAvatarSource); Android has no converter.
 * Crop uses orientation-normalized visible size after one native orientation fix; no guessed Android double-rotate.
 * Transparent sources fail closed: native white-flatten is unproven.
 */
export async function prepareOwnAvatarDerivative(
  deps: AvatarRuntimeDeps,
  asset: PickedAvatarAsset,
  retired: () => boolean,
): Promise<AvatarDerivative> {
  const tracked: string[] = [];
  let localRetired = false;
  const effectivelyRetired = () => retired() || localRetired;
  const track = (uri: string) => {
    if (!uri) return;
    if (uri === asset.uri && !deps.isOwnedCacheUri(uri)) return;
    if (!tracked.includes(uri)) tracked.push(uri);
  };
  if (deps.isOwnedCacheUri(asset.uri)) track(asset.uri);
  const cleanup = async () => {
    for (const uri of tracked.splice(0)) {
      try {
        await deps.deleteTracked(uri);
      } catch {
        /* Best-effort app-owned cache only. */
      }
    }
  };
  try {
    const work = (async () => {
      const sourceBytes = await readBoundedAvatarBytes(deps.openReadOnly, asset.uri);
      if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      const source = await resolveAvatarSource(deps, asset, sourceBytes, track, effectivelyRetired);
      const meta = source.meta;
      assertOpaqueAvatarSource(meta);
      const oriented = avatarOrientedSize(meta);
      const maxEdge = Math.min(2048, Math.max(oriented.width, oriented.height));
      const rendered = await deps.centerSquare512(source.uri, meta, maxEdge);
      track(rendered.uri);
      if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      if (rendered.width !== AVATAR_SIZE || rendered.height !== AVATAR_SIZE) {
        throw new AvatarSourceError('Не удалось подготовить квадрат 512×512. Выберите другое фото.');
      }
      const qualities = [0.9, 0.8, 0.65, 0.5, 0.35];
      for (const format of ['webp', 'jpeg'] as const) {
        for (const compress of qualities) {
          if (effectivelyRetired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
          const saved = await deps.saveDerivative(rendered.uri, format, compress);
          track(saved.uri);
          let out: Uint8Array;
          try {
            out = await readBoundedAvatarBytes(
              deps.openReadOnly,
              saved.uri,
              AVATAR_DERIVATIVE_MAX_BYTES,
              AVATAR_DERIVATIVE_OVERSIZE,
            );
          } catch (error) {
            if (error instanceof AvatarSourceError && error.code === 'OVERSIZE') continue;
            throw error;
          }
          try {
            return assertDerivativeReady(out, `image/${format}`);
          } catch (error) {
            if (error instanceof AvatarSourceError && error.code === 'DERIVATIVE_OVERSIZE') continue;
            if (error instanceof AvatarSourceError && error.message.includes('уменьшить')) continue;
            if (error instanceof AvatarSourceError && error.code === 'WHITE_FLATTEN_UNPROVEN') throw error;
            continue;
          }
        }
      }
      throw new AvatarSourceError(AVATAR_DERIVATIVE_OVERSIZE, 'DERIVATIVE_OVERSIZE');
    })();
    return await avatarDeadline(
      work,
      AVATAR_PREPROCESS_MS,
      () => {
        localRetired = true;
        void cleanup();
      },
      () => {
        void cleanup();
      },
      () => {
        void cleanup();
      },
    );
  } finally {
    await cleanup();
  }
}

/** Closed file:// prefix check against verified SDK cache root(s). Never matches content:// or arbitrary paths. */
export function isClosedSdkAppCacheUri(uri: string, cacheRoots: readonly string[]): boolean {
  if (!uri.startsWith('file:')) return false;
  const normalize = (value: string) => value.replace(/\/+$/, '');
  const target = normalize(uri);
  for (const root of cacheRoots) {
    if (!root.startsWith('file:')) continue;
    const base = normalize(root);
    if (target === base || target.startsWith(`${base}/`)) return true;
  }
  return false;
}

/** Live Expo 58 adapter — genuine SDK module types for lazy require; injectable test port stays separate. */
export function createExpoAvatarRuntime(): AvatarRuntimeDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const picker = require('expo-image-picker') as typeof ExpoImagePickerModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manipulator = require('expo-image-manipulator') as typeof ExpoImageManipulatorModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('expo-file-system') as typeof ExpoFileSystemModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native') as typeof ReactNativeModule;
  const ios = Platform.OS === 'ios';
  /**
   * iOS ImageCropTransformer throws when the rect exceeds the decoded bitmap by even 1 px, and ImageIO
   * thumbnail rounding is not JS rounding — so crop from the decoded (already upright) ImageRef size.
   */
  const iosDecodedCrop = async (
    inputUri: string,
    decodeMax: number,
    rect: (width: number, height: number) => { originX: number; originY: number; width: number; height: number },
    size: { width: number; height: number },
  ) => {
    const decoded = await manipulator.ImageManipulator.manipulate(inputUri, {
      maxWidth: decodeMax,
      maxHeight: decodeMax,
    }).renderAsync();
    try {
      const crop = rect(decoded.width, decoded.height);
      const image = await manipulator.ImageManipulator.manipulate(decoded)
        .crop({
          originX: crop.originX,
          originY: crop.originY,
          width: crop.width,
          height: crop.height,
        })
        .resize(size)
        .renderAsync();
      const saved = await image.saveAsync({
        format: manipulator.SaveFormat.JPEG,
        compress: 1,
      });
      return { uri: saved.uri, width: image.width, height: image.height };
    } finally {
      decoded.release();
    }
  };
  const preferred =
    picker.UIImagePickerPreferredAssetRepresentationMode?.Current ??
    ('current' as const);
  const cacheRoots: string[] = [];
  try {
    const cacheUri = fs.Paths.cache.uri;
    if (typeof cacheUri === 'string' && cacheUri.startsWith('file:')) cacheRoots.push(cacheUri);
  } catch {
    /* Paths.cache unavailable in non-native hosts — ownership stays closed (no deletes). */
  }
  const runtime: AvatarRuntimeDeps = {
    launchLibrary: options =>
      picker.launchImageLibraryAsync({
        ...options,
        mediaTypes: [...options.mediaTypes],
        preferredAssetRepresentationMode: preferred,
      }),
    openReadOnly: uri => {
      const file = new fs.File(uri);
      return file.open(fs.FileMode.ReadOnly);
    },
    deleteTracked: async uri => {
      // Ownership is decided at track() time (picker cache only when verified; derivatives always).
      if (!uri.startsWith('file:')) return;
      try {
        await new fs.File(uri).delete();
      } catch {
        /* Never delete caller/user source URIs outside tracked app cache. */
      }
    },
    isOwnedCacheUri: uri => isClosedSdkAppCacheUri(uri, cacheRoots),
    centerSquare512: async (inputUri, meta, maxEdge) => {
      const oriented = avatarOrientedSize(meta);
      const crop = avatarDownsampleCrop(oriented, maxEdge);
      if (ios) {
        return iosDecodedCrop(
          inputUri,
          crop.decodeMax,
          (width, height) => avatarDownsampleCrop({ width, height }, Math.max(width, height)),
          { width: AVATAR_SIZE, height: AVATAR_SIZE },
        );
      }
      const image = await manipulator.ImageManipulator.manipulate(inputUri, {
        maxWidth: crop.decodeMax,
        maxHeight: crop.decodeMax,
      })
        .crop({
          originX: crop.originX,
          originY: crop.originY,
          width: crop.width,
          height: crop.height,
        })
        .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
        .renderAsync();
      const saved = await image.saveAsync({
        format: manipulator.SaveFormat.JPEG,
        compress: 1,
      });
      return { uri: saved.uri, width: image.width, height: image.height };
    },
    coverFrame1200x400: async (inputUri, meta, position, maxEdge) => {
      const oriented = avatarOrientedSize(meta);
      const decodeMax = Math.max(1, Math.min(maxEdge, Math.max(oriented.width, oriented.height)));
      const scale = Math.min(1, decodeMax / Math.max(oriented.width, oriented.height));
      const dw = Math.max(1, Math.round(oriented.width * scale));
      const dh = Math.max(1, Math.round(oriented.height * scale));
      const crop = coverCrop(dw, dh, position.x, position.y);
      if (ios) {
        return iosDecodedCrop(
          inputUri,
          decodeMax,
          (width, height) => coverCrop(width, height, position.x, position.y),
          { width: COVER_WIDTH, height: COVER_HEIGHT },
        );
      }
      const image = await manipulator.ImageManipulator.manipulate(inputUri, {
        maxWidth: decodeMax,
        maxHeight: decodeMax,
      })
        .crop({
          originX: crop.originX,
          originY: crop.originY,
          width: crop.width,
          height: crop.height,
        })
        .resize({ width: COVER_WIDTH, height: COVER_HEIGHT })
        .renderAsync();
      const saved = await image.saveAsync({
        format: manipulator.SaveFormat.JPEG,
        compress: 1,
      });
      return { uri: saved.uri, width: image.width, height: image.height };
    },
    saveDerivative: async (renderedUri, format, compress) => {
      const image = await manipulator.ImageManipulator.manipulate(renderedUri).renderAsync();
      return image.saveAsync({
        format: format === 'webp' ? manipulator.SaveFormat.WEBP : manipulator.SaveFormat.JPEG,
        compress,
      });
    },
  };
  if (ios) {
    runtime.heicToJpeg = async (inputUri, maxEdge) => {
      const image = await manipulator.ImageManipulator.manipulate(inputUri, {
        maxWidth: maxEdge,
        maxHeight: maxEdge,
      }).renderAsync();
      const saved = await image.saveAsync({
        format: manipulator.SaveFormat.JPEG,
        compress: 1,
      });
      return { uri: saved.uri, width: image.width, height: image.height };
    };
  }
  return runtime;
}
