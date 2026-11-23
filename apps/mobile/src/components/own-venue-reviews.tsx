import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { publicApi } from '../public-api.ts';
import {
  isVenueExperienceCommandPacket,
  isVenueExperiencePacketKind,
  mayWithdrawOwnVenue,
  ownVenueStatusLabel,
  postgameIdempotencyReplayBlocked,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
  type OwnVenueReview,
} from '../venue-reviews.ts';
import { VenueExperienceComposer } from './venue-experience-composer.tsx';
import { iosModalOrientations, Label, Loading, OutlineButton, Page, PrimaryButton, TextButton, styles } from './ui.tsx';
import { colors } from '../theme.ts';

type FocusTarget = ComponentRef<typeof Pressable>;

/** Profile entry — opens private own venue history. */
export function OwnVenueReviewsEntry({ onOpen }: { onOpen: () => void }) {
  const held = useRef<FocusTarget | null>(null);
  return (
    <Pressable
      ref={held}
      accessibilityRole="button"
      accessibilityLabel="Открыть отзывы о площадках"
      onPress={() => {
        onOpen();
      }}
      style={({ pressed }) => [{
        alignSelf: 'flex-start' as const,
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.lineDark,
        backgroundColor: pressed ? colors.paper : colors.card,
        justifyContent: 'center' as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }]}
    >
      <Label style={{ fontWeight: '700', textAlign: 'left' }}>Отзывы о площадках</Label>
    </Pressable>
  );
}

/** Host: history sheet + selected edit composer + withdraw confirm. */
export function OwnVenueReviewsHost() {
  const auth = useAuth();
  const owner = auth.postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  if (!s.ownVenueSurface || s.ownVenueSurface.mode !== 'history') return null;
  return <OwnVenueReviewsSheet onClose={() => owner.closeOwnVenueHistory()} />;
}

function OwnVenueReviewsSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const owner = auth.postgame;
  const router = useRouter();
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const command = s.command && isVenueExperiencePacketKind(s.command.packet.kind) ? s.command : null;
  const venueOwnerBusy = command && isVenueExperienceCommandPacket(command.packet) ? command : null;
  const retentionBlocked = venueOwnerBusy?.status === 'unknown'
    && postgameIdempotencyReplayBlocked(venueOwnerBusy.firstDispatchedAt);
  const items = s.ownVenue.status === 'ready' ? s.ownVenue.data?.items ?? [] : [];
  const locked = !!command || !!s.venueExperience?.reviewId;
  const editOpen = !!s.venueExperience?.reviewId;

  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const close = () => {
    if (s.command?.status === 'sending') return;
    if (editOpen) {
      owner.closeVenueExperience();
      return;
    }
    onClose();
  };

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen"
      supportedOrientations={iosModalOrientations}
      onRequestClose={close}>
      <Page keyboard header={<View style={{ gap: 8 }}>
        <TextButton title={editOpen ? 'К списку' : 'Закрыть'} onPress={close} />
        {venueOwnerBusy?.status === 'unknown' && !retentionBlocked ? (
          <TextButton title="Проверить исходное действие" onPress={() => void owner.reconcileVenueExperience()} />
        ) : null}
      </View>}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
          <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite"
            allowFontScaling style={[styles.text, styles.subtitle]}>
            Отзывы о площадках
          </Text>
          <Label style={{ fontWeight: '700' }}>Только вам</Label>
          <Label>
            Здесь до 50 последних отзывов. Это неполная история: отсутствие отзыва в списке не означает, что он удалён или не существует.
          </Label>
          {retentionBlocked ? <Label accessibilityRole="status">{POSTGAME_RETENTION_EXPIRED_NOTICE}</Label> : null}
          {s.venueNotice ? <Label accessibilityRole="status">{s.venueNotice}</Label> : null}
          {venueOwnerBusy?.status === 'sending' ? <Loading title="Отправляем…" /> : null}
          {venueOwnerBusy?.status === 'unknown' && !retentionBlocked ? (
            <Label accessibilityRole="status">
              Результат отправки не подтверждён. Новые операции заблокированы; обновление списка не подтвердит эту отправку.
            </Label>
          ) : null}
          {s.ownVenueReadRequired ? (
            <Label accessibilityRole="alert">
              Нужно успешное обновление списка или перечитывание выбранного отзыва. Ошибка чтения не снимает блокировку устаревшей версии.
            </Label>
          ) : null}
          <OutlineButton
            title="Обновить список"
            disabled={locked || s.ownVenue.status === 'loading'}
            onPress={() => void owner.loadOwnVenueReviews()}
          />
          {s.ownVenue.status === 'idle' || s.ownVenue.status === 'loading'
            ? <Loading title="Загружаем ваши отзывы…" />
            : null}
          {s.ownVenue.status === 'unavailable'
            ? <Label>Войдите, чтобы увидеть свои отзывы о площадках.</Label>
            : null}
          {s.ownVenue.status === 'error' ? (
            <Label accessibilityRole="alert">
              Не удалось загрузить ваши отзывы. Последнее подтверждённое состояние сохранено; действия недоступны до успешного чтения.
            </Label>
          ) : null}
          {s.ownVenue.status === 'ready' && items.length === 0 ? (
            <Label>В последних 50 отзывах записей нет. Более ранняя история здесь недоступна.</Label>
          ) : null}
          {items.map(row => (
            <OwnVenueReviewCard
              key={row.id}
              row={row}
              locked={locked || s.ownVenueReadRequired || s.ownVenue.status !== 'ready'}
              onOpenVenue={() => {
                onClose();
                router.push(`/venues/${encodeURIComponent(row.venueId)}`);
              }}
              onEdit={() => owner.openOwnVenueEdit(row)}
              onReread={() => void owner.loadOwnVenueSelected(row.id, { clearConflict: true })}
              onWithdraw={() => owner.beginOwnVenueWithdraw(row)}
              showReread={s.ownVenueReadRequired}
            />
          ))}
        </View>
      </Page>
      {editOpen && s.venueExperience ? (
        <VenueExperienceComposer
          gameId={s.venueExperience.gameId}
          venueId={s.venueExperience.venueId}
          onClose={() => owner.closeVenueExperience()}
        />
      ) : null}
      {s.ownVenueWithdraw ? (
        <WithdrawConfirm
          row={s.ownVenueWithdraw}
          busy={!!venueOwnerBusy}
          readRequired={s.ownVenueReadRequired}
          notice={s.venueNotice}
          pending={venueOwnerBusy?.status === 'unknown'}
          retentionBlocked={retentionBlocked}
          onCancel={() => owner.cancelOwnVenueWithdraw()}
          onConfirm={() => void owner.confirmOwnVenueWithdraw()}
          onRetry={() => void owner.reconcileVenueExperience()}
        />
      ) : null}
    </Modal>
  );
}

