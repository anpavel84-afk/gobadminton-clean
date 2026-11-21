import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Actor } from '../participation.ts';
import { nativeAuth } from '../auth-runtime.ts';
import { CommunityError } from '../venue-community.ts';
import {
  COMMENT_PHOTO_MAX_BYTES,
  MAX_COMMENT_PHOTOS,
  commentSendReady,
  detectCommentPhotoMime,
  hasCheckingPhoto,
  isHeicCommentSource,
  mapUploadFailure,
  photoComposerReducer,
  photoStatusLabel,
  readyPhotoIds,
  type PhotoComposerItem,
} from '../venue-comment-photos.ts';
import {
  AVATAR_PICKER_OPTIONS,
  createExpoAvatarRuntime,
  readBoundedAvatarBytes,
} from '../profile-avatar-runtime.ts';
import { colors } from '../theme.ts';
import { Label, OutlineButton } from './ui.tsx';

export type VenueCommentPhotoComposerModel = {
  items: PhotoComposerItem[];
  rights: boolean;
  setRights: (value: boolean) => void;
  notice: string;
  readyIds: string[];
  checking: boolean;
  canSend: (text: string) => boolean;
  add: () => void;
  retry: (item: PhotoComposerItem) => void;
  remove: (item: PhotoComposerItem) => void;
  clear: () => void;
};

/**
 * Root-comment photo drafts: rights gate → picker → raw binary upload via nativeAuth.
 * Tokens never leave the auth coordinator; no CSRF cookies or multipart bodies.
 */
export function useVenueCommentPhotoComposer(
  venueId: string | null,
  actor: Actor | null,
  locked: boolean,
): VenueCommentPhotoComposerModel {
  const [items, dispatch] = useReducer(photoComposerReducer, []);
  const [rights, setRights] = useState(false);
  const [notice, setNotice] = useState('');
  const bytesByKey = useRef(new Map<string, Uint8Array>());
  const running = useRef(new Set<string>());
  const generation = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const live = useRef({ venueId, actor, locked });
  live.current = { venueId, actor, locked };

  useEffect(() => {
    generation.current += 1;
    bytesByKey.current.clear();
    running.current.clear();
    dispatch({ type: 'clear' });
    setRights(false);
    setNotice('');
  }, [venueId, actor?.actorId, actor?.sessionId, actor?.generation]);

  const uploadOne = useCallback(async (key: string, mime: PhotoComposerItem['mime'], bytes: Uint8Array) => {
    const epoch = generation.current;
    const { venueId: venue, actor: current } = live.current;
    if (!venue || !current || running.current.has(key)) return;
    running.current.add(key);
    dispatch({ type: 'patch', key, state: 'checking', message: undefined });
    try {
      const receipt = await nativeAuth.uploadCommentPhoto(
        { venueId: venue, key, mime, bytes },
        current,
      );
      if (epoch !== generation.current || live.current.venueId !== venue) return;
      dispatch({
        type: 'patch',
        key,
        state: 'ready',
        receipt,
        message: 'Готово к публикации',
      });
    } catch (error) {
      if (epoch !== generation.current || live.current.venueId !== venue) return;
      if (error instanceof CommunityError) {
        const mapped = mapUploadFailure(error.status, error.code);
        dispatch({ type: 'patch', key, state: mapped.state, message: mapped.message });
      } else {
        dispatch({
          type: 'patch',
          key,
          state: 'unknown',
          message: 'Результат пока неизвестен. Повтор использует ту же попытку.',
        });
      }
    } finally {
      running.current.delete(key);
    }
  }, []);

  const add = useCallback(() => {
    if (!rights || live.current.locked || !live.current.venueId || !live.current.actor) return;
    if (itemsRef.current.length >= MAX_COMMENT_PHOTOS) {
      setNotice('Не больше четырёх фото в публикации.');
      return;
    }
    void (async () => {
      const epoch = generation.current;
      try {
        const runtime = createExpoAvatarRuntime();
        const result = await runtime.launchLibrary(AVATAR_PICKER_OPTIONS);
        if (epoch !== generation.current || result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];
        if (!asset?.uri) {
          setNotice('Не удалось получить выбранное фото.');
          return;
        }
        if (itemsRef.current.length >= MAX_COMMENT_PHOTOS) {
          setNotice('Не больше четырёх фото в публикации.');
          return;
        }
        let bytes: Uint8Array;
        try {
          bytes = await readBoundedAvatarBytes(
            runtime.openReadOnly,
            asset.uri,
            COMMENT_PHOTO_MAX_BYTES,
            'Выберите JPEG, PNG или WebP до 5 МиБ.',
          );
        } catch {
          setNotice('Выберите JPEG, PNG или WebP до 5 МиБ.');
          return;
        }
        if (epoch !== generation.current) return;
        if (isHeicCommentSource(bytes)) {
          setNotice('Формат HEIC не поддерживается. Сохраните фото как JPEG, PNG или WebP.');
          return;
        }
        const mime = detectCommentPhotoMime(bytes);
        if (!mime || bytes.byteLength < 1 || bytes.byteLength > COMMENT_PHOTO_MAX_BYTES) {
          setNotice('Выберите JPEG, PNG или WebP до 5 МиБ.');
          return;
        }
        const key = Crypto.randomUUID();
        bytesByKey.current.set(key, bytes);
        dispatch({ type: 'add', key, mime, size: bytes.byteLength });
        void uploadOne(key, mime, bytes);
      } catch {
        if (epoch === generation.current) {
          setNotice('Не удалось прочитать файл. Загрузка не начата; выберите файл снова.');
        }
      }
    })();
  }, [rights, uploadOne]);

  const retry = useCallback((item: PhotoComposerItem) => {
    if (live.current.locked || item.state === 'checking' || item.state === 'ready' || item.state === 'rejected') return;
    if (!rights) return;
    const bytes = bytesByKey.current.get(item.key);
    if (!bytes) {
      setNotice('Выберите тот же файл для этой попытки, затем повторите.');
      return;
    }
    void uploadOne(item.key, item.mime, bytes);
  }, [rights, uploadOne]);

  const remove = useCallback((item: PhotoComposerItem) => {
    if (live.current.locked || item.state === 'checking') return;
    if (item.state === 'rejected' || item.state === 'retryable' || item.state === 'unknown' || !item.receipt) {
      bytesByKey.current.delete(item.key);
      dispatch({ type: 'drop', key: item.key });
      return;
    }
    const { venueId: venue, actor: current } = live.current;
    if (!venue || !current || !item.receipt) return;
    const withdrawKey = Crypto.randomUUID();
    const epoch = generation.current;
    dispatch({ type: 'patch', key: item.key, state: 'checking', message: undefined });
    void (async () => {
      try {
        await nativeAuth.withdrawCommentPhoto({ id: item.receipt!.id, key: withdrawKey }, current);
        if (epoch !== generation.current) return;
        bytesByKey.current.delete(item.key);
        dispatch({ type: 'drop', key: item.key });
      } catch {
        if (epoch !== generation.current) return;
        dispatch({
          type: 'patch',
          key: item.key,
          state: 'unknown',
          receipt: item.receipt,
          message: 'Снятие не подтверждено. Проверьте доступ и повторите ту же операцию.',
        });
      }
    })();
  }, []);

  const clear = useCallback(() => {
    generation.current += 1;
    bytesByKey.current.clear();
    running.current.clear();
    dispatch({ type: 'clear' });
    setRights(false);
    setNotice('');
  }, []);

  return {
    items,
    rights,
    setRights,
    notice,
    readyIds: readyPhotoIds(items),
    checking: hasCheckingPhoto(items),
    canSend: (text: string) => commentSendReady(text, items),
    add,
    retry,
    remove,
    clear,
  };
}

