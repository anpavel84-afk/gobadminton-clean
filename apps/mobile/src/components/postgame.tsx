import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentRef, PropsWithChildren, RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, Text, View, TextInput, Switch } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { attendanceLabel, mayAcknowledge } from '../postgame.ts';
import type { Attendance, AttendanceValue, Reminder, Results } from '../postgame.ts';
import { Label, Loading, TextButton, PrimaryButton, Page, styles } from './ui.tsx';
type FocusTarget = ComponentRef<typeof Pressable>;
const FocusContext=createContext<RefObject<FocusTarget | null> | null>(null);
export function PostgameSurface({children}:PropsWithChildren) {
  const trigger=useRef<FocusTarget>(null);
  return <FocusContext.Provider value={trigger}>{children}</FocusContext.Provider>;
}
function useBlocked() {
  const owner=useAuth().postgame, s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  return !!(s.command || s.review);
}
/** Retain the actual initiating control for focus return and visibly gate new intents. */
function ReviewButton({title,onPress}: {title:string;onPress:()=>void}) {
  const trigger=useContext(FocusContext), ref=useRef<FocusTarget>(null), disabled=useBlocked();
  return <Pressable ref={ref} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled}
    onPress={()=>{if(trigger) trigger.current=ref.current;onPress();}} style={[styles.textButton,{opacity:disabled ? 0.45 : 1}]}><Label>{title}</Label></Pressable>;
}
function Choice({title,selected,onPress}: {title:string;selected:boolean;onPress:()=>void}) {
  const disabled=useBlocked();
  return <Pressable accessibilityRole="button" accessibilityState={{selected,disabled}} disabled={disabled} onPress={onPress}
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
  const path=usePathname(), owner=useAuth().postgame, s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  const command=s.command, review=s.review, selected=review ?? command?.packet;
  const active=path === (gameId ? `/my-games/${gameId}/results` : '/my-games');
  const [dismissed,setDismissed]=useState<typeof command>(null);
  const visible=active && !!(review || command && command !== dismissed);
  const heading=useRef<ComponentRef<typeof Text>>(null), trigger=useContext(FocusContext), wasOpen=useRef(false);
  useEffect(()=>{
    if(!visible && wasOpen.current && active) {
      const frame=requestAnimationFrame(()=>{trigger?.current?.focus();const node=findNodeHandle(trigger?.current ?? null);if(node) AccessibilityInfo.setAccessibilityFocus(node);});
      wasOpen.current=false; return ()=>cancelAnimationFrame(frame);
    }
    wasOpen.current=visible;
  },[visible,active,trigger]);
  const close=()=>{if(review) owner.cancelReview();setDismissed(command);};
  const data=selected ? s.games[selected.gameId]?.data : null;
  return <>
    {s.notice && <Label accessibilityRole="alert">{s.notice}</Label>}
    {command && <TextButton title={command.status === 'sending' ? 'Сохраняем… Показать действие' : 'Исход неизвестен. Показать действие'} onPress={()=>setDismissed(null)} />}
    <Modal visible={visible} animationType="none" presentationStyle="fullScreen" onRequestClose={close}
      onShow={()=>{const node=findNodeHandle(heading.current);if(node) AccessibilityInfo.setAccessibilityFocus(node);}}>
      <Page keyboard header={<View style={{gap:8}}>
        <TextButton title={review ? 'Отмена' : 'Закрыть'} onPress={close} />
        {review && <PrimaryButton title="Подтвердить" onPress={()=>void owner.confirm()} />}
        {command?.status === 'sending' && <Label accessibilityLiveRegion="polite">Сохраняем…</Label>}
        {command?.status === 'unknown' && <TextButton title="Проверить исходное действие" onPress={()=>void owner.reconcile(command.packet.gameId)} />}
      </View>}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={{gap:16}}>
          <Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" allowFontScaling style={[styles.text,styles.subtitle]}>{review ? 'Проверьте выбранное действие' : command?.status === 'sending' ? 'Сохраняем…' : 'Исход действия неизвестен'}</Text>
          {selected && <>
            <Label>Игра · {selected.gameId}</Label>
            {selected.kind === 'outcome' && <><Label>{selected.body.outcome === 'held' ? 'Игра состоялась' : 'Игра не состоялась'}</Label>{selected.body.reason && <Label>{selected.body.reason}</Label>}</>}
            {selected.kind === 'attendance' && <><Label>{data?.attendance?.roster?.find(r=>r.contextId === selected.contextId)?.displayName ?? (data?.attendance?.myAttendance?.contextId === selected.contextId ? data.attendance.myAttendance.displayName : selected.contextId)}</Label><Label>{attendanceLabel(selected.body.value)}{selected.body.late ? ' · Опоздал' : ''}</Label>{selected.body.correctionReason && <Label>{selected.body.correctionReason}</Label>}</>}
            {selected.kind === 'bulk' && <><Label>Отметить «Пришёл» только выбранным участникам · {selected.body.items.length}</Label>{selected.body.items.map(item=><Label key={item.contextId}>{data?.attendance?.roster?.find(r=>r.contextId === item.contextId)?.displayName ?? item.contextId}</Label>)}</>}
            {selected.kind === 'ack' && <><Label>{data?.attendance?.myAttendance?.displayName ?? selected.contextId}</Label><Label>Я согласен с отметкой посещения · {attendanceLabel(data?.attendance?.myAttendance?.value ?? 'unknown')}</Label></>}
            {selected.kind === 'later' && <Label>Отложить это напоминание?</Label>}
          </>}
          {command?.status === 'sending' && <Loading title="Отправляем выбранное действие…" />}
          {command?.status === 'unknown' && <><Label>Результат пока неизвестен. Новые изменения недоступны до проверки исходного действия.</Label></>}
        </View>
      </Page>
    </Modal>
  </>;
}
export function OutcomePanel({data}: {data:Results}) {
  const owner=useAuth().postgame, blocked=useBlocked();
  const [value,setValue]=useState<'held'|'not_held'>(data.outcome.value === 'not_held' ? 'not_held' : 'held'), [reason,setReason]=useState('');
  return <View style={styles.card}><Label style={{fontWeight:'700'}}>Исход игры</Label>
    <Label>{data.outcome.value === 'held' ? 'Игра состоялась' : data.outcome.value === 'not_held' ? 'Игра не состоялась' : 'Исход ещё не указан'}</Label>
    {data.outcome.reason && <Label>{data.outcome.reason}</Label>}
    {data.outcome.provenance && <Label>Отметил организатор · {new Date(data.outcome.provenance.recordedAt).toLocaleString('ru')}</Label>}
    {data.allowedActions.canRecordOutcome && <>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['held','not_held'] as const).map(v=><Choice key={v} title={v === 'held' ? 'Состоялась' : 'Не состоялась'} selected={value === v} onPress={()=>setValue(v)} />)}</View>
      <Label>Причина исхода или исправления</Label><TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Причина исхода или исправления" placeholder="Причина" value={reason} onChangeText={setReason} maxLength={500} style={[styles.input,{minHeight:100,maxHeight:180}]} />
      <ReviewButton title="Проверить исход" onPress={()=>owner.review({kind:'outcome',gameId:data.gameId,body:{expectedVersion:data.outcome.version,outcome:value,...(reason.trim() ? {reason:reason.trim()} : {})}})} />
    </>}
  </View>;
}
export function AttendancePanel({row,gameId,own=false,writes}: {row:Attendance;gameId:string;own?:boolean;writes:boolean}) {
  const owner=useAuth().postgame, blocked=useBlocked();
  const [value,setValue]=useState<AttendanceValue>(row.value === 'unknown' ? 'present' : row.value), [late,setLate]=useState(row.late), [reason,setReason]=useState('');
  const disputed=row.dispute?.status === 'open';
  const source=row.assertion.source === 'self_attested' ? 'Сами отметили' : row.assertion.source === 'manager_explicit' ? 'Отметил организатор' : row.assertion.source === 'case_reviewer' ? 'Решение по обращению' : 'Источник неизвестен';
  return <View style={styles.card}>
    <Label style={{fontWeight:'700'}}>{own ? 'Ваше посещение' : row.displayName}</Label><Label>{attendanceLabel(row.value)}{row.late ? ' · Опоздал' : ''}</Label>
    <Label>{disputed ? 'На уточнении' : row.value === 'unknown' ? 'Ещё без отметки' : row.acknowledgedVersion === row.version ? 'Участник подтвердил' : source}</Label>
    {row.assertion.at && <Label>{row.assertion.actorDisplay} · {new Date(row.assertion.at).toLocaleString('ru')}</Label>}
    {disputed && <Label>По этой отметке открыто уточнение.</Label>}
    {writes && row.allowedActions.canSetAttendance && !disputed && <>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['present','absent',...(row.version > 0 ? ['unknown'] as const : [])] as AttendanceValue[]).map(v=><Choice key={v} title={attendanceLabel(v)} selected={value === v} onPress={()=>{setValue(v);if(v !== 'present')setLate(false);}} />)}</View>
      {value === 'present' && <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Label>Опоздал</Label><Switch disabled={blocked} accessibilityLabel="Опоздал" value={late} onValueChange={setLate} /></View>}
      {row.version > 0 && <><Label>Причина исправления посещения</Label><TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Причина исправления посещения" placeholder="Причина исправления" value={reason} onChangeText={setReason} maxLength={500} style={[styles.input,{minHeight:100,maxHeight:180}]} /></>}
      <ReviewButton title="Проверить отметку" onPress={()=>owner.review({kind:'attendance',gameId,contextId:row.contextId,body:{expectedVersion:row.version,value,late,...(row.version > 0 ? {correctionReason:reason.trim()} : {})}})} />
    </>}
    {own && writes && mayAcknowledge(row) && <><Label>Подтверждайте только если согласны с отметкой.</Label><ReviewButton title="Я согласен с отметкой" onPress={()=>owner.review({kind:'ack',gameId,contextId:row.contextId,body:{attendanceVersion:row.version}})} /></>}
  </View>;
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
