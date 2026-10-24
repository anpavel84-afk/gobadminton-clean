/* Additive adapter for the existing seven-stage monitor; no layout/CSS or new polling. */
'use strict';
window.GBTrainMonitor = {
  render: function (slot, parent, el, kv) {
    var a = slot.actions_train;
    if (!a) return;
    var model = a.model || {}, process = a.process;
    var T = { not_applicable: '—', none: 'нет', not_started: 'не запущено', unknown: 'неизвестно', 'not recorded': 'не записано',
      stale: 'давно не обновлялось', running: 'выполняется', waiting: 'ожидание', confirmed: 'подтверждено', error: 'ошибка', unavailable: 'недоступно' };
    function t(v) { return Object.prototype.hasOwnProperty.call(T, v) ? T[v] : v; }
    var last = a.last_confirmed_event ? new Date(a.last_confirmed_event * 1000).toISOString() : 'unknown';
    parent.appendChild(kv([
      ['Цикл починки', t((a.failure_loop || {}).status || 'not_applicable')],
      ['Отпечаток сбоя / бриф', ((a.failure_loop || {}).failure_fingerprint || 'нет') + ' / ' + ((a.failure_loop || {}).brief_hash || 'нет')],
      ['Этап в Actions', t(a.operation || 'not_started') + ' / ' + t(a.status) + (a.status === 'stale' ? ' (контроллер публикует этап только при событиях конвейера)' : '')],
      ['Запуск workflow', a.workflow_run ? String(a.workflow_run) + ', попытка ' + a.workflow_attempt : 'не запущено'],
      ['Процесс CLI', process ? 'PID ' + process.pid + ', старт ' + process.start + (a.status === 'stale' ? ' (последнее наблюдение)' : '') : 'не запущено'],
      ['Провайдер / роль', model.provider ? model.provider + ' / ' + model.role : 'неизвестно'],
      ['Модель: запрошена / фактическая', (model.requested_model || 'по умолчанию') + ' / ' + (model.effective_model || 'неизвестно')],
      ['Усилие: запрошено / фактическое', (model.requested_effort || model.effort || 'неизвестно') + ' / ' + (model.effective_effort || model.effort || 'неизвестно')],
      ['Сложность этапа', model.stage_complexity || 'как раньше (без изменений)'],
      ['Причина выбора модели', t(model.selection_reason || 'not recorded')],
      ['Эскалация', t(model.escalation_reason || 'none')],
      ['Диагностика затрат', t(model.expense_diagnostic || 'none')],
      ['Вызовы / токены', model.usage ? String(model.usage.charged_calls) + ' / ' + (model.usage.tokens === null ? 'недоступно' : String(model.usage.tokens)) : 'не записано'],
      ['Запасной вариант', t(model.fallback_reason || 'not_applicable')],
      ['Последнее подтверждённое событие', last === 'unknown' ? 'неизвестно' : last],
      ['Причина ожидания', t(a.wait_reason || 'not_applicable')]
    ]));
  }
};