export function VenueCommentPhotoComposer({
  model,
  disabled,
}: {
  model: VenueCommentPhotoComposerModel;
  disabled: boolean;
}) {
  const locked = disabled;
  return (
    <View style={{ gap: 8 }}>
      <Label accessibilityRole="header">Фотографии · до 4</Label>
      <Label style={{ color: colors.secondary }}>
        JPEG, PNG или WebP до 5 МиБ. Фото сохраняется целиком. Проверка перед отправкой ещё не публикует фото.
      </Label>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: model.rights, disabled: locked }}
        disabled={locked}
        onPress={() => model.setRights(!model.rights)}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', minHeight: 48, opacity: locked ? 0.5 : 1 }}
      >
        <View style={{
          width: 22, height: 22, marginTop: 2, borderRadius: 4, borderWidth: 1, borderColor: colors.lineDark,
          backgroundColor: model.rights ? colors.purple : colors.card, alignItems: 'center', justifyContent: 'center',
        }}>
          {model.rights ? <Label accessible={false} style={{ color: colors.onPurple, fontSize: 14, lineHeight: 16 }}>✓</Label> : null}
        </View>
        <Label style={{ flex: 1 }}>
          Это мои фото или у меня есть права на публикацию. Узнаваемые люди согласны на публикацию. EXIF и геометки будут удалены.
        </Label>
      </Pressable>
      <OutlineButton
        title="Добавить фото"
        disabled={!model.rights || locked || model.items.length >= MAX_COMMENT_PHOTOS}
        onPress={() => {
          if (!model.rights || locked) return;
          model.add();
        }}
      />
      {model.notice ? <Label accessibilityRole="alert" accessibilityLiveRegion="polite">{model.notice}</Label> : null}
      {model.items.map((item, index) => (
        <View key={item.key} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: colors.line }}>
          <Label accessibilityLiveRegion="polite">
            Фото {index + 1} · {photoStatusLabel(item.state)}
          </Label>
          {item.message ? <Label>{item.message}</Label> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {item.state !== 'checking' && item.state !== 'ready' && item.state !== 'rejected' ? (
              <OutlineButton
                title="Повторить"
                disabled={locked || !model.rights}
                onPress={() => model.retry(item)}
              />
            ) : null}
            <OutlineButton
              title={`Убрать фото ${index + 1}`}
              disabled={locked || item.state === 'checking'}
              onPress={() => model.remove(item)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
