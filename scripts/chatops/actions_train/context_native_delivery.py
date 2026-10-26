"""Cursor and Antigravity rules delivery. Scoped profile is not qualified.

Stage 5 §10.9 first step is offline only. This module is the fail-closed gate
for a future opt-in. It does not select scoped_v1, does not read a recipient
workspace, and does not change the installed Codex pin inside context_policy.

A requested scoped_v1 profile falls back to the exact full inject payload when
the recipient's verified_access is not confirmed, and also when it is confirmed:
qualification of Cursor/AGY scoped delivery is a separate decision. The probe
cannot authorize a shorter rules text.
"""
import copy
import hashlib

from context_policy import inject
from core import need

PROVIDERS = frozenset(('cursor', 'agy'))
OPERATIONAL_ROLES = frozenset(('analyst', 'independent_qa'))
# There is no reviewed qualification that turns scoped_v1 on for these providers.
SCOPED_QUALIFIED = False


def _confirmed(verified_access, reference):
    if verified_access is None:
        return False
    try:
        return verified_access(copy.deepcopy(reference)) is True
    except Exception:
        return False


def cursor_agy_context(prompt, qa, cwd, accepted, *, provider, operational_role,
                      requested_profile='full', full_rules_reference=None,
                      verified_access=None, scoped_guidance=''):
    """Return the lossless full rules payload for Cursor or Antigravity.

    operational_role is analyst or independent_qa. The wire role stays the
    read-only QA channel already used by the native AGY adapter. This function
    does not relabel technical_pm_product_analyst and does not compile a capsule.
    scoped_guidance is ignored: a fallback must not change the full wire text.
    """
    need(provider in PROVIDERS, 'unsupported native context provider')
    need(operational_role in OPERATIONAL_ROLES, 'unsupported native context role')
    need(requested_profile in ('full', 'scoped_v1'), 'unknown context profile')
    need(qa is True, 'cursor/agy rules gate is read-only')
    need(SCOPED_QUALIFIED is False, 'cursor/agy scoped qualification is not enabled')
    confirmed = False
    if requested_profile == 'scoped_v1':
        confirmed = _confirmed(verified_access, full_rules_reference)
    # Always the legacy full profile. Do not pass context_profile='scoped_v1'.
    payload, receipt = inject(prompt, True, cwd, accepted, role='qa', context_profile='full')
    text, _metadata = accepted
    need(text in payload, 'native context lost full rules')
    need('CONTEXT_PROFILE scoped_v1' not in payload, 'native context silently selected scoped_v1')
    need(receipt['context_metrics']['policy_profile'] == 'full', 'native context profile drifted')
    need(receipt['context_metrics']['delivered_policy_bytes'] == receipt['context_metrics']['full_rules_bytes'],
         'native context delivered fewer rules bytes than the full canon pin')
    metrics = dict(receipt['context_metrics'])
    metrics['requested_profile'] = requested_profile
    metrics['effective_profile'] = 'full'
    metrics['provider'] = provider
    metrics['operational_role'] = operational_role
    metrics['scoped_qualified'] = False
    metrics['verified_access_confirmed'] = confirmed
    metrics['token_accounting'] = 'not_exposed'
    if requested_profile == 'scoped_v1':
        metrics['fallback_reason'] = ('RECIPIENT_RULES_ACCESS_UNVERIFIED' if not confirmed
                                      else 'CURSOR_AGY_SCOPED_NOT_QUALIFIED')
    else:
        metrics['fallback_reason'] = None
    receipt = dict(receipt, provider=provider, operational_role=operational_role,
                   context_metrics=metrics)
    need(receipt['stdin_sha256'] == hashlib.sha256(payload.encode('utf-8')).hexdigest(),
         'native context stdin hash drift')
    # scoped_guidance is accepted so a caller can pass the same keyword as inject.
    # It is not concatenated. The returned payload is inject(..., context_profile='full').
    return payload, _ignore_scoped_guidance(scoped_guidance, receipt)


def _ignore_scoped_guidance(scoped_guidance, receipt):
    if not isinstance(scoped_guidance, str):
        raise ValueError('scoped guidance must be text')
    return receipt
