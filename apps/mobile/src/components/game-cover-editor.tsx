import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { AppState, Image, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { nativeAuth } from '../auth-runtime.ts';
import {
  GAME_COVER_EDITOR_COPY,
  gameCoverMutationSucceeded,
  type GameCoverRenderedPermit,
} from '../game-cover.ts';
import { sameActor } from '../participation.ts';
import {
  createExpoAvatarRuntime,
  pickOwnAvatarAsset,
  prepareGameCoverDerivative,
  releaseOwnedPickerAsset,
  type PickedAvatarAsset,
} from '../profile-avatar-runtime.ts';
import { DiscoverySheet, Label, PrimaryButton, TextButton, styles } from './ui.tsx';

function step(value: number, delta: number) {
  return Math.min(1, Math.max(0, Math.round((value + delta) * 10) / 10));
}

/** Retire app-owned picker cache for a draft selection; user library URIs are never deleted. */
function retirePickerSource(asset: PickedAvatarAsset | null | undefined) {
  if (!asset) return;
  releaseOwnedPickerAsset(createExpoAvatarRuntime(), asset);
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
};

const emptyDraft = (scope: string): DraftBundle => ({
  scope,
  asset: null,
  crop: { x: 0.5, y: 0.5 },
  previewUri: null,
  previewBytes: null,
  confirmed: false,
  prepareError: null,
});

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
  const leaseRef = useRef<number | null>(null);
  const endPickerRef = useRef<(() => void) | null>(null);
  const [draft, setDraft] = useState<DraftBundle>(() => emptyDraft(''));
  const [preparing, setPreparing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const reconcileViewRef = useRef<{ gameId: string; viewGen: number } | null>(null);

  const focused = state.focus?.gameId === gameId && state.focus.viewGen === leaseRef.current
    && state.gameId === gameId;
  const access = focused ? state.access : null;
  const saving = owner.busy() || state.status === 'sending' || reconciling;
  const uncertain = focused && (state.uncertain || state.status === 'unknown');
  const hasCover = !!access?.hasCover;
  const coverSource = access ? owner.coverImageSource(access.cover.uploadedUrl) : null;

  // Actor/session/game/view lease identity — same-game reopen must not inherit prior draft handlers.
  const actorKey = `${state.actor?.actorId ?? ''}:${state.actor?.sessionId ?? ''}:${state.actor?.generation ?? ''}`;
  const liveViewGen = state.focus?.gameId === gameId && state.focus.viewGen === leaseRef.current
    ? state.focus.viewGen
    : null;
  const draftScope = `${actorKey}:${gameId}:${liveViewGen ?? 'none'}`;

  // Synchronous draft binding — previous-game/account/view private image must not render or submit under a new permit.
  if (draft.scope !== draftScope) {
    retirePickerSource(draft.asset);
    setDraft(emptyDraft(draftScope));
  }
  const preparingScoped = draft.scope === draftScope && preparing;
  const scopedAsset = draft.scope === draftScope ? draft.asset : null;
  const scopedPreviewUri = draft.scope === draftScope ? draft.previewUri : null;
  const scopedPreviewBytes = draft.scope === draftScope ? draft.previewBytes : null;
  const scopedConfirmed = draft.scope === draftScope ? draft.confirmed : false;
  const scopedPrepareError = draft.scope === draftScope ? draft.prepareError : null;
  const scopedCrop = draft.scope === draftScope ? draft.crop : { x: 0.5, y: 0.5 };

  // Route focus owns the openView lease (shared with open/auth/game). Real blur/unmount always releases; picker AppState is separate.
  useFocusEffect(useCallback(() => {
    if (!open || auth.status !== 'authenticated' || !gameId) {
      leaseRef.current = null;
      endPickerRef.current?.();
      endPickerRef.current = null;
      return;
    }
    const release = owner.openView(gameId);
    leaseRef.current = owner.getSnapshot().focus?.viewGen ?? null;
    owner.setForeground(AppState.currentState === 'active');
    const scopeForBg = `${actorKey}:${gameId}:${leaseRef.current ?? 'none'}`;
    const sub = AppState.addEventListener('change', next => {
      owner.setForeground(next === 'active');
      // Ordinary background clears draft; expected picker handoff retains legitimate selection.
      if (next !== 'active' && !owner.expectingPickerHandoff()) {
        setDraft(d => {
          if (d.scope !== scopeForBg) return d;
          retirePickerSource(d.asset);
          return emptyDraft(scopeForBg);
        });
        setPreparing(false);
      }
    });
    return () => {
      sub.remove();
      // Expo route blur/unmount is real view retirement — always end picker + release lease.
      // Native picker Activity background does not navigate Expo routes (AppState + handoff handle that).
      endPickerRef.current?.();
      endPickerRef.current = null;
      release();
      leaseRef.current = null;
      setDraft(d => {
        retirePickerSource(d.asset);
        return emptyDraft(d.scope);
      });
      setPreparing(false);
      setReconciling(false);
      reconcileViewRef.current = null;
    };
  }, [open, owner, gameId, auth.status, actorKey]));

  // Parent-forced close / game / account change must not leave stale preview under another owner.
  useEffect(() => {
    setPreparing(false);
    if (!open) {
      endPickerRef.current?.();
      endPickerRef.current = null;
      setDraft(d => {
        retirePickerSource(d.asset);
        return emptyDraft(draftScope);
      });
      setReconciling(false);
      reconcileViewRef.current = null;
    }
  }, [open, gameId, actorKey, draftScope]);

  // Permit captured for this render — checked before paint of prepared preview.
  const permit: GameCoverRenderedPermit | null = state.actor && state.focus && state.foreground
    && state.focus.gameId === gameId
    && state.focus.viewGen === leaseRef.current
    ? Object.freeze({
      actor: Object.freeze({ ...state.actor }),
      gameId,
      viewGen: state.focus.viewGen,
      foregroundGen: state.foregroundGen,
    })
    : null;

  useEffect(() => {
    if (!open || !scopedAsset || !permit) {
      setPreparing(false);
      if (!scopedAsset || !permit) {
        setDraft(d => d.scope === draftScope && (d.previewUri || d.previewBytes)
          ? { ...d, previewUri: null, previewBytes: null, confirmed: false }
          : d);
      }
      return;
    }
    const captured = permit;
    const scope = draftScope;
    let cancelled = false;
    setPreparing(true);
    setDraft(d => d.scope === scope ? { ...d, prepareError: null, previewUri: null, previewBytes: null, confirmed: false } : d);
    const runtime = createExpoAvatarRuntime();
    const crop = scopedCrop;
    const timer = setTimeout(() => {
      // Retain picker source across crop tweaks; transient derivatives still clean per prepare.
      void prepareGameCoverDerivative(runtime, scopedAsset, crop, () => cancelled || !owner.permitLive(captured), { retainSource: true }).then(
        derivative => {
          if (cancelled || !owner.permitLive(captured)) return;
          setDraft(d => d.scope === scope ? {
            ...d,
            previewBytes: { bytes: derivative.bytes, mime: derivative.mime },
            previewUri: bytesToDataUri(derivative.bytes, derivative.mime),
            prepareError: null,
          } : d);
          setPreparing(false);
        },
        failure => {
          if (cancelled || !owner.permitLive(captured)) return;
          setPreparing(false);
          setDraft(d => d.scope === scope ? {
            ...d,
            prepareError: failure instanceof Error ? failure.message : 'Не удалось подготовить фото. Выберите другое изображение.',
          } : d);
        },
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scopedAsset, scopedCrop.x, scopedCrop.y, open, permit?.viewGen, permit?.foregroundGen, permit?.gameId, draftScope, owner]);

  function close() {
    if (saving) return;
    // Guard stale original rendered permit (actor/game/view) before ALL close effects — not full foreground permitLive.
    // Current idle/loading/denied of THIS view still closes; old-view close no-ops. Do not mint authority at click.
    const snap = owner.getSnapshot();
    const lease = leaseRef.current;
    if (lease === null
      || !snap.actor
      || snap.focus?.gameId !== gameId
      || snap.focus.viewGen !== lease) {
      return;
    }
    if (permit) {
      if (!sameActor(permit.actor, snap.actor)
        || permit.gameId !== gameId
        || permit.viewGen !== lease) {
        return;
      }
    }
    const live = !!permit && owner.permitLive(permit);
    endPickerRef.current?.();
    endPickerRef.current = null;
    if (live) {
      setDraft(d => {
        if (d.scope !== draftScope) return d;
        retirePickerSource(d.asset);
        return emptyDraft(draftScope);
      });
    }
    onOpenChange(false);
  }

  function resetSelection() {
    if (saving) return;
    if (!permit || !owner.permitLive(permit)) return;
    // Old reset must not clear a newer context's draft.
    setDraft(d => {
      if (d.scope !== draftScope) return d;
      retirePickerSource(d.asset);
      return emptyDraft(draftScope);
    });
    setPreparing(false);
  }

  const showReconcile = focused && uncertain;
  const showEditorBody = focused && access && state.status !== 'loading' && state.status !== 'denied';
  const previewLive = !!(scopedPreviewUri && permit && owner.permitLive(permit));
  // Key private image identity to the immutable draft scope + uri.
  const previewImageKey = previewLive ? `${draftScope}:${scopedPreviewUri!.slice(0, 64)}` : null;
  const coverLive = !!(coverSource && !scopedAsset && permit && owner.permitLive(permit));
  const coverImageKey = coverLive
    ? `${draftScope}:${access?.cover.uploadedUrl ?? ''}:${access?.version ?? ''}`
    : null;

  return (
    <>
      {focused && state.notice ? <Label accessibilityLiveRegion="polite">{state.notice}</Label> : null}
      <DiscoverySheet visible={open} title={GAME_COVER_EDITOR_COPY.title} onClose={close} returnFocusRef={returnFocusRef}>
        <Label>{GAME_COVER_EDITOR_COPY.formats}</Label>
        <Label>{GAME_COVER_EDITOR_COPY.fallback}</Label>
        {!focused || state.status === 'loading' ? (
          <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.loading}</Label>
        ) : state.status === 'denied' ? (
          <Label accessibilityRole="alert">{state.error ?? GAME_COVER_EDITOR_COPY.loading}</Label>
        ) : state.status === 'idle' && !access && !uncertain ? (
          <>
            <Label accessibilityRole="alert">{state.error ?? GAME_COVER_EDITOR_COPY.loading}</Label>
            <TextButton title={GAME_COVER_EDITOR_COPY.retryLoad} onPress={() => {
              if (permit) void owner.load(gameId, permit);
              else void owner.load(gameId);
            }} />
          </>
        ) : (
          <>
            {/* Explicit read-only reconcile reachable without displaying old private access after quarantine. */}
            {showReconcile ? (
              <>
                {!access ? (
                  <Label accessibilityLiveRegion="polite">{state.error ?? GAME_COVER_EDITOR_COPY.loading}</Label>
                ) : null}
                <PrimaryButton title={GAME_COVER_EDITOR_COPY.reconcile} disabled={saving || !permit} onPress={() => {
                  if (!permit) return;
                  const captured = permit;
                  reconcileViewRef.current = { gameId: captured.gameId, viewGen: captured.viewGen };
                  setReconciling(true);
                  void owner.reconcile(captured).finally(() => {
                    // Only clear matching original reconcile marker — never null a newer view's marker.
                    const marked = reconcileViewRef.current;
                    if (!marked
                      || marked.gameId !== captured.gameId
                      || marked.viewGen !== captured.viewGen) return;
                    setReconciling(false);
                    if (!owner.permitLive(captured)) reconcileViewRef.current = null;
                  });
                }} />
              </>
            ) : null}
            {showEditorBody && !uncertain ? (
              <>
                <TextButton title={GAME_COVER_EDITOR_COPY.pick} onPress={() => {
                  if (saving || uncertain || !permit) return;
                  const captured = permit;
                  endPickerRef.current?.();
                  endPickerRef.current = owner.beginExpectedPickerHandoff(captured);
                  const runtime = createExpoAvatarRuntime();
                  const scope = draftScope;
                  void pickOwnAvatarAsset(runtime, () => !owner.pickerHandoffPending(captured)).then(picked => {
                    // Evaluate acceptance before ending handoff — end() clears pending binding.
                    const accepted = owner.pickerHandoffLive(captured) || owner.permitLive(captured);
                    const end = endPickerRef.current;
                    endPickerRef.current = null;
                    end?.();
                    if (!accepted) return;
                    if (picked === 'cancelled') return;
                    setDraft(d => {
                      if (d.scope === scope && d.asset && d.asset.uri !== picked.uri) {
                        retirePickerSource(d.asset);
                      }
                      return {
                        scope,
                        asset: picked,
                        crop: { x: 0.5, y: 0.5 },
                        previewUri: null,
                        previewBytes: null,
                        confirmed: false,
                        prepareError: null,
                      };
                    });
                  }, failure => {
                    const accepted = owner.pickerHandoffLive(captured) || owner.permitLive(captured);
                    const end = endPickerRef.current;
                    endPickerRef.current = null;
                    end?.();
                    if (!accepted) return;
                    setDraft(d => d.scope === scope ? {
                      ...d,
                      prepareError: failure instanceof Error ? failure.message : 'Не удалось выбрать фото. Попробуйте ещё раз.',
                    } : d);
                  });
                }} />
                {scopedAsset ? (
                  <>
                    <Label>{GAME_COVER_EDITOR_COPY.horizontal}</Label>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали меньше"
                        disabled={saving || uncertain} onPress={() => {
                          if (!permit || !owner.permitLive(permit)) return;
                          setDraft(d => d.scope === draftScope ? { ...d, crop: { ...d.crop, x: step(d.crop.x, -0.1) } } : d);
                        }}
                        style={styles.textButton}><Label>−</Label></Pressable>
                      <Label accessibilityLabel={`По горизонтали ${scopedCrop.x.toFixed(1)}`}>{scopedCrop.x.toFixed(1)}</Label>
                      <Pressable accessibilityRole="button" accessibilityLabel="По горизонтали больше"
                        disabled={saving || uncertain} onPress={() => {
                          if (!permit || !owner.permitLive(permit)) return;
                          setDraft(d => d.scope === draftScope ? { ...d, crop: { ...d.crop, x: step(d.crop.x, 0.1) } } : d);
                        }}
                        style={styles.textButton}><Label>+</Label></Pressable>
                    </View>
                    <Label>{GAME_COVER_EDITOR_COPY.vertical}</Label>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Pressable accessibilityRole="button" accessibilityLabel="По вертикали меньше"
                        disabled={saving || uncertain} onPress={() => {
                          if (!permit || !owner.permitLive(permit)) return;
                          setDraft(d => d.scope === draftScope ? { ...d, crop: { ...d.crop, y: step(d.crop.y, -0.1) } } : d);
                        }}
                        style={styles.textButton}><Label>−</Label></Pressable>
                      <Label accessibilityLabel={`По вертикали ${scopedCrop.y.toFixed(1)}`}>{scopedCrop.y.toFixed(1)}</Label>
                      <Pressable accessibilityRole="button" accessibilityLabel="По вертикали больше"
                        disabled={saving || uncertain} onPress={() => {
                          if (!permit || !owner.permitLive(permit)) return;
                          setDraft(d => d.scope === draftScope ? { ...d, crop: { ...d.crop, y: step(d.crop.y, 0.1) } } : d);
                        }}
                        style={styles.textButton}><Label>+</Label></Pressable>
                    </View>
                    {!scopedConfirmed && scopedPreviewBytes && !preparingScoped ? (
                      <PrimaryButton title={GAME_COVER_EDITOR_COPY.confirmPick} disabled={saving || uncertain || !permit}
                        onPress={() => { if (permit && owner.permitLive(permit)) setDraft(d => d.scope === draftScope ? { ...d, confirmed: true } : d); }} />
                    ) : null}
                  </>
                ) : null}
                {preparingScoped ? <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.preparing}</Label> : null}
                {previewLive && previewImageKey ? (
                  <View key={previewImageKey} accessibilityLabel="Предпросмотр фото игры" style={{ gap: 8 }}>
                    <Label>{GAME_COVER_EDITOR_COPY.previewCaption}</Label>
                    <View style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden', borderRadius: 12 }}>
                      <Image source={{ uri: scopedPreviewUri! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Выбранный фрагмент фото игры" />
                    </View>
                  </View>
                ) : null}
                {coverLive && coverImageKey && coverSource ? (
                  <View key={coverImageKey} style={{ width: '100%', aspectRatio: 2.5, overflow: 'hidden', borderRadius: 12 }}>
                    <Image source={coverSource} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Текущее фото игры" />
                  </View>
                ) : null}
                {saving ? (
                  <Label accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
                    {reconciling ? GAME_COVER_EDITOR_COPY.reconciling : GAME_COVER_EDITOR_COPY.saving}
                  </Label>
                ) : null}
                {(scopedPrepareError || state.error) ? (
                  <Label accessibilityRole="alert">{scopedPrepareError ?? state.error}</Label>
                ) : null}
                <PrimaryButton title={GAME_COVER_EDITOR_COPY.save}
                  disabled={saving || preparingScoped || !scopedConfirmed || !scopedPreviewBytes || !permit}
                  onPress={() => {
                    if (!scopedPreviewBytes || !scopedConfirmed || !permit) return;
                    if (draft.scope !== draftScope) return;
                    const captured = permit;
                    const derivative = scopedPreviewBytes;
                    const scope = draftScope;
                    void owner.change(async retired => {
                      if (retired() || !owner.permitLive(captured)) return 'cancelled';
                      return Object.freeze({ mime: derivative.mime, bytes: derivative.bytes });
                    }, captured).then(() => {
                      if (!owner.permitLive(captured)) return;
                      const snap = owner.getSnapshot();
                      // Close only on definite success + live original view — not on error/UNKNOWN notice.
                      if (gameCoverMutationSucceeded(snap)) {
                        setDraft(d => {
                          if (d.scope !== scope) return d;
                          retirePickerSource(d.asset);
                          return emptyDraft(scope);
                        });
                        onOpenChange(false);
                      }
                    });
                  }} />
                {hasCover ? (
                  <TextButton title={GAME_COVER_EDITOR_COPY.remove} onPress={() => {
                    if (!permit) return;
                    const captured = permit;
                    const scope = draftScope;
                    void owner.remove(captured).then(() => {
                      if (!owner.permitLive(captured)) return;
                      if (gameCoverMutationSucceeded(owner.getSnapshot())) {
                        setDraft(d => {
                          if (d.scope !== scope) return d;
                          retirePickerSource(d.asset);
                          return emptyDraft(scope);
                        });
                        onOpenChange(false);
                      }
                    });
                  }} />
                ) : null}
                {scopedAsset ? <TextButton title="Без своего фото" onPress={resetSelection} /> : null}
              </>
            ) : null}
            {!access && !uncertain && state.status !== 'idle' ? (
              <Label accessibilityLiveRegion="polite">{GAME_COVER_EDITOR_COPY.loading}</Label>
            ) : null}
          </>
        )}
        <TextButton title={GAME_COVER_EDITOR_COPY.cancel} onPress={close} />
      </DiscoverySheet>
    </>
  );
}
