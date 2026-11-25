import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentRef, ReactNode, RefObject } from 'react';
import { AccessibilityInfo, AppState, findNodeHandle, Image, Modal, Pressable, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { nativeAuth } from '../auth-runtime.ts';
import { useGameComments } from '../game-comments-runtime.tsx';
import type { GameCommentsCoordinator, GameCommentThread, GameCommentOperation } from '../game-comments-coordinator.ts';
import type { GameComment, GameCommentAction, GameCommentPacket } from '../game-comments.ts';
import { commentText } from '../game-comments.ts';
import { NativeSafety } from './safety.tsx';
import { API_ORIGIN } from '../public-api.ts';
import { colors } from '../theme.ts';
import { DiscoveryChip, DiscoverySheet, iosModalOrientations, Label, Loading, Page, PrimaryButton, styles } from './ui.tsx';

type Trigger = ComponentRef<typeof Pressable>;
const orderOptions = [['asc', 'Сначала старые'], ['desc', 'Сначала новые']] as const;

function longComment(text: string) { return text.length > 220 || text.split('\n').length > 4; }
function ActionButton({ title, onPress, disabled = false, expanded, buttonRef }: {
  title: string; onPress: () => void; disabled?: boolean; expanded?: boolean; buttonRef?: RefObject<Trigger | null>;
}) {
  return <Pressable ref={buttonRef} accessibilityRole="button" accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({
      minHeight: 48, minWidth: 48, padding: 10, justifyContent: 'center', borderRadius: 12,
      backgroundColor: pressed ? colors.paper : undefined, opacity: disabled ? 0.5 : 1,
    })}>
    <Label>{title}</Label>
  </Pressable>;
}
function validText(value: string) { try { commentText(value); return true; } catch { return false; } }
function Field({ label, value, onChange, disabled = false }: {
  label: string; value: string; onChange: (text: string) => void; disabled?: boolean;
}) {
  const count = [...value.trim()].length;
  return <View style={{ gap: 8 }}>
    <Label>{label}</Label>
    <TextInput accessibilityLabel={label} multiline scrollEnabled editable={!disabled} value={value}
      onChangeText={onChange} style={[styles.input, { minHeight: 96, maxHeight: 200, textAlignVertical: 'top' }]} />
    <Label style={{ color: colors.secondary }}>{count} / 1000</Label>
    {count > 1000 && <Label accessibilityRole="alert">Максимум 1000 символов</Label>}
  </View>;
}
function Outcome({ operation, owner }: { operation: GameCommentOperation; owner: GameCommentsCoordinator }) {
  return <View style={{ gap: 8 }} accessibilityLiveRegion="polite" accessibilityState={{ busy: operation.status === 'pending' }}>
    {operation.notice && <Label accessibilityRole={operation.status === 'refused' ? 'alert' : undefined}>{operation.notice}</Label>}
    {operation.status === 'unknown' && <ActionButton title="Повторить то же действие" disabled={!owner.canReconcile(operation.packet.key)}
      onPress={() => void owner.reconcile(operation.packet.key)} />}
  </View>;
}
function Outcomes({ owner, match }: { owner: GameCommentsCoordinator; match: (operation: GameCommentOperation) => boolean }) {
  const operations = owner.getSnapshot().operations.filter(o => o.status !== 'unknown' && o.status !== 'pending' && match(o));
  return <>{operations.map(operation => <Outcome key={operation.packet.key} operation={operation} owner={owner} />)}</>;
}
function UnresolvedActions({ owner }: { owner: GameCommentsCoordinator }) {
  const operations = owner.unresolved();
  if (!operations.length) return null;
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Незавершённое действие на этой игре</Label>
    <Label>Новые действия недоступны до подтверждения результата. Исходная публикация может отсутствовать в текущем списке.</Label>
    {operations.map(operation => <View key={operation.packet.key} style={{ gap: 8 }}>
      <Label>Ранее проверенное действие · {operation.context.game} · {operation.context.action} · {operation.context.target}</Label>
      <Label>Это история вашего действия, а не текущий опубликованный текст.</Label>
      {operation.context.text !== undefined && <Label>{operation.context.text}</Label>}
      {operation.context.consequence && <Label>{operation.context.consequence}</Label>}
      <Outcome operation={operation} owner={owner} />
      {operation.status === 'unknown' && !owner.canReconcile(operation.packet.key)
        && <Label>Для повтора нужен подтверждённый доступ к исходной игре в той же сессии. Обновите данные; результат остаётся неизвестным.</Label>}
    </View>)}
  </View>;
}
function Dialog({ title, children, close, trigger }: {
  title: string; children: ReactNode; close: () => void; trigger: RefObject<Trigger | null>;
}) {
  const heading = useRef<ComponentRef<typeof Label>>(null), cancel = useRef<Trigger>(null);
  useEffect(() => () => {
    requestAnimationFrame(() => {
      trigger.current?.focus();
      const node = findNodeHandle(trigger.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, [trigger]);
  return <Modal visible animationType="none" onRequestClose={close} supportedOrientations={iosModalOrientations}
    onShow={() => {
      cancel.current?.focus();
      const node = findNodeHandle(cancel.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }}>
    <Page keyboard header={<ActionButton buttonRef={cancel} title="Отмена" onPress={close} />}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={{ gap: 16 }}>
        <Label ref={heading} accessibilityRole="header" style={styles.subtitle}>{title}</Label>
        {children}
      </View>
    </Page>
  </Modal>;
}

/**
 * Accepted-web public game text discussion — guest read; authenticated root/reply/edit/delete own roots;
 * one-level replies; author safety via single selected NativeSafety host (not comment report).
 * Focus + AppState lifetime: Expo Stack keeps prior screens mounted; background does not unmount.
 */
export function NativeGameComments({ gameId }: { gameId: string }) {
  const { owner, state } = useGameComments();
  useFocusEffect(useCallback(() => {
    const release = owner.attach(gameId);
    owner.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', next => {
      owner.setForeground(next === 'active');
    });
    return () => {
      sub.remove();
      owner.cancelReviews();
      release();
    };
  }, [owner, gameId]));
  if (state.gameId !== gameId || !state.focused) return <Loading title="Загружаем обсуждение игры…" />;
  const key = `${gameId}:${state.actor?.actorId ?? 'guest'}:${state.actor?.sessionId ?? ''}:${state.actor?.generation ?? ''}`;
  return <GameCommentsPanel key={key} />;
}

function GameCommentsPanel() {
  const { owner, state: s } = useGameComments(), router = useRouter();
  const orderTrigger = useRef<Trigger>(null);
  const [confirmation, setConfirmation] = useState<{ packet: GameCommentPacket; title: string; text: string } | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [safetyAuthor, setSafetyAuthor] = useState<{ publicPlayerId: string; displayName: string } | null>(null);
  const origin = useRef<RefObject<Trigger | null>>(orderTrigger);
  const lastBlocks = useSyncExternalStore(
    nativeAuth.safety.subscribe,
    () => nativeAuth.safety.getSnapshot().lastBlocks,
    () => nativeAuth.safety.getSnapshot().lastBlocks,
  );
  const blocksSeen = useRef(lastBlocks);
  const locked = owner.busy();
  const live = s.focused && s.foreground;
  const orderLabel = orderOptions.find(([value]) => value === s.order)?.[1] ?? orderOptions[0][1];
  const login = () => router.push({ pathname: '/profile', params: { returnTo: `/games/${s.gameId}` } });
  const commit = (action: GameCommentAction) => {
    const packet = owner.review(action);
    if (packet) void owner.commit(packet.key);
  };
  const confirm = (action: GameCommentAction, title: string, text: string) => {
    const packet = owner.review(action);
    if (packet) setConfirmation({ packet, title, text });
  };
  const close = () => {
    if (confirmation) owner.cancelReview(confirmation.packet.key);
    setConfirmation(null);
  };
  // Cached ready canCreate must not re-enable actions while focus/foreground refresh runs.
  const canCreate = !!(live && s.roots.phase === 'ready' && s.roots.pages[0]?.page.canCreate);
  // One selected public-author safety host for the panel — never per-row competing owners.
  useEffect(() => {
    if (!safetyAuthor) return;
    const stillVisible = owner.rows().some(c =>
      !c.mine && c.author?.profilePublic && c.author.publicPlayerId === safetyAuthor.publicPlayerId);
    if (!stillVisible) setSafetyAuthor(null);
  }, [owner, safetyAuthor, s.roots, s.replies]);
  useEffect(() => {
    const prev = blocksSeen.current;
    blocksSeen.current = lastBlocks;
    if (!safetyAuthor) return;
    const id = safetyAuthor.publicPlayerId;
    if (prev[id] !== lastBlocks[id] && lastBlocks[id] !== undefined) setSafetyAuthor(null);
  }, [safetyAuthor, lastBlocks]);
  return <>
    <UnresolvedActions owner={owner} />
    <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Обсуждение игры</Label>
      {s.editNotice && <Label accessibilityLiveRegion="polite">{s.editNotice}</Label>}
      <Label style={{ color: colors.secondary }}>Вопросы об этой игре и короткий разговор до встречи</Label>
      {s.roots.phase === 'ready' && s.roots.pages[0]?.page.visibleCount !== null
        && <Label>Комментарии · {s.roots.pages[0]?.page.visibleCount}</Label>}
      <Pressable ref={orderTrigger} accessibilityRole="button" accessibilityLabel={`Порядок · ${orderLabel}`}
        accessibilityState={{ expanded: orderOpen, disabled: locked }} disabled={locked}
        onPress={() => setOrderOpen(true)}
        style={({ pressed }) => ({
          minHeight: 48, minWidth: 48, padding: 10, justifyContent: 'center', borderRadius: 12,
          backgroundColor: pressed ? colors.paper : undefined, opacity: locked ? 0.5 : 1,
        })}>
        <Label accessible={false}>Порядок · {orderLabel}</Label>
      </Pressable>
      <DiscoverySheet visible={orderOpen} title="Порядок" onClose={() => setOrderOpen(false)} returnFocusRef={orderTrigger}>
        {orderOptions.map(([value, label]) =>
          <DiscoveryChip key={value} title={label} selected={s.order === value}
            onPress={() => { owner.setOrder(value); setOrderOpen(false); }} />)}
      </DiscoverySheet>
      {!s.actor ? <ActionButton title="Войти, чтобы написать комментарий" onPress={login} />
        : canCreate ? <>
          <Field label="Ваш комментарий" value={s.drafts.root ?? ''} disabled={locked}
            onChange={text => owner.setDraft('root', text)} />
          <PrimaryButton title="Отправить" disabled={locked || !validText(s.drafts.root ?? '')}
            onPress={() => commit({ kind: 'create', text: s.drafts.root!, parentCommentId: null })} />
        </>
          : s.roots.phase === 'ready' ? <Label>Чтение доступно. Отправка комментариев сейчас недоступна.</Label>
            : null}
      <Outcomes owner={owner} match={o => o.packet.action.kind === 'create' && !o.packet.action.parentCommentId} />
      <ThreadNotice thread={s.roots} reload={() => void owner.loadThread(null)} />
      {s.roots.phase === 'ready' && !s.roots.pages.flatMap(p => p.page.items).length
        && <Label>Пока нет комментариев. Начните разговор.</Label>}
      {s.roots.pages.flatMap(p => p.page.items).map(comment =>
        <CommentRow key={comment.id} comment={comment} owner={owner} canCreate={!!canCreate} locked={locked}
          safetyAuthorId={safetyAuthor?.publicPlayerId ?? null}
          openSafety={(author, source) => {
            if (!s.actor) { login(); return; }
            origin.current = source;
            setSafetyAuthor(author);
          }}
          remove={(c, source) => {
            origin.current = source;
            confirm({ kind: 'delete', comment: c }, 'Удалить комментарий?',
              'Текст комментария будет скрыт. Ответы в ветке сохранятся.');
          }}
          commit={commit} />)}
      {s.roots.pages.at(-1)?.page.nextCursor
        && <ActionButton title="Ещё комментарии" disabled={s.roots.phase === 'loading'}
          onPress={() => void owner.loadThread(null, true)} />}
      {safetyAuthor && s.actor ? <View style={{ gap: 8, paddingTop: 8 }}>
        <Label>Действие в отношении автора, не отдельная жалоба на комментарий.</Label>
        <NativeSafety peerId={safetyAuthor.publicPlayerId} name={safetyAuthor.displayName} />
        <ActionButton title="Закрыть действия с автором" onPress={() => setSafetyAuthor(null)} />
      </View> : null}
    </View>
    {confirmation && <Dialog title={confirmation.title} trigger={origin.current} close={close}>
      <Label>{confirmation.text}</Label>
      <PrimaryButton title="Удалить комментарий"
        disabled={s.operations.find(o => o.packet.key === confirmation.packet.key)?.status !== 'review'}
        onPress={() => { void owner.commit(confirmation.packet.key); setConfirmation(null); }} />
    </Dialog>}
  </>;
}

function ThreadNotice({ thread, reload }: { thread: GameCommentThread; reload: () => void }) {
  return <>
    {(thread.phase === 'idle' || thread.phase === 'loading')
      && <Label accessibilityLiveRegion="polite">Загружаем комментарии…</Label>}
    {thread.phase === 'error' && <>
      <Label accessibilityRole="alert">{thread.error}</Label>
      <ActionButton title="Повторить загрузку комментариев" onPress={reload} />
    </>}
  </>;
}

function CommentRow({
  comment: c, owner, canCreate, locked, safetyAuthorId, openSafety, remove, commit, reply = false,
}: {
  comment: GameComment; owner: GameCommentsCoordinator; canCreate: boolean; locked: boolean;
  safetyAuthorId: string | null;
  openSafety: (author: { publicPlayerId: string; displayName: string }, source: RefObject<Trigger | null>) => void;
  remove: (c: GameComment, source: RefObject<Trigger | null>) => void;
  commit: (a: GameCommentAction) => void; reply?: boolean;
}) {
  const [full, setFull] = useState(false), [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false), [replying, setReplying] = useState(false), [expanded, setExpanded] = useState(false);
  const router = useRouter(), trigger = useRef<Trigger>(null), menuHeading = useRef<ComponentRef<typeof Label>>(null);
  const s = owner.getSnapshot(), replies = s.replies[c.id], draft = s.drafts[`edit:${c.id}`] ?? '';
  const canAuthorSafety = !!(s.actor && !c.mine && !c.deleted && c.author?.profilePublic && c.author.publicPlayerId);
  useEffect(() => {
    if (menu) {
      const node = findNodeHandle(menuHeading.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [menu]);
  useEffect(() => { setEditing(false); }, [c.version]);
  useEffect(() => { if (!canCreate || !c.mine || c.deleted) setEditing(false); }, [canCreate, c.mine, c.deleted]);
  const body = c.body ?? 'Текст недоступен';
  const long = !!c.body && longComment(c.body);
  return <View style={{
    gap: 8, paddingTop: 16, borderTopWidth: 1, borderColor: colors.line, ...(reply ? { marginLeft: 8 } : {}),
  }}>
    {c.deleted ? <Label>Комментарий удалён</Label> : <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {c.author?.avatar.uploadedUrl
          ? <Image source={{ uri: `${API_ORIGIN}${c.author.avatar.uploadedUrl}` }} accessibilityLabel="Аватар автора"
            style={{ width: 40, height: 40, borderRadius: 20 }} />
          : <View accessible={false} style={{
            width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper,
            alignItems: 'center', justifyContent: 'center',
          }}><Label>{c.author?.displayName.slice(0, 1) ?? '?'}</Label></View>}
        <View style={{ flex: 1, minWidth: 100 }}>
          {c.author?.profilePublic && c.author.publicPlayerId
            ? <ActionButton title={c.author.displayName}
              onPress={() => router.push({
                pathname: '/players/[publicPlayerId]',
                params: { publicPlayerId: c.author!.publicPlayerId! },
              })} />
            : <Label>{c.author?.displayName ?? 'Игрок'}</Label>}
          <Label style={{ color: colors.secondary }}>
            {new Date(c.createdAt).toLocaleString('ru-RU')}{c.edited ? ' · изменён' : ''}
          </Label>
        </View>
        {(canCreate && c.mine && !c.deleted || canAuthorSafety)
          && <ActionButton buttonRef={trigger} title="Действия с комментарием" expanded={menu} onPress={() => setMenu(!menu)} />}
      </View>
      <Label numberOfLines={long && !full ? 4 : undefined}>{body}</Label>
      {long && <ActionButton title={full ? 'Свернуть текст' : 'Читать полностью'} expanded={full} onPress={() => setFull(!full)} />}
    </>}
    {menu && <View style={{ gap: 8 }}>
      <Label ref={menuHeading} accessibilityRole="header">Действия с комментарием</Label>
      {!reply && c.mine && canCreate && !c.deleted && <>
        <ActionButton title="Изменить" disabled={locked} onPress={() => {
          if (owner.beginEdit(c.id)) { setEditing(true); setMenu(false); }
        }} />
        <ActionButton title="Удалить" disabled={locked} onPress={() => { setMenu(false); remove(c, trigger); }} />
      </>}
      {canAuthorSafety && c.author?.publicPlayerId && <>
        <Label>Действие в отношении автора, не отдельная жалоба на комментарий.</Label>
        <ActionButton title={safetyAuthorId === c.author.publicPlayerId ? 'Скрыть действия с автором' : 'Безопасность автора'}
          disabled={locked}
          onPress={() => {
            setMenu(false);
            if (safetyAuthorId === c.author!.publicPlayerId) return;
            openSafety({ publicPlayerId: c.author!.publicPlayerId!, displayName: c.author!.displayName }, trigger);
          }} />
      </>}
      <ActionButton title="Закрыть действия" onPress={() => { setMenu(false); trigger.current?.focus(); }} />
    </View>}
    {editing && !reply && c.mine && !c.deleted && c.body !== null && canCreate && s.roots.phase === 'ready'
      && Object.hasOwn(s.drafts, `edit:${c.id}`) && <>
      <Field label="Изменить комментарий" value={draft} disabled={locked}
        onChange={text => owner.setDraft(`edit:${c.id}`, text)} />
      <PrimaryButton title="Сохранить изменение" disabled={locked || !validText(draft) || draft.trim() === c.body}
        onPress={() => commit({ kind: 'edit', comment: c, text: draft })} />
      <ActionButton title="Отмена изменения" disabled={locked} onPress={() => setEditing(false)} />
    </>}
    <Outcomes owner={owner} match={o =>
      (o.packet.action.kind === 'edit' || o.packet.action.kind === 'delete') && o.packet.action.comment.id === c.id
      || o.packet.action.kind === 'create' && o.packet.action.parentCommentId === c.id} />
    {!reply && <>
      {canCreate && s.actor && !c.deleted
        && <ActionButton title="Ответить" disabled={locked} expanded={replying} onPress={() => {
          setReplying(!replying);
          if (!s.replies[c.id]) void owner.loadThread(c.id);
        }} />}
      {replying && canCreate && s.actor && !c.deleted && <>
        <Label>Ответ · {c.author?.displayName ?? 'Игрок'}</Label>
        <Field label="Ответ" value={s.drafts[c.id] ?? ''} disabled={locked}
          onChange={text => owner.setDraft(c.id, text)} />
        <PrimaryButton title="Отправить ответ"
          disabled={locked || replies?.phase !== 'ready' || !replies.pages[0]?.page.canCreate || !validText(s.drafts[c.id] ?? '')}
          onPress={() => commit({ kind: 'create', text: s.drafts[c.id]!, parentCommentId: c.id })} />
        <ActionButton title="Отмена ответа" onPress={() => setReplying(false)} />
      </>}
      {(c.replyCount > 0 || replies) && <ActionButton
        title={expanded ? 'Скрыть ответы' : `Показать ответы · ${replies?.pages[0]?.page.visibleCount ?? c.replyCount}`}
        expanded={expanded}
        onPress={() => {
          setExpanded(!expanded);
          if (!expanded && !replies?.pages.length) void owner.loadThread(c.id);
        }} />}
      {expanded && replies && <>
        <ThreadNotice thread={replies} reload={() => void owner.loadThread(c.id)} />
        {replies.pages.flatMap(p => p.page.items).map(r =>
          <CommentRow key={r.id} comment={r} owner={owner} canCreate={false} locked={locked}
            safetyAuthorId={safetyAuthorId} openSafety={openSafety} remove={remove} commit={commit} reply />)}
        {replies.pages.at(-1)?.page.nextCursor
          && <ActionButton title="Ещё ответы" disabled={replies.phase === 'loading'}
            onPress={() => void owner.loadThread(c.id, true)} />}
      </>}
    </>}
  </View>;
}
