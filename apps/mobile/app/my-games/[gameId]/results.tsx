import { useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth.tsx';
import { canonicalPostgamePath } from '../../../src/native-auth-protocol.ts';
import { AttendancePanel, PostgameSurface, CommandReview, OutcomePanel, Roster, SourceNotice, ReminderActions } from '../../../src/components/postgame.tsx';
import { ClarificationSection } from '../../../src/components/postgame-disputes.tsx';
import { NotesSection } from '../../../src/components/postgame-notes.tsx';
import { FeedbackSection } from '../../../src/components/postgame-feedback.tsx';
import { feedbackSectionVisible, notesSectionVisible } from '../../../src/postgame.ts';
import { BackLink, Header, Label, Loading, Page, TextButton, styles } from '../../../src/components/ui.tsx';
export default function GameResults() {
  const params=useLocalSearchParams<{gameId?:string|string[]}>(), router=useRouter(), auth=useAuth(), owner=auth.postgame;
  const s=useSyncExternalStore(owner.subscribe,owner.getSnapshot,owner.getSnapshot);
  const p=useSyncExternalStore(auth.participation.subscribe,auth.participation.getSnapshot,auth.participation.getSnapshot);
  const gameId=typeof params.gameId === 'string' && canonicalPostgamePath(`/my-games/${params.gameId}/results`) ? params.gameId : null;
  const actor=auth.me?.id,session=auth.me?.session.id;
  const current=auth.status === 'authenticated' && s.actor?.actorId === actor && s.actor?.sessionId === session;
  useEffect(()=>{if(!current || !gameId) return; void owner.loadResults(gameId);void owner.loadReminders();void auth.participation.loadGame(gameId);},[current,gameId,owner,auth.participation,actor,session]);
  const state=current && gameId ? s.games[gameId] : undefined, data=state?.data, game=gameId ? p.games[gameId]?.game : undefined;
  const showNotes=!!gameId && notesSectionVisible(gameId, data, s.notes, s.knownNoteRefs);
  const showFeedback=!!gameId && feedbackSectionVisible(gameId, data?.feedback, s.reviewHistory);
  const back=()=>router.replace('/my-games');
  return <PostgameSurface><Page keyboard header={<Header />}><BackLink title="← К моим играм" onPress={back} /><Label accessibilityRole="header" style={styles.title}>Участники / Итоги</Label>
    {!gameId ? <Label>Игра недоступна.</Label> : auth.status === 'hydrating' ? <Loading title="Проверяем сессию…" /> : !current ? <>
      <Label>Войдите, чтобы увидеть итоги игры.</Label><TextButton title="Войти" onPress={()=>void auth.signIn(`/my-games/${gameId}/results`)} />
    </> : <>
      <CommandReview gameId={gameId} />
      <View style={styles.card}><Label style={{fontWeight:'700'}}>{game?.title ?? 'Игра'}</Label><Label>{game ? new Date(game.startsAt).toLocaleString('ru',{timeZone:game.timezone}) : 'Условия игры сейчас недоступны'}</Label>
        <TextButton title="К игре" onPress={()=>router.push({pathname:'/games/[id]',params:{id:gameId}})} /></View>
      <SourceNotice title="Итоги игры" status={state?.status ?? 'loading'} retry={()=>void owner.loadResults(gameId)} />
      {data && <>
        <OutcomePanel key={`${actor}:${gameId}:outcome`} data={data} />
        {data.attendance?.installed === false && <Label>Отметки посещения сейчас недоступны.</Label>}
        {data.attendance?.myAttendance && <AttendancePanel key={`${actor}:${gameId}:own`} row={data.attendance.myAttendance} gameId={gameId} own writes={data.attendance.writesEnabled} />}
        <Roster key={`${actor}:${gameId}:roster`} data={data} />
        <ClarificationSection key={`${actor}:${gameId}:clarify`} data={data} />
        {data.revisions && <View style={styles.card}><Label style={{fontWeight:'700'}}>История исхода</Label>{data.revisions.map(r=><View key={r.version}><Label>{r.after.value === 'held' ? 'Игра состоялась' : 'Игра не состоялась'} · {new Date(r.recordedAt).toLocaleString('ru')}</Label>{r.reason && <Label>{r.reason}</Label>}</View>)}
          {data.revisionsNextCursor && <TextButton title="Ещё изменения" onPress={()=>void owner.loadResults(gameId,{revisionsLimit:20,revisionsCursor:data.revisionsNextCursor ?? undefined},'revisions')} />}</View>}
      </>}
      {/* Peer feedback + own history: available when results denied but /me/reviews permits. */}
      {showFeedback ? <FeedbackSection key={`${actor}:${gameId}:feedback`} gameId={gameId} data={data} /> : null}
      {/* Own-note lane outside data&& when results denied but typed GET proves ownership. */}
      {showNotes ? <NotesSection key={`${actor}:${gameId}:notes`} gameId={gameId} data={data} /> : null}
      <SourceNotice title="Напоминания" status={s.reminders.status} retry={()=>void owner.loadReminders()} />
      {s.reminders.data?.items.filter(r=>r.gameId === gameId).map(r=><ReminderActions key={r.id} item={r} />)}
      <TextButton title="Обновить итоги" onPress={()=>void owner.loadResults(gameId)} />
    </>}
  </Page></PostgameSurface>;
}
