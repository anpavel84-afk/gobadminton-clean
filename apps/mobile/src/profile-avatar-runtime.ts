import {
  AVATAR_DERIVATIVE_MAX_BYTES,
  AVATAR_PREPROCESS_MS,
  AVATAR_SIZE,
  AVATAR_SOURCE_MAX_BYTES,
  AvatarSourceError,
  assertDerivativeReady,
  assertOpaqueAvatarSource,
  avatarDeadline,
  inspectAvatarSource,
  type AvatarDerivative,
  type AvatarMetadata,
} from './profile-avatar.ts';

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
  /**
   * Center-crop + resize using inspected source dimensions (no guessed EXIF rotate).
   * Platform orientation is verified on the output bytes, not assumed from package inspection.
   */
  centerSquare512: (
    inputUri: string,
    meta: Pick<AvatarMetadata, 'width' | 'height'>,
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
): Promise<Uint8Array> {
  const handle = openReadOnly(uri);
  try {
    const bytes = await handle.readBytes(limit + 1);
    if (bytes.byteLength > limit) {
      throw new AvatarSourceError('Фото должно быть не больше 10 МБ. Выберите фото меньшего размера.');
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
 * No guessed Android EXIF double-rotate; output container/dimensions/orientation are inspected.
 * Transparent sources fail closed: native white-flatten is unproven without extent/backgroundColor.
 */
export async function prepareOwnAvatarDerivative(
  deps: AvatarRuntimeDeps,
  asset: PickedAvatarAsset,
  retired: () => boolean,
): Promise<AvatarDerivative> {
  const tracked: string[] = [];
  const track = (uri: string) => {
    if (uri && uri !== asset.uri) tracked.push(uri);
  };
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
      if (retired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      const meta = inspectAvatarSource(sourceBytes, asset.mimeType ?? '');
      assertOpaqueAvatarSource(meta);
      const maxEdge = Math.min(2048, Math.max(meta.width, meta.height));
      const rendered = await deps.centerSquare512(asset.uri, meta, maxEdge);
      track(rendered.uri);
      if (retired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      if (rendered.width !== AVATAR_SIZE || rendered.height !== AVATAR_SIZE) {
        throw new AvatarSourceError('Не удалось подготовить квадрат 512×512. Выберите другое фото.');
      }
      const qualities = [0.9, 0.8, 0.65, 0.5, 0.35];
      for (const format of ['webp', 'jpeg'] as const) {
        for (const compress of qualities) {
          if (retired()) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
          const saved = await deps.saveDerivative(rendered.uri, format, compress);
          track(saved.uri);
          const out = await readBoundedAvatarBytes(deps.openReadOnly, saved.uri, AVATAR_DERIVATIVE_MAX_BYTES);
          try {
            return assertDerivativeReady(out, `image/${format}`);
          } catch (error) {
            if (error instanceof AvatarSourceError && error.message.includes('уменьшить')) continue;
            if (error instanceof AvatarSourceError && error.code === 'WHITE_FLATTEN_UNPROVEN') throw error;
            continue;
          }
        }
      }
      throw new AvatarSourceError('Не удалось уменьшить фото. Выберите другое фото и попробуйте ещё раз.');
    })();
    return await avatarDeadline(
      work,
      AVATAR_PREPROCESS_MS,
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

/** Live Expo 58 adapter. Structural types only; packages are pinned and locked by trusted parent. */
export function createExpoAvatarRuntime(): AvatarRuntimeDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const picker = require('expo-image-picker') as {
    launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<AvatarPickerResult>;
    UIImagePickerPreferredAssetRepresentationMode?: { Current: string };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manipulator = require('expo-image-manipulator') as {
    ImageManipulator: {
      manipulate: (uri: string, options?: { maxWidth?: number; maxHeight?: number }) => {
        crop: (rect: { originX: number; originY: number; width: number; height: number }) => {
          resize: (size: { width: number; height: number }) => {
            renderAsync: () => Promise<{
              width: number;
              height: number;
              saveAsync: (o: { format: string; compress: number }) => Promise<{ uri: string }>;
            }>;
          };
        };
        renderAsync: () => Promise<{
          width: number;
          height: number;
          saveAsync: (o: { format: string; compress: number }) => Promise<{ uri: string }>;
        }>;
      };
    };
    SaveFormat: { JPEG: string; WEBP: string };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('expo-file-system') as {
    File: new (uri: string) => {
      open: (mode: unknown) => AvatarFileHandle;
      delete: () => void | Promise<void>;
    };
    FileMode: { ReadOnly: unknown };
  };
  const preferred = picker.UIImagePickerPreferredAssetRepresentationMode?.Current ?? 'current';
  return {
    launchLibrary: options =>
      picker.launchImageLibraryAsync({
        ...options,
        preferredAssetRepresentationMode: preferred,
      }),
    openReadOnly: uri => new fs.File(uri).open(fs.FileMode.ReadOnly),
    deleteTracked: async uri => {
      try {
        await new fs.File(uri).delete();
      } catch {
        /* Never delete caller/user source URIs outside tracked app cache. */
      }
    },
    centerSquare512: async (inputUri, meta, maxEdge) => {
      const crop = avatarDownsampleCrop(meta, maxEdge);
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
