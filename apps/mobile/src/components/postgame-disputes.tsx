import { useEffect, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Platform, Switch, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useAuth } from '../auth.tsx';
import { attendanceHistoryLanes, attendanceLabel, mayAcknowledgeCurrent, normalizeFormReason } from '../postgame.ts';
import type { AttendanceDispute, AttendanceValue, Results } from '../postgame.ts';
import { AttendanceHistoryPanel, Choice, ReviewButton } from './postgame.tsx';
import { Label, Loading, TextButton, styles } from './ui.tsx';

function useOwner() {
  const owner = useAuth().postgame;
  return { owner, s: useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot) };
}
function useBlocked() {
  const { s } = useOwner();
  return !!(s.command || s.review);
}

function helpStatusLabel(detail: AttendanceDispute): string | null {
  if (!detail.helpProgress) return null;
  if (detail.caseProgress.linked) return 'Обращение принято в работу';
  if (detail.helpProgress === 'requested') return 'Запрос отправлен, ожидает приёма';
  return null;
}

function markLine(value: AttendanceValue, version: number, late?: boolean) {
  return `${attendanceLabel(value)}${late ? ' · Опоздание' : ''} · версия ${version}`;
}

function DisputeDetailPanel({ detail, writes, displayName }: { detail: AttendanceDispute; writes: boolean; displayName: string }) {
  const { owner, s } = useOwner();
  const blocked = useBlocked();
  const key = `${detail.gameId}:${detail.contextId}:${detail.id}`;
  const draft = s.drafts[key] ?? {};
  const respondText = draft.respondExplanation ?? '';
  const helpText = draft.helpExplanation ?? '';
  const correctionEnabled = !!draft.correctionEnabled;
  const correctionValue = draft.correctionValue ?? 'present';
  const correctionLate = !!draft.correctionLate;
  const correctionReason = draft.correctionReason ?? '';
  const help = helpStatusLabel(detail);
  return <View style={styles.card} accessibilityLabel={`Уточнение · ${displayName}`}>
    <Label style={{ fontWeight: '700' }}>Участник · {displayName}</Label>
    {detail.status === 'open' && <Label>На уточнении</Label>}
    <Label>Оспариваемая отметка: {detail.challengedAssertion
      ? markLine(detail.challengedAssertion.value, detail.challengedAssertion.version, detail.challengedAssertion.late)
      : detail.challengedVersion === 0 ? 'Отметки пока нет' : `версия ${detail.challengedVersion}`}</Label>
    <Label>Текущая отметка: {markLine(detail.currentAssertion.value, detail.currentAssertion.version, detail.currentAssertion.late)}</Label>
    <Label>Пояснение участника: {detail.explanation}</Label>
    {detail.latestManagerResponse ? <Label>Ответ организатора: {detail.latestManagerResponse}</Label> : null}
    {help ? <Label>{help}</Label> : null}
    {writes && mayAcknowledgeCurrent(detail) ? (
      <ReviewButton title="Проверить текущую отметку" onPress={() => owner.review({
        kind: 'ack', gameId: detail.gameId, contextId: detail.contextId,
        body: { attendanceVersion: detail.currentAssertion.version, resolvingDisputeId: detail.id, expectedDisputeVersion: detail.version },
      })} />
    ) : null}
    {writes && detail.allowedActions.canRespond ? <>
      <Label>Пояснение организатора</Label>
      <TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Пояснение организатора"
        value={respondText} onChangeText={text => owner.setDraft(detail.gameId, detail.contextId, detail.id, { respondExplanation: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 100, maxHeight: 180 }]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Label>Также исправить текущую отметку</Label>
        <Switch disabled={blocked} accessibilityLabel="Также исправить текущую отметку" value={correctionEnabled}
          onValueChange={value => owner.setDraft(detail.gameId, detail.contextId, detail.id, { correctionEnabled: value })} />
      </View>
      {correctionEnabled ? <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['present', 'absent', 'unknown'] as AttendanceValue[]).map(v =>
            <Choice key={v} title={attendanceLabel(v)} selected={correctionValue === v}
              onPress={() => owner.setDraft(detail.gameId, detail.contextId, detail.id, { correctionValue: v, ...(v !== 'present' ? { correctionLate: false } : {}) })} />)}
        </View>
        {correctionValue === 'present' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Label>Опоздание</Label>
          <Switch disabled={blocked} accessibilityLabel="Опоздание" value={correctionLate}
            onValueChange={value => owner.setDraft(detail.gameId, detail.contextId, detail.id, { correctionLate: value })} />
        </View> : null}
        <Label>Причина исправления</Label>
        <TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Причина исправления"
          value={correctionReason} onChangeText={text => owner.setDraft(detail.gameId, detail.contextId, detail.id, { correctionReason: text })}
          maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
          style={[styles.input, { minHeight: 80, maxHeight: 140 }]} />
        <Label>Уточнение останется открытым</Label>
      </> : null}
      <ReviewButton title="Ответить / исправить" onPress={() => {
        const explanation = normalizeFormReason(respondText);
        if (!explanation) return;
        const body: { expectedVersion: number; explanation: string; correction?: { expectedAttendanceVersion: number; value: AttendanceValue; late?: boolean; correctionReason: string } } = {
          expectedVersion: detail.version, explanation,
        };
        if (correctionEnabled) {
          const reason = normalizeFormReason(correctionReason);
          if (!reason) return;
          body.correction = {
            expectedAttendanceVersion: detail.currentAssertion.version,
            value: correctionValue,
            ...(correctionValue === 'present' ? { late: correctionLate } : {}),
            correctionReason: reason,
          };
        }
        owner.review({ kind: 'respond', gameId: detail.gameId, disputeId: detail.id, body });
      }} />
    </> : null}
    {writes && detail.allowedActions.canWithdraw ? <>
      <Label>Отзыв сохраняет текущую отметку и не записывает согласие участника с ней.</Label>
      <ReviewButton title="Отозвать возражение" onPress={() => owner.review({
        kind: 'withdraw', gameId: detail.gameId, disputeId: detail.id,
        body: { expectedVersion: detail.version },
      })} />
    </> : null}
    {writes && detail.allowedActions.canRequestHelp ? <>
      <Label>Пояснение для помощи</Label>
      <TextInput editable={!blocked} multiline scrollEnabled textAlignVertical="top" accessibilityLabel="Пояснение для помощи"
        value={helpText} onChangeText={text => owner.setDraft(detail.gameId, detail.contextId, detail.id, { helpExplanation: text })}
        maxLength={500} autoCorrect={Platform.OS === 'ios' ? false : undefined}
        style={[styles.input, { minHeight: 80, maxHeight: 140 }]} />
      <ReviewButton title="Помощь по уточнению" onPress={() => {
        const explanation = normalizeFormReason(helpText) || 'Нужна помощь по уточнению посещения.';
        owner.setDraft(detail.gameId, detail.contextId, detail.id, { helpExplanation: explanation });
        owner.review({ kind: 'help', gameId: detail.gameId, disputeId: detail.id, body: { expectedVersion: detail.version, explanation } });
      }} />
    </> : null}
  </View>;
}