function OwnVenueReviewCard({
  row,
  locked,
  onOpenVenue,
  onEdit,
  onReread,
  onWithdraw,
  showReread,
}: {
  row: OwnVenueReview;
  locked: boolean;
  onOpenVenue: () => void;
  onEdit: () => void;
  onReread: () => void;
  onWithdraw: () => void;
  showReread: boolean;
}) {
  return (
    <View style={styles.card} accessibilityLabel={`Ваш отзыв о площадке · ${ownVenueStatusLabel(row)}`}>
      <Label style={{ fontWeight: '700' }}>Ваш отзыв о площадке</Label>
      <Label>{ownVenueStatusLabel(row)}</Label>
      <OutlineButton title="Открыть площадку" onPress={onOpenVenue} />
      {row.status === 'withdrawn' ? (
        <Label>Публикация снята. Повторная отправка этого отзыва недоступна.</Label>
      ) : (
        <>
          <Label style={{ fontWeight: '700' }}>
            {row.pendingRevision !== null || row.receiptToken
              ? 'Ваш текст · ожидает обработки'
              : 'Ваш текст'}
          </Label>
          <Label>{row.text ?? 'Текст не возвращён.'}</Label>
          <Label>
            Это ваш текст из личного списка, а не подтверждённая публичная цитата. Обработка может задержать публикацию.
          </Label>
          {row.publicVisible
            ? <PublicQuotation own={row} />
            : <Label>Публичная видимость не подтверждена.</Label>}
          <Label>
            Для редактирования перечитаем выбранный отзыв и проверим сохранённое основание. Отозвать отзыв можно независимо от срока редактирования.
          </Label>
          <OutlineButton title="Изменить отзыв" disabled={locked} onPress={onEdit} />
          {showReread ? (
            <OutlineButton title="Перечитать выбранный отзыв" disabled={locked} onPress={onReread} />
          ) : null}
          {mayWithdrawOwnVenue(row) ? (
            <PrimaryButton title="Отозвать отзыв" disabled={locked} onPress={onWithdraw} />
          ) : null}
        </>
      )}
    </View>
  );
}

