"""Trusted QA evidence adapter for Runner; no commands from task JSON.

Service-owned policy and immutable evidence are separate from executor receipts.
No runner, subprocess, secrets, session UUID or dispatch mechanism lives here.
"""
import hashlib
import json
import os
import re
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def sha(value, length=64):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{%d}' % length, value):
        raise ValueError('invalid SHA')


INPUTS = {'source_sha', 'source_tree', 'tests_sha', 'dependencies_sha', 'node_sha',
          'pnpm_sha', 'lockfile_sha', 'environment_sha', 'suite_id', 'author_id'}


def validate_job(job, suites):
    if set(job) != INPUTS:
        raise ValueError('job schema; commands/secrets forbidden')
    for key in INPUTS - {'suite_id', 'author_id'}:
        sha(job[key], 40 if key in {'source_sha', 'source_tree'} else 64)
    if job['suite_id'] not in suites or not job['author_id']:
        raise ValueError('unapproved suite/author')


def verify(job, receipt, verdict, policy, previous=()):
    validate_job(job, policy['suite_ids'])
    if set(receipt) != {'job_sha', 'exit_code', 'test_count', 'log_sha', 'outcome'}:
        raise ValueError('receipt schema')
    sha(receipt['log_sha'])
    if receipt['job_sha'] != digest(job):
        raise ValueError('tested inputs changed')
    if type(receipt['exit_code']) is not int or type(receipt['test_count']) is not int:
        raise ValueError('actual counts required')
    if (receipt['outcome'] != 'PASS' or receipt['exit_code'] != 0 or receipt['test_count'] <= 0):
        raise ValueError('ENV_BLOCKED/zero tests/FAIL is not PASS')
    if set(verdict) != {'receipt_sha', 'reviewer_id', 'verdict', 'authorization_id'}:
        raise ValueError('verdict schema')
    if verdict['receipt_sha'] != digest(receipt) or verdict['verdict'] != 'PASS':
        raise ValueError('verdict binding')
    reviewer = verdict['reviewer_id']
    if reviewer == job['author_id'] or reviewer not in policy['reviewers']:
        raise ValueError('independent authorized reviewer required')
    # Authorization records are protected service policy, never task role claims.
    if policy['verdict_authorizations'].get(verdict['authorization_id']) != digest(verdict):
        raise ValueError('unauthorized/revoked verdict')
    for old_job, old_receipt in previous:
        if (old_receipt['outcome'] in {'PRODUCT_FAIL', 'SECURITY_FAIL'}
                and all(old_job[k] == job[k] for k in INPUTS - {'environment_sha'})):
            raise ValueError('unremediated negative finding')
    return digest(receipt)


def immutable_write(path, payload):
    """Exclusive durable creation: a retry cannot replace receipt or log bytes."""
    with open(path, 'xb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def protected_json(path):
    info = path.lstat()
    if path.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('root-bound evidence required')
    return json.loads(path.read_bytes())


def verify_runner_receipt(data, root):
    # Root directory itself must also be protected against evidence replacement.
    for directory in [root, *root.parents]:
        st = directory.lstat()
        if directory.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise ValueError('unprotected QA root')
    ref = data['trusted_job']
    sha(ref)
    record = protected_json(root / (ref + '.json'))
    if digest(record) != ref:
        raise ValueError('immutable record SHA')
    policy = protected_json(root / 'policy.json')
    result = verify(record['job'], record['receipt'], record['verdict'], policy,
                    record['previous'])
    if hashlib.sha256((root / (record['receipt']['log_sha'] + '.log')).read_bytes()).hexdigest() != record['receipt']['log_sha']:
        raise ValueError('log integrity')
    if data.get('candidate_sha') != record['job']['source_sha']:
        raise ValueError('candidate binding')
    return result
