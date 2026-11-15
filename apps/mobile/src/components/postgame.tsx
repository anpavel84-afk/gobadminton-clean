import { useState, useSyncExternalStore } from 'react';
import { View, TextInput, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import { attendanceLabel, mayAcknowledge } from '../postgame.ts';
import type { Attendance, AttendanceValue, Reminder, Results } from '../postgame.ts';
import { Label, Loading, TextButton, PrimaryButton, DiscoveryChip, styles } from './ui.tsx';
export function SourceNotice({title,status,retry}: {title:string;status:string;retry:()=>void}) {
  if(status === 'ready') return null;
  if(status === 'idle' || status === 'loading') return <Loading title={`Загружаем: ${title}…`} />;
  return <View style={styles.card}><Label>{title}: {status === 'unavailable' ? 'сейчас недоступны.' : 'не удалось загрузить.'}</Label><TextButton title={`Обновить: ${title}`} onPress={retry} /></View>;
}
export function ReminderActions({item}: {item:Reminder}) {
  const auth=useAuth(), router=useRouter();
  return <View style={{gap:8}}><Label style={{fontWeight:'700'}}>Подведите итоги</Label><Label>Укажите исход игры и посещение.</Label>
    {item.allowedActions.canOpenResults && <TextButton title="Подвести итоги" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:item.gameId}})} />}
    {item.allowedActions.canLater && <TextButton title="Позже" onPress={()=>auth.postgame.review({kind:'later',gameId:item.gameId,reminderId:item.id,body:{command:'later',expectedVersion:item.version}})} />}
  </View>;
}
export function CommandReview({gameId}: {gameId?:string}) {
  const router=useRouter(), owner=useAuth().postgame, s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot), intent=s.review;
  const command=s.command && (!gameId || s.command.packet.gameId === gameId) ? s.command : null;
  const review=intent && (!gameId || intent.gameId === gameId) ? intent : null;
  const data=review ? s.games[review.gameId]?.data : null;
  return <>
    {s.notice && <Label accessibilityRole="alert">{s.notice}</Label>}
    {gameId && s.command && s.command.packet.gameId !== gameId && <TextButton title="Вернуться к незавершённому действию" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:s.command!.packet.gameId}})} />}
    {command?.status === 'sending' && <Loading title="Сохраняем…" />}
    {command?.status === 'unknown' && <TextButton title="Проверить исходное действие" onPress={()=>void owner.reconcile(command.packet.gameId)} />}
    {review && <View style={styles.card}>
      <Label style={{fontWeight:'700'}}>Проверьте выбранное действие</Label>
      {review.kind === 'outcome' && <><Label>{review.body.outcome === 'held' ? 'Игра состоялась' : 'Игра не состоялась'}</Label>{review.body.reason && <Label>{review.body.reason}</Label>}</>}
      {review.kind === 'attendance' && <><Label>{data?.attendance?.roster?.find(r=>r.contextId === review.contextId)?.displayName ?? data?.attendance?.myAttendance?.displayName}</Label><Label>{attendanceLabel(review.body.value)}{review.body.late ? ' · Опоздал' : ''}</Label>{review.body.correctionReason && <Label>{review.body.correctionReason}</Label>}</>}
      {review.kind === 'bulk' && <><Label>Отметить «Пришёл» только выбранным участникам · {review.body.items.length}</Label>{review.body.items.map(item=><Label key={item.contextId}>{data?.attendance?.roster?.find(r=>r.contextId === item.contextId)?.displayName ?? item.contextId}</Label>)}</>}
      {review.kind === 'ack' && <Label>Я согласен с отметкой посещения · {attendanceLabel(data?.attendance?.myAttendance?.value ?? 'unknown')}</Label>}
      {review.kind === 'later' && <Label>Отложить это напоминание?</Label>}
      <PrimaryButton title="Подтвердить" onPress={()=>void owner.confirm()} />
      <TextButton title="Отмена" onPress={owner.cancelReview} />
    </View>}
  </>;
}
export function OutcomePanel({data}: {data:Results}) {
  const owner=useAuth().postgame;
  const [value,setValue]=useState<'held'|'not_held'>(data.outcome.value === 'not_held' ? 'not_held' : 'held'), [reason,setReason]=useState('');
  return <View style={styles.card}><Label style={{fontWeight:'700'}}>Исход игры</Label>
    <Label>{data.outcome.value === 'held' ? 'Игра состоялась' : data.outcome.value === 'not_held' ? 'Игра не состоялась' : 'Исход ещё не указан'}</Label>
    {data.outcome.reason && <Label>{data.outcome.reason}</Label>}
    {data.outcome.provenance && <Label>Отметил организатор · {new Date(data.outcome.provenance.recordedAt).toLocaleString('ru')}</Label>}
    {data.allowedActions.canRecordOutcome && <>
      <View style={{flexDirection:'row',gap:8}}>{(['held','not_held'] as const).map(v=><DiscoveryChip key={v} title={v === 'held' ? 'Состоялась' : 'Не состоялась'} selected={value === v} onPress={()=>setValue(v)} />)}</View>
      <TextInput accessibilityLabel="Причина исхода или исправления" placeholder="Причина" value={reason} onChangeText={setReason} maxLength={500} style={styles.input} />
      <TextButton title="Проверить исход" onPress={()=>owner.review({kind:'outcome',gameId:data.gameId,body:{expectedVersion:data.outcome.version,outcome:value,...(reason.trim() ? {reason:reason.trim()} : {})}})} />
    </>}
  </View>;
}
export function AttendancePanel({row,gameId,own=false,writes}: {row:Attendance;gameId:string;own?:boolean;writes:boolean}) {
  const owner=useAuth().postgame;
  const [value,setValue]=useState<AttendanceValue>(row.value === 'unknown' ? 'present' : row.value), [late,setLate]=useState(row.late), [reason,setReason]=useState('');
  const disputed=row.dispute?.status === 'open';
  const source=row.assertion.source === 'self_attested' ? 'Сами отметили' : row.assertion.source === 'manager_explicit' ? 'Отметил организатор' : row.assertion.source === 'case_reviewer' ? 'Решение по обращению' : 'Источник неизвестен';
  return <View style={styles.card}>
    <Label style={{fontWeight:'700'}}>{own ? 'Ваше посещение' : row.displayName}</Label><Label>{attendanceLabel(row.value)}{row.late ? ' · Опоздал' : ''}</Label>
    <Label>{disputed ? 'На уточнении' : row.value === 'unknown' ? 'Ещё без отметки' : row.acknowledgedVersion === row.version ? 'Участник подтвердил' : source}</Label>
    {row.assertion.at && <Label>{row.assertion.actorDisplay} · {new Date(row.assertion.at).toLocaleString('ru')}</Label>}
    {disputed && <Label>По этой отметке открыто уточнение.</Label>}
    {writes && row.allowedActions.canSetAttendance && !disputed && <>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['present','absent',...(row.version > 0 ? ['unknown'] as const : [])] as AttendanceValue[]).map(v=><DiscoveryChip key={v} title={attendanceLabel(v)} selected={value === v} onPress={()=>{setValue(v);if(v !== 'present')setLate(false);}} />)}</View>
      {value === 'present' && <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Label>Опоздал</Label><Switch accessibilityLabel="Опоздал" value={late} onValueChange={setLate} /></View>}
      {row.version > 0 && <TextInput accessibilityLabel="Причина исправления посещения" placeholder="Причина исправления" value={reason} onChangeText={setReason} maxLength={500} style={styles.input} />}
      <TextButton title="Проверить отметку" onPress={()=>owner.review({kind:'attendance',gameId,contextId:row.contextId,body:{expectedVersion:row.version,value,late,...(row.version > 0 ? {correctionReason:reason.trim()} : {})}})} />
    </>}
    {own && writes && mayAcknowledge(row) && <><Label>Подтверждайте только если согласны с отметкой.</Label><TextButton title="Я согласен с отметкой" onPress={()=>owner.review({kind:'ack',gameId,contextId:row.contextId,body:{attendanceVersion:row.version}})} /></>}
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
      {a.writesEnabled && a.allowedActions.canBulkPresent && eligible.some(r=>r.contextId === row.contextId) && <DiscoveryChip title={`${selected.includes(row.contextId) ? '✓ ' : ''}${row.displayName}`} selected={selected.includes(row.contextId)} onPress={()=>setSelected(ids=>ids.includes(row.contextId) ? ids.filter(id=>id !== row.contextId) : [...ids,row.contextId])} />}
      <AttendancePanel row={row} gameId={data.gameId} writes={a.writesEnabled} />
    </View>)}
    {a.writesEnabled && a.allowedActions.canBulkPresent && selection.length > 0 && <TextButton title={`Проверить выбранных · ${selection.length}`} onPress={()=>owner.review({kind:'bulk',gameId:data.gameId,body:{items:selection.map(r=>({contextId:r.contextId,expectedVersion:r.version})),confirmedExactSelection:true}})} />}
    {a.rosterNextCursor && <TextButton title="Ещё участники" onPress={()=>void owner.loadResults(data.gameId,{rosterLimit:50,rosterCursor:a.rosterNextCursor ?? undefined},'roster')} />}
  </View>;
}
