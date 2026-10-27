"""Bounded opt-in SR integration; no provider, publication or authority writes.

GB_SMART_STAGE_V1 extends only the existing routing_policy slot. It supports
preplanned source tasks and role floors, not automatic planner/triage or Fast
Fix dispatch. SR1 decisions remain shadow proposals. Legacy cost V1/V2 and #218
are unchanged. Qualification is still checked by the existing native resolver.
"""
import copy
import re

import smart_routing as sr

SCHEMA = 'GB_SMART_STAGE_V1'
SOL_MEDIUM = 'codex:gpt-6.1-sol:medium'
SOL_HIGH = 'codex:gpt-6.1-sol:high'
AGY_MEDIUM = 'agy:claude-sonnet-5-5-medium'
AGY_HIGH = 'agy:claude-sonnet-5-5-high'
LEVELS = frozenset(('simple', 'standard', 'complex'))
REASONS = frozenset(('bounded_docs', 'standard_ui', 'standard_api', 'complex_logic'))


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def selected(task):
    return (type(task) is dict and type(task.get('routing_policy')) is dict
            and task['routing_policy'].get('schema') == SCHEMA)


def task_fingerprint(task):
    """Hash task inputs and accepted routing revision, excluding the plan's self-hash."""
    from core import digest
    from context_policy import ROUTING_COMMIT, ROUTING_SHA256, ROUTING_SIZE
    view = copy.deepcopy(task)
    view['routing_policy'].pop('plan', None)
    return digest(dict(task=view, accepted_routing=dict(commit=ROUTING_COMMIT,
                  sha256=ROUTING_SHA256, bytes=ROUTING_SIZE)))


def operation(task, stage, *, facts=None):
    """Classify structured effects, never log words or a model's assurances.

    Facts are internal controller observations, not new admission/wire fields.
    No classification grants the ability to execute privileged operations.
    """
    def result(klass, reason):
        return dict(operation_class=klass, operation_reason=reason)
    if facts is not None:
        if (type(facts) is not dict or set(facts) != {'category'}
                or type(facts['category']) is not str):
            return result('unknown', 'HOLD_INVALID_OPERATION_FACTS')
        category = facts['category']
        if category in ('platform_refusal', 'model_auth', 'permission_denial'):
            return result('refusal', 'HOLD_' + category.upper())
        if category == 'unknown_effect':
            return result('unknown', 'HOLD_UNKNOWN_EFFECT_RECONCILE')
        if category != 'none':
            return result('unknown', 'HOLD_INVALID_OPERATION_FACTS')
    if type(task) is not dict:
        return result('unknown', 'HOLD_INVALID_TASK')
    kind = task.get('kind')
    if kind in ('guarded_ops', 'admin_auth', 'trusted_publication'):
        return result(kind, 'HOLD_SEPARATE_TRUSTED_AUTHORITY_REQUIRED')
    if kind != 'source_only' or task.get('target') != 'dev':
        return result('unknown', 'HOLD_UNSUPPORTED_TASK_KIND')
    paths = task.get('allowed_paths')
    if type(paths) is not list or not 1 <= len(paths) <= 32:
        return result('unknown', 'HOLD_INVALID_SOURCE_SCOPE')
    for path in paths:
        if type(path) is not str:
            return result('unknown', 'HOLD_INVALID_SOURCE_SCOPE')
        bare = path[:-3] if path.endswith('/**') else path
        if (not re.fullmatch(r'[A-Za-z0-9_./\[\]-]+', bare)
                or any(p in ('', '.', '..') for p in bare.split('/'))):
            return result('unknown', 'HOLD_INVALID_SOURCE_SCOPE')
        parts = bare.lower().split('/')
        if (parts[0] in ('etc', 'srv', 'var') or parts[0] == '.github'):
            return result('guarded_ops', 'HOLD_PRIVILEGED_WRITER_UNSUPPORTED')
        if (bare.startswith(('docs/rules/', 'docs/decisions/', 'docs/manifest/', 'docs/governance/'))
                or any(p in ('agents.md', 'credentials', 'secrets') for p in parts)
                or bare.endswith(('.pem', '.key'))):
            return result('admin_auth', 'HOLD_ADMIN_AUTH_WRITER_UNSUPPORTED')
        if parts[0] not in ('apps', 'packages', 'docs'):
            # Controller source is source work, but the frozen publisher does
            # not admit it. Do not turn this gap into model root/Git powers.
            return result('source', 'HOLD_SOURCE_SCOPE_REQUIRES_TRUSTED_PUBLISHER')
    if stage in ('claim', 'author'):
        return result('source', 'SOURCE_ONLY_WITHIN_EXISTING_ADMISSION')
    if stage in ('qa', 'failure_diagnosis'):
        return result('independent_qa', 'FRESH_READ_ONLY_ROLE_REQUIRED')
    if stage in ('publish', 'integrate', 'promote', 'ci', 'dev'):
        return result('trusted_publication', 'EXISTING_BRIDGE_GATES_REQUIRED')
    return result('unknown', 'HOLD_UNSUPPORTED_STAGE')


