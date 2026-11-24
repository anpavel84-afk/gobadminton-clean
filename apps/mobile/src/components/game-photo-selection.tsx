import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, View } from 'react-native';
import {
  GAME_COVER_EDITOR_COPY,
  GAME_PHOTO_SELECTION_COPY,
} from '../game-cover.ts';
import {
  createExpoAvatarRuntime,
  pickOwnAvatarAsset,
  prepareGameCoverDerivative,
  releaseOwnedPickerAsset,
  type PickedAvatarAsset,
} from '../profile-avatar-runtime.ts';
import type { AvatarDerivative } from '../profile-avatar.ts';
import { Label, PrimaryButton, TextButton, styles } from './ui.tsx';

/** True crop ratio for 1200×400 game-cover derivative. */
const COVER_PREVIEW_ASPECT = 3;

function step(value: number, delta: number) {
  return Math.min(1, Math.max(0, Math.round((value + delta) * 10) / 10));
}

function retirePickerSource(asset: PickedAvatarAsset | null | undefined) {
  if (!asset) return;
  releaseOwnedPickerAsset(createExpoAvatarRuntime(), asset);
}

type OwnedPickerLease = { scope: string; asset: PickedAvatarAsset };

function installOwnedPicker(
  ref: { current: OwnedPickerLease | null },
  scope: string,
  asset: PickedAvatarAsset,
) {
  const prev = ref.current;
  if (prev && (prev.scope !== scope || prev.asset.uri !== asset.uri)) {
    ref.current = null;
    retirePickerSource(prev.asset);
  }
  ref.current = { scope, asset };
}