export function ClarificationSection({
  data, sectionRef, onSectionLayout,
}: {
  data: Results;
  /** Content-relative onLayout anchor for results section=clarification reveal. */
  sectionRef?: RefObject<ComponentRef<typeof View> | null>;
  onSectionLayout?: (layoutY: number) => void;
}) {
  const { owner, s } = useOwner();
  const attendance = data.attendance;
  const installed = !!attendance?.installed;
  const openRows = installed && attendance ? [
    ...(attendance.roster ?? []).filter(r => r.dispute?.status === 'open'),
    ...(attendance.myAttendance?.dispute?.status === 'open' ? [attendance.myAttendance] : []),
  ] : [];
  const seen = new Set<string>();
  const opens = openRows.filter(r => { if (seen.has(r.contextId)) return false; seen.add(r.contextId); return true; });
  const selection = s.selection?.gameId === data.gameId ? s.selection : null;
  const selectedRow = selection ? opens.find(r => r.contextId === selection.contextId && r.dispute?.id === selection.disputeId) : null;
  const detailSource = selection ? s.disputes[selection.disputeId] : undefined;
  const writes = attendance?.writesEnabled ?? false;
  const onlyOpen = opens.length === 1 ? opens[0] : null;
  const historyLanes = attendanceHistoryLanes(data, selection);
  // Own card already exposes history; clarification lane covers manager/other selected contexts.
  const clarificationHistory = historyLanes.clarification
    && historyLanes.own?.contextId !== historyLanes.clarification.contextId
    ? historyLanes.clarification
    : null;
  const reportSectionLayout = (event: LayoutChangeEvent) => {
    onSectionLayout?.(event.nativeEvent.layout.y);
  };

  // Hooks must run before any conditional return (installed gate).
  useEffect(() => {
    if (!installed || selection || !onlyOpen) return;
    const dispute = onlyOpen.dispute;
    if (!dispute) return;
    owner.selectDispute({ gameId: data.gameId, contextId: onlyOpen.contextId, disputeId: dispute.id });
  }, [installed, selection, onlyOpen, data.gameId, owner]);

  if (!installed || !attendance) return null;

  return <View ref={sectionRef} collapsable={false} onLayout={reportSectionLayout} style={{ gap: 12 }} accessibilityLabel="Уточнение">
    <Label accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>Уточнение</Label>
    {opens.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Открытые уточнения">
      {opens.map(row => {
        const rowDispute = row.dispute;
        return rowDispute ? <Choice key={rowDispute.id}
          title={`${row.displayName}${selection?.disputeId === rowDispute.id ? ' · выбрано' : ''}`}
          selected={selection?.disputeId === rowDispute.id}
          onPress={() => owner.selectDispute({ gameId: data.gameId, contextId: row.contextId, disputeId: rowDispute.id })} /> : null;
      })}
    </View> : null}
    {selection && selectedRow ? <>
      {(detailSource?.status === 'idle' || detailSource?.status === 'loading') ? <Loading title="Загружаем уточнение…" /> : null}
      {(detailSource?.status === 'error' || detailSource?.status === 'unavailable') ? <View style={styles.card}>
        <Label>Не удалось загрузить уточнение</Label>
        <TextButton title="Повторить" onPress={() => void owner.loadDispute(selection.disputeId)} />
      </View> : null}
      {detailSource?.status === 'ready' && detailSource.data
        ? <DisputeDetailPanel detail={detailSource.data} writes={writes} displayName={selectedRow.displayName} />
        : null}
      {clarificationHistory
        ? <AttendanceHistoryPanel gameId={clarificationHistory.gameId} contextId={clarificationHistory.contextId} />
        : null}
    </> : null}
    {!selection && opens.length === 0
      ? <Label>Нет открытого уточнения по вашей отметке.</Label>
      : null}
  </View>;
}
