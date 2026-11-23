import { useEffect, useSyncExternalStore } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useAuth } from '../auth.tsx';
import { normalizeFormReason, notesSectionVisible } from '../postgame.ts';
import type { PersonalNote, Results } from '../postgame.ts';
import { Choice, ReviewButton } from './postgame.tsx';
import { Label, Loading, TextButton, styles } from './ui.tsx';

export { notesSectionVisible };

function useOwner() {
  const owner = useAuth().postgame;
  return { owner, s: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
function useBlocked() {
  const { s } = useOwner();
  return !!(s.command || s.review);
}

function collectNotes(gameId: string, data: Results | undefined, notes: Record<string, { status: string; data?: PersonalNote }>, known: Record<string, { gameId: string; contextId: string }>): PersonalNote[] {
  const byContext = new Map<string, PersonalNote>();
  for (const note of data?.feedback?.myNotes ?? []) {
    const direct = notes[`${gameId}:${note.contextId}`];
    // Definitive unavailable/denied shadows stale bounded myNotes for that context.
    if (direct?.status === 'unavailable') continue;
    byContext.set(note.contextId, note);
  }
  for (const ref of Object.values(known)) {
    if (ref.gameId !== gameId) continue;
    const source = notes[`${ref.gameId}:${ref.contextId}`];
    if (source?.status === 'ready' && source.data) byContext.set(source.data.contextId, source.data);
  }
  return [...byContext.values()];
}

function NoteCard({ gameId, note, writes }: { gameId: string; note: PersonalNote; writes: boolean }) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const key = `${gameId}:${note.contextId}`;
  const draft = s.noteDrafts[key] ?? {};
  const editing = draft.editText !== undefined && note.allowedActions.canEdit;
  const editText = draft.editText ?? note.text;
  const trimmed = normalizeFormReason(editText);
  const needsRefresh = !!(s.notice && /Обновите заметку/i.test(s.notice));
  return <View style={styles.card} accessibilityLabel={`Заметка · ${note.subjectDisplay}`}>
    <Label style={{ fontWeight: '700' }}>{note.subjectDisplay}</Label>
    {editing ? <>
      <Label>Текст заметки</Label>
      <TextInput editable={!blocked && writes} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel={`Текст заметки · ${note.subjectDisplay}`}
        value={editText} onChangeText={text => owner.setNoteDraft(gameId, note.contextId, { editText: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 100, maxHeight: 180 }]} />
      {needsRefresh ? <TextButton title="Обновить заметку" onPress={() => void owner.loadNote(gameId, note.contextId)} /> : null}
      <ReviewButton title={`Сохранить изменения · ${note.subjectDisplay}`} onPress={() => {
        if (!trimmed) return;
        owner.review({ kind: 'note-upsert', gameId, contextId: note.contextId, body: { expectedVersion: note.version, text: trimmed } });
      }} />
      <TextButton title="Отмена" onPress={() => owner.setNoteDraft(gameId, note.contextId, { editText: undefined })} />
    </> : <Label>{note.text}</Label>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {writes && note.allowedActions.canEdit && !editing ? (
        <ReviewButton title={`Изменить · ${note.subjectDisplay}`} onPress={() => owner.setNoteDraft(gameId, note.contextId, { editText: note.text })} />
      ) : null}
      {writes && note.allowedActions.canDelete ? (
        <ReviewButton title={`Удалить · ${note.subjectDisplay}`} onPress={() => owner.review({
          kind: 'note-delete', gameId, contextId: note.contextId, body: { expectedVersion: note.version },
        })} />
      ) : null}
    </View>
  </View>;
}

/**
 * Private personal notes after attendance/clarification.
 * Own-note lane can render when results are denied but a known typed GET is ready.
 */
export function NotesSection({ gameId, data }: { gameId: string; data?: Results }) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const feedback = data?.feedback;
  const installed = feedback?.installed !== false;
  const writes = !!(feedback?.installed && feedback.writesEnabled);
  const canCreate = !!(feedback?.capabilities.canCreateNote && writes);
  const list = collectNotes(gameId, data, s.notes, s.knownNoteRefs);
  const visible = notesSectionVisible(gameId, data, s.notes, s.knownNoteRefs);
  const createDraft = s.noteDrafts[gameId] ?? {};
  const selectedId = createDraft.selectedContextId ?? '';
  const createText = createDraft.createText ?? '';
  const createTrimmed = normalizeFormReason(createText);
  const subjects = feedback?.capabilities.peerSubjects?.length
    ? feedback.capabilities.peerSubjects
    : (data?.attendance?.roster ?? []).map(r => ({ contextId: r.contextId, displayName: r.displayName }));
  const selectedKey = selectedId ? `${gameId}:${selectedId}` : '';
  const selectedSource = selectedKey ? s.notes[selectedKey] : undefined;
  const selectedExisting = selectedSource?.status === 'ready' ? selectedSource.data : undefined;
  const selectedAbsent = selectedSource?.status === 'unavailable';
  const selectedLoading = selectedSource?.status === 'loading' || selectedSource?.status === 'idle';
  const selectedError = selectedSource?.status === 'error';
  const canSubmitSelected = !!selectedId && !!createTrimmed && (selectedAbsent || !!selectedExisting);
  const needsSelectedRefresh = !!(s.notice && /Обновите заметку/i.test(s.notice) && selectedId);

  useEffect(() => {
    // Recover known own notes via direct GET when results denied or list incomplete.
    // Error stays user-retry only — do not auto-loop loadNote on persistent failure.
    for (const ref of Object.values(s.knownNoteRefs)) {
      if (ref.gameId !== gameId) continue;
      const key = `${ref.gameId}:${ref.contextId}`;
      const source = s.notes[key];
      if (!source || source.status === 'idle') void owner.loadNote(ref.gameId, ref.contextId);
    }
  }, [gameId, owner, s.knownNoteRefs, s.notes]);

  if (!visible || !installed) {
    if (feedback && feedback.installed === false) {
      return <View style={styles.card}><Label style={{ fontWeight: '700' }}>Заметки</Label><Label>Личные заметки на этом сервере недоступны.</Label></View>;
    }
    return null;
  }

  const knownErrors = Object.values(s.knownNoteRefs).filter(ref => {
    if (ref.gameId !== gameId) return false;
    const source = s.notes[`${ref.gameId}:${ref.contextId}`];
    return source?.status === 'error';
  });

  return <View style={{ gap: 12 }}>
    <Label style={{ fontSize: 20, fontWeight: '700' }}>Заметки</Label>
    <Label>Личная заметка видна только вам. Это не отзыв и не жалоба.</Label>
    {knownErrors.map(ref => (
      <View key={ref.contextId} style={styles.card}>
        <Label>Не удалось прочитать заметку.</Label>
        <TextButton title="Повторить" onPress={() => void owner.loadNote(ref.gameId, ref.contextId)} />
      </View>
    ))}
    {Object.values(s.knownNoteRefs).some(ref => ref.gameId === gameId && s.notes[`${ref.gameId}:${ref.contextId}`]?.status === 'loading')
      ? <Loading title="Загружаем заметку…" /> : null}
    {canCreate ? <View style={styles.card}>
      <Label>Участник</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Choice title="Выберите" selected={!selectedId} onPress={() => owner.setNoteDraft(gameId, null, { selectedContextId: '', createText: '' })} />
        {subjects.map(subject => (
          <Choice key={subject.contextId} title={subject.displayName} selected={selectedId === subject.contextId}
            onPress={() => owner.setNoteDraft(gameId, null, { selectedContextId: subject.contextId })} />
        ))}
      </View>
      {selectedId && selectedLoading ? <Loading title="Загружаем заметку…" /> : null}
      {selectedId && selectedError ? <>
        <Label>Не удалось прочитать заметку.</Label>
        <TextButton title="Обновить заметку" onPress={() => void owner.loadNote(gameId, selectedId)} />
      </> : null}
      {needsSelectedRefresh ? <TextButton title="Обновить заметку" onPress={() => void owner.loadNote(gameId, selectedId)} /> : null}
      <Label>Текст заметки</Label>
      <TextInput editable={!blocked && writes} multiline scrollEnabled textAlignVertical="top"
        accessibilityLabel={selectedId ? `Текст заметки · ${subjects.find(subject => subject.contextId === selectedId)?.displayName ?? 'участник'}` : 'Текст заметки'}
        value={createText} onChangeText={text => owner.setNoteDraft(gameId, null, { createText: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 100, maxHeight: 180 }]} />
      <ReviewButton title={selectedExisting ? `Сохранить заметку · ${selectedExisting.subjectDisplay}` : 'Сохранить заметку'} onPress={() => {
        if (!canSubmitSelected || !selectedId) return;
        owner.review({
          kind: 'note-upsert', gameId, contextId: selectedId,
          body: { expectedVersion: selectedExisting ? selectedExisting.version : 0, text: createTrimmed },
        });
      }} />
    </View> : null}
    {list.map(note => <NoteCard key={note.contextId} gameId={gameId} note={note} writes={writes || note.allowedActions.canEdit || note.allowedActions.canDelete} />)}
  </View>;
}
