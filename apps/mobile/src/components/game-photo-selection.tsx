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
  const mountedRef = useRef(true);
  const foregroundRef = useRef(AppState.currentState === 'active');
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
  const committedScopeRef = useRef<string | null>(null);

  // Bump generation synchronously on actor/session/view scope change so this render's
  // callbacks capture the new identity. Passive effect must not invalidate a fresh render.
  if (committedScopeRef.current !== scopeKey) {
    if (committedScopeRef.current !== null) {
      scopeEpoch.current += 1;
      retireOwnedPicker(ownedPickerRef);
    }
    liveScopeRef.current = scopeKey;
  }

  // Original render generation / draft identity — OUTSIDE handlers (not re-read at press).
  const genAtRender = scopeEpoch.current;
  const scopeAtRender = scopeKey;
  const scopedAsset = draft.scope === scopeKey ? draft.asset : null;
  const scopedPreviewUri = draft.scope === scopeKey ? draft.previewUri : null;
  const scopedPreviewBytes = draft.scope === scopeKey ? draft.previewBytes : null;
  const scopedConfirmed = draft.scope === scopeKey ? draft.confirmed : false;
  const scopedPrepareError = draft.scope === scopeKey ? draft.prepareError : null;
  const scopedCrop = draft.scope === scopeKey ? draft.crop : { x: 0.5, y: 0.5 };
  const scopedStatus = draft.scope === scopeKey ? draft.statusMessage : '';
  const preparingScoped = draft.scope === scopeKey && preparing;
  const assetUri = scopedAsset?.uri ?? null;
  const assetAtRender = scopedAsset;
  const previewBytesAtRender = scopedPreviewBytes;
  const cropXAtRender = scopedCrop.x;
  const cropYAtRender = scopedCrop.y;

  const selectionLive = useCallback((gen: number, scope: string) => (
    mountedRef.current
    && foregroundRef.current
    && !disabledRef.current
    && scopeEpoch.current === gen
    && liveScopeRef.current === scope
  ), []);

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
    const prev = committedScopeRef.current;
    const changed = prev !== null && prev !== scopeKey;
    committedScopeRef.current = scopeKey;
    // Generation already advanced during render when scope changed — do not bump again.
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
    mountedRef.current = true;
    return () => {
      // Real unmount retires generation so late confirm/pick cannot inject into a new create mount.
      // Parent selection is retired by CreateGame bindCreationView on real route/view departure —
      // do not onChange into another actor via a stale ref here.
      mountedRef.current = false;
      pickerArmedRef.current = false;
      scopeEpoch.current += 1;
      retireOwnedPicker(ownedPickerRef);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const active = next === 'active';
      foregroundRef.current = active;
      if (active || pickerArmedRef.current) return;
      // Real background (not expected OS picker): retire generation + owned assets; clear parent.
      const scope = liveScopeRef.current;
      retireGeneration(true);
      setDraft(d => (d.scope !== scope ? d : emptyDraft(scope)));
    });
    return () => sub.remove();
  }, [retireGeneration]);

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
        () => cancelled || scopeEpoch.current !== epoch || !mountedRef.current,
        { retainSource: true },
      ).then(
        derivative => {
          if (cancelled || scopeEpoch.current !== epoch || !mountedRef.current) return;
          setDraft(d => d.scope === scope ? {
            ...d,
            previewBytes: { bytes: derivative.bytes, mime: derivative.mime },
            previewUri: bytesToDataUri(derivative.bytes, derivative.mime),
            prepareError: null,
          } : d);
          setPreparing(false);
        },
        failure => {
          if (cancelled || scopeEpoch.current !== epoch || !mountedRef.current) return;
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
    if (!selectionLive(genAtRender, scopeAtRender)) return;
    retireOwnedPicker(ownedPickerRef, scopeAtRender);
    setDraft({
      ...emptyDraft(scopeAtRender),
      statusMessage: GAME_PHOTO_SELECTION_COPY.omitStatus,
    });
    setPreparing(false);
    if (!selectionLive(genAtRender, scopeAtRender)) return;
    onChangeRef.current(null);
    onReadyRef.current(true);
  }

  return (
    <View accessibilityLabel={GAME_PHOTO_SELECTION_COPY.sectionLabel} style={{ gap: 12 }}>
      <Label style={{ textAlign: 'left' }}>{GAME_PHOTO_SELECTION_COPY.explanation}</Label>
      <Label style={{ textAlign: 'left' }}>{GAME_COVER_EDITOR_COPY.formats}</Label>
      <TextButton title={GAME_COVER_EDITOR_COPY.pick} onPress={() => {
        if (!selectionLive(genAtRender, scopeAtRender)) return;
        const gen = genAtRender;
        const scope = scopeAtRender;
        pickerArmedRef.current = true;
        const runtime = createExpoAvatarRuntime();
        void pickOwnAvatarAsset(runtime, () => scopeEpoch.current !== gen || !mountedRef.current).then(picked => {
          const armed = pickerArmedRef.current && selectionLive(gen, scope);
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
          if (!selectionLive(gen, scope)) return;
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
                if (!selectionLive(genAtRender, scopeAtRender) || !assetAtRender) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeAtRender
                  ? { ...d, crop: { ...d.crop, x: step(cropXAtRender, -0.1) }, confirmed: false }
                  : d);
              }}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По горизонтали ${scopedCrop.x.toFixed(1)}`}>{scopedCrop.x.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали больше"
              disabled={disabled} onPress={() => {
                if (!selectionLive(genAtRender, scopeAtRender) || !assetAtRender) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeAtRender
                  ? { ...d, crop: { ...d.crop, x: step(cropXAtRender, 0.1) }, confirmed: false }
                  : d);
              }}
              style={styles.textButton}><Label>+</Label></Pressable>
          </View>
          <Label>{GAME_COVER_EDITOR_COPY.vertical}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали меньше"
              disabled={disabled} onPress={() => {
                if (!selectionLive(genAtRender, scopeAtRender) || !assetAtRender) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeAtRender
                  ? { ...d, crop: { ...d.crop, y: step(cropYAtRender, -0.1) }, confirmed: false }
                  : d);
              }}
              style={styles.textButton}><Label>−</Label></Pressable>
            <Label accessibilityLabel={`По вертикали ${scopedCrop.y.toFixed(1)}`}>{scopedCrop.y.toFixed(1)}</Label>
            <Pressable accessibilityRole="button" accessibilityLabel="По вертикали больше"
              disabled={disabled} onPress={() => {
                if (!selectionLive(genAtRender, scopeAtRender) || !assetAtRender) return;
                invalidateConfirmed();
                setDraft(d => d.scope === scopeAtRender
                  ? { ...d, crop: { ...d.crop, y: step(cropYAtRender, 0.1) }, confirmed: false }
                  : d);
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
                if (!selectionLive(genAtRender, scopeAtRender) || !previewBytesAtRender) return;
                const derivative = Object.freeze({
                  mime: previewBytesAtRender.mime,
                  bytes: previewBytesAtRender.bytes,
                });
                setDraft(d => d.scope === scopeAtRender
                  ? { ...d, confirmed: true, statusMessage: GAME_PHOTO_SELECTION_COPY.confirmStatus }
                  : d);
                if (!selectionLive(genAtRender, scopeAtRender)) return;
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
