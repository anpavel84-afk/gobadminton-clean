#!/usr/bin/python3
"""Deterministic ref-only train release. Run a reviewed copy as trusted OPS only.

prepare prints the complete plan; --publish-ref creates a local release branch via
one CAS transaction, leaving source HEAD/index/worktree untouched. Never pushes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from core import Refused, loads, need
from content_identity import path_kind, exact, git, tree

WORKFLOWS = ('.github/workflows/train-dispatch.yml', '.github/workflows/train-stage.yml')
MANIFEST = 'scripts/chatops/actions_train/manifest.json'
PREFIX = 'scripts/chatops/actions_train/'
REF = rb'(uses: actions/checkout@[^\n]+\n[ \t]+with:\n[ \t]+ref: )([a-f0-9]{40})([ \t]*\n)'


def blob(repo, commit, path):
    return git(repo, 'show', commit + ':' + path)


def refs(raw):
    found = re.findall(REF, raw)
    need(len(found) == 2 and len(re.findall(rb'^\s+ref:.*$', raw, re.M)) == 2,
         'exactly two immutable checkout refs per workflow required')
    return [m[1].decode() for m in found]


def workflows(repo, implementation):
    result = {}
    for path in WORKFLOWS:
        raw = blob(repo, implementation, path)
        refs(raw)
        result[path] = re.sub(REF, lambda m: m[1] + implementation.encode() + m[3], raw)
        need(result[path] != raw, 'implementation cannot pin itself')
    return result


def payload(repo, commit, entries=None):
    entries = tree(repo, commit) if entries is None else entries
    raw = blob(repo, commit, MANIFEST)
    manifest = loads(raw)
    expected = {p for p in entries if p.startswith(PREFIX) and p != MANIFEST
                and Path(p).suffix in ('.py', '.js', '.json')}
    expected.add('scripts/chatops/server/gb-deploy-helper.sh')
    need(all(PREFIX + p in expected for p in ('core.py','receiver.py','installer.py','stage.py',
         'client.py','live/autonomous_issues.py','live/slots.py','live/check_foundation.py')),
         'required install payload missing')
    need(set(manifest) == {'schema','files'} and manifest['schema'] == 'GB_ACTIONS_TRAIN_INSTALL_V1'
         and set(manifest['files']) == expected, 'incomplete install manifest')
    need(entries[MANIFEST]['mode'] == '100644', 'manifest mode drift')
    for path, checksum in manifest['files'].items():
        need(path in entries and entries[path]['mode'] in ('100644','100755')
             and entries[path]['sha256'] == checksum, 'payload bytes/type drift: ' + path)
    # Pin actual live libraries as well as their enclosing payload hash.
    import ast
    code = ast.parse(blob(repo, commit, PREFIX + 'core.py'))
    definitions = [n.value for n in code.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'PINS' for t in n.targets)]
    need(len(definitions) == 1, 'missing/ambiguous live library pins')
    pins = ast.literal_eval(definitions[0])
    for path, checksum in pins.items():
        need(entries[PREFIX + 'live/' + path]['sha256'] == checksum, 'live library pin drift')
    return dict(manifest_sha256=hashlib.sha256(raw).hexdigest(), install_set=manifest['files'],
                install_modes={p: entries[p]['mode'] for p in manifest['files']})


def release(repo, implementation, revision):
    exact(repo, implementation); exact(repo, revision)
    need(git(repo, 'show', '-s', '--format=%P', revision).decode().split() == [implementation],
         'release must be single-parent child of implementation')
    before, after = tree(repo, implementation), tree(repo, revision)
    expected = workflows(repo, implementation)
    changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
    need(changed == set(WORKFLOWS), 'release changed more than four refs')
    for path, raw in expected.items():
        need(before[path]['mode'] == after[path]['mode'] == '100644'
             and blob(repo, revision, path) == raw, 'release bytes/mode mismatch')
    return payload(repo, implementation, before)


def check(repo, revision, require_reusable=False):
    exact(repo, revision)
    pins = sum((refs(blob(repo, revision, path)) for path in WORKFLOWS), [])
    need(len(set(pins)) == 1, 'all four refs must equal the implementation SHA')
    implementation = exact(repo, pins[0])
    rows = git(repo, 'rev-list', '--parents', '--ancestry-path', implementation + '..' + revision)
    candidates = [r.split()[0].decode() for r in rows.splitlines()
                  if r.split()[1:] == [implementation.encode()]]
    valid = []
    for child in candidates:
        try: release(repo, implementation, child)
        except (Refused, KeyError, ValueError): continue
        if git(repo, 'merge-base', child, revision).strip().decode() == child: valid.append(child)
    need(len(valid) == 1, 'unique actual ref-only release ancestor required')
    ancestor = valid[0]
    # Installed controller identity is not task review authority. The complete
    # manifest defines every installed byte; tests outside it are not installed.
    # New candidate CI/test-delta review remain obligations. Product QA uses
    # qa_equivalence's dependency-aware proof, not this release-packaging result.
    before, after = tree(repo, ancestor), tree(repo, revision)
    classification = []
    for path in sorted(before.keys() | after.keys()):
        old, new = before.get(path), after.get(path)
        if old == new: continue
        kind = path_kind(path)
        if new is None or new['mode'] != '100644' or old and old['mode'] != '100644':
            kind = 'runtime'
        classification.append(dict(path=path, kind=kind, before=old, after=new))
    current_payload = payload(repo, revision, after)
    original_payload = payload(repo, implementation)
    reusable = current_payload == original_payload and all(c['kind'] != 'runtime' for c in classification)
    need(not require_reusable or reusable, 'descendant requires new implementation release')
    return dict(schema='GB_TRAIN_RELEASE_V1', implementation=implementation, release=ancestor,
                revision=revision, runtime_identity_reusable=reusable,
                identity_scope='manifest_installed_controller_only',
                descendant_changes=classification, payload=current_payload,
                obligations=['exact_candidate_CI','independent_task_QA_with_dependency_proof',
                             'integration','DEV_acceptance'] +
                    (['test_delta_review'] if any(c['kind']=='test' for c in classification) else []))


def prepare(repo, implementation, expected_head, publish_ref=None, expected_ref=None):
    exact(repo, implementation); exact(repo, expected_head)
    need(implementation == expected_head and git(repo, 'rev-parse', 'HEAD').strip().decode() == expected_head,
         'source HEAD CAS mismatch')
    need(not git(repo, 'status', '--porcelain=v1', '--untracked-files=all'), 'source must be clean')
    entries = tree(repo, implementation)
    manifest = payload(repo, implementation, entries)
    edits = workflows(repo, implementation)
    result = dict(schema='GB_TRAIN_RELEASE_PREPARE_V1', implementation=implementation,
                  expected_head=expected_head, payload=manifest,
                  files={p:dict(sha256=hashlib.sha256(raw).hexdigest(), content=raw.decode())
                         for p, raw in edits.items()}, ref_count=4, published=False)
    if not publish_ref: return result
    need(re.fullmatch(r'refs/heads/[a-zA-Z0-9][a-zA-Z0-9/_.-]*', publish_ref)
         and '..' not in publish_ref, 'local release branch required')
    headref = git(repo, 'rev-parse', '--symbolic-full-name', 'HEAD').strip().decode()
    need(publish_ref != headref, 'release ref must not be checked out')
    # An alternate index constructs the complete tree without touching the source index.
    with tempfile.TemporaryDirectory(prefix='gb-train-release-') as temp:
        env = {'GIT_INDEX_FILE': str(Path(temp) / 'index')}
        git(repo, 'read-tree', implementation, env=env)
        for path, raw in edits.items():
            oid = git(repo, 'hash-object', '-w', '--stdin', data=raw).strip().decode()
            git(repo, 'update-index', '--add', '--cacheinfo', '100644', oid, path, env=env)
        release_tree = git(repo, 'write-tree', env=env).strip().decode()
    timestamp = int(git(repo, 'show', '-s', '--format=%ct', implementation).strip()) + 1
    env = {k: v for k, v in (
        ('GIT_AUTHOR_NAME','GoBadminton OPS'), ('GIT_COMMITTER_NAME','GoBadminton OPS'),
        ('GIT_AUTHOR_EMAIL','ops@gobadminton.invalid'), ('GIT_COMMITTER_EMAIL','ops@gobadminton.invalid'),
        ('GIT_AUTHOR_DATE',f'{timestamp} +0000'), ('GIT_COMMITTER_DATE',f'{timestamp} +0000'))}
    child = git(repo, '-c', 'commit.gpgsign=false', 'commit-tree', release_tree, '-p', implementation,
        data=f'Refs #248: train ref-only release of {implementation}\n'.encode(), env=env).strip().decode()
    release(repo, implementation, child)
    # Existing identical local release is idempotent. No force update is offered.
    listing = git(repo, 'for-each-ref', '--format=%(objectname)', publish_ref).strip().decode()
    need(listing in ('', child), 'release ref already contains a different commit; no force update')
    need(expected_ref is None or expected_ref == (listing or '0'*40), 'release ref CAS mismatch')
    need(not git(repo, 'status', '--porcelain=v1', '--untracked-files=all'), 'source changed during preparation')
    transaction = (f'start\nverify HEAD {expected_head}\nupdate {publish_ref} {child} '
                   f'{listing or "0"*40}\nprepare\ncommit\n').encode()
    git(repo, 'update-ref', '--stdin', data=transaction)
    return dict(result, release=child, published=True, publish_ref=publish_ref, idempotent=listing == child)



def automatic(repo, revision, base, output, checkout=None, tool_revision=None):
    """CI forms an artifact only; no remote write, model call or admission.

    The workflow checks out this generator at an exact tools revision separately
    from the tested candidate. Candidate source is DATA, never imported here.
    """
    repo = Path(repo).resolve()
    exact(repo, revision); exact(repo, base)
    actual_checkout = git(repo, 'rev-parse', 'HEAD').strip().decode()
    if checkout is not None:
        need(checkout == actual_checkout, 'workflow checkout differs from inspected checkout')
    tool_root = Path(__file__).resolve().parents[3]
    if tool_revision is not None:
        exact(tool_root, tool_revision)
        need(git(tool_root, 'rev-parse', 'HEAD').strip().decode() == tool_revision
             and not git(tool_root, 'status', '--porcelain=v1', '--untracked-files=all').strip(),
             'generator checkout is not the exact immutable tools revision')
    # A normal PR may be behind the latest base. Compare its actual fork point,
    # not the synthetic merge SHA and not a mandatory base==candidate ancestor.
    fork = git(repo, 'merge-base', base, revision).strip().decode(); exact(repo, fork)
    changed = [x.decode('utf-8') for x in git(repo, 'diff', '--name-only', '-z', fork, revision).split(b'\0') if x]
    relevant = any(x.startswith('scripts/chatops/actions_train/')
        or x in (MANIFEST, 'scripts/chatops/ops/prepare_train_release.py', '.github/workflows/ci.yml', *WORKFLOWS)
        for x in changed)
    output = Path(output).resolve()
    need(not output.exists(), 'release evidence output already exists; never overwrite')
    output.mkdir(mode=0o700, parents=True)
    result = dict(schema='GB_TRAIN_AUTO_RELEASE_V1', source_head=revision,
        inspected_base=base, fork_point=fork, tested_checkout=actual_checkout,
        relevant=relevant, tools_revision=tool_revision,
        tool_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        authority='artifact_only_not_QA_or_installation')
    if not relevant:
        result.update(status='not_applicable', implementation=None, release=None)
    else:
        # This also validates the CURRENT candidate manifest, not only its old
        # pinned implementation. Corruption/missing objects must NOT regenerate.
        entries = tree(repo, revision)
        payload(repo, revision, entries)
        inspected = check(repo, revision)
        if inspected['runtime_identity_reusable']:
            result.update(status='existing_release', implementation=inspected['implementation'],
                release=inspected['release'], payload=inspected['payload'])
        else:
            with tempfile.TemporaryDirectory(prefix='gb-release-source-') as tmp:
                source = Path(tmp) / 'source'
                git(repo, 'clone', '--quiet', '--local', '--no-hardlinks', '--no-checkout', str(repo), str(source))
                git(source, 'checkout', '--detach', '--quiet', revision)
                local_ref = 'refs/heads/train-auto-release-' + revision[:18]
                generated = prepare(source, revision, revision, local_ref)
                child = generated['release']
                verified = check(source, child, require_reusable=True)
                need(verified['implementation'] == revision and verified['release'] == child,
                     'generated release is not exactly bound to source head')
                bundle = output / 'release.bundle'
                git(source, 'bundle', 'create', str(bundle), local_ref, '^' + revision)
                git(source, 'bundle', 'verify', str(bundle))
                result.update(status='generated', implementation=revision, release=child,
                    payload=verified['payload'], bundle_sha256=hashlib.sha256(bundle.read_bytes()).hexdigest())
    (output / 'release.json').write_text(json.dumps(result, sort_keys=True)+'\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check','prepare','auto'))
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--implementation')
    parser.add_argument('--expected-head')
    parser.add_argument('--publish-ref')
    parser.add_argument('--expected-ref')
    parser.add_argument('--require-reusable', action='store_true')
    parser.add_argument('--base')
    parser.add_argument('--output')
    parser.add_argument('--checkout-sha')
    parser.add_argument('--tool-revision')
    args = parser.parse_args()
    if args.action == 'auto':
        need(args.base and args.output, 'auto requires exact base and output')
        result = automatic(args.repo, args.revision, args.base, args.output, args.checkout_sha, args.tool_revision)
    elif args.action == 'check':
        revision = git(args.repo, 'rev-parse', args.revision).strip().decode()
        result = check(args.repo, revision, args.require_reusable)
    else: result = prepare(args.repo, args.implementation, args.expected_head, args.publish_ref, args.expected_ref)
    print(json.dumps(result, sort_keys=True))

if __name__ == '__main__':
    try: main()
    except (Refused, KeyError, ValueError, OSError) as error:
        print(json.dumps(dict(status='refused', reason=str(error))))
        sys.exit(1)
