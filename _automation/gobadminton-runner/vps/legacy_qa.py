"""Read-only, enumerated historical dependency attestations. No schema coercion.

This never supplies source merge/rebinding/new-QA acceptance. An independently
reviewed NON-PROD bootstrap and established reconciler trust are mandatory.
It creates no files, refreshes no refs and rewrites no original receipts.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

MANIFEST_PATH = '_automation/gobadminton-runner/vps/legacy_qa_attestations_v001.json'
# Filled from the reviewed author manifest; changing any row is a new candidate.
MANIFEST_SHA256 = 'bf17b67772e22e9f9330a546ef3c605c37cebeb02ebb433de697106ad4fbb4d2'
LEGACY_TASK_IDS = frozenset({
    'qa-fb01-city-visual-v001', 'qa-fb01-game-api-backend-20261008-v001',
    'qa-fb01-logo-edge-v001', 'qa-fb01-review-city-v001', 'qa-fb01-review-design-v001',
    'qa-fb01-review-game-v001', 'qa-fb01-review-media-v001', 'qa-fb01-review-messaging-v001',
    'qa-fb01-thread-return-v001', 'qa-owner-messaging-registration-default-v001',
    'qa-radar-distance-unified-directory-contract-20261008-v001',
    'qa-radar-g1-current-main-integration-20261008-v001',
    'qa-radar-map-asset-readiness-20261008-v001', 'qa-radar-unified-distance-api-20261008-v001',
    'qa-runner-scoped-locks-20261008-v001', 'qa-rv3-moscow-map-assets-v001',
    'qa-rv3-players-map-frontend-v001', 'qa-venue-a1a-consumer-search-select-v001',
})
PASS = {'PASS', 'PASS_WITH_NONBLOCKING_GAPS'}
TERMINAL_FAILURE = {'qa_failed', 'qa_blocked'}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def definition_digest(task):
    return digest(json.dumps(task, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=False).encode())


def _sha(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{40}', value)


def _safe_path(value):
    return (isinstance(value, str) and value.startswith('docs/') and
            all(x not in {'', '.', '..'} for x in value.split('/')) and
            re.fullmatch('[A-Za-z0-9_./-]+', value))


def accepted(runner, q, st, dep_id, consumer):
    """Only exact frozen dependency edges can consume an attestation.

    Default caller without a consumer fails closed, deliberately keeping
    publication_guard, autopilot merges and replacement QA strict.
    """
    if consumer is None:
        return False
    try:
        import backlog_sync
        backlog_sync.validate_history(st.get('history'))
        lookup = runner._v2_task_map(q)
        dep = lookup[dep_id]
        if consumer != lookup.get(consumer['id']):
            return False
        if (runner._v2_history_status(st, dep_id) != 'completed' or
                dep.get('status') in TERMINAL_FAILURE or
                any(h['id'] == dep_id and h['status'] in TERMINAL_FAILURE for h in st['history'])):
            return False
        root = runner.BACKLOG_PATH.parent
        stable_bytes = [(root / name, (root / name).read_bytes()) for name in
                        ('backlog-sync-trust.json', 'backlog-sync-state.json', 'legacy-qa-bootstrap.json')]
        trust = backlog_sync.read_metadata(root / 'backlog-sync-trust.json')
        meta = backlog_sync.read_metadata(root / 'backlog-sync-state.json')
        if (meta['status'] not in {'SYNCED', 'IN_SYNC'} or
                any(meta[k] != trust[k] for k in ('canonical_commit', 'canonical_blob'))):
            return False
        bootstrap = json.loads((root / 'legacy-qa-bootstrap.json').read_bytes())
        if (bootstrap.get('version') != 1 or bootstrap.get('project') != 'GoBadminton' or
                bootstrap.get('prod_authorized') is not False or
                bootstrap.get('manifest_sha256') != MANIFEST_SHA256 or
                not _sha(bootstrap.get('manifest_commit')) or
                not _sha(bootstrap.get('review_commit')) or not _safe_path(bootstrap.get('review_path'))):
            return False
        git = runner._v2_git_evidence
        anchor = trust['canonical_commit']
        if (git(['rev-parse', anchor + ':' + backlog_sync.CANONICAL_PATH]) != trust['canonical_blob'] or
                git(['merge-base', '--is-ancestor', anchor, 'refs/remotes/origin/main']) is None):
            return False
        for commit in (bootstrap['manifest_commit'], bootstrap['review_commit']):
            if git(['merge-base', '--is-ancestor', commit, anchor]) is None:
                return False
        # run_git strips output. These two canonical JSON artifacts use a single LF.
        manifest_text = git(['show', bootstrap['manifest_commit'] + ':' + MANIFEST_PATH])
        if manifest_text is None or digest((manifest_text + '\n').encode()) != MANIFEST_SHA256:
            return False
        review_text = git(['show', bootstrap['review_commit'] + ':' + bootstrap['review_path']])
        review = json.loads(review_text)
        if (review.get('kind') != 'legacy_qa_bootstrap_review' or
                review.get('project') != 'GoBadminton' or review.get('prod_authorized') is not False or
                not str(review.get('task_id', '')).startswith('qa-') or
                review.get('task_id') == review.get('producer_task_id') or
                not review.get('producer_task_id') or
                review.get('candidate_sha') != bootstrap['manifest_commit'] or
                review.get('candidate_tree') != git(['rev-parse', bootstrap['manifest_commit'] + '^{tree}']) or
                review.get('manifest_sha256') != MANIFEST_SHA256 or
                review.get('verdict') not in PASS or review.get('blocking_findings') != [] or
                review.get('merge_recommendation') != 'MERGE_RECOMMENDED' or
                review.get('status') != 'APPROVED_BOOTSTRAP_NONPROD'):
            return False
        manifest = json.loads(manifest_text)
        if (manifest.get('version') != 1 or manifest.get('project') != 'GoBadminton' or
                manifest.get('prod_authorized') is not False):
            return False
        row = manifest['records'][dep_id]
        if (row.get('decision') != 'ATTESTED_DEPENDENCY_ONLY' or
                row['qa_definition_sha256'] != definition_digest(dep) or
                row['consumers'].get(consumer['id']) != definition_digest(consumer)):
            return False
        candidate, tree = row['candidate_sha'], row['candidate_tree']
        if not _sha(candidate) or not _sha(tree):
            return False
        producer_id = row['producer_task_id']
        producer = lookup[producer_id]
        if (producer_id == dep_id or producer_id.startswith('qa-') or producer.get('recovery_from') or
                producer.get('status') in TERMINAL_FAILURE or
                runner._v2_history_status(st, producer_id) != 'completed' or
                producer_id not in runner._v2_dependencies(dep, 'depends_on_completed') or
                row['producer_definition_sha256'] != definition_digest(producer)):
            return False
        for task, field in ((dep, 'qa_receipt_sha256'), (producer, 'producer_receipt_sha256')):
            raw = runner.receipt_path_for(task).read_bytes()
            stable_bytes.append((runner.receipt_path_for(task), raw))
            receipt = json.loads(raw)
            if (digest(raw) != row[field] or receipt.get('ok') is not True or
                    receipt.get('project') != 'GoBadminton' or receipt.get('task_id') != task['id'] or
                    ('candidate_sha' in receipt and receipt['candidate_sha'] != candidate) or
                    ('candidate_tree' in receipt and receipt['candidate_tree'] != tree)):
                return False
            if task == dep and receipt.get('verdict') != row['verdict']:
                return False
        if row['verdict'] not in PASS or row['original_blocking_findings'] != []:
            return False
        terminal_ids = set(manifest['terminal_receipts']) | {
            h['id'] for h in st['history'] if h['status'] in TERMINAL_FAILURE}
        for failed_id in terminal_ids:
            status = runner._v2_history_status(st, failed_id)
            if status is not None:
                failed = lookup.get(failed_id, {'id': failed_id})
                raw = runner.receipt_path_for(failed).read_bytes()
                stable_bytes.append((runner.receipt_path_for(failed), raw))
                data = json.loads(raw)
                # Missing/malformed terminal evidence is never silently skipped.
                historical = manifest['terminal_receipts'].get(failed_id)
                bound = (historical is not None and digest(raw) == historical['sha256'] and
                         status == historical['status'])
                current = (data.get('verdict') in {'FAIL', 'BLOCKED'} and _sha(data.get('candidate_sha')))
                if (data.get('project') != 'GoBadminton' or data.get('task_id') != failed_id or
                        not (bound or current) or candidate in raw.decode('utf-8')):
                    return False
            else:
                return False
        if (git(['rev-parse', candidate + '^{tree}']) != tree or
                git(['merge-base', '--is-ancestor', candidate, row['accepted_main_sha']]) is None or
                git(['merge-base', '--is-ancestor', row['accepted_main_sha'], anchor]) is None or
                git(['merge-base', '--is-ancestor', candidate, row['producer_publication_sha']]) is None):
            return False
        for proof in row['proofs']:
            if not _sha(proof['commit']) or not _safe_path(proof['path']):
                return False
            if git(['rev-parse', proof['commit'] + ':' + proof['path']]) != proof['blob']:
                return False
        repo = runner._v2_evidence_repo()
        if repo is None:
            return False
        backlog_sync.validate_immutable_sources(repo, [dep, producer])
        return all(path.read_bytes() == raw for path, raw in stable_bytes)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError, subprocess.TimeoutExpired):
        return False