def risk_floor(task):
    """Conservative source-boundary floor; uncertainty never enables a writer."""
    if task.get('risk') == 'critical' or task.get('work_kind') == 'architecture':
        return 'critical'
    sensitive = re.compile(r'auth|identity|permission|credential|secret|sandbox|guard|'
                           r'budget|admission|concurren|payment|billing|migration|rollback', re.I)
    if any(sensitive.search(path) for path in task['allowed_paths']):
        return 'critical'
    return task.get('risk')


def allowed_routes(role, level):
    if role == 'author':
        return ({'cursor:auto', SOL_HIGH} if level == 'complex' else
                {'cursor:auto', SOL_MEDIUM} | ({'codex:gpt-6-luna:medium'} if level == 'simple' else set()))
    return {AGY_HIGH, SOL_HIGH} if level == 'complex' else {AGY_MEDIUM, SOL_MEDIUM}


def validate_policy(task):
    from context_policy import RULES_COMMIT, RULES_SHA256
    p = task.get('routing_policy')
    require(type(p) is dict and set(p) == {'schema', 'author', 'qa', 'plan'}
            and p['schema'] == SCHEMA, 'invalid smart stage policy')
    require(all(k in task for k in ('author_routes', 'qa_routes', 'work_kind', 'risk'))
            and 'model' not in task and 'effort' not in task, 'smart stage requires explicit role routes')
    op = operation(task, 'claim')
    require(not op['operation_reason'].startswith('HOLD_'), op['operation_reason'])
    require(task['work_kind'] in ('architecture', 'implementation', 'ux', 'contract', 'test')
            and task['risk'] in ('routine', 'complex', 'critical'), 'invalid smart stage metadata')
    require(risk_floor(task) != 'critical', 'HOLD_CRITICAL_EXPERT_AND_EXACT_QA_PROOF_REQUIRED')
    for role in ('author', 'qa'):
        row = p[role]
        require(type(row) is dict and set(row) == {'complexity', 'reason', 'evidence'},
                'invalid smart stage classification')
        level, reason, evidence = row['complexity'], row['reason'], row['evidence']
        require(type(level) is str and level in LEVELS and type(reason) is str and reason in REASONS,
                'HOLD_UNSUPPORTED_SMART_ROLE_CLASS')
        require(type(evidence) is str and 1 <= len(evidence.strip()) <= 1200
                and all(c.isprintable() for c in evidence), 'smart stage evidence required')
        require(level != 'simple' or reason == 'bounded_docs', 'mechanical class requires bounded evidence')
        require(level != 'complex' or reason == 'complex_logic', 'complex class requires complex route reason')
        routes = task[role + '_routes']
        require(type(routes) is list and 1 <= len(routes) <= 4
                and all(type(r) is str and r in allowed_routes(role, level) for r in routes)
                and len(set(routes)) == len(routes), 'smart role/risk capability floor violated')
    plan = p['plan']
    error = sr.validate_plan(plan)
    require(error is None, 'invalid SR1 plan: ' + str(error))
    require(plan['executable'] is True and not plan['fast_fix']
            and plan['planner_calls'] == plan['astra_calls'] == 0,
            'HOLD_AUTOMATIC_PLANNING_FAST_FIX_NOT_IMPLEMENTED')
    require(set(plan['effects']) == {'source_edit_within_scope'} and len(plan['effects']) == 1,
            'HOLD_UNSUPPORTED_PLAN_EFFECT')
    for role in ('author', 'qa'):
        require(plan[role + '_route'] == task[role + '_routes'][0], 'plan route differs from admission')
    actual_models = {r.split(':')[1] for r in (plan['author_route'], plan['qa_route'])
                     if not r.startswith('cursor:')}
    require(set(plan['model_ids']) <= actual_models, 'plan model IDs differ from admitted roles')
    # A valid proposal is not evidence that a planner ran or that a role is
    # qualified. Input hashes bind it to this Owner admission, never vice versa.
    require(plan['binding']['task_sha'] == task_fingerprint(task)
            and plan['binding']['rules_commit'] == RULES_COMMIT
            and plan['binding']['rules_sha256'] == RULES_SHA256, 'stale smart plan inputs')
    from failure_diagnosis import policy
    try:
        policy(task)  # No new FAIL shortcut; #218 remains mandatory in this slice.
    except Exception as error:
        raise ValueError('smart stage requires existing #218 diagnosis admission') from error
    return p


