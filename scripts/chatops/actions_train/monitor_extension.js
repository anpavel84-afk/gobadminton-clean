/* Additive adapter for the existing seven-stage monitor; no layout/CSS or new polling. */
'use strict';
window.GBTrainMonitor = {
  render: function (slot, parent, el, kv) {
    var a = slot.actions_train;
    if (!a) return;
    var model = a.model || {}, process = a.process;
    var last = a.last_confirmed_event ? new Date(a.last_confirmed_event * 1000).toISOString() : 'unknown';
    parent.appendChild(kv([
      ['Failure loop', (a.failure_loop || {}).status || 'not_applicable'],
      ['Failure / brief hash', ((a.failure_loop || {}).failure_fingerprint || 'none') + ' / ' + ((a.failure_loop || {}).brief_hash || 'none')],
      ['Actions stage', (a.operation || 'not_started') + ' / ' + a.status],
      ['Workflow', a.workflow_run ? String(a.workflow_run) + ' attempt ' + a.workflow_attempt : 'not_started'],
      ['CLI process', process ? 'PID ' + process.pid + ' / start ' + process.start + (a.status === 'stale' ? ' (last observation)' : '') : 'not_started'],
      ['Provider / role', model.provider ? model.provider + ' / ' + model.role : 'unknown'],
      ['Requested / effective model', (model.requested_model || 'default') + ' / ' + (model.effective_model || 'unknown')],
      ['Effort requested / effective', (model.requested_effort || model.effort || 'unknown') + ' / ' + (model.effective_effort || model.effort || 'unknown')],
      ['Stage complexity', model.stage_complexity || 'legacy immutable'],
      ['Selection reason', model.selection_reason || 'not recorded'],
      ['Escalation', model.escalation_reason || 'none'],
      ['Cost diagnostic', model.expense_diagnostic || 'none'],
      ['Measured calls / tokens', model.usage ? String(model.usage.charged_calls) + ' / ' + (model.usage.tokens === null ? 'unavailable' : String(model.usage.tokens)) : 'not recorded'],
      ['Fallback', model.fallback_reason || 'not_applicable'],
      ['Last CONFIRMED event', last],
      ['Wait reason', a.wait_reason || 'not_applicable']
    ]));
  }
};
