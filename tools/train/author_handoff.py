"""Caller-side B2 binding and bounded retention. No native patching or launches.

Native provider streams have NO authenticated capacity-control producer boundary.
AGY_ERROR/RESOURCE_EXHAUSTED on outer stderr and a static emitter callgraph
do not close tool/model spoofing in this caller seam. They therefore HOLD;
only a separately trusted control adapter can supply a stop. No legacy Root
NO_SOURCE_EFFECT adjudication is implemented here; cgroup-absent stays HOLD.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
from dataclasses import asdict
from contextlib import ExitStack
from pathlib import Path

import author_routing as policy

ACTUAL = {policy.CURSOR: 'cursor_auto', policy.AGY: 'agy_author',
          policy.CODEX: 'codex_author'}
POLICY = {v: k for k, v in ACTUAL.items()}
BINDING_SCHEMA = 'GB_BOUND_AUTHOR_V1'


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def freeze(task, *, revision, pipeline, routes, history_counts=None, mode='off',
           current_provider=None):
    """Called only at new trusted claim creation, never on repair/resume."""
    if mode not in ('off', 'shadow', 'on'):
        raise ValueError('routing mode invalid')
    decision = policy.select_author(
        routes=routes, complexity=task.get('complexity'), work_kind=task.get('work_kind'),
        history_counts=history_counts, policy_enabled=mode != 'off',
        new_task=current_provider is None, current_provider=current_provider,
        mobile_522=int(task['issue']) == 522)
    result = dict(schema=BINDING_SCHEMA, issue=task['issue'], revision=revision,
                  pipeline=pipeline, mode=mode, decision=decision,
                  route_proofs={k: asdict(v) for k, v in routes.items()})
    result['fingerprint'] = fingerprint(result)
    return json.loads(json.dumps(result))


def bound_provider(task):
    """Read controller-owned binding; never rank or select again."""
    bound = task.get('_bound_author')
    if bound is None:
        return None
    check = {k: v for k, v in bound.items() if k != 'fingerprint'}
    if (bound.get('schema') != BINDING_SCHEMA or fingerprint(check) != bound.get('fingerprint')
            or bound.get('issue') != task.get('issue')
            or bound.get('revision') != task.get('revision') or not policy._sha(bound.get('pipeline'))):
        raise ValueError('routing binding mismatch')
    if bound['mode'] != 'on':
        return None
    d = bound['decision']
    if d['action'] not in ('ASSIGN', 'KEEP') or d['provider'] not in ACTUAL:
        raise ValueError('routing HOLD')
    return ACTUAL[d['provider']], d['reason'], bound


def operation(task, provider, source_sha):
    return policy.Operation(str(task['issue']), str(task['_author_operation']),
        POLICY[provider], source_sha, fingerprint(sorted(task['allowed_paths'])),
        task['runtime_base_sha'])


def propose_handoff(*, current, failure, proof, routes, reviewer, initial_provider,
                    chain=(), cumulative_attempts, history_refs):
    """Trusted adapter boundary. No JSON/raw-string error interpretation."""
    if (not isinstance(reviewer, policy.Reviewer)
            or reviewer.model not in policy.QUALIFIED_QA_MODELS):
        return dict(action='HOLD', reason='qualified_separate_gpt_6_sol_qa_required')
    result = policy.capacity_handoff(current=current, failure=failure, proof=proof,
        routes=routes, initial_provider=initial_provider, chain=chain,
        cumulative_attempts=cumulative_attempts, history_refs=history_refs,
        reviewer=reviewer)
    if result['action'] == 'REQUIRE_NEW_ADMISSION':
        result['reviewer'] = reviewer
        result['actual_provider'] = ACTUAL[result['provider']]
    return result


def owned_group_gone(process):
    if process.poll() is None:
        return False
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


class RetentionError(RuntimeError):
    pass


def need(ok):
    if not ok:
        raise RetentionError('unsafe_source_retention')


class PrivateRetentionSecrets:
    """Fixed native copy only. Capture anchors before Popen/model effect.

    Original AUTH still uses native.trusted; this does not relax that guard.
    Refresh may replace the token inode, but every read is stable and bounded.
    """
    def __init__(self, native, work, home, *, uid):
        self.native, self.uid = native, uid
        self.work, self.home = Path(work), Path(home)
        base = self.work.parent
        need(self.work == base / 'ws' and self.home == base / 'home'
             and base.name.startswith('gb-agy-author-'))
        self.guard = native._AuthorGuard(base)
        fd = native._guard_root(self.guard, record=True)
        os.close(fd)
        self.directories = {}
        self.tokens = list(self._read(record=True))

    def _read(self, *, record=False):
        native = self.native
        with ExitStack() as stack:
            root = stack.enter_context(native._private_root(self.guard))
            def check(fd, key, *, capture=record):
                info = os.fstat(fd)
                need(stat.S_ISDIR(info.st_mode) and info.st_uid == self.uid
                     and stat.S_IMODE(info.st_mode) == 0o700)
                identity = (info.st_dev, info.st_ino)
                if capture: self.directories[key] = identity
                else: need(self.directories.get(key) == identity)
            check(root, 'root')
            work = stack.enter_context(native._private_directory(root, 'ws'))
            check(work, 'ws')
            parent = root
            for part in ('home', '.gemini', 'antigravity-cli'):
                parent = stack.enter_context(native._private_directory(parent, part))
                check(parent, part)
            name = 'antigravity-oauth-token'
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                info = os.fstat(fd)
                need((before.st_dev, before.st_ino) == (info.st_dev, info.st_ino)
                     and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                     and info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o600
                     and info.st_size <= 65536)
                raw = bytearray()
                while len(raw) <= 65536:
                    chunk = os.read(fd, min(8192, 65537 - len(raw)))
                    if not chunk: break
                    raw.extend(chunk)
                end = os.fstat(fd)
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                signature = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid,
                    s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
                need(len(raw) <= 65536 and signature(info) == signature(end) == signature(current))
                tokens = native._credentials(bytes(raw))
            finally:
                os.close(fd)
        # Reopen all anchors to detect renamed ancestors during the read.
        fd = native._guard_root(self.guard)
        os.close(fd)
        with ExitStack() as stack:
            root = stack.enter_context(native._private_root(self.guard))
            check(root, 'root', capture=False)
            work = stack.enter_context(native._private_directory(root, 'ws'))
            check(work, 'ws', capture=False)
            parent = root
            for part in ('home', '.gemini', 'antigravity-cli'):
                parent = stack.enter_context(native._private_directory(parent, part))
                check(parent, part, capture=False)
        return tokens

    def __call__(self):
        for token in self._read():
            if token not in self.tokens:
                self.tokens.append(token)
        need(len(self.tokens) <= 1000 and sum(map(len, self.tokens)) <= 1 << 20)
        return tuple(self.tokens)


def retention_failure(stage, error=None):
    """Finite metadata; never exception text, paths, source or credentials."""
    category = ('unsafe' if isinstance(error, RetentionError) else
                'os_error' if isinstance(error, OSError) else 'error')
    return dict(stage=stage, error_class=category, reason='retention_' + stage + '_failed')


def valid_retention_status(value):
    """No child-provided strings, paths or source in the diagnostic channel."""
    if (type(value) is not dict or set(value) != {'schema', 'checkpoint', 'failure'}
            or value['schema'] != 'GB_SOURCE_RETENTION_STATUS_V1'):
        return False
    if value['checkpoint'] == 'UNVALIDATED':
        return value['failure'] is None
    f = value['failure']
    return (value['checkpoint'] == 'INVALID' and type(f) is dict
            and set(f) == {'stage', 'error_class', 'reason'}
            and f['stage'] in ('setup', 'prepare', 'private_guard', 'capture_or_reap',
                              'persist', 'status_persist', 'no_capture')
            and f['error_class'] in ('unsafe', 'os_error', 'error')
            and f['reason'] == 'retention_' + f['stage'] + '_failed')


def finish_retention(retention, directory, binding, setup_failure=None):
    """Persist a checkpoint or an explicit INVALID receipt after native finalizers."""
    from providers import atomic_write
    failure = setup_failure
    checkpoint = 'INVALID'
    if retention is not None:
        failure = retention.failure_metadata
        if retention.failure is None and retention.result is not None:
            try:
                retention.persist(directory, binding)
                checkpoint = 'UNVALIDATED'
            except BaseException as err:
                failure = retention_failure('persist', err)
        elif failure is None:
            failure = retention_failure('no_capture')
    if failure is None and checkpoint == 'INVALID':
        failure = retention_failure('setup')
    status = dict(schema='GB_SOURCE_RETENTION_STATUS_V1', checkpoint=checkpoint, failure=failure)
    try:
        atomic_write(Path(directory) / 'source-retention.json', status, 0o600)
    except BaseException as err:
        # Caller also carries this finite status over its existing bounded IPC.
        status = dict(schema='GB_SOURCE_RETENTION_STATUS_V1', checkpoint='INVALID',
                      failure=retention_failure('status_persist', err))
    return status


class SourceRetention:
    """One source-only snapshot, in memory, after ORIGINAL native owned reap.

    Full scans include ignored outputs for secret/link safety. Only untracked
    paths ignored by the original checkout are excluded from the diff. Bytes,
    manifests and saved payload hashes come from the same bounded reads.
    """
    def __init__(self, *, baseline, allowed, ignored, source_name, secrets,
                 control=None, max_files=10000, max_bytes=64 << 20, max_file=8 << 20):
        self.baseline = dict(baseline)
        self.allowed = frozenset(allowed)
        self.ignored = ignored
        self.source_name = source_name
        self.secrets = secrets
        self.control = control
        self.max_files, self.max_bytes, self.max_file = max_files, max_bytes, max_file
        self.result = None
        self.failure = None
        self.failure_metadata = None
        self.before_modes = None

    def scan(self, work, tokens):
        root = Path(work)
        need(not root.is_symlink() and root.is_dir())
        payloads, metadata, total, count, controls = {}, {}, 0, 0, set()
        def walk(fd, prefix=''):
            nonlocal total, count
            entries = sorted(os.listdir(fd))
            for name in entries:
                rel = prefix + name
                need('/' not in name and name not in ('.', '..'))
                need(not any(t and t in rel.encode() for t in tokens))
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                count += 1
                need(count <= self.max_files)
                flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                child = os.open(name, flags, dir_fd=fd)
                try:
                    now = os.fstat(child)
                    need((info.st_dev, info.st_ino, info.st_mode) ==
                         (now.st_dev, now.st_ino, now.st_mode))
                    if stat.S_ISDIR(now.st_mode):
                        if rel == '.agents' or rel.startswith('.agents/'):
                            controls.add(rel)
                        else:
                            need(self.source_name(rel))
                        walk(child, rel + '/')
                    else:
                        need(stat.S_ISREG(now.st_mode) and now.st_nlink == 1
                             and now.st_size <= self.max_file)
                        raw = bytearray()
                        while len(raw) <= self.max_file:
                            chunk = os.read(child, min(65536, self.max_file + 1 - len(raw)))
                            if not chunk: break
                            raw.extend(chunk)
                        raw = bytes(raw)
                        total += len(raw)
                        need(total <= self.max_bytes and len(raw) <= self.max_file)
                        need(not any(t and t in raw for t in tokens))
                        end = os.fstat(child)
                        need((now.st_size, now.st_mtime_ns, now.st_ctime_ns) ==
                             (end.st_size, end.st_mtime_ns, end.st_ctime_ns))
                        if rel == '.agents' or rel.startswith('.agents/'):
                            controls.add(rel)
                            need(self.control is not None and rel == self.control[0]
                                 and raw == self.control[1])
                        else:
                            need(self.source_name(rel))
                            if rel in self.baseline or not self.ignored(rel):
                                payloads[rel] = raw
                        metadata[rel] = (end.st_dev, end.st_ino, end.st_mode,
                            end.st_size, end.st_mtime_ns, end.st_ctime_ns)
                finally:
                    os.close(child)
            need(entries == sorted(os.listdir(fd)))
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            root_info = os.fstat(fd)
            walk(fd)
            current = root.lstat()
            need((root_info.st_dev, root_info.st_ino) == (current.st_dev, current.st_ino))
        finally:
            os.close(fd)
        if self.control:
            need(controls == {'.agents', '.agents/agents', self.control[0]})
        else:
            need(not controls)
        return payloads, metadata

    def prepare(self, work):
        try:
            tokens = tuple(t.encode() if isinstance(t, str) else t for t in self.secrets())
            source, metadata = self.scan(work, tokens)
            need({n: hashlib.sha256(raw).hexdigest() for n, raw in source.items()} == self.baseline)
            self.before_modes = {n: m[2] for n, m in metadata.items() if n in self.baseline}
        except BaseException as err:
            self.failure = 'retention_prepare_failed'
            self.failure_metadata = retention_failure('prepare', err)

    def capture(self, work):
        tokens = tuple(t.encode() if isinstance(t, str) else t for t in self.secrets())
        first, meta = self.scan(work, tokens)
        second, meta2 = self.scan(work, tokens)
        need(first == second and meta == meta2)
        # Revalidate private anchors and refresh tokens after both scans too.
        # A refresh during scanning invalidates this snapshot rather than
        # exporting bytes scanned against an obsolete credential set.
        need(tokens == tuple(t.encode() if isinstance(t, str) else t for t in self.secrets()))
        if self.before_modes is not None:
            # Native importers retain existing modes, so a chmod cannot be
            # handed off faithfully through their byte-only payload contract.
            need(all(n not in meta or meta[n][2] == mode for n, mode in self.before_modes.items()))
        after = {n: hashlib.sha256(raw).hexdigest() for n, raw in first.items()}
        changed = sorted(n for n in set(after) | set(self.baseline)
                         if after.get(n) != self.baseline.get(n))
        need(set(changed) <= self.allowed)
        data = {n: first[n] for n in changed if n in first}
        self.result = dict(changed_paths=changed, payloads=data,
            deleted=[n for n in changed if n not in after],
            payload_hashes={n: hashlib.sha256(raw).hexdigest() for n, raw in data.items()},
            before=self.baseline, after=after,
            partial_state='preserved_diff' if changed else 'confirmed_empty_diff')
        return self.result

    def observe(self, work, process, reap):
        try:
            reap(process)  # ORIGINAL native function, original Popen object
            need(owned_group_gone(process))
            if self.failure is None and self.result is None:
                self.capture(work)
        except BaseException as err:
            # Observing must not replace the native result or exception.
            self.failure = 'retention_or_owned_reap_failed'
            self.failure_metadata = retention_failure('capture_or_reap', err)
            self.result = None

    def popen(self, original, reap):
        observer = self
        def launch(*args, **kwargs):
            observer.prepare(kwargs['cwd'])
            process = original(*args, **kwargs)
            work = kwargs['cwd']
            class Observed:
                def __getattr__(self, name):
                    return getattr(process, name)
                def communicate(self, *a, **k):
                    try:
                        return process.communicate(*a, **k)
                    finally:
                        observer.observe(work, process, reap)
            return Observed()
        return launch

    def persist(self, directory, binding):
        """Separate UNVALIDATED checkpoint, never native parsed-success evidence."""
        need(self.failure is None and self.result is not None)
        from providers import atomic_write
        destination = Path(directory) / 'source-checkpoint'
        destination.mkdir(mode=0o700, exist_ok=False)
        r = self.result
        for index, name in enumerate(sorted(r['payloads'])):
            atomic_write(destination / f'payload-{index}', r['payloads'][name], 0o600)
        manifest = {k: v for k, v in r.items() if k != 'payloads'}
        manifest.update(schema='GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1', binding=asdict(binding),
                        payload_files={n: f'payload-{i}' for i, n in enumerate(sorted(r['payloads']))})
        manifest['fingerprint'] = fingerprint(manifest)
        atomic_write(destination / 'manifest.json', manifest, 0o600)
        return manifest


def reconciled_stop(current, failure, *, checkpoint, checkpoint_ref, native_receipt,
                    receipt_refs, actual_effects, owned_reaped):
    """Called with fixed-path native receipt AFTER invoke and its finalizers.

    Usage unknown is deliberately not actual-effects unknown. Raw native error
    and charge receipts are retained separately; this function never clears them.
    """
    if (not isinstance(failure, policy.CapacityFailure) or failure.binding != current
            or actual_effects != 'RECONCILED' or owned_reaped is not True
            or checkpoint.get('binding') != asdict(current)
            or checkpoint.get('schema') != 'GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1'
            or checkpoint.get('fingerprint') != fingerprint({k: v for k, v in checkpoint.items()
                                                           if k != 'fingerprint'})
            or not checkpoint_ref or not receipt_refs):
        return None
    # Native AGY final cleanup/guard/cgroup closure is mandatory. Snapshot alone
    # never proves it, and an absent cgroup is insufficient for native AGY.
    if current.provider == policy.AGY:
        if (native_receipt.get('schema') != 'GB_AGY_AUTHOR_RECEIPT_V1'
                or native_receipt.get('phase') != 'failed_no_automatic_replay'
                or native_receipt.get('executor_reap') != 'cgroup-quiet'
                or native_receipt.get('source_head') != current.source_sha
                or native_receipt.get('cleanup') == 'failed'
                or native_receipt.get('oauth_refresh') == 'failed'
                or any(k.startswith('cleanup_') and v == 'failed' for k, v in native_receipt.items())
                or native_receipt.get('receipt_persist') == 'failed'):
            return None
    elif (native_receipt.get('owned_reaped') is not True
          or native_receipt.get('source_sha') != current.source_sha
          or native_receipt.get('operation') != current.operation):
        return None
    changed = checkpoint.get('changed_paths')
    hashes = checkpoint.get('payload_hashes')
    if not isinstance(changed, list) or not isinstance(hashes, dict):
        return None
    return policy.StopProof(current, failure.fingerprint, True, True, True, False,
        checkpoint_ref, tuple(receipt_refs), checkpoint['partial_state'])
