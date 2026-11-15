import { useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth.tsx';
import { participationLabels } from '../src/participation.ts';
import { hubRows, hubView, hubBucket, sortHubRows } from '../src/my-games.ts';
import type { HubRow } from '../src/my-games.ts';
import { attendanceLabel, needsAttention } from '../src/postgame.ts';
import { GameCard } from '../src/components/game-card.tsx';
import { PostgameSurface, CommandReview, ReminderActions, SourceNotice } from '../src/components/postgame.tsx';
import { ErrorState, Header, Label, Loading, Page, TextButton, DiscoveryChip, styles } from '../src/components/ui.tsx';
const filters=[{value:'all',label:'Все'},{value:'manage',label:'Создаю и управляю'},{value:'participate',label:'Заявки и участие'}] as const;
export default function MyGames() {
  const auth=useAuth(), router=useRouter(), owner=auth.postgame, participation=auth.participation;
  const s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  const p=useSyncExternalStore(participation.subscribe,participation.getSnapshot,participation.getSnapshot);
  const actor=auth.me?.id, session=auth.me?.session.id;
  const current=auth.status === 'authenticated' && s.actor?.actorId === actor && s.actor?.sessionId === session && p.actor?.actorId === actor;
  useEffect(()=>{
    if(auth.status !== 'authenticated') return;
    if(p.own.status === 'idle') void participation.loadOwn(); if(p.managed.status === 'idle') void participation.loadManaged();
    if(s.own.status === 'idle') void owner.loadOwn(); if(s.reminders.status === 'idle') void owner.loadReminders();
  },[auth.status,actor,session,owner,participation,p.own.status,p.managed.status,s.own.status,s.reminders.status]);
  const all=current ? hubRows(p.managed.items,p.own.items,s.own.data?.items ?? [],s.reminders.data?.items ?? []) : [];
  const {rows,attention,empty}=hubView(all,s.filter), target=attention[0];
  const complete=p.own.status === 'ready' && p.managed.status === 'ready' && s.own.status === 'ready' && s.reminders.status === 'ready';
  const groups=[['upcoming','Предстоящие'],['draft','Черновики'],['past','История'],['terminal','Завершённые заявки и отмены'],['unknown','Дата недоступна']] as const;
  return <PostgameSurface><Page header={<Header back={()=>router.canGoBack() ? router.back() : router.replace('/games')} />}>
    <Label accessibilityRole="header" style={styles.title}>Мои игры</Label>
    {auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !current ? <>
      <Label>Войдите, чтобы видеть свои игры</Label><TextButton title="Войти" onPress={()=>void auth.signIn('/my-games')} />
    </> : <>
      <CommandReview />
      <TextButton title="Создать игру" onPress={()=>router.push('/games/create')} />
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{filters.map(f=><DiscoveryChip key={f.value} title={f.label} selected={s.filter === f.value} onPress={()=>owner.filter(f.value)} />)}</View>
      {target && <View style={styles.card}><Label>После игры ждут ответа · {attention.length}{s.own.data?.nextCursor ? '+' : ''} · в загруженных источниках</Label>
        <TextButton title="К итогам" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:target.gameId}})} /></View>}
      <SourceNotice title="Управляемые игры" status={p.managed.status} retry={()=>void participation.loadManaged()} />
      <SourceNotice title="Заявки и участия" status={p.own.status} retry={()=>void participation.loadOwn()} />
      <SourceNotice title="Ваши итоги" status={s.own.status} retry={()=>void owner.loadOwn()} />
      <SourceNotice title="Напоминания" status={s.reminders.status} retry={()=>void owner.loadReminders()} />
      {s.reminders.status === 'ready' && s.reminders.data?.installed === false && <Label>Напоминания сейчас недоступны.</Label>}
      {complete && empty === 'filter' && <><Label>В выбранном фильтре нет загруженных игр.</Label><TextButton title="Показать все" onPress={()=>owner.filter('all')} /></>}
      {complete && empty === 'loaded' && <><Label>В загруженных источниках пока нет ваших игр.</Label><TextButton title="Найти игру" onPress={()=>router.push('/games')} /></>}
      {groups.map(([bucket,title])=>{
        const getGame=(r:HubRow)=>p.games[r.gameId]?.game ?? r.managed;
        const items=sortHubRows(rows.filter(r=>hubBucket(r,getGame(r)) === bucket),bucket,getGame);
        if(!items.length && bucket !== 'upcoming' && bucket !== 'past') return null;
        return <View key={bucket} style={{gap:16}}><Label accessibilityRole="header" style={{fontSize:20,fontWeight:'700'}}>{title}</Label>
          {bucket === 'past' && <Label>История показывает исход заявки или статус игры. Это не подтверждает присутствие на площадке и не означает оплату.</Label>}
          {!items.length && complete && <Label>{bucket === 'upcoming' ? 'В этом фильтре нет предстоящих игр.' : 'В загруженных источниках история этого фильтра пуста.'}</Label>}
          {items.map(row=><OwnGame key={`${actor}:${session}:${row.gameId}`} row={row} />)}</View>;
      })}
      {s.own.data?.nextCursor && <TextButton title={s.own.status === 'loading' ? 'Загружаем…' : 'Показать ещё итоги'} onPress={()=>void owner.loadOwn(true)} />}
      <TextButton title="Обновить мои игры" onPress={()=>{void participation.loadOwn();void participation.loadManaged();void owner.loadOwn();void owner.loadReminders();}} />
    </>}
  </Page></PostgameSurface>;
}
function OwnGame({row}: {row:HubRow}) {
  const router=useRouter(), auth=useAuth(), owner=auth.participation;
  const p=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  useEffect(()=>{if(!p.games[row.gameId]) void owner.loadGame(row.gameId);},[owner,row.gameId,p.games]);
  const state=p.games[row.gameId], game=state?.game ?? row.managed;
  return <View style={{gap:8}}>
    {game ? <GameCard game={game} onOpen={()=>router.push({pathname:'/games/[id]',params:{id:row.gameId}})} /> : <View style={styles.card}>
      <Label>{row.own[0]?.gameTitle ?? row.reminders[0]?.gameTitle ?? 'Игра'}</Label>
      <Label>{row.own[0]?.endsAt ?? row.reminders[0]?.endsAt ?? 'Дата и время недоступны'}</Label>
    </View>}
    {(!state || state.status === 'loading') && <Loading title="Загружаем условия игры…" />}
    {state?.status === 'error' && <ErrorState error={state.error} retry={()=>void owner.loadGame(row.gameId)} />}
    <View style={styles.card}>
      {row.managed && <><Label>{row.managed.management.role === 'owner' ? 'Создаю и управляю' : 'Управляю'}</Label><TextButton title="Управление игрой" onPress={()=>router.push({pathname:'/games/manage/[id]',params:{id:row.gameId}})} /></>}
      {row.parts.map(p=><Label key={p.id}>{participationLabels[p.status]}</Label>)}
      {row.own.map(r=><Label key={r.contextId}>{attendanceLabel(r.attendance.value)}{needsAttention(r) ? ' · Ждёт вашего ответа' : ''}</Label>)}
      <TextButton title="Участники / Итоги" onPress={()=>router.push({pathname:'/my-games/[gameId]/results',params:{gameId:row.gameId}})} />
      {row.reminders.map(r=><ReminderActions key={r.id} item={r} />)}
    </View>
  </View>;
}