/** At most three existing public pages, exact handle only; own COALESCE text is never substituted. */
function PublicQuotation({ own }: { own: OwnVenueReview }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing' | 'ready'>('idle');
  const live = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  async function load() {
    if (lock.current || !live.current) return;
    lock.current = true;
    setState('loading');
    let cursor: string | undefined;
    const seen = new Set<string>();
    try {
      for (let page = 0; page < 3; page += 1) {
        const result = await publicApi.experienceReviews(own.venueId, cursor, 20);
        if (!live.current) return;
        if (result.venueId !== own.venueId || !Array.isArray(result.items)) break;
        const item = result.items.find(entry => entry.reviewHandle === own.reviewHandle);
        if (item && typeof item.text === 'string') {
          setText(item.text);
          setState('ready');
          return;
        }
        const next = result.nextCursor;
        if (!next || seen.has(next)) break;
        seen.add(next);
        cursor = next;
      }
    } catch {
      /* Visibility remains confirmed by own DTO; quotation remains unknown. */
    } finally {
      lock.current = false;
    }
    if (live.current) setState('missing');
  }
  return (
    <View style={{ gap: 8 }}>
      <Label style={{ fontWeight: '700' }}>Публичная версия</Label>
      <Label>Публичная видимость подтверждена.</Label>
      {state === 'ready' ? (
        <Label>{text}</Label>
      ) : (
        <>
          <Label>
            Публичная цитата {state === 'loading' ? 'загружается' : 'недоступна'}. Ваш личный текст её не заменяет.
          </Label>
          <OutlineButton title="Показать публичный текст" disabled={state === 'loading'} onPress={() => void load()} />
        </>
      )}
    </View>
  );
}

function WithdrawConfirm({
  row,
  busy,
  readRequired,
  notice,
  pending,
  retentionBlocked,
  onCancel,
  onConfirm,
  onRetry,
}: {
  row: OwnVenueReview;
  busy: boolean;
  readRequired: boolean;
  notice: string | null;
  pending: boolean;
  retentionBlocked: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const heading = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const node = findNodeHandle(heading.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);
  return (
    <Modal visible animationType="none" presentationStyle="fullScreen"
      supportedOrientations={iosModalOrientations}
      onRequestClose={onCancel}
      onShow={() => {
        const node = findNodeHandle(heading.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }}>
      <Page keyboard header={<View style={{ gap: 8 }}>
        <TextButton title={busy ? 'Скрыть окно' : 'Отмена'} onPress={onCancel} />
      </View>}>
        <View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={{ gap: 16 }}>
          <Text ref={heading} accessibilityRole="header" allowFontScaling
            style={[styles.text, styles.subtitle]}>
            Отозвать отзыв?
          </Text>
          <Label>Публикация и ожидающая заявка будут сняты. Повторная отправка этого отзыва недоступна.</Label>
          <Label style={{ fontWeight: '700' }}>Ваш текст</Label>
          <Label>{row.text ?? 'Текст не возвращён.'}</Label>
          {notice ? <Label accessibilityRole="alert">{notice}</Label> : null}
          {readRequired ? (
            <Label accessibilityRole="alert">
              Сначала успешно обновите список и подтвердите действие заново.
            </Label>
          ) : null}
          {retentionBlocked ? <Label accessibilityRole="status">{POSTGAME_RETENTION_EXPIRED_NOTICE}</Label> : null}
          {pending && !busy && !retentionBlocked ? (
            <Label>
              Исходный запрос сохранён в этой сессии. Повтор отправит тот же запрос с тем же ключом; закрытие окна не отменяет операцию.
            </Label>
          ) : null}
          <View style={{ gap: 8 }}>
            <OutlineButton title={busy ? 'Скрыть окно' : 'Отмена'} onPress={onCancel} />
            {pending && !retentionBlocked ? (
              <PrimaryButton title="Повторить исходный запрос" disabled={busy} onPress={onRetry} />
            ) : (
              <PrimaryButton
                title="Да, отозвать"
                disabled={readRequired || busy || retentionBlocked}
                onPress={onConfirm}
              />
            )}
          </View>
        </View>
      </Page>
    </Modal>
  );
}
