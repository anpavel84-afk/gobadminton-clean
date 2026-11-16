import {
  AVATAR_DERIVATIVE_MAX_BYTES,
  AVATAR_DERIVATIVE_OVERSIZE,
  AVATAR_PREPROCESS_MS,
  AVATAR_SIZE,
  AVATAR_SOURCE_MAX_BYTES,
  AvatarSourceError,
  assertDerivativeReady,
  assertOpaqueAvatarSource,
  avatarDeadline,
  avatarOrientedSize,
  inspectAvatarSource,
  type AvatarDerivative,
  type AvatarMetadata,
} from './profile-avatar.ts';
import type * as ExpoFileSystemModule from 'expo-file-system';
import type * as ExpoImageManipulatorModule from 'expo-image-manipulator';
import type * as ExpoImagePickerModule from 'expo-image-picker';

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
  saveDerivative: (
    renderedUri: string,
    format: 'jpeg' | 'webp',
    compress: number,
  ) => Promise<{ uri: string }>;
};

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
 * Android quality:1 copies selected original bytes to cache, but OS/provider import may precede validation.
 * iOS may silently fall back to decoded/reencoded PNG — original-container parity is unproved.
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
      const meta = inspectAvatarSource(sourceBytes, asset.mimeType ?? '');
      assertOpaqueAvatarSource(meta);
      const oriented = avatarOrientedSize(meta);
      const maxEdge = Math.min(2048, Math.max(oriented.width, oriented.height));
      const rendered = await deps.centerSquare512(asset.uri, meta, maxEdge);
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
  const picker = require('expo-image-picker') as ExpoImagePickerModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manipulator = require('expo-image-manipulator') as ExpoImageManipulatorModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('expo-file-system') as ExpoFileSystemModule;
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
  return {
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
    saveDerivative: async (renderedUri, format, compress) => {
      const image = await manipulator.ImageManipulator.manipulate(renderedUri).renderAsync();
      return image.saveAsync({
        format: format === 'webp' ? manipulator.SaveFormat.WEBP : manipulator.SaveFormat.JPEG,
        compress,
      });
    },
  };
}
