/* Additive adapter for the existing seven-stage monitor; no layout/CSS or new polling. */
'use strict';
window.GBTrainMonitor = {
  render: function (slot, parent, el, kv) {
    var a = slot.actions_train;
    if (!a) return;
    var model = a.model || {}, process = a.process;
    var last = a.last_confirmed_event ? new Date(a.last_confirmed_event * 1000).toISOString() : 'unknown';
    parent.appendChild(kv([
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

'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STAGES = ['Задача', 'Код', 'PR', 'QA', 'CI', 'DEV', 'Принято'];
  var CUR = { claimed: 1, developing: 1, candidate: 2, pr_wait: 2, integrating: 2, qa: 3, ci: 4, promoting: 5, dev_wait: 5, done: 6 };
  var PHASE_RU = { claimed: 'задача взята', developing: 'идёт разработка кода', candidate: 'код готов; подготовка публикации', pr_wait: 'код опубликован; ожидание PR',
    qa: 'независимая QA', ci: 'CI (проверки на GitHub)', integrating: 'интеграция с текущим DEV; новые QA и CI ожидаются', promoting: 'вливание в dev', dev_wait: 'выкладка на DEV, ждём приёмку',
    blocked: 'ЗАБЛОКИРОВАНО (держит слот)', parked: 'на паузе', done: 'готово' };
  var timer = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function chip(text, kind) { return el('span', 'chip ' + (kind || ''), text); }
  function sh(s) { return s ? s.slice(0, 8) : '—'; }
  function ago(sec) {
    if (sec == null) return 'неизвестно';
    if (sec < 60) return sec + ' с назад';
    if (sec < 3600) return Math.floor(sec / 60) + ' мин назад';
    if (sec < 86400) return Math.floor(sec / 3600) + ' ч ' + Math.floor(sec % 3600 / 60) + ' мин назад';
    return Math.floor(sec / 86400) + ' дн назад';
  }
  function kv(rows) {
    var dl = el('dl', 'kv');
    rows.forEach(function (r) { dl.appendChild(el('dt', null, r[0])); var dd = el('dd'); if (r[1] instanceof Node) dd.appendChild(r[1]); else dd.textContent = r[1]; dl.appendChild(dd); });
    return dl;
  }
  function steps(claim) {
    var ol = el('ol', 'steps'), ph = claim.phase, blocked = ph === 'blocked';
    var idx = blocked ? (claim.resume_phase && CUR[claim.resume_phase] != null ? CUR[claim.resume_phase] : -1) : (CUR[ph] != null ? CUR[ph] : -1);
    STAGES.forEach(function (s, i) {
      var c = '';
      if (idx >= 0) { if (i < idx || ph === 'done') c = 'done'; else if (i === idx) c = blocked ? 'fail' : 'cur'; }
      ol.appendChild(el('li', c, s));
    });
    return ol;
  }

  function nm(n, desc, fallbackTitle) {
    var t = (desc && desc.described && desc.title_ru) || fallbackTitle || (desc && desc.title_ru) || 'Задача #' + n + ' (описание не добавлено)';
    return '#' + n + ' ' + t;
  }
  function descLines(parent, desc) {
    if (!desc || !desc.described) return;
    if (desc.meaning_ru) parent.appendChild(el('div', 'mut', 'Суть: ' + desc.meaning_ru));
    if (desc.result_ru) parent.appendChild(el('div', 'mut', 'Результат: ' + desc.result_ru));
    if (desc.note_ru) parent.appendChild(el('div', 'mut', desc.note_ru));
  }

  function renderNow(d) {
    var s = clear($('now')), finished = d.claim && d.claim.phase === 'done';
    s.appendChild(el('h2', null, d.source_mode === 'slots' ? 'Состояние слотов' : (finished || !d.claim ? 'Состояние исполнителя' : 'Сейчас выполняется')));
    if (d.slots) {
      if (d.source_mode === 'legacy') s.appendChild(el('div', 'mut', 'Публикации слотов ещё не прошли проверку; показан legacy.'));
      d.slots.forEach(function (slot) {
        var b = el('div', 'item'), c = slot.claim;
        b.appendChild(el('div', 'big', slot.slot));
        var names = { FRESH: 'публикация свежая', STALE: 'данные устарели', MISSING: 'нет публикации',
          INVALID: 'публикация отклонена', ERROR: 'ошибка чтения', OWNER_UNKNOWN: 'владелец UNKNOWN' };
        b.appendChild(chip(names[slot.status] || 'UNKNOWN', slot.status === 'FRESH' ? 'info' : 'bad'));
        b.appendChild(el('div', 'mut', slot.note || 'UNKNOWN'));
        var proc = slot.process, live = slot.status === 'FRESH';
        b.appendChild(el('div', 'mut', proc ? 'Служба: ' + proc.active + ' / ' + proc.sub + ' · PID ' + proc.pid + (live ? '' : ' (последнее наблюдение)') : 'Состояние службы неизвестно'));
        if (c && c.phase === 'done') b.appendChild(el('div', 'mut', 'Активной задачи нет. Последний завершённый результат:'));
        if (c) {
          b.appendChild(el('div', 'big', nm(c.issue, c.desc)));
          descLines(b, c.desc);
          b.appendChild(chip(PHASE_RU[c.phase] || c.phase, c.phase === 'blocked' ? 'bad' : 'info'));
          b.appendChild(steps(c));
        } else b.appendChild(el('div', 'mut', live && proc && proc.active === 'active' ? 'Исполнитель запущен; активной задачи нет.' : 'Активная задача не подтверждена.'));
        b.appendChild(kv([['Попытка', c && c.attempt != null ? String(c.attempt) : 'UNKNOWN'],
          ['Коммит', c && c.head_sha ? sh(c.head_sha) : 'ещё не создан'],
          ['Запрошенная модель', c && c.requested_model ? c.requested_model + ' / ' + c.requested_effort : 'не указана'],
          ['QA', c && c.qa && c.qa.verdict ? c.qa.verdict + (c.qa.reviewed_sha ? ' (' + sh(c.qa.reviewed_sha) + ')' : '') : 'результат ещё не получен'],
          ['CI', c && c.ci ? c.ci.result + ' · ' + c.ci.passed + '/' + c.ci.total + ' (' + sh(c.ci.sha) + ')' : 'результат ещё не получен'],
          ['PR', c && c.pr ? '#' + c.pr : 'ещё не создан'],
          ['Изменение чекпоинта', slot.checkpoint_age_s != null ? ago(slot.checkpoint_age_s) : 'нет чекпоинта'],
          ['Публикация', slot.published_utc || 'UNKNOWN'], ['Возраст публикации', ago(slot.age_s)]]));
        if (window.GBTrainMonitor) window.GBTrainMonitor.render(slot, b, el, kv);
        s.appendChild(b);
      });
      if (d.source_mode === 'slots') return;
    }
    var c = d.claim;
    if (!c) {
      s.appendChild(el('div', 'big', d.source_ok === false ? 'Нет данных чекпоинта' : 'Исполнитель свободен'));
      s.appendChild(el('div', 'mut', d.source_ok === false ? (d.source_error || '') : 'Активной задачи нет.'));
      return;
    }
    if (finished) {
      s.appendChild(el('div', 'big', 'Активной задачи нет'));
      s.appendChild(el('div', 'mut', 'Ниже — результат последней завершённой задачи.'));
    }
    s.appendChild(el('div', 'big', c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || 'без названия')));
    descLines(s, c.desc);
    var kind = c.phase === 'blocked' ? 'bad' : 'info';
    s.appendChild(chip(PHASE_RU[c.phase] || c.phase, kind));
    s.appendChild(steps(c));
    var rows = [['Попытка', c.attempt != null ? c.attempt + ' из ' + (c.max_attempts || '?') : '—']];
    rows.push(['Исполнитель/модель', 'не подтверждено']);
    if (c.pr != null) rows.push(['PR', '#' + c.pr]);
    rows.push(['Коммит', sh(c.head_sha)]);
    if (c.qa && c.qa.verdict) rows.push(['QA', c.qa.verdict + (c.qa.reviewed_sha ? ' (' + sh(c.qa.reviewed_sha) + ')' : '')]);
    if (c.ci) rows.push(['CI', c.ci.total ? c.ci.passed + '/' + c.ci.total + ' ✓' + (c.ci.failed ? ', ошибок ' + c.ci.failed : '') + (c.ci.pending ? ', идут ' + c.ci.pending : '') : 'запущен, данных по задачам нет']);
    rows.push([finished ? 'Результат замечен монитором' : 'Состояние задачи не менялось', d.changed_utc ? ago(d.age_s != null ? Math.max(0, Math.floor((Date.parse(d.server_utc) - Date.parse(d.changed_utc)) / 1000)) : null) : 'не замечено с запуска монитора']);
    if (c.reason) rows.push(['Причина', c.reason]);
    s.appendChild(kv(rows));
  }

  var BL_KIND = { 'опубликована': 'info', 'ожидает': 'warn', 'припаркована': 'bad' };
  var BL_SHOW = 6;
  function blItem(x) {
    var b = el('div', 'item bl');
    var head = el('div', 'blhead');
    head.appendChild(el('span', 'blprio', x.priority != null ? String(x.priority) : '—'));
    var t = el('div', 'bltitle');
    t.appendChild(el('span', 'blid', x.id + (x.issue != null && x.id !== '#' + x.issue ? ' · #' + x.issue : '')));
    t.appendChild(document.createTextNode(' ' + (x.title_ru || '')));
    head.appendChild(t); b.appendChild(head);
    if (x.meaning_ru) b.appendChild(el('div', 'mut', x.meaning_ru));
    var m = el('div', 'blmeta'); m.appendChild(chip(x.status || '—', BL_KIND[x.status]));
    if (x.depends_on && x.depends_on.length) m.appendChild(el('span', 'mut', 'после: ' + x.depends_on.join(', ')));
    b.appendChild(m);
    if (x.note_ru) b.appendChild(el('div', 'mut', x.note_ru));
    return b;
  }
  function renderBacklog(d) {
    var s = clear($('backlog')), bl = d.backlog;
    if (!bl) return;
    var it = bl.items || [];
    s.appendChild(el('h2', null, 'Бэклог' + (bl.available ? ' (' + it.length + ')' : '')));
    if (!bl.available) { s.appendChild(el('div', 'mut', 'Бэклог недоступен: ' + (bl.note || 'нет данных') + '.')); return; }
    if (!it.length) { s.appendChild(el('div', 'mut', 'Запланированных задач нет.')); return; }
    s.appendChild(el('div', 'mut', 'В планах, ещё не взяты в работу. По приоритету: 1 — первой.'));
    it.slice(0, BL_SHOW).forEach(function (x) { s.appendChild(blItem(x)); });
    if (it.length > BL_SHOW) {
      var det = el('details', 'blmore'); det.appendChild(el('summary', null, 'Показать ещё ' + (it.length - BL_SHOW)));
      it.slice(BL_SHOW).forEach(function (x) { det.appendChild(blItem(x)); });
      s.appendChild(det);
    }
  }

  function renderInfra(d) {
    var s = clear($('infra')); s.appendChild(el('h2', null, 'Исполнитель и DEV'));
    var ex = d.executor || {}, dv = d.dev || {};
    var exKind = ex.running === true ? 'ok' : (ex.state === 'UNKNOWN' ? 'warn' : 'bad');
    var exTxt = ex.running === true ? 'работает' : (ex.state === 'UNKNOWN' ? 'статус неизвестен' : 'ОСТАНОВЛЕН (' + ex.state + ')');
    var rows = [['Исполнитель', chip(exTxt, exKind)]];
    if (dv.status === 'READABLE') {
      rows.push(['Принятый DEV SHA', sh(dv.source_sha) + (dv.release_id ? ' · ' + dv.release_id : '')]);
      rows.push(['Статус релиза', dv.accepted_status || '—']);
      rows.push(['Ожидает выкладки', dv.pending === true ? 'да' : (dv.pending === false ? 'нет' : '—')]);
    } else rows.push(['Квитанция DEV', 'недоступна']);
    if (d.done_count != null) rows.push([d.counts_complete === false ? 'Готово задач (из доступных публикаций)' : 'Готово задач (всего)', String(d.done_count)]);
    if (d.parked_count != null) rows.push(['Припарковано (уникальных ID)', String(d.parked_count)]);
    s.appendChild(kv(rows));
  }

  function renderPaused(d) {
    var s = clear($('paused')), items = [];
    var c = d.claim;
    if (c && c.phase === 'blocked') items.push({ n: c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || ''), desc: c.desc, reason: c.reason || 'причина не указана', attempt: c.attempt, max: c.max_attempts, action: 'Нужно решение Owner/OPS: заблокированная задача держит единственный слот.', succ: 'нет — слот занят' });
    (d.parked || []).forEach(function (p) { items.push({ n: nm(p.issue, p.desc), desc: p.desc, closed: p.closed === true, reason: p.reason, attempt: p.attempt, max: 3, action: p.closed === true ? 'Решение не нужно: Issue закрыт на GitHub.' : 'Нужно решение Owner: задача снята с очереди (PARK).', succ: p.has_successor === true ? 'разрешён' : (p.has_successor === false ? 'не разрешён' : 'не указано') }); });
    if (!items.length) return;
    s.appendChild(el('h2', null, 'На паузе / заблокировано'));
    items.forEach(function (i) {
      var b = el('div', 'item'); b.appendChild(el('div', 'big', i.n));
      if (i.closed) b.appendChild(chip('закрыта', 'ok'));
      descLines(b, i.desc);
      b.appendChild(kv([['Причина', i.reason], ['Попыток', i.attempt != null ? i.attempt + ' из ' + i.max : '—'], ['Преемник', i.succ], ['Действие Owner', i.action]]));
      s.appendChild(b);
    });
  }

  function renderNext(d) {
    var s = clear($('next')); s.appendChild(el('h2', null, 'Следующие задачи'));
    var q = d.queue || {}, qi = q.items || [];
    s.appendChild(el('div', 'mut', q.note || 'ожидает взятия исполнителем'));
    qi.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x)));
      descLines(b, x); s.appendChild(b); });
    if (!qi.length) s.appendChild(el('div', 'mut', 'Полный список открытых задач монитор не читает (нет доступа к GitHub); показаны только отмеченные вручную.'));
  }

  function renderDone(d) {
    var s = clear($('done')); s.appendChild(el('h2', null, 'Недавно завершено'));
    var r = d.recent_done || [];
    if (!r.length) { s.appendChild(el('div', 'mut', 'Журнал пуст: ведётся только с момента установки монитора.')); return; }
    r.forEach(function (x) {
      var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x.desc, x.title && x.title.indexOf('Задача #') !== 0 ? x.title : null)));
      descLines(b, x.desc);
      b.appendChild(el('div', 'mut', x.evidence + (x.source_sha ? ' · ' + sh(x.source_sha) : '') + (x.release_id ? '' : ' (подтверждения релиза нет)')));
      s.appendChild(b);
    });
  }

  function renderDoneAll(d) {
    var s = clear($('doneall')), a = d.done_all || [];
    if (!a.length) return;
    s.appendChild(el('h2', null, 'Все выполненные задачи (' + a.length + ')'));
    a.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x))); descLines(b, x); s.appendChild(b); });
  }

  function renderOutside(d) {
    var s = clear($('outside')), o = d.product_outside || [];
    if (!o.length) return;
    s.appendChild(el('h2', null, 'Вне исполнителя'));
    o.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, '#' + x.id + ' ' + x.title)); b.appendChild(chip(x.status)); s.appendChild(b); });
  }


  // gb-pipeline: textContent only; the snapshot API retains its PIN check.
  function renderPipeline(p) {
    var s = $('pipeline');
    if (!s) { s = el('section'); s.id = 'pipeline'; $('infra').parentNode.insertBefore(s, $('infra')); }
    clear(s); s.appendChild(el('h2', null, 'Конвейер'));
    if (!p || !p.available) { s.appendChild(el('div', 'mut', 'Статус конвейера недоступен.')); return; }
    if (p.stale) s.appendChild(chip('Данные устарели', 'warn'));
    var runs = p.runs || [];
    if (!runs.length) s.appendChild(el('div', 'mut', 'Активных запусков нет.'));
    function duration(v) { return v == null ? 'нет истории' : Math.round(v) + ' с'; }
    runs.forEach(function (r) {
      var b = el('div', 'item');
      b.appendChild(el('div', null, (r.kind === 'brief' ? 'Тело задачи: ' : 'Установщик: ') + r.name));
      b.appendChild(kv([['Этап', r.phase], ['Начало', r.start], ['Прошло', duration(r.elapsed_s)],
        ['ETA (медиана)', duration(r.eta_s)], ['Осталось по оценке', duration(r.remaining_s)]]));
      s.appendChild(b);
    });
  }

  function render(d) {
    renderPipeline(d.pipeline);
    var f = $('fresh'), bn = $('banner');
    var stale = d.available === false || d.stale;
    f.className = 'chip ' + (stale ? 'bad' : 'ok');
    f.textContent = d.available === false ? 'нет снимка' : (stale ? 'данные устарели: ' + ago(d.age_s) : 'Снимок обновлён · ' + ago(d.age_s));
    f.title = 'Свежесть отчёта не означает, что задача сейчас выполняется.';
    if (!stale && d.source_mode === 'slots') {
      f.className = 'chip warn';
      f.textContent = d.source_ok === false ? 'публикации слотов неполны или устарели' : 'телеметрия обновляется';
    }
    bn.hidden = true; bn.className = '';
    if (d.available === false) { bn.hidden = false; bn.textContent = 'Нет свежих данных: снимок недоступен. Писатель снимка остановлен или не установлен. Ниже — только пустые блоки.'; }
    else if (stale) { bn.hidden = false; bn.textContent = 'Нет свежих данных (' + ago(d.age_s) + '). Показано последнее известное состояние, ему нельзя доверять как текущему.'; }
    else if (d.source_mode === 'slots' && d.source_ok === false) { bn.hidden = false; bn.textContent = d.source_error || 'Статусы слотов недоступны.'; }
    else if (d.executor && d.executor.running === false) { bn.hidden = false; bn.className = 'warn'; bn.textContent = 'Исполнитель остановлен.'; }
    if (d.available === false) { ['now', 'backlog', 'infra', 'paused', 'done', 'doneall', 'outside'].forEach(function (k) { clear($(k)); }); renderNext({}); return; }
    var dim = stale ? 0.55 : 1; ['now', 'backlog', 'infra', 'paused', 'next', 'done', 'doneall', 'outside'].forEach(function (k) { $(k).style.opacity = dim; });
    renderNow(d); renderBacklog(d); renderInfra(d); renderPaused(d); renderNext(d); renderDone(d); renderDoneAll(d); renderOutside(d);
    $('updated').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU');
  }

  function show(which) { $('login').hidden = which !== 'login'; $('app').hidden = which !== 'app'; }

  function poll() {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(poll, 5000); return; }
    fetch('api/snapshot', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { show('login'); return null; }
      return r.json();
    }).then(function (d) { if (d) { show('app'); render(d); } timer = setTimeout(poll, 30000); })
      .catch(function () { var f = $('fresh'); f.className = 'chip bad'; f.textContent = 'нет связи'; $('banner').hidden = false; $('banner').textContent = 'Нет связи с монитором.'; show('app'); timer = setTimeout(poll, 30000); });
  }

  $('pinform').addEventListener('submit', function (e) {
    e.preventDefault(); var err = $('loginerr'); err.textContent = '';
    fetch('api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('pin').value }) })
      .then(function (r) { return r.json().then(function (j) { return [r.status, j]; }); })
      .then(function (x) {
        $('pin').value = '';
        if (x[0] === 200) poll();
        else if (x[0] === 429) err.textContent = 'Слишком много попыток. Подождите ' + Math.ceil((x[1].retry_after_s || 900) / 60) + ' мин.';
        else err.textContent = 'Неверный PIN.';
      }).catch(function () { err.textContent = 'Нет связи.'; });
  });
  $('logout').addEventListener('click', function () {
    fetch('api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () { show('login'); });
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  poll();
})();