def selection(task, role):
    from core import digest
    p = validate_policy(task)
    require(role in ('author', 'qa'), 'unsupported smart role')
    routes = task[role + '_routes']
    return routes[0], dict(approved_fallback_routes=routes[1:], policy=SCHEMA,
        stage_complexity=p[role]['complexity'], selection_reason=p[role]['reason'],
        selection_evidence=p[role]['evidence'], escalation_reason=None,
        expense_diagnostic=None, risk_is_not_complexity=True,
        plan_input_sha256=p['plan']['binding']['task_sha'],
        plan_sha256=digest(p['plan']), plan_operation_id=p['plan']['binding']['operation_id'],
        plan_head=p['plan']['binding']['head'], decision_source='immutable_admitted_SR1_plan',
        **operation(task, 'author' if role == 'author' else 'qa'))


def dispatch_gate(task, stage, active=None, *, facts=None):
    if not selected(task):
        return None  # Preserve all immutable legacy semantics.
    p = validate_policy(task)
    op = operation(task, stage, facts=facts)
    require(not op['operation_reason'].startswith('HOLD_'), op['operation_reason'])
    if active is not None:
        require(active.get('base') == p['plan']['binding']['head'],
                'HOLD_SOURCE_BASE_CHANGED_REPLAN_REQUIRED')
        if stage == 'author' and active.get('phase') == 'claimed':
            require(active.get('head') in (None, p['plan']['binding']['head']),
                    'HOLD_SOURCE_HEAD_CHANGED_REPLAN_REQUIRED')
    return op


def shadow(case, plan):
    """Use the SR1 interfaces without turning a synthetic decision into dispatch."""
    error = sr.validate_plan(plan)
    require(error is None, 'invalid SR1 plan: ' + str(error))
    value = copy.deepcopy(case)
    require(type(value) is dict and type(value.get('evidence')) is dict, 'invalid shadow case')
    value['evidence']['plan'] = copy.deepcopy(plan)
    decision = sr.decide(value)
    return dict(schema='GB_SMART_STAGE_SHADOW_V1', proposed=decision,
                dispatch_allowed=False, model_calls=0, tokens=None,
                reason='SHADOW_ONLY_NOT_ADMISSION')
