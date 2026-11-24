import { useEffect, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import { GAME_COVER_EDITOR_COPY } from '../game-cover.ts';
import {
  createExpoAvatarRuntime,
  pickOwnAvatarAsset,
  prepareGameCoverDerivative,
  type PickedAvatarAsset,
} from '../profile-avatar-runtime.ts';
import { DiscoverySheet, Label, PrimaryButton, TextButton, styles } from './ui.tsx';

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

/** Native managed-game photo editor — accepted web GameCoverEditor / GamePhotoSelection copy. */
export function GameCoverEditor({
  gameId,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  gameId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<ComponentRef<typeof Pressable> | null>;
}) {
  const auth = useAuth();
  const owner = nativeAuth.gameCover;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [asset, setAsset] = useState<PickedAvatarAsset | null>(null);
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5 });
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const focused = state.gameId === gameId;
  const access = focused ? state.access : null;
  const saving = owner.busy() || state.status === 'sending' || reconciling;
  const uncertain = focused && (state.uncertain || state.status === 'unknown');
  const hasCover = !!access?.hasCover;
  const coverSource = access ? owner.coverImageSource(access.cover.uploadedUrl) : null;

  useEffect(() => {
    if (!open || auth.status !== 'authenticated' || !gameId) return;
    owner.focus(gameId);
  }, [open, owner, gameId, auth.status, state.actor?.actorId, state.actor?.sessionId, state.actor?.generation]);

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
    setConfirmed(false);
    const runtime = createExpoAvatarRuntime();
    const timer = setTimeout(() => {
      void prepareGameCoverDerivative(runtime, asset, crop, () => cancelled).then(
        derivative => {
          if (cancelled) return;
          setPreviewBytes({ bytes: derivative.bytes, mime: derivative.mime });
          setPreviewUri(bytesToDataUri(derivative.bytes, derivative.mime));
          setPreparing(false);
        },
        failure => {
          if (cancelled) return;
          setPreparing(false);
          setPrepareError(failure instanceof Error ? failure.message : 'Не удалось подготовить фото. Выберите другое изображение.');
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
    setConfirmed(false);
    setPrepareError(null);
  }

  function resetSelection() {
    if (saving) return;
    setAsset(null);
    setPreviewUri(null);
    setPreviewBytes(null);
    setConfirmed(false);
    setPrepareError(null);
  }

  return <>
    {focused && state.notice ? <Label accessibilityLiveRegion="polite">{state.notice}</Label> : null}
    <DiscoverySheet visible={open} title={GAME_COVER_EDITOR_COPY.title} onClose={close} returnFocusRef={returnFocusRef}>
      <Label>{GAME_COVER_EDITOR_COPY.formats}</Label>
      <Label>{GAME_COVER_EDITOR_COPY.fallback}</Label>
      {!focused || state.status === 'loading' ? (
        <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.loading}</Label>
      ) : state.status === 'denied' || !access ? (
        <Label accessibilityRole="alert">{state.error ?? GAME_COVER_EDITOR_COPY.loading}</Label>
      ) : <>
        <TextButton title={GAME_COVER_EDITOR_COPY.pick} onPress={() => {
          if (saving || uncertain) return;
          const runtime = createExpoAvatarRuntime();
          void pickOwnAvatarAsset(runtime, () => false).then(picked => {
            if (picked === 'cancelled') return;
            setAsset(picked);
            setCrop({ x: 0.5, y: 0.5 });
            setConfirmed(false);
            setPreviewUri(null);
            setPreviewBytes(null);
            setPrepareError(null);
          });
        }} />
        {asset ? <>
          <Label>{GAME_COVER_EDITOR_COPY.horizontal}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали меньше"
              disabled={saving || uncertain} onPress={() => setCrop(c => ({ ...c, x: step(c.x, -0.1) }))}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По горизонтали ${crop.x.toFixed(1)}`}>{crop.x.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали больше"
              disabled={saving || uncertain} onPress={() => setCrop(c => ({ ...c, x: step(c.x, 0.1) }))}
              style={styles.textButton}><Label>+</Label></Pressable>
          </View>
          <Label>{GAME_COVER_EDITOR_COPY.vertical}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали меньше"
              disabled={saving || uncertain} onPress={() => setCrop(c => ({ ...c, y: step(c.y, -0.1) }))}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По вертикали ${crop.y.toFixed(1)}`}>{crop.y.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали больше"
              disabled={saving || uncertain} onPress={() => setCrop(c => ({ ...c, y: step(c.y, 0.1) }))}
              style={styles.textButton}><Label>+</Label></Pressable>
          </View>
          {!confirmed && previewBytes && !preparing ? (
            <PrimaryButton title={GAME_COVER_EDITOR_COPY.confirmPick} disabled={saving || uncertain}
              onPress={() => setConfirmed(true)} />
          ) : null}
        </> : null}
        {preparing ? <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.preparing}</Label> : null}
        {previewUri ? <View accessibilityLabel="Предпросмотр фото игры" style={{ gap: 8 }}>
          <Label>{GAME_COVER_EDITOR_COPY.previewCaption}</Label>
          <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden', borderRadius: 12 }}>
            <Image source={{ uri: previewUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Выбранный фрагмент фото игры" />
          </View>
        </View> : null}
        {!asset && coverSource ? (
          <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden', borderRadius: 12 }}>
            <Image source={coverSource} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Текущее фото игры" />
          </View>
        ) : null}
        {saving ? <Label accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
          {reconciling ? GAME_COVER_EDITOR_COPY.reconciling : GAME_COVER_EDITOR_COPY.saving}
        </Label> : null}
        {(prepareError || state.error) ? <Label accessibilityRole="alert">{prepareError ?? state.error}</Label> : null}
        {uncertain ? (
          <PrimaryButton title={GAME_COVER_EDITOR_COPY.reconcile} disabled={saving} onPress={() => {
            setReconciling(true);
            void owner.reconcile().finally(() => setReconciling(false));
          }} />
        ) : <>
          <PrimaryButton title={GAME_COVER_EDITOR_COPY.save}
            disabled={saving || preparing || !confirmed || !previewBytes}
            onPress={() => {
              if (!previewBytes || !confirmed) return;
              const derivative = previewBytes;
              void owner.change(async () => Object.freeze({
                mime: derivative.mime,
                bytes: derivative.bytes,
              })).then(() => {
                if (owner.getSnapshot().notice) {
                  resetSelection();
                  close();
                }
              });
            }} />
          {hasCover ? <TextButton title={GAME_COVER_EDITOR_COPY.remove} onPress={() => {
            void owner.remove().then(() => {
              if (owner.getSnapshot().notice) {
                resetSelection();
                close();
              }
            });
          }} /> : null}
        </>}
        {asset ? <TextButton title="Без своего фото" onPress={resetSelection} /> : null}
      </>}
      <TextButton title={GAME_COVER_EDITOR_COPY.cancel} onPress={close} />
    </DiscoverySheet>
  </>;
}
