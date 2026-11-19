import { useEffect, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import {
  createExpoAvatarRuntime,
  pickOwnAvatarAsset,
  prepareOwnCoverDerivative,
  type PickedAvatarAsset,
} from '../profile-avatar-runtime.ts';
import { PlayerCover } from './player-card.tsx';
import { DiscoverySheet, Label, PrimaryButton, TextButton, styles } from './ui.tsx';

/** Exact web CoverEditor.tsx user-facing copy (Style Guide owner-v3 template 22). */
export const COVER_EDITOR_COPY = {
  formats:
    'JPEG, PNG или WebP · до 10 МБ и 50 Мп, без анимации. На сервер отправляется только выбранный фрагмент. Обложка следует видимости профиля.',
  pick: 'Выбрать изображение',
  horizontal: 'По горизонтали',
  vertical: 'По вертикали',
  preparing: 'Готовим фрагмент…',
  previewCaption: 'Фрагмент в шапке профиля при текущем размере экрана',
  saving: 'Сохраняем обложку…',
  reconciling: 'Проверяем обложку…',
  error429: 'Слишком много попыток. Попробуйте позже.',
  error422: 'Обложка не прошла проверку. Выберите другое фото.',
  errorOther: 'Сохранение не подтверждено. Обновите данные перед повтором.',
  reconcile: 'Обновить данные',
  save: 'Сохранить фрагмент',
  remove: 'Удалить обложку',
  cancel: 'Отмена',
  saved: 'Обложка сохранена.',
  removed: 'Обложка удалена. Используется стандартное оформление.',
  open: 'Изменить обложку',
  title: 'Обложка профиля',
} as const;

function step(value: number, delta: number) {
  return Math.min(1, Math.max(0, Math.round((value + delta) * 10) / 10));
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${globalThis.btoa(binary)}`;
}

/** Native «Изменить обложку» sheet — web CoverEditor.tsx copy is the source of truth. */
export function CoverEditor({ open, onOpenChange, returnFocusRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const auth = useAuth();
  const owner = auth.profile;
  const coverOwner = auth.cover;
  const profileState = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const coverState = useSyncExternalStore(coverOwner.subscribe, coverOwner.getSnapshot, coverOwner.getSnapshot);
  const [asset, setAsset] = useState<PickedAvatarAsset | null>(null);
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5 });
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const profile = profileState.profile;
  const saving = coverOwner.busy() || coverState.status === 'sending' || reconciling;
  const uncertain = coverState.uncertain || coverState.status === 'unknown';
  const hasCover = !!profile?.cover?.uploadedUrl;
  const coverSource = auth.cover.coverImageSource(profile?.cover?.uploadedUrl ?? null);

  useEffect(() => {
    if (!open || !asset) {
      setPreviewUri(null);
      setPreviewBytes(null);
      setPreparing(false);
      return;
    }
    let cancelled = false;
    setPreparing(true);
    setPrepareError(null);
    setPreviewUri(null);
    setPreviewBytes(null);
    const runtime = createExpoAvatarRuntime();
    const timer = setTimeout(() => {
      void prepareOwnCoverDerivative(runtime, asset, crop, () => cancelled).then(
        derivative => {
          if (cancelled) return;
          setPreviewBytes({ bytes: derivative.bytes, mime: derivative.mime });
          setPreviewUri(bytesToDataUri(derivative.bytes, derivative.mime));
          setPreparing(false);
        },
        failure => {
          if (cancelled) return;
          setPreparing(false);
          setPrepareError(failure instanceof Error ? failure.message : 'Не удалось подготовить обложку. Выберите другое фото.');
        },
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [asset, crop, open]);

  function close() {
    if (saving) return;
    onOpenChange(false);
    setAsset(null);
    setPreviewUri(null);
    setPreviewBytes(null);
    setPrepareError(null);
  }

  return <>
    {coverState.notice ? <Label accessibilityLiveRegion="polite">{coverState.notice}</Label> : null}
    <DiscoverySheet visible={open} title={COVER_EDITOR_COPY.title} onClose={close} returnFocusRef={returnFocusRef}>
      <Label>{COVER_EDITOR_COPY.formats}</Label>
      <TextButton title={COVER_EDITOR_COPY.pick} onPress={() => {
        if (saving) return;
        const runtime = createExpoAvatarRuntime();
        void pickOwnAvatarAsset(runtime, () => false).then(picked => {
          if (picked === 'cancelled') return;
          setAsset(picked);
          setCrop({ x: 0.5, y: 0.5 });
        });
      }} />
      {asset ? <>
        <Label>{COVER_EDITOR_COPY.horizontal}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали меньше"
            disabled={saving} onPress={() => setCrop(c => ({ ...c, x: step(c.x, -0.1) }))}
            style={styles.textButton}><Label>−</Label></Pressable>
          <Label accessibilityLabel={`По горизонтали ${crop.x.toFixed(1)}`}>{crop.x.toFixed(1)}</Label>
          <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали больше"
            disabled={saving} onPress={() => setCrop(c => ({ ...c, x: step(c.x, 0.1) }))}
            style={styles.textButton}><Label>+</Label></Pressable>
        </View>
        <Label>{COVER_EDITOR_COPY.vertical}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="По вертикали меньше"
            disabled={saving} onPress={() => setCrop(c => ({ ...c, y: step(c.y, -0.1) }))}
            style={styles.textButton}><Label>−</Label></Pressable>
          <Label accessibilityLabel={`По вертикали ${crop.y.toFixed(1)}`}>{crop.y.toFixed(1)}</Label>
          <Pressable accessibilityRole="button" accessibilityLabel="По вертикали больше"
            disabled={saving} onPress={() => setCrop(c => ({ ...c, y: step(c.y, 0.1) }))}
            style={styles.textButton}><Label>+</Label></Pressable>
        </View>
      </> : null}
      {preparing ? <Label accessibilityLiveRegion="polite">{COVER_EDITOR_COPY.preparing}</Label> : null}
      {previewUri ? <View accessibilityLabel="Предпросмотр обложки" style={{ gap: 8 }}>
        <Label>{COVER_EDITOR_COPY.previewCaption}</Label>
        <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden', borderRadius: 12 }}>
          <Image source={{ uri: previewUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Выбранный фрагмент в шапке профиля" />
        </View>
      </View> : null}
      {!asset ? <PlayerCover uploadedUrl={profile?.cover?.uploadedUrl ?? null} source={coverSource} /> : null}
      {saving ? <Label accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
        {reconciling ? COVER_EDITOR_COPY.reconciling : COVER_EDITOR_COPY.saving}
      </Label> : null}
      {(prepareError || coverState.error) ? <Label accessibilityRole="alert">{prepareError ?? coverState.error}</Label> : null}
      {uncertain ? (
        <PrimaryButton title={COVER_EDITOR_COPY.reconcile} disabled={saving} onPress={() => {
          setReconciling(true);
          void coverOwner.reconcile().finally(() => setReconciling(false));
        }} />
      ) : <>
        <PrimaryButton title={COVER_EDITOR_COPY.save} disabled={saving || preparing || !previewBytes}
          onPress={() => {
            if (!previewBytes) return;
            const derivative = previewBytes;
            void coverOwner.change(async () => Object.freeze({
              mime: derivative.mime,
              bytes: derivative.bytes,
            })).then(() => {
              if (coverOwner.getSnapshot().notice) close();
            });
          }} />
        {hasCover ? <TextButton title={COVER_EDITOR_COPY.remove} onPress={() => {
          void coverOwner.remove().then(() => {
            if (coverOwner.getSnapshot().notice) close();
          });
        }} /> : null}
      </>}
      <TextButton title={COVER_EDITOR_COPY.cancel} onPress={close} />
    </DiscoverySheet>
  </>;
}
