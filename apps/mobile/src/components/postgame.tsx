import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentRef, PropsWithChildren, RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Modal, Platform, Pressable, Text, View, TextInput, Switch } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { attendanceLabel, mayAcknowledge, normalizeFormReason, peerRatingLabel, reviewKindModeLabel, resolvingAckAssertion } from '../postgame.ts';
import { isPublicRolePacketKind } from '../public-role-reviews.ts';
import {
  isVenueExperiencePacketKind,
  postgameIdempotencyReplayBlocked,
  venueExperiencePendingRecoveryTarget,
  POSTGAME_RETENTION_EXPIRED_NOTICE,
} from '../venue-reviews.ts';
import { sameActor } from '../participation.ts';
import type { Attendance, AttendanceValue, Reminder, Results } from '../postgame.ts';
import { iosModalOrientations, Label, Loading, TextButton, PrimaryButton, Page, styles } from './ui.tsx';
type FocusTarget = ComponentRef<typeof Pressable>;
export const FocusContext=createContext<RefObject<FocusTarget | null> | null>(null);
/** Private CommandReview focus owner — public role sheets use shared rememberPublicRoleFocusTarget instead. */
export function PostgameSurface({children}:PropsWithChildren) {
  const trigger=useRef<FocusTarget>(null);
  return <FocusContext.Provider value={trigger}>{children}</FocusContext.Provider>;
}
function useBlocked() {
  const owner=useAuth().postgame, s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  return !!(s.command || s.review);
}
/** Retain the actual initiating control for focus return and visibly gate new intents. */
export function ReviewButton({title,onPress,disabled: disabledProp=false}: {title:string;onPress:()=>void;disabled?:boolean}) {
  const trigger=useContext(FocusContext), ref=useRef<FocusTarget>(null), blocked=useBlocked();
  const disabled=blocked || !!disabledProp;
  return <Pressable ref={ref} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled}
    onPress={()=>{if(disabled) return;Keyboard.dismiss();if(trigger) trigger.current=ref.current;onPress();}} style={[styles.textButton,{opacity:disabled ? 0.45 : 1}]}><Label>{title}</Label></Pressable>;
}
export function Choice({title,selected,onPress,disabled: disabledProp=false}: {title:string;selected:boolean;onPress:()=>void;disabled?:boolean}) {
  const blocked=useBlocked();
  const disabled=blocked || !!disabledProp;
  return <Pressable accessibilityRole="button" accessibilityState={{selected,disabled}} disabled={disabled}
    onPress={()=>{if(disabled) return;onPress();}}
    style={[styles.chip,{maxWidth:'100%',minWidth:0,opacity:disabled ? 0.45 : 1}]}><Label>{selected ? '✓ ' : ''}{title}</Label></Pressable>;
}
export function SourceNotice({title,status,retry}: {title:string;status:string;retry:()=>void}) {
  if(status === 'ready') return null;
  if(status === 'idle' || status === 'loading') return <Loading title={`Загружаем: ${title}…`} />;
  return <View style={styles.card}><Label>{title}: {status === 'unavailable' ? 'сейчас недоступны.' : 'не удалось загрузить.'}</Label><TextButton title={`Обновить: ${title}`} onPress={retry} /></View>;
}
export function ReminderActions({item}: {item:Reminder}) {
  const auth=useAuth(), router=useRouter();
  return <View style={{gap:8}}><Label style={{fontWeight:'700'}}>Подведите итоги</Label><Label>Укажите исход игры и посещение.</Label>
    {item.allowedActions.canOpenResults && <TextButton title="Подвести итоги" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:item.gameId}})} />}
    {item.allowedActions.canLater && <ReviewButton title="Позже" onPress={()=>auth.postgame.review({kind:'later',gameId:item.gameId,reminderId:item.id,body:{command:'later',expectedVersion:item.version}})} />}
  </View>;
}
export function CommandReview({gameId}: {gameId?:string}) {
  const path=usePathname(), router=useRouter(), auth=useAuth(), owner=auth.postgame, participation=auth.participation;
  const s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  const p=useSyncExternalStore(participation.subscribe,participation.getSnapshot,participation.getSnapshot);
  const command=s.command, review=s.review, selected=review ?? command?.packet;
  // Public role / venue experience mutations own their sheets — never open private CommandReview.
  const publicRole=!!selected && isPublicRolePacketKind(selected.kind);
  const venueExperience=!!selected && isVenueExperiencePacketKind(selected.kind);
  const active=path === (gameId ? `/my-games/${gameId}/results` : '/my-games');
  const [dismissed,setDismissed]=useState<typeof command>(null);
  const visible=active && !publicRole && !venueExperience && !!(review || command && command !== dismissed);
  const heading=useRef<ComponentRef<typeof Text>>(null), trigger=useContext(FocusContext), wasOpen=useRef(false);
  useEffect(()=>{
    if(!visible && wasOpen.current && active) {
      const frame=requestAnimationFrame(()=>{trigger?.current?.focus();const node=findNodeHandle(trigger?.current ?? null);if(node) AccessibilityInfo.setAccessibilityFocus(node);});
      wasOpen.current=false; return ()=>cancelAnimationFrame(frame);
    }
    wasOpen.current=visible;
  },[visible,active,trigger]);
  const close=()=>{if(review) owner.cancelReview();setDismissed(command);};
  const current=auth.status === 'authenticated' && s.actor?.actorId === auth.me?.id && s.actor?.sessionId === auth.me?.session.id;
  const source=selected ? s.games[selected.gameId] : undefined;
  const participationCurrent=current && sameActor(p.actor,s.actor);
  const gameSource=selected && participationCurrent ? p.games[selected.gameId] : undefined;
  // A denied game or reduced results projection must never recover private labels from older lists.
  const readable=current && source?.status !== 'unavailable' && gameSource?.status !== 'error';
  const data=readable && source?.status === 'ready' ? source.data : null;
  const own=readable && selected && s.own.status === 'ready' ? s.own.data?.items.filter(r=>r.gameId === selected.gameId) : undefined;
  const reminder=readable && selected && s.reminders.status === 'ready' ? s.reminders.data?.items.find(r=>r.gameId === selected.gameId) : undefined;
  const managed=readable && selected && participationCurrent && p.managed.status === 'ready' && !gameSource ? p.managed.items.find(g=>g.id === selected.gameId) : undefined;
  const title=readable && gameSource?.status === 'ready' ? gameSource.game?.title : managed?.title;
  const otherGame=!!selected && !!gameId && selected.gameId !== gameId;
  const gameTitle=title?.trim() || own?.find(r=>r.gameTitle?.trim())?.gameTitle || reminder?.gameTitle?.trim() || (otherGame ? 'Другая игра — исходное действие' : 'Выбранная игра');
  const person=(contextId:string)=>data?.attendance?.roster?.find(r=>r.contextId === contextId) ?? (data?.attendance?.myAttendance?.contextId === contextId ? data.attendance.myAttendance : undefined);
  // Dispute command context is locked to the frozen intent's disputeId — not the live selection.
  const disputeCommand=selected && (selected.kind === 'withdraw' || selected.kind === 'respond' || selected.kind === 'help') ? selected : null;
  const lockedDisputeSource=disputeCommand && readable ? s.disputes[disputeCommand.disputeId] : undefined;
  const lockedDetail=disputeCommand && lockedDisputeSource?.status === 'ready' && lockedDisputeSource.data?.id === disputeCommand.disputeId
    ? lockedDisputeSource.data : undefined;
  const lockedPerson=lockedDetail ? person(lockedDetail.contextId) : undefined;
  // Resolving ACK consent locks to frozen body + matching dispute detail — never the live roster row.
  const resolvingAck=selected?.kind === 'ack' && selected.body.resolvingDisputeId !== undefined;
  const resolvingSource=resolvingAck && selected.kind === 'ack' && readable ? s.disputes[selected.body.resolvingDisputeId!] : undefined;
  const resolvingDetail=resolvingSource?.status === 'ready' && selected?.kind === 'ack' && resolvingSource.data?.id === selected.body.resolvingDisputeId
    ? resolvingSource.data : undefined;
  const resolvingMatch=selected?.kind === 'ack' && resolvingAck ? resolvingAckAssertion(selected, resolvingDetail) : null;
  const canConfirm=!resolvingAck || !!resolvingMatch;
  const retentionBlocked = command?.status === 'unknown'
    && postgameIdempotencyReplayBlocked(command.firstDispatchedAt);
  // Venue/public own their sheets — never a dead private-modal reopen CTA.
  const showPrivatePendingCta = !!command && !publicRole && !venueExperience;
  // Create recovery keeps immutable results gameId; owner command never uses a game URL (sentinel own-venue).
  const venuePendingRecovery = command && venueExperience
    ? venueExperiencePendingRecoveryTarget(command.packet)
    : null;
  const venuePendingOtherGame = venuePendingRecovery?.kind === 'create-results'
    && (!gameId || venuePendingRecovery.gameId !== gameId);
  const venuePendingOwnerHistory = venuePendingRecovery?.kind === 'owner-history';
  return <>
    {s.notice && <Label accessibilityRole="alert">{s.notice}</Label>}
    {showPrivatePendingCta && <TextButton title={command.status === 'sending' ? 'Сохраняем… Показать действие' : 'Исход неизвестен. Показать действие'} onPress={()=>setDismissed(null)} />}
    {venuePendingOtherGame && venuePendingRecovery?.kind === 'create-results' && <TextButton title={command.status === 'sending' ? 'Сохраняем… Открыть игру отправки' : 'Посмотреть отправку'} onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:venuePendingRecovery.gameId}})} />}
    {venuePendingOwnerHistory && <TextButton title={command.status === 'sending' ? 'Сохраняем… Посмотреть отправку' : 'Посмотреть отправку'} onPress={()=>{
      // Intent survives route commit — do not open history before navigation (blur would retire it).
      owner.requestOwnVenueHistoryNavIntent();
      router.push('/profile');
    }} />}
    <Modal visible={visible} animationType="none" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={iosModalOrientations}
      onShow={()=>{const node=findNodeHandle(heading.current);if(node) AccessibilityInfo.setAccessibilityFocus(node);}}>
      <Page keyboard header={<View style={{gap:8}}>
        <TextButton title={review ? 'Отмена' : 'Закрыть'} onPress={close} />
        {review && <PrimaryButton title="Подтвердить" disabled={!canConfirm} onPress={()=>void owner.confirm()} />}
        {command?.status === 'sending' && <Label accessibilityLiveRegion="polite">Сохраняем…</Label>}
        {command?.status === 'unknown' && !retentionBlocked && <TextButton title="Проверить исходное действие" onPress={()=>void owner.reconcile(command.packet.gameId)} />}
      </View>}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={{gap:16}}>
          <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" allowFontScaling style={[styles.text,styles.subtitle]}>{review ? 'Проверьте выбранное действие' : command?.status === 'sending' ? 'Сохраняем…' : 'Исход действия неизвестен'}</Text>
          {selected && <>
            <Label>Игра · {gameTitle}</Label>
            {otherGame && <Label>Это действие относится к другой игре.</Label>}
            {selected.gameId !== gameId && <TextButton title="Открыть игру этого действия" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:selected.gameId}})} />}
            {selected.kind === 'outcome' && <><Label>{selected.body.outcome === 'held' ? 'Игра состоялась' : 'Игра не состоялась'}</Label>{selected.body.reason && <Label>{selected.body.reason}</Label>}</>}
            {selected.kind === 'attendance' && <><Label>{person(selected.contextId)?.displayName || 'Выбранный участник'}</Label><Label>{attendanceLabel(selected.body.value)}{selected.body.late ? ' · Опоздал' : ''}</Label>{selected.body.correctionReason && <Label>{selected.body.correctionReason}</Label>}</>}
            {selected.kind === 'bulk' && <><Label>Отметить «Пришёл» только выбранным участникам · {selected.body.items.length}</Label>{selected.body.items.map((item,index)=><Label key={item.contextId}>{person(item.contextId)?.displayName || `Выбранный участник ${index+1}`}</Label>)}</>}
            {selected.kind === 'ack' && <><Label>{person(selected.contextId)?.displayName || 'Выбранный участник'}</Label>
              {selected.body.resolvingDisputeId
                ? resolvingMatch
                  ? <Label>{`Подтвердить отметку и закрыть уточнение · ${attendanceLabel(resolvingMatch.value)}${resolvingMatch.late ? ' · Опоздал' : ''} · версия ${resolvingMatch.version}`}</Label>
                  : <><Label>Текущая отметка для подтверждения недоступна. Обновите уточнение.</Label>
                    <TextButton title="Обновить уточнение" onPress={()=>void owner.loadDispute(selected.body.resolvingDisputeId!)} /></>
                : <Label>{`Я согласен с отметкой посещения · ${attendanceLabel(person(selected.contextId)?.value ?? 'unknown')}`}</Label>}</>}
            {selected.kind === 'dispute' && <><Label>{person(selected.contextId)?.displayName || 'Выбранный участник'}</Label><Label>{selected.body.attendanceVersion === 0 ? 'Отметки пока нет' : `Версия ${selected.body.attendanceVersion}`}</Label><Label>{selected.body.explanation}</Label></>}
            {selected.kind === 'withdraw' && <><Label>{lockedPerson?.displayName || 'Выбранный участник'}</Label><Label>Отозвать возражение · версия уточнения {selected.body.expectedVersion}</Label>{lockedDetail && <Label>Текущая отметка: {attendanceLabel(lockedDetail.currentAssertion.value)} · версия {lockedDetail.currentAssertion.version}</Label>}<Label>Отметка сохранится; согласие участника с ней не записывается.</Label>{selected.body.reason && <Label>{selected.body.reason}</Label>}</>}
            {selected.kind === 'respond' && <><Label>{lockedPerson?.displayName || 'Выбранный участник'}</Label><Label>Ответить / исправить · версия уточнения {selected.body.expectedVersion}</Label>{lockedDetail && <Label>Текущая отметка: {attendanceLabel(lockedDetail.currentAssertion.value)} · версия {lockedDetail.currentAssertion.version}</Label>}<Label>{selected.body.explanation}</Label>{selected.body.correction && <Label>{attendanceLabel(selected.body.correction.value)}{selected.body.correction.late ? ' · Опоздание' : ''} · {selected.body.correction.correctionReason}</Label>}<Label>Уточнение останется открытым</Label></>}
            {selected.kind === 'help' && <><Label>{lockedPerson?.displayName || 'Выбранный участник'}</Label><Label>Помощь по уточнению · версия уточнения {selected.body.expectedVersion}</Label>{lockedDetail && <Label>Текущая отметка: {attendanceLabel(lockedDetail.currentAssertion.value)} · версия {lockedDetail.currentAssertion.version}</Label>}<Label>{selected.body.explanation}</Label></>}
            {selected.kind === 'later' && <Label>Отложить это напоминание?</Label>}
            {selected.kind === 'note-upsert' && <><Label>{person(selected.contextId)?.displayName
              || s.notes[`${selected.gameId}:${selected.contextId}`]?.data?.subjectDisplay
              || data?.feedback?.myNotes.find(n => n.contextId === selected.contextId)?.subjectDisplay
              || 'Выбранный участник'}</Label><Label>{selected.body.expectedVersion === 0 ? 'Сохранить заметку' : 'Сохранить изменения'}</Label><Label>{selected.body.text}</Label></>}
            {selected.kind === 'note-delete' && <><Label>{person(selected.contextId)?.displayName
              || s.notes[`${selected.gameId}:${selected.contextId}`]?.data?.subjectDisplay
              || data?.feedback?.myNotes.find(n => n.contextId === selected.contextId)?.subjectDisplay
              || 'Выбранный участник'}</Label><Label>Удалить заметку</Label><Label>После удаления создать заметку об этом участнике в этой игре заново не получится</Label></>}
            {selected.kind === 'peer-create' && <><Label>{data?.feedback?.capabilities.peerSubjects.find(p => p.contextId === selected.body.subjectContextId)?.displayName
              || 'Выбранный участник'}</Label><Label>Отзыв увидите только вы и адресат</Label><Label>{peerRatingLabel(selected.body.peerRating)}</Label>{selected.body.comment && <Label>{selected.body.comment}</Label>}<Label>Отправляя отзыв, вы подтверждаете, что играли вместе</Label></>}
            {selected.kind === 'organization-create' && <><Label>{reviewKindModeLabel('organization')}</Label>
              <Label>{data?.feedback?.capabilities.organizationRecipientDisplay
                ? `Адресат · ${data.feedback.capabilities.organizationRecipientDisplay}`
                : 'Адресат · организатор этой встречи'}</Label>
              {selected.body.organizationScore !== undefined
                ? <Label>Оценка организации: {selected.body.organizationScore} из 5</Label>
                : <Label>Без оценки</Label>}
              {selected.body.comment ? <Label>{selected.body.comment}</Label> : null}
              {selected.body.discrepancyExplanation ? <Label>{selected.body.discrepancyExplanation}</Label> : null}
              <Label>Отправляя отзыв, вы подтверждаете, что описываете собственный опыт этой встречи</Label></>}
            {selected.kind === 'training-create' && <><Label>{reviewKindModeLabel('training')}</Label>
              <Label>Адресат · тренер этой встречи</Label>
              <Label>{selected.body.comment}</Label>
              {selected.body.discrepancyExplanation ? <Label>{selected.body.discrepancyExplanation}</Label> : null}
              <Label>Отправляя отзыв, вы подтверждаете, что описываете собственный опыт этой встречи</Label></>}
            {selected.kind === 'peer-reply' && <><Label>Ответ на отзыв</Label><Label>{selected.body.text}</Label></>}
            {selected.kind === 'peer-report' && <><Label>Пожаловаться на отзыв · версия {selected.body.expectedVersion}</Label><Label>Без публикации и без блокировки игрока</Label>{selected.body.detail && <Label>{selected.body.detail}</Label>}</>}
          </>}
          {command?.status === 'sending' && <Loading title="Отправляем выбранное действие…" />}
          {command?.status === 'unknown' && !retentionBlocked && <><Label>Результат пока неизвестен. Новые изменения недоступны до проверки исходного действия.</Label></>}
          {command?.status === 'unknown' && retentionBlocked && <><Label accessibilityRole="status">{POSTGAME_RETENTION_EXPIRED_NOTICE}</Label></>}
        </View>
      </Page>
    </Modal>
  </>;
}
export function OutcomePanel({data}: {data:Results}) {
  const owner=useAuth().postgame, blocked=useBlocked();
  const [value,setValue]=useState<'held'|'not_held'>(data.outcome.value === 'not_held' ? 'not_held' : 'held'), [reason,setReason]=useState('');
  const reviewReason=normalizeFormReason(reason);
  return <View style={styles.card}><Label style={{fontWeight:'700'}}>Исход игры</Label>
    <Label>{data.outcome.value === 'held' ? 'Игра состоялась' : data.outcome.value === 'not_held' ? 'Игра не состоялась' : 'Исход ещё не указан'}</Label>
    {data.outcome.reason && <Label>{data.outcome.reason}</Label>}
    {data.outcome.provenance && <Label>Отметил организатор · {new Date(data.outcome.provenance.recordedAt).toLocaleString('ru')}</Label>}
    {data.allowedActions.canRecordOutcome && <>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['held','not_held'] as const).map(v=><Choice key={v} title={v === 'held' ? 'Состоялась' : 'Не состоялась'} selected={value === v} onPress={()=>setValue(v)} />)}</View>
      <Label>Причина исхода или исправления</Label><TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Причина исхода или исправления" placeholder="Причина" value={reason} onChangeText={setReason} maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined} returnKeyType={Platform.OS === 'ios' ? 'done' : undefined} style={[styles.input,{minHeight:100,maxHeight:180}]} />
      <ReviewButton title="Проверить исход" onPress={()=>owner.review({kind:'outcome',gameId:data.gameId,body:{expectedVersion:data.outcome.version,outcome:value,...(reviewReason ? {reason:reviewReason} : {})}})} />
    </>}
  </View>;
}
export function AttendancePanel({row,gameId,own=false,writes}: {row:Attendance;gameId:string;own?:boolean;writes:boolean}) {
  const owner=useAuth().postgame, blocked=useBlocked();
  const s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  const [value,setValue]=useState<AttendanceValue>(row.value === 'unknown' ? 'present' : row.value), [late,setLate]=useState(row.late), [reason,setReason]=useState('');
  const [disputeOpen,setDisputeOpen]=useState(false);
  const reviewReason=normalizeFormReason(reason);
  const draftKey=`${gameId}:${row.contextId}:create`;
  const disputeText=s.drafts[draftKey]?.createExplanation ?? '';
  const disputeExplanation=normalizeFormReason(disputeText);
  const dispute=row.dispute;
  const disputed=dispute?.status === 'open';
  const source=row.assertion.source === 'self_attested' ? 'Сами отметили' : row.assertion.source === 'manager_explicit' ? 'Отметил организатор' : row.assertion.source === 'case_reviewer' ? 'Решение по обращению' : 'Источник неизвестен';
  const missing=row.version === 0 && row.value === 'unknown';
  return <View style={styles.card}>
    <Label style={{fontWeight:'700'}}>{own ? 'Ваше посещение' : row.displayName}</Label><Label>{attendanceLabel(row.value)}{row.late ? ' · Опоздал' : ''}</Label>
    <Label>{disputed ? 'На уточнении' : row.value === 'unknown' ? 'Ещё без отметки' : row.acknowledgedVersion === row.version ? 'Участник подтвердил' : source}</Label>
    {row.assertion.at && <Label>{row.assertion.actorDisplay} · {new Date(row.assertion.at).toLocaleString('ru')}</Label>}
    {disputed && <Label>По этой отметке открыто уточнение.</Label>}
    {writes && row.allowedActions.canSetAttendance && !disputed && <>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['present','absent',...(row.version > 0 ? ['unknown'] as const : [])] as AttendanceValue[]).map(v=><Choice key={v} title={attendanceLabel(v)} selected={value === v} onPress={()=>{setValue(v);if(v !== 'present')setLate(false);}} />)}</View>
      {value === 'present' && <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Label>Опоздал</Label><Switch disabled={blocked} accessibilityLabel="Опоздал" value={late} onValueChange={setLate} /></View>}
      {row.version > 0 && <><Label>Причина исправления посещения</Label><TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Причина исправления посещения" placeholder="Причина исправления" value={reason} onChangeText={setReason} maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined} returnKeyType={Platform.OS === 'ios' ? 'done' : undefined} style={[styles.input,{minHeight:100,maxHeight:180}]} /></>}
      <ReviewButton title="Проверить отметку" onPress={()=>owner.review({kind:'attendance',gameId,contextId:row.contextId,body:{expectedVersion:row.version,value,late,...(row.version > 0 ? {correctionReason:reviewReason} : {})}})} />
    </>}
    {own && writes && mayAcknowledge(row) && <><Label>Подтверждайте только если согласны с отметкой.</Label><ReviewButton title="Я согласен с отметкой" onPress={()=>owner.review({kind:'ack',gameId,contextId:row.contextId,body:{attendanceVersion:row.version}})} /></>}
    {own && writes && row.allowedActions.canDispute && !disputed && (
      <ReviewButton title={row.value === 'unknown' ? 'Попросить уточнение' : 'Оспорить отметку'} onPress={()=>setDisputeOpen(true)} />
    )}
    {own && disputed && dispute && <ReviewButton title="К уточнению" onPress={()=>owner.selectDispute({gameId,contextId:row.contextId,disputeId:dispute.id})} />}
    {!own && disputed && dispute && <ReviewButton title="Открыть уточнение" onPress={()=>owner.selectDispute({gameId,contextId:row.contextId,disputeId:dispute.id})} />}
    {own && <AttendanceHistoryPanel gameId={gameId} contextId={row.contextId} />}
    <Modal visible={disputeOpen} animationType="none" presentationStyle="fullScreen" supportedOrientations={iosModalOrientations} onRequestClose={()=>setDisputeOpen(false)}>
      <Page keyboard header={<View style={{gap:8}}>
        <TextButton title="Отмена" onPress={()=>setDisputeOpen(false)} />
        <PrimaryButton title="Отправить" disabled={!disputeExplanation} onPress={()=>{
          setDisputeOpen(false);
          owner.review({kind:'dispute',gameId,contextId:row.contextId,body:{attendanceVersion:row.version,explanation:disputeExplanation}});
        }} />
      </View>}>
        <View style={{gap:12}}>
          <Label accessibilityRole="header" style={{fontWeight:'700'}}>{row.value === 'unknown' ? 'Попросить уточнение' : 'Оспорить отметку'}</Label>
          <Label>{missing ? 'Отметки пока нет' : `${attendanceLabel(row.value)} · версия ${row.version}`}</Label>
          <Label>Пояснение</Label>
          <TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Пояснение"
            value={disputeText} onChangeText={text=>owner.setDraft(gameId,row.contextId,null,{createExplanation:text})}
            maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
            style={[styles.input,{minHeight:100,maxHeight:180}]} />
        </View>
      </Page>
    </Modal>
  </View>;
}
/** Typed attendance-history lane — reachable from own card independently of open disputes. */
export function AttendanceHistoryPanel({ gameId, contextId }: { gameId: string; contextId: string }) {
  const owner = useAuth().postgame;
  const s = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const key = `${gameId}:${contextId}`;
  const source = s.histories[key];
  const [open, setOpen] = useState(false);
  return <>
    <TextButton title="История изменений" onPress={() => { setOpen(true); void owner.loadHistory(gameId, contextId, 20); }} />
    <Modal visible={open} animationType="none" presentationStyle="fullScreen" supportedOrientations={iosModalOrientations} onRequestClose={() => setOpen(false)}>
      <Page keyboard header={<TextButton title="Закрыть" onPress={() => setOpen(false)} />}>
        <Label accessibilityRole="header" style={{ fontWeight: '700' }}>История изменений</Label>
        {(source?.status === 'idle' || source?.status === 'loading') ? <Loading title="Загружаем историю…" /> : null}
        {source?.status === 'error' ? <><Label>Не удалось загрузить историю.</Label><TextButton title="Повторить" onPress={() => void owner.loadHistory(gameId, contextId, 20)} /></> : null}
        {source?.status === 'unavailable' ? <Label>История сейчас недоступна.</Label> : null}
        {source?.status === 'ready' ? (source.data?.items.length
          ? source.data.items.map(item => {
            const sourceLabel = item.source === 'self_attested' ? 'Сами отметили'
              : item.source === 'manager_explicit' ? 'Отметил организатор'
              : item.source === 'case_reviewer' ? 'Решение по обращению'
              : 'Источник неизвестен';
            return <View key={item.version} style={{ gap: 4 }}>
              <Label>v{item.version}: {attendanceLabel(item.after.value)}{item.after.late ? ' · опоздание' : ''} · {item.actorDisplay} · {sourceLabel} · {new Date(item.recordedAt).toLocaleString('ru')}</Label>
            </View>;
          })
          : <Label>Пока нет записей.</Label>) : null}
      </Page>
    </Modal>
  </>;
}
export function Roster({data}: {data:Results}) {
  const owner=useAuth().postgame, [selected,setSelected]=useState<string[]>([]), a=data.attendance;
  if(!a?.roster) return null;
  const eligible=a.roster.filter(r=>r.value === 'unknown' && r.allowedActions.canSetAttendance && r.dispute?.status !== 'open');
  const selection=eligible.filter(r=>selected.includes(r.contextId));
  return <View style={{gap:12}}><Label style={{fontSize:20,fontWeight:'700'}}>Участники</Label>
    {a.summary && <Label>Всего {a.summary.rosterCount} · Отмечено {a.summary.marked} · Без отметки {a.summary.unknown} · На уточнении {a.summary.underClarification}</Label>}
    {a.roster.map(row=><View key={row.contextId} style={{gap:8}}>
      {a.writesEnabled && a.allowedActions.canBulkPresent && eligible.some(r=>r.contextId === row.contextId) && <Choice title={row.displayName} selected={selected.includes(row.contextId)} onPress={()=>setSelected(ids=>ids.includes(row.contextId) ? ids.filter(id=>id !== row.contextId) : [...ids,row.contextId])} />}
      <AttendancePanel row={row} gameId={data.gameId} writes={a.writesEnabled} />
    </View>)}
    {a.writesEnabled && a.allowedActions.canBulkPresent && selection.length > 0 && <ReviewButton title={`Проверить выбранных · ${selection.length}`} onPress={()=>owner.review({kind:'bulk',gameId:data.gameId,body:{items:selection.map(r=>({contextId:r.contextId,expectedVersion:r.version})),confirmedExactSelection:true}})} />}
    {a.rosterNextCursor && <TextButton title="Ещё участники" onPress={()=>void owner.loadResults(data.gameId,{rosterLimit:50,rosterCursor:a.rosterNextCursor ?? undefined},'roster')} />}
  </View>;
}
