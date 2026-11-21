import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef, ReactNode, RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Image, Modal, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useVenueCommunity } from '../venue-community-runtime.tsx';
import type { VenueCommunityCoordinator, Thread, Operation } from '../venue-community-coordinator.ts';
import type { Comment, Action, CreateVenueCommunityReportRequest, Packet } from '../venue-community.ts';
import { commentText } from '../venue-community.ts';
import {
  applyPublishOperationUpdates,
  notePendingPublish,
  type PendingPublishMap,
} from '../venue-comment-photos.ts';
import { API_ORIGIN } from '../public-api.ts';
import { colors } from '../theme.ts';
import { DiscoveryChip, DiscoverySheet, iosModalOrientations, Label, Loading, Page, PrimaryButton, styles } from './ui.tsx';
import { VenueReviewsSection } from './venue-reviews.tsx';
import { VenueCommunityPhotosSection } from './venue-photos.tsx';
import {
  VenueCommentPhotoComposer,
  useVenueCommentPhotoComposer,
  type VenueCommentPhotoComposerModel,
} from './venue-comment-photo-composer.tsx';
type Trigger = ComponentRef<typeof Pressable>;
const reasons = [ ['harassment','Оскорбления / давление'], ['spam','Спам'], ['fake_profile','Поддельный профиль'], ['inappropriate','Неприемлемый контент'], ['other','Другое'] ] as const;
const orderOptions = [ ['asc','Сначала старые'], ['desc','Сначала новые'] ] as const;
function longComment(text: string) { return text.length > 220 || text.split('\n').length > 4; }
function ActionButton({ title, onPress, disabled = false, expanded, buttonRef }: { title: string; onPress: () => void; disabled?: boolean; expanded?: boolean; buttonRef?: RefObject<Trigger | null> }) {
  return <Pressable ref={buttonRef} accessibilityRole="button" accessibilityState={{disabled, ...(expanded === undefined ? {} : {expanded})}} disabled={disabled} onPress={onPress}
    style={({pressed}) => ({minHeight:48,minWidth:48,padding:10,justifyContent:'center',borderRadius:12,backgroundColor:pressed ? colors.paper : undefined,opacity:disabled ? 0.5 : 1})}>
    <Label>{title}</Label>
  </Pressable>;
}
function validText(value: string) { try { commentText(value); return true; } catch { return false; } }
function Field({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (text: string) => void; disabled?: boolean }) {
  const count = [...value.trim()].length;
  return <View style={{gap:8}}><Label>{label}</Label><TextInput accessibilityLabel={label} multiline scrollEnabled editable={!disabled} value={value} onChangeText={onChange}
    style={[styles.input,{minHeight:96,maxHeight:200,textAlignVertical:'top'}]} />
    <Label style={{color:colors.secondary}}>{count} / 1000</Label>{count > 1000 && <Label accessibilityRole="alert">Максимум 1000 символов</Label>}</View>;
}
function Outcome({ operation, owner }: { operation: Operation; owner: VenueCommunityCoordinator }) {
  return <View style={{gap:8}} accessibilityLiveRegion="polite" accessibilityState={{busy:operation.status === 'pending'}}>
    {operation.notice && <Label accessibilityRole={operation.status === 'refused' ? 'alert' : undefined}>{operation.notice}</Label>}
    {operation.status === 'unknown' && <ActionButton title="Повторить то же действие" disabled={!owner.canReconcile(operation.packet.key)} onPress={() => void owner.reconcile(operation.packet.key)} />}
  </View>;
}
function Outcomes({ owner, match }: { owner: VenueCommunityCoordinator; match: (operation: Operation) => boolean }) {
  const operations = owner.getSnapshot().operations.filter(o => o.status !== 'unknown' && o.status !== 'pending' && match(o));
  return <>{operations.map(operation => <Outcome key={operation.packet.key} operation={operation} owner={owner} />)}</>;
}
function UnresolvedActions({owner}:{owner:VenueCommunityCoordinator}) {
  const operations = owner.unresolved();
  if (!operations.length) return null;
  return <View style={styles.card}>
    <Label accessibilityRole="header" style={styles.subtitle}>Незавершённое действие на этой площадке</Label>
    <Label>Новые действия недоступны до подтверждения результата. Исходная публикация может отсутствовать в текущем списке.</Label>
    {operations.map(operation => <View key={operation.packet.key} style={{gap:8}}>
      <Label>Ранее проверенное действие · {operation.context.venue} · {operation.context.action} · {operation.context.target}</Label>
      <Label>Это история вашего действия, а не текущий опубликованный текст.</Label>
      {operation.context.text !== undefined && <Label>{operation.context.text}</Label>}
      {operation.context.consequence && <Label>{operation.context.consequence}</Label>}
      {operation.context.rating !== undefined && <Label>Оценка · {operation.context.rating} из 5</Label>}
      {operation.context.reason && <Label>Причина · {operation.context.reason}</Label>}
      {operation.context.detail && <Label>{operation.context.detail}</Label>}
      <Outcome operation={operation} owner={owner} />
      {operation.status === 'unknown' && !owner.canReconcile(operation.packet.key) && <Label>Для повтора нужен подтверждённый доступ к исходной площадке в той же сессии. Обновите данные; результат остаётся неизвестным.</Label>}
    </View>)}
  </View>;
}
function Dialog({ title, children, close, trigger }: { title: string; children: ReactNode; close: () => void; trigger: RefObject<Trigger | null> }) {
  const heading = useRef<ComponentRef<typeof Label>>(null), cancel = useRef<Trigger>(null);
  useEffect(() => () => { requestAnimationFrame(() => { trigger.current?.focus(); const node = findNodeHandle(trigger.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); }); }, [trigger]);
  return <Modal visible animationType="none" onRequestClose={close} supportedOrientations={iosModalOrientations} onShow={() => { cancel.current?.focus(); const node = findNodeHandle(cancel.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); }}>
    <Page keyboard header={<ActionButton buttonRef={cancel} title="Отмена" onPress={close} />}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={{gap:16}}>
        <Label ref={heading} accessibilityRole="header" style={styles.subtitle}>{title}</Label>{children}
      </View>
    </Page>
  </Modal>;
}
function countLabel(count: number) {
  const mod10 = count % 10, mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? 'оценка' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'оценки' : 'оценок'}`;
}
type ReportSubject = Pick<CreateVenueCommunityReportRequest,'subjectKind'|'venueId'|'commentId'|'expectedVersion'> & { label: string };
export function NativeVenueCommunity({ venueId, name }: { venueId: string; name: string }) {
  const {owner,state} = useVenueCommunity();
  useEffect(() => { owner.open(venueId); return () => { owner.cancelReviews(); owner.detach(); }; }, [owner,venueId]);
  if (state.venueId !== venueId) return <Loading title="Загружаем сообщество площадки…" />;
  const key = `${venueId}:${state.actor?.actorId ?? 'guest'}:${state.actor?.sessionId ?? ''}:${state.actor?.generation ?? ''}`;
  return <CommunityPanel key={key} name={name} />;
}
function CommunityPanel({name}:{name:string}) {
  const {owner,state:s} = useVenueCommunity(), router = useRouter();
  const withdrawTrigger = useRef<Trigger>(null), ownReportTrigger = useRef<Trigger>(null), aggregateReportTrigger = useRef<Trigger>(null), orderTrigger = useRef<Trigger>(null);
  const [report,setReport] = useState<ReportSubject | null>(null), [reason,setReason] = useState<CreateVenueCommunityReportRequest['reasonCode'] | null>(null), [detail,setDetail] = useState('');
  const [confirmation,setConfirmation] = useState<{packet:Packet; title:string; text:string} | null>(null);
  const [orderOpen,setOrderOpen] = useState(false);
  const origin = useRef<RefObject<Trigger | null>>(aggregateReportTrigger);
  const locked = owner.busy(), own = s.own?.own;
  // Photo drafts + create→photoIds association live on CommunityPanel (same owner lifetime).
  // RootCommentComposer unmounts when canCreate flips false; association must outlive it.
  const photos = useVenueCommentPhotoComposer(s.scope?.canonicalVenueId ?? null, s.actor, locked);
  const pendingPublish = useRef<PendingPublishMap>(new Map());
  const rememberPublish = useCallback((packetKey: string, photoIds: readonly string[]) => {
    pendingPublish.current = notePendingPublish(pendingPublish.current, packetKey, photoIds);
  }, []);
  useEffect(() => {
    const { pending, retireIds } = applyPublishOperationUpdates(pendingPublish.current, s.operations);
    pendingPublish.current = pending;
    if (retireIds.length) photos.retirePublished(retireIds);
  }, [s.operations, photos]);
  const orderLabel = orderOptions.find(([value]) => value === s.order)?.[1] ?? orderOptions[0][1];
  const login = () => router.push({pathname:'/profile',params:{returnTo:`/venues/${s.venueId}`}});
  const commit = (action:Action) => { const packet = owner.review(action); if (packet) void owner.commit(packet.key); };
  const confirm = (action:Action,title:string,text:string) => { const packet = owner.review(action); if (packet) setConfirmation({packet,title,text}); };
  const close = () => { if (confirmation) owner.cancelReview(confirmation.packet.key); setConfirmation(null); setReport(null); setReason(null); setDetail(''); };
  const reportSubject = (subject:ReportSubject, source: RefObject<Trigger | null>) => { if (!s.actor) {login();return;} origin.current=source;setReport(subject);setReason(null);setDetail(''); };
  const aggregate = s.summary;
  const canCreate = s.roots.pages[0]?.page.canCreate;
  return <>
    <UnresolvedActions owner={owner} />
    <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Оценки сообщества</Label>
      <Label style={{color:colors.secondary}}>Впечатления пользователей об этой площадке · не отзывы после игры</Label>
      {s.summaryPhase === 'idle' && <ActionButton title="Загрузить общедоступные данные" onPress={() => void owner.refresh()} />}
      {s.summaryPhase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем оценки…</Label>}
      {s.summaryPhase === 'error' && <><Label accessibilityRole="alert">Не удалось загрузить оценки</Label><ActionButton title="Повторить загрузку оценок" onPress={() => void owner.refresh()} /></>}
      {aggregate?.state === 'unavailable' && <Label>Сводка оценок недоступна</Label>}
      {aggregate?.state === 'empty' && <Label>Пока нет оценок</Label>}
      {aggregate?.state === 'available' && <View accessible accessibilityLabel={`${aggregate.average!.toFixed(1).replace('.',',')} из 5 · ${countLabel(aggregate.count!)}`} style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}>
        <Label accessible={false} style={{fontSize:40,lineHeight:48,fontWeight:'700'}}>{aggregate.average!.toFixed(1).replace('.',',')}</Label>
        <View accessible={false} style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}>
          <Label accessible={false} style={{color:colors.purple}}>★</Label>
          <Label accessible={false}>{countLabel(aggregate.count!)}{aggregate.count! < 10 ? ' · пока небольшая выборка' : ''}</Label>
        </View>
      </View>}
      <Label accessibilityRole="header" style={styles.subtitle}>Как вам эта площадка?</Label>
      {!s.actor ? <><Label>Войдите, чтобы поставить свою оценку</Label><ActionButton title="Войти и оценить" onPress={login} /></> : <>
        {s.ownPhase === 'loading' && <Label accessibilityLiveRegion="polite">Загружаем вашу оценку…</Label>}
        {s.ownPhase === 'error' && <><Label accessibilityRole="alert">Не удалось загрузить вашу оценку</Label><ActionButton title="Обновить мою оценку" onPress={() => void owner.loadOwn()} /></>}
        {own && !own.withdrawn && own.value !== null && <Label>Ваша оценка · {own.value} из 5</Label>}
        {own?.moderationState === 'withheld' && <Label>Оценка снята с публичной сводки</Label>}
        <View accessibilityRole="radiogroup" accessibilityLabel="Ваша оценка площадки" style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
          {[1,2,3,4,5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} из 5`} accessibilityState={{checked:s.selected === value,disabled:locked || !owner.canRate()}}
            disabled={locked || !owner.canRate()} onPress={() => owner.select(value)} style={{minWidth:48,minHeight:48,padding:6,justifyContent:'center',alignItems:'center',borderRadius:12,backgroundColor:s.selected === value ? '#EEE6FF' : colors.paper,opacity:locked || !owner.canRate() ? 0.5 : 1}}>
            <Label accessible={false} style={{fontSize:28,lineHeight:36,color:colors.purple}}>{value <= (s.selected ?? 0) ? '★' : '☆'}</Label>
          </Pressable>)}
        </View>
        <PrimaryButton title={own && own.version > 0 && !own.withdrawn ? 'Сохранить изменение' : 'Отправить оценку'} disabled={locked || !owner.canRate() || s.selected === null || !own?.withdrawn && s.selected === own?.value}
          onPress={() => { if (s.selected !== null) commit({kind:'upsert',value:s.selected,expectedVersion:own?.version ?? 0}); }} />
        {own?.allowedActions.withdraw && !own.withdrawn && <ActionButton buttonRef={withdrawTrigger} title="Убрать мою оценку" disabled={locked} onPress={() => {origin.current=withdrawTrigger;confirm({kind:'withdraw',expectedVersion:own.version},'Убрать мою оценку?','Ваша оценка больше не будет учитываться в сводке.');}} />}
        {own && own.version > 0 && !own.withdrawn && <ActionButton buttonRef={ownReportTrigger} title="Запросить проверку моей оценки" disabled={locked} onPress={() => reportSubject({subjectKind:'own_vote',venueId:s.venueId!,expectedVersion:own.version,label:'Моя оценка'}, ownReportTrigger)} />}
      </>}
      <Outcomes owner={owner} match={o => o.packet.action.kind === 'upsert' || o.packet.action.kind === 'withdraw'} />
      <ActionButton buttonRef={aggregateReportTrigger} title="Пожаловаться на сводку оценок" disabled={locked || s.summaryPhase !== 'ready' || aggregate?.state === 'unavailable'} onPress={() => reportSubject({subjectKind:'aggregate',venueId:s.venueId!,label:'Сводка оценок'}, aggregateReportTrigger)} />
    </View>
    <View style={styles.card}>
      <Label accessibilityRole="header" style={styles.subtitle}>Обсуждение площадки</Label>
      {s.editNotice && <Label accessibilityLiveRegion="polite">{s.editNotice}</Label>}
      <Label style={{color:colors.secondary}}>Вопросы и впечатления о площадке · не проверенные отзывы после игры</Label>
      {s.roots.phase === 'ready' && s.roots.pages[0]?.page.visibleCount !== null && <Label>Комментарии · {s.roots.pages[0]?.page.visibleCount}</Label>}
      <Pressable ref={orderTrigger} accessibilityRole="button" accessibilityLabel={`Порядок · ${orderLabel}`} accessibilityState={{expanded:orderOpen,disabled:locked}} disabled={locked}
        onPress={() => setOrderOpen(true)} style={({pressed}) => ({minHeight:48,minWidth:48,padding:10,justifyContent:'center',borderRadius:12,backgroundColor:pressed ? colors.paper : undefined,opacity:locked ? 0.5 : 1})}>
        <Label accessible={false}>Порядок · {orderLabel}</Label>
      </Pressable>
      <DiscoverySheet visible={orderOpen} title="Порядок" onClose={() => setOrderOpen(false)} returnFocusRef={orderTrigger}>
        {orderOptions.map(([value,label]) => <DiscoveryChip key={value} title={label} selected={s.order === value} onPress={() => { owner.setOrder(value); setOrderOpen(false); }} />)}
      </DiscoverySheet>
      {!s.actor ? <ActionButton title="Войти, чтобы написать комментарий" onPress={login} />
        : canCreate ? <RootCommentComposer locked={locked} photos={photos} onPublish={rememberPublish} />
          : s.roots.phase === 'ready' ? <Label>Чтение доступно. Отправка комментариев сейчас недоступна.</Label>
            : null}
      <Outcomes owner={owner} match={o => o.packet.action.kind === 'create' && !o.packet.action.parentCommentId} />
      <ThreadNotice thread={s.roots} reload={() => void owner.loadThread(null)} />
      {s.roots.phase === 'ready' && !s.roots.pages.flatMap(p => p.page.items).length && <Label>Пока нет комментариев. Начните разговор.</Label>}
      {s.roots.pages.flatMap(p => p.page.items).map(comment => <CommentRow key={comment.id} comment={comment} owner={owner} canCreate={!!s.roots.pages[0]?.page.canCreate} locked={locked}
        report={(c,source) => reportSubject({subjectKind:'venue_comment',venueId:s.venueId!,commentId:c.id,expectedVersion:c.version,label:`Комментарий · ${c.author?.displayName ?? 'Игрок'}`},source)}
        remove={(c,source) => {origin.current=source;confirm({kind:'delete',comment:c},'Удалить комментарий?','Текст комментария будет скрыт. Ответы в ветке сохранятся.');}} commit={commit} />)}
      {s.roots.pages.at(-1)?.page.nextCursor && <ActionButton title="Ещё комментарии" disabled={s.roots.phase === 'loading'} onPress={() => void owner.loadThread(null,true)} />}
    </View>
    <VenueReviewsSection venueId={s.venueId!} />
    <VenueCommunityPhotosSection venueId={s.venueId!} />
    <Outcomes owner={owner} match={o => o.packet.action.kind === 'report'} />
    {s.operations.filter(o => o.status === 'refused' && o.packet.action.kind === 'report').map(o => <ActionButton key={o.packet.key} title="Изменить жалобу" disabled={locked} onPress={() => {
      const action = o.packet.action;
      if (action.kind !== 'report') return;
      const {targetKind,reasonCode,detail,...subject} = action.report; void targetKind;
      setReport({...subject,label:subject.subjectKind === 'aggregate' ? 'Сводка оценок' : subject.subjectKind === 'own_vote' ? 'Моя оценка' : 'Комментарий'});
      setReason(reasonCode);setDetail(detail ?? '');
    }} />)}
    {report && !confirmation && <Dialog title="Пожаловаться" trigger={origin.current} close={close}>
      <Label>{name} · {report.label}</Label><Label>Причина</Label>
      {reasons.map(([code,label]) => <Pressable key={code} accessibilityRole="radio" accessibilityState={{checked:reason === code}} onPress={() => setReason(code)} style={{minHeight:48,padding:10}}><Label>{reason === code ? '✓ ' : ''}{label}</Label></Pressable>)}
      <Field label="Подробности (необязательно)" value={detail} onChange={setDetail} />
      <PrimaryButton title="Проверить жалобу" disabled={locked || !reason || [...detail.trim()].length > 1000} onPress={() => { if (!reason) return; const {label,...subject} = report; void label;
        confirm({kind:'report',report:{...subject,targetKind:'venue_community',reasonCode:reason,detail:detail.trim() || null}},'Отправить жалобу?',`${name} · ${report.label} · ${reasons.find(r => r[0] === reason)?.[1]}`); }} />
    </Dialog>}
    {confirmation && <Dialog title={confirmation.title} trigger={origin.current} close={close}>
      <Label>{confirmation.text}</Label>{confirmation.packet.action.kind === 'report' && detail.trim() && <Label>{detail.trim()}</Label>}
      <PrimaryButton title={confirmation.packet.action.kind === 'delete' ? 'Удалить комментарий' : confirmation.packet.action.kind === 'withdraw' ? 'Убрать мою оценку' : 'Отправить жалобу'} disabled={s.operations.find(o => o.packet.key === confirmation.packet.key)?.status !== 'review'}
        onPress={() => { void owner.commit(confirmation.packet.key); setConfirmation(null);setReport(null);setDetail('');setReason(null); }} />
    </Dialog>}
  </>;
}
function RootCommentComposer({
  locked,
  photos,
  onPublish,
}: {
  locked: boolean;
  photos: VenueCommentPhotoComposerModel;
  onPublish: (packetKey: string, photoIds: readonly string[]) => void;
}) {
  const { owner, state: s } = useVenueCommunity();
  const draft = s.drafts.root ?? '';
  // No create→photoIds association state here — this composer unmounts when canCreate is false;
  // CommunityPanel owns that association next to drafts so reconcile can still retire them.
  const sendEnabled = !locked && photos.canSend(draft) && (!draft.trim() || validText(draft));
  return <>
    <Field label="Ваш комментарий" value={draft} disabled={locked} onChange={text => owner.setDraft('root', text)} />
    <VenueCommentPhotoComposer model={photos} disabled={locked} />
    <PrimaryButton
      title="Отправить"
      disabled={!sendEnabled}
      onPress={() => {
        const photoIds = photos.readyIds;
        const packet = owner.review({
          kind: 'create',
          text: draft,
          parentCommentId: null,
          parentEntityId: s.scope!.canonicalVenueId,
          ...(photoIds.length ? { photoIds } : {}),
        });
        if (!packet) return;
        if (photoIds.length) onPublish(packet.key, photoIds);
        void owner.commit(packet.key);
      }}
    />
  </>;
}
function ThreadNotice({thread,reload}:{thread:Thread;reload:()=>void}) {
  return <>{(thread.phase === 'idle' || thread.phase === 'loading') && <Label accessibilityLiveRegion="polite">Загружаем комментарии…</Label>}
    {thread.phase === 'error' && <><Label accessibilityRole="alert">{thread.error}</Label><ActionButton title="Повторить загрузку комментариев" onPress={reload} /></>}</>;
}
function CommentRow({comment:c,owner,canCreate,locked,report,remove,commit,reply = false}:{comment:Comment;owner:VenueCommunityCoordinator;canCreate:boolean;locked:boolean;report:(c:Comment,source:RefObject<Trigger|null>)=>void;remove:(c:Comment,source:RefObject<Trigger|null>)=>void;commit:(a:Action)=>void;reply?:boolean}) {
  const [full,setFull] = useState(false), [menu,setMenu] = useState(false), [editing,setEditing] = useState(false), [replying,setReplying] = useState(false), [expanded,setExpanded] = useState(false);
  const router = useRouter(), trigger = useRef<Trigger>(null), menuHeading = useRef<ComponentRef<typeof Label>>(null);
  const s = owner.getSnapshot(), replies = s.replies[c.id], draft = s.drafts[`edit:${c.id}`] ?? '';
  useEffect(() => { if (menu) { const node = findNodeHandle(menuHeading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); } }, [menu]);
  useEffect(() => { setEditing(false); }, [c.version]);
  useEffect(() => { if (!canCreate || !c.mine || c.deleted) setEditing(false); }, [canCreate,c.mine,c.deleted]);
  const body = c.body ?? 'Текст недоступен';
  const long = !!c.body && longComment(c.body);
  return <View style={{gap:8,paddingTop:16,borderTopWidth:1,borderColor:colors.line,...(reply ? {marginLeft:8} : {})}}>
    {c.deleted ? <Label>Комментарий удалён</Label> : <>
      <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}>
        {c.author?.avatar.uploadedUrl ? <Image source={{uri:`${API_ORIGIN}${c.author.avatar.uploadedUrl}`}} accessibilityLabel="Аватар автора" style={{width:40,height:40,borderRadius:20}} />
          : <View accessible={false} style={{width:40,height:40,borderRadius:20,backgroundColor:colors.paper,alignItems:'center',justifyContent:'center'}}><Label>{c.author?.displayName.slice(0,1) ?? '?'}</Label></View>}
        <View style={{flex:1,minWidth:100}}>
          {c.author?.profilePublic && c.author.publicPlayerId ? <ActionButton title={c.author.displayName} onPress={() => router.push({pathname:'/players/[id]',params:{id:c.author!.publicPlayerId!}})} /> : <Label>{c.author?.displayName ?? 'Игрок'}</Label>}
          <Label style={{color:colors.secondary}}>{new Date(c.createdAt).toLocaleString('ru-RU')}{c.edited ? ' · изменён' : ''}</Label>
        </View>
        <ActionButton buttonRef={trigger} title="Действия с комментарием" expanded={menu} onPress={() => setMenu(!menu)} />
      </View>
      <Label numberOfLines={long && !full ? 4 : undefined}>{body}</Label>
      {long && <ActionButton title={full ? 'Свернуть текст' : 'Читать полностью'} expanded={full} onPress={() => setFull(!full)} />}
      {c.photos.map(photo => <Image key={photo.id} source={{uri:`${API_ORIGIN}${photo.url}`}} accessibilityLabel="Фото в комментарии" resizeMode="contain" style={{width:'100%',aspectRatio:photo.width/photo.height,maxHeight:260,backgroundColor:colors.paper}} />)}
    </>}
    {menu && <View style={{gap:8}}><Label ref={menuHeading} accessibilityRole="header">Действия с комментарием</Label>
      {!reply && c.mine && canCreate && !c.deleted && <><ActionButton title="Изменить" disabled={locked} onPress={() => {if (owner.beginEdit(c.id)) {setEditing(true);setMenu(false);}}} />
        <ActionButton title="Удалить" disabled={locked} onPress={() => {setMenu(false);remove(c,trigger);}} /></>}
      {!c.deleted && <ActionButton title="Пожаловаться на комментарий" disabled={locked} onPress={() => {setMenu(false);report(c,trigger);}} />}
      <ActionButton title="Закрыть действия" onPress={() => {setMenu(false);trigger.current?.focus();}} />
    </View>}
    {editing && !reply && c.mine && !c.deleted && c.body !== null && canCreate && s.roots.phase === 'ready' && Object.hasOwn(s.drafts,`edit:${c.id}`) && <>
      <Field label="Изменить комментарий" value={draft} disabled={locked} onChange={text => owner.setDraft(`edit:${c.id}`,text)} />
      <PrimaryButton title="Сохранить изменение" disabled={locked || !validText(draft) || draft.trim() === c.body} onPress={() => commit({kind:'edit',comment:c,text:draft})} />
      <ActionButton title="Отмена изменения" disabled={locked} onPress={() => setEditing(false)} />
    </>}
    <Outcomes owner={owner} match={o => (o.packet.action.kind === 'edit' || o.packet.action.kind === 'delete') && o.packet.action.comment.id === c.id || o.packet.action.kind === 'create' && o.packet.action.parentCommentId === c.id} />
    {!reply && <>
      {canCreate && s.actor && !c.deleted && <ActionButton title="Ответить" disabled={locked} expanded={replying} onPress={() => { setReplying(!replying); if (!s.replies[c.id]) void owner.loadThread(c.id); }} />}
      {replying && canCreate && s.actor && !c.deleted && <>
        <Label>Ответ · {c.author?.displayName ?? 'Игрок'}</Label>
        <Field label="Ответ" value={s.drafts[c.id] ?? ''} disabled={locked} onChange={text => owner.setDraft(c.id,text)} />
        <PrimaryButton title="Отправить ответ" disabled={locked || replies?.phase !== 'ready' || !replies.pages[0]?.page.canCreate || !validText(s.drafts[c.id] ?? '')}
          onPress={() => commit({kind:'create',text:s.drafts[c.id]!,parentCommentId:c.id,parentEntityId:c.entityId})} />
        <ActionButton title="Отмена ответа" onPress={() => setReplying(false)} />
      </>}
      {(c.replyCount > 0 || replies) && <ActionButton title={expanded ? 'Скрыть ответы' : `Показать ответы · ${replies?.pages[0]?.page.visibleCount ?? c.replyCount}`} expanded={expanded}
        onPress={() => {setExpanded(!expanded);if (!expanded && !replies?.pages.length) void owner.loadThread(c.id);}} />}
      {expanded && replies && <><ThreadNotice thread={replies} reload={() => void owner.loadThread(c.id)} />
        {replies.pages.flatMap(p => p.page.items).map(r => <CommentRow key={r.id} comment={r} owner={owner} canCreate={false} locked={locked} report={report} remove={remove} commit={commit} reply />)}
        {replies.pages.at(-1)?.page.nextCursor && <ActionButton title="Ещё ответы" disabled={replies.phase === 'loading'} onPress={() => void owner.loadThread(c.id,true)} />}
      </>}
    </>}
  </View>;
}