function retireOwnedPicker(
  ref: { current: OwnedPickerLease | null },
  scope?: string,
) {
  const cur = ref.current;
  if (!cur) return;
  if (scope !== undefined && cur.scope !== scope) return;
  ref.current = null;
  retirePickerSource(cur.asset);
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${globalThis.btoa(binary)}`;
}

type DraftBundle = {
  scope: string;
  asset: PickedAvatarAsset | null;
  crop: { x: number; y: number };
  previewUri: string | null;
  previewBytes: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null;
  confirmed: boolean;
  prepareError: string | null;
  statusMessage: string;
};

const emptyDraft = (scope: string): DraftBundle => ({
  scope,
  asset: null,
  crop: { x: 0.5, y: 0.5 },
  previewUri: null,
  previewBytes: null,
  confirmed: false,
  prepareError: null,
  statusMessage: '',
});

/**
 * Create-game optional photo — accepted-web GamePhotoSelection order/copy.
 * Local preparation only; no game id and no upload owner. Confirmed bytes go to management.
 * Kept mounted across create preview↔edit by CreateGame (display:none under preview).
 */
export function GamePhotoSelection({
  scopeKey,
  disabled = false,
  onChange,
  onReady,
}: {
  scopeKey: string;
  disabled?: boolean;
  onChange: (derivative: AvatarDerivative | null) => void;
  onReady: (ready: boolean) => void;
}) {
  const ownedPickerRef = useRef<OwnedPickerLease | null>(null);
  const pickerArmedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const disabledRef = useRef(disabled);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  disabledRef.current = disabled;
  const [draft, setDraft] = useState<DraftBundle>(() => emptyDraft(scopeKey));
  const [preparing, setPreparing] = useState(false);
  const scopeEpoch = useRef(0);
  const liveScopeRef = useRef(scopeKey);
  liveScopeRef.current = scopeKey;
  const prevScopeRef = useRef<string | null>(null);

  const retireGeneration = useCallback((clearParent: boolean) => {
    scopeEpoch.current += 1;
    retireOwnedPicker(ownedPickerRef);
    setPreparing(false);
    if (clearParent) {
      onChangeRef.current(null);
      onReadyRef.current(true);
    }
  }, []);

  useEffect(() => {
    const changed = prevScopeRef.current !== null && prevScopeRef.current !== scopeKey;
    prevScopeRef.current = scopeKey;
    scopeEpoch.current += 1;
    retireOwnedPicker(ownedPickerRef);
    setDraft(emptyDraft(scopeKey));
    setPreparing(false);
    // Actor/session/view scope change clears local + parent selection.
    // Ordinary preview↔edit remount must not wipe parent-confirmed bytes (CreateGame keeps mount).
    if (changed) {
      onChangeRef.current(null);
      onReadyRef.current(true);
    }
  }, [scopeKey]);

  useEffect(() => {
    return () => {
      // Real unmount retires generation so late confirm/pick cannot inject into a new create mount.
      pickerArmedRef.current = false;
      scopeEpoch.current += 1;
      retireOwnedPicker(ownedPickerRef);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' || pickerArmedRef.current) return;
      // Real background (not expected OS picker): retire generation + owned assets; clear parent.
      const scope = liveScopeRef.current;
      retireGeneration(true);
      setDraft(d => (d.scope !== scope ? d : emptyDraft(scope)));
    });
    return () => sub.remove();
  }, [retireGeneration]);

  const scopedAsset = draft.scope === scopeKey ? draft.asset : null;
  const scopedPreviewUri = draft.scope === scopeKey ? draft.previewUri : null;
  const scopedPreviewBytes = draft.scope === scopeKey ? draft.previewBytes : null;
  const scopedConfirmed = draft.scope === scopeKey ? draft.confirmed : false;
  const scopedPrepareError = draft.scope === scopeKey ? draft.prepareError : null;
  const scopedCrop = draft.scope === scopeKey ? draft.crop : { x: 0.5, y: 0.5 };
  const scopedStatus = draft.scope === scopeKey ? draft.statusMessage : '';
  const preparingScoped = draft.scope === scopeKey && preparing;
  const assetUri = scopedAsset?.uri ?? null;

  useEffect(() => {
    if (!assetUri || !scopedAsset) {
      setPreparing(false);
      return;
    }
    const scope = scopeKey;
    const crop = { x: scopedCrop.x, y: scopedCrop.y };
    const asset = scopedAsset;
    const epoch = scopeEpoch.current;
    let cancelled = false;
    setPreparing(true);
    setDraft(d => d.scope === scope
      ? { ...d, prepareError: null, previewUri: null, previewBytes: null, confirmed: false, statusMessage: '' }
      : d);
    onChangeRef.current(null);
    onReadyRef.current(false);
    const runtime = createExpoAvatarRuntime();
    const timer = setTimeout(() => {
      void prepareGameCoverDerivative(
        runtime,
        asset,
        crop,
        () => cancelled || scopeEpoch.current !== epoch,
        { retainSource: true },
      ).then(
        derivative => {
          if (cancelled || scopeEpoch.current !== epoch) return;
          setDraft(d => d.scope === scope ? {
            ...d,
            previewBytes: { bytes: derivative.bytes, mime: derivative.mime },
            previewUri: bytesToDataUri(derivative.bytes, derivative.mime),
            prepareError: null,
          } : d);
          setPreparing(false);
        },
        failure => {
          if (cancelled || scopeEpoch.current !== epoch) return;
          setPreparing(false);
          setDraft(d => d.scope === scope ? {
            ...d,
            prepareError: failure instanceof Error
              ? failure.message
              : 'Не удалось подготовить фото. Выберите другое изображение.',
          } : d);
        },
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assetUri, scopedAsset, scopedCrop.x, scopedCrop.y, scopeKey]);

  const invalidateConfirmed = useCallback(() => {
    onChangeRef.current(null);
    onReadyRef.current(false);
  }, []);

  function resetSelection() {
    const epoch = scopeEpoch.current;
    const scope = scopeKey;
    if (disabledRef.current || scopeEpoch.current !== epoch || liveScopeRef.current !== scope) return;
    retireOwnedPicker(ownedPickerRef, scope);
    setDraft({
      ...emptyDraft(scope),
      statusMessage: GAME_PHOTO_SELECTION_COPY.omitStatus,
    });
    setPreparing(false);
    if (scopeEpoch.current !== epoch || liveScopeRef.current !== scope) return;
    onChangeRef.current(null);
    onReadyRef.current(true);
  }

  return (
    <View accessibilityLabel={GAME_PHOTO_SELECTION_COPY.sectionLabel} style={{ gap: 12 }}>
      <Label style={{ textAlign: 'left' }}>{GAME_PHOTO_SELECTION_COPY.explanation}</Label>
      <Label style={{ textAlign: 'left' }}>{GAME_COVER_EDITOR_COPY.formats}</Label>
      <TextButton title={GAME_COVER_EDITOR_COPY.pick} onPress={() => {
        if (disabledRef.current) return;
        const scope = scopeKey;
        const epoch = scopeEpoch.current;
        pickerArmedRef.current = true;
        const runtime = createExpoAvatarRuntime();
        void pickOwnAvatarAsset(runtime, () => scopeEpoch.current !== epoch).then(picked => {
          const armed = pickerArmedRef.current && scopeEpoch.current === epoch && liveScopeRef.current === scope;
          pickerArmedRef.current = false;
          if (!armed) {
            if (picked !== 'cancelled' && picked) retirePickerSource(picked);
            return;
          }
          if (picked === 'cancelled') return;
          installOwnedPicker(ownedPickerRef, scope, picked);
          invalidateConfirmed();
          setDraft({
            scope,
            asset: picked,
            crop: { x: 0.5, y: 0.5 },
            previewUri: null,
            previewBytes: null,
            confirmed: false,
            prepareError: null,
            statusMessage: '',
          });
        }, failure => {
          pickerArmedRef.current = false;
          if (scopeEpoch.current !== epoch || liveScopeRef.current !== scope) return;
          setDraft(d => d.scope === scope ? {
            ...d,
            prepareError: failure instanceof Error
              ? failure.message
              : 'Не удалось выбрать фото. Попробуйте ещё раз.',
          } : d);
        });
      }} />
      {scopedAsset ? (
        <>
          <Label>{GAME_COVER_EDITOR_COPY.horizontal}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали меньше"
              disabled={disabled} onPress={() => {
                const epoch = scopeEpoch.current;
                if (disabledRef.current || scopeEpoch.current !== epoch) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeKey ? { ...d, crop: { ...d.crop, x: step(d.crop.x, -0.1) }, confirmed: false } : d);
              }}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По горизонтали ${scopedCrop.x.toFixed(1)}`}>{scopedCrop.x.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали больше"
              disabled={disabled} onPress={() => {
                const epoch = scopeEpoch.current;
                if (disabledRef.current || scopeEpoch.current !== epoch) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeKey ? { ...d, crop: { ...d.crop, x: step(d.crop.x, 0.1) }, confirmed: false } : d);
              }}
              style={styles.textButton}><Label>+</Label></Pressable>
          </View>
          <Label>{GAME_COVER_EDITOR_COPY.vertical}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали меньше"
              disabled={disabled} onPress={() => {
                const epoch = scopeEpoch.current;
                if (disabledRef.current || scopeEpoch.current !== epoch) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeKey ? { ...d, crop: { ...d.crop, y: step(d.crop.y, -0.1) }, confirmed: false } : d);
              }}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По вертикали ${scopedCrop.y.toFixed(1)}`}>{scopedCrop.y.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали больше"
              disabled={disabled} onPress={() => {
                const epoch = scopeEpoch.current;
                if (disabledRef.current || scopeEpoch.current !== epoch) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeKey ? { ...d, crop: { ...d.crop, y: step(d.crop.y, 0.1) }, confirmed: false } : d);
              }}
              style={styles.textButton}><Label>+</Label></Pressable>
          </View>
          {scopedPreviewUri ? (
            <View accessibilityLabel="Предпросмотр фото игры" style={{ gap: 8 }}>
              <Label>{GAME_COVER_EDITOR_COPY.previewCaption}</Label>
              <View style={{ width: '100%', aspectRatio: COVER_PREVIEW_ASPECT, overflow: 'hidden', borderRadius: 12 }}>
                <Image source={{ uri: scopedPreviewUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover"
                  accessibilityLabel="Выбранный фрагмент фото игры" />
              </View>
            </View>
          ) : null}
          {!scopedConfirmed && scopedPreviewBytes && !preparingScoped ? (
            <PrimaryButton title={GAME_COVER_EDITOR_COPY.confirmPick} disabled={disabled}
              onPress={() => {
                const epoch = scopeEpoch.current;
                const scope = scopeKey;
                if (!scopedPreviewBytes || disabledRef.current) return;
                if (scopeEpoch.current !== epoch || liveScopeRef.current !== scope) return;
                const derivative = Object.freeze({
                  mime: scopedPreviewBytes.mime,
                  bytes: scopedPreviewBytes.bytes,
                });
                setDraft(d => d.scope === scope
                  ? { ...d, confirmed: true, statusMessage: GAME_PHOTO_SELECTION_COPY.confirmStatus }
                  : d);
                if (scopeEpoch.current !== epoch || liveScopeRef.current !== scope) return;
                onChangeRef.current(derivative);
                onReadyRef.current(true);
              }} />
          ) : null}
        </>
      ) : null}
      {preparingScoped ? <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.preparing}</Label> : null}
      {scopedPrepareError ? <Label accessibilityRole="alert">{scopedPrepareError}</Label> : null}
      <TextButton title="Без своего фото" onPress={resetSelection} />
      {!!scopedStatus && !preparingScoped ? <Label accessibilityLiveRegion="polite">{scopedStatus}</Label> : null}
    </View>
  );
}
