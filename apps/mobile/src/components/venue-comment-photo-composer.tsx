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
  applyPendingReadDelta,
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
  /** Drop drafts whose receipt ids were published by a confirmed create. */
  retirePublished: (photoIds: readonly string[]) => void;
};

/**
 * Root-comment photo drafts: rights gate → picker → raw binary upload via nativeAuth.
 * Tokens never leave the auth coordinator; no CSRF cookies or multipart bodies.
 * `venueId` must be the coordinator Scope canonicalVenueId (API receipts bind to canonical).
 */
export function useVenueCommentPhotoComposer(
  venueId: string | null,
  actor: Actor | null,
  locked: boolean,
): VenueCommentPhotoComposerModel {
  const [items, dispatch] = useReducer(photoComposerReducer, []);
  const [rights, setRights] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingReads, setPendingReads] = useState(0);
  const bytesByKey = useRef(new Map<string, Uint8Array>());
  const running = useRef(new Set<string>());
  const generation = useRef(0);
  const alive = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const live = useRef({ venueId, actor, locked });
  live.current = { venueId, actor, locked };

  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    bytesByKey.current.clear();
    running.current.clear();
    dispatch({ type: 'clear' });
    setRights(false);
    setNotice('');
    setPendingReads(0);
    return () => {
      alive.current = false;
      generation.current += 1;
      running.current.clear();
    };
  }, [venueId, actor?.actorId, actor?.sessionId, actor?.generation]);

  const uploadOne = useCallback(async (key: string, mime: PhotoComposerItem['mime'], bytes: Uint8Array) => {
    const epoch = generation.current;
    const { venueId: venue, actor: current, locked: isLocked } = live.current;
    // Recheck admission before starting upload — Send may have locked mid-read.
    if (!venue || !current || !alive.current || running.current.has(key)) return;
    if (isLocked) {
      // Keep bytes as retryable; never start an upload while the composer is locked.
      dispatch({
        type: 'patch',
        key,
        state: 'retryable',
        message: 'Проверка временно недоступна. Повторите позже.',
      });
      return;
    }
    running.current.add(key);
    dispatch({ type: 'patch', key, state: 'checking', message: undefined });
    try {
      const receipt = await nativeAuth.uploadCommentPhoto(
        { venueId: venue, key, mime, bytes },
        current,
      );
      if (!alive.current || epoch !== generation.current || live.current.venueId !== venue) return;
      dispatch({
        type: 'patch',
        key,
        state: 'ready',
        receipt,
        message: 'Готово к публикации',
      });
    } catch (error) {
      if (!alive.current || epoch !== generation.current || live.current.venueId !== venue) return;
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
      // Stale upload must not mutate the current generation's running set.
      if (alive.current && epoch === generation.current) running.current.delete(key);
    }
  }, []);

  const withdrawOne = useCallback(async (
    key: string,
    receiptId: string,
    withdrawKey: string,
  ) => {
    const epoch = generation.current;
    const { venueId: venue, actor: current } = live.current;
    if (!venue || !current || !alive.current || running.current.has(key)) return;
    running.current.add(key);
    dispatch({ type: 'patch', key, state: 'withdrawing', withdrawKey, message: undefined });
    try {
      await nativeAuth.withdrawCommentPhoto({ id: receiptId, key: withdrawKey, venueId: venue }, current);
      if (!alive.current || epoch !== generation.current || live.current.venueId !== venue) return;
      bytesByKey.current.delete(key);
      dispatch({ type: 'drop', key });
    } catch (error) {
      if (!alive.current || epoch !== generation.current || live.current.venueId !== venue) return;
      if (
        error instanceof CommunityError
        && error.status === 404
        && error.code === 'PHOTO_SUBMISSION_UNAVAILABLE'
      ) {
        bytesByKey.current.delete(key);
        dispatch({ type: 'drop', key });
        return;
      }
      dispatch({
        type: 'patch',
        key,
        state: 'withdraw_failed',
        withdrawKey,
        message: 'Снятие не подтверждено. Проверьте доступ и повторите ту же операцию.',
      });
    } finally {
      if (alive.current && epoch === generation.current) running.current.delete(key);
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
      const venue = live.current.venueId;
      // Increment only while this read's generation is still current.
      setPendingReads(count => applyPendingReadDelta(count, 1, alive.current, epoch, generation.current));
      try {
        const runtime = createExpoAvatarRuntime();
        const result = await runtime.launchLibrary(AVATAR_PICKER_OPTIONS);
        if (!alive.current || epoch !== generation.current || live.current.venueId !== venue
          || result.canceled || !result.assets?.length) return;
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
          if (alive.current && epoch === generation.current && live.current.venueId === venue) {
            setNotice('Выберите JPEG, PNG или WebP до 5 МиБ.');
          }
          return;
        }
        // Recheck admission after async read — do not start upload while locked.
        if (!alive.current || epoch !== generation.current || live.current.venueId !== venue) return;
        if (live.current.locked) return;
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
        if (alive.current && epoch === generation.current && live.current.venueId === venue) {
          setNotice('Не удалось прочитать файл. Загрузка не начата; выберите файл снова.');
        }
      } finally {
        // Stale read completion must not decrement a newer generation's pending count.
        setPendingReads(count => applyPendingReadDelta(count, -1, alive.current, epoch, generation.current));
      }
    })();
  }, [rights, uploadOne]);

  const retry = useCallback((item: PhotoComposerItem) => {
    if (
      live.current.locked
      || item.state === 'checking'
      || item.state === 'withdrawing'
      || item.state === 'ready'
      || item.state === 'rejected'
    ) return;
    if (item.withdrawKey && item.receipt) {
      void withdrawOne(item.key, item.receipt.id, item.withdrawKey);
      return;
    }
    if (!rights) return;
    const bytes = bytesByKey.current.get(item.key);
    if (!bytes) {
      setNotice('Выберите тот же файл для этой попытки, затем повторите.');
      return;
    }
    void uploadOne(item.key, item.mime, bytes);
  }, [rights, uploadOne, withdrawOne]);

  const remove = useCallback((item: PhotoComposerItem) => {
    if (live.current.locked || item.state === 'checking' || item.state === 'withdrawing') return;
    if (
      item.state === 'rejected'
      || item.state === 'retryable'
      || !item.receipt
      || (item.state === 'unknown' && !item.withdrawKey)
    ) {
      bytesByKey.current.delete(item.key);
      dispatch({ type: 'drop', key: item.key });
      return;
    }
    const withdrawKey = item.withdrawKey ?? Crypto.randomUUID();
    void withdrawOne(item.key, item.receipt.id, withdrawKey);
  }, [withdrawOne]);

  const clear = useCallback(() => {
    generation.current += 1;
    bytesByKey.current.clear();
    running.current.clear();
    dispatch({ type: 'clear' });
    setRights(false);
    setNotice('');
    setPendingReads(0);
  }, []);

  const retirePublished = useCallback((photoIds: readonly string[]) => {
    if (!photoIds.length) return;
    const idSet = new Set(photoIds);
    for (const item of itemsRef.current) {
      if (item.receipt && idSet.has(item.receipt.id)) bytesByKey.current.delete(item.key);
    }
    dispatch({ type: 'retireIds', ids: photoIds });
  }, []);

  const reading = pendingReads > 0;
  return {
    items,
    rights,
    setRights,
    notice,
    readyIds: readyPhotoIds(items),
    checking: hasCheckingPhoto(items) || reading,
    canSend: (text: string) => !reading && commentSendReady(text, items),
    add,
    retry,
    remove,
    clear,
    retirePublished,
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
            {item.state !== 'checking'
              && item.state !== 'withdrawing'
              && item.state !== 'ready'
              && item.state !== 'rejected' ? (
              <OutlineButton
                title="Повторить"
                disabled={locked || (!model.rights && !item.withdrawKey)}
                onPress={() => model.retry(item)}
              />
            ) : null}
            <OutlineButton
              title={`Убрать фото ${index + 1}`}
              disabled={locked || item.state === 'checking' || item.state === 'withdrawing'}
              onPress={() => model.remove(item)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
