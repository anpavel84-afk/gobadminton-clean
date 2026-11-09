"""Caller-side B2 binding and bounded retention. No native patching or launches.

Root custody is separate from provider success, stop authority and acceptance.
Capacity recovery requires protected operation/control evidence and explicit
Root policy. An absent cgroup requires independent exclusive-UID proc proof.
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


def require_agy_source_custody(custody=None):
    from providers import ProviderError
    if not isinstance(custody, CustodyClient) or not custody.ready:
        raise ProviderError('agy_source_custody_unsupported',
                            'precharge_hold: protected custody not ready', charge='none')


def _directory(fd, name):
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)


def _signature(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_nlink,
            st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _bounded_file(fd, name, limit):
    before = os.stat(name, dir_fd=fd, follow_symlinks=False)
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
    try:
        info = os.fstat(child)
        need(_signature(before) == _signature(info) and stat.S_ISREG(info.st_mode)
             and info.st_nlink == 1 and 0 <= info.st_size <= limit)
        raw = bytearray()
        while len(raw) <= limit:
            part = os.read(child, min(65536, limit + 1 - len(raw)))
            if not part: break
            raw.extend(part)
        need(len(raw) == info.st_size and _signature(info) == _signature(os.fstat(child))
             == _signature(os.stat(name, dir_fd=fd, follow_symlinks=False)))
        return bytes(raw)
    finally: os.close(child)


class SourceQuarantine:
    """Bounded per-file fault inventory; no unsafe source-byte retention.

    Incomplete outcomes never release cleanup. Opaque EXACT workspace custody
    belongs to the Root parent and is never called sanitized or source-only.
    """
    def __init__(self, cap, allowed, uid):
        need(type(allowed) in (list, tuple) and 0 < len(allowed) <= 256)
        self.allowed = tuple(sorted(set(allowed)))
        for name in self.allowed:
            need(type(name) is str and len(name.encode()) <= 1024
                 and not name.startswith('/') and all(p not in ('', '.', '..')
                 and not p.startswith('.') and p.lower() not in
                 ('home', 'auth', 'out', 'agents.md', 'gemini.md') for p in name.split('/')))
        self.cap, self.uid = cap, uid
        self.workfd = None
        self.ready = self.quarantined = False
        self.outcomes = {}
        os.mkdir('fallback', 0o700, dir_fd=cap)
        self.fallback = _directory(cap, 'fallback')
        for index in range(len(self.allowed)):
            fd = os.open(str(index), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self.fallback)
            try: os.fsync(fd)
            finally: os.close(fd)
        os.fsync(self.fallback); os.fsync(self.cap)

    def anchor(self, work):
        need(self.workfd is None)
        self.workfd = os.open(work, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(self.workfd)
        need(info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o700
             and info.st_dev == os.fstat(self.cap).st_dev)
        return [info.st_dev, info.st_ino]

    def quarantine(self):
        """Truthful fault inventory only. Unsafe bytes stay in EXACT ws.

        No secret-blind per-file rename, no sanitized/source-only claim. Root
        may subsequently move the opaque workspace without traversing it.
        Native must veto destructive cleanup until a durable checkpoint ACK.
        """
        self.ready = False
        self.outcomes = {}
        for index, name in enumerate(self.allowed):
            parent = os.dup(self.workfd) if self.workfd is not None else None
            try:
                need(parent is not None)
                for part in name.split('/')[:-1]:
                    child = _directory(parent, part); os.close(parent); parent = child
                info = os.stat(name.split('/')[-1], dir_fd=parent, follow_symlinks=False)
                self.outcomes[str(index)] = ('unvalidated_in_ws' if stat.S_ISREG(info.st_mode)
                                             else 'unsafe_in_ws')
            except FileNotFoundError:
                self.outcomes[str(index)] = 'absent'
            except (OSError, RetentionError):
                self.outcomes[str(index)] = 'unproven_in_ws'
            finally:
                if parent is not None: os.close(parent)
        self.quarantined = False  # Inventory is not a completed custody transfer.
        return self.outcomes

    def close(self):
        for fd in (self.workfd, self.fallback, self.cap):
            if fd is not None: os.close(fd)
        self.workfd = self.fallback = self.cap = None


def _proc_identity(pid):
    """Root reads actual procfs; permission/namespace/parse faults fail closed."""
    root = Path('/proc') / str(pid)
    before_stat = (root / 'stat').read_text()
    status = (root / 'status').read_text()
    namespace = os.readlink(root / 'ns/pid')
    uids = tuple(map(int, next(x for x in status.splitlines() if x.startswith('Uid:')).split()[1:]))
    raw = (root / 'stat').read_text()
    need(raw[raw.rindex(')')+2:].split()[19] == before_stat[before_stat.rindex(')')+2:].split()[19]
         and next(x for x in status.splitlines() if x.startswith('Uid:')) ==
             next(x for x in (root / 'status').read_text().splitlines() if x.startswith('Uid:'))
         and namespace == os.readlink(root / 'ns/pid'))
    fields = raw[raw.rindex(')') + 2:].split()
    return dict(pid=pid, uid=list(uids), ppid=int(fields[1]), pgrp=int(fields[2]),
                start=int(fields[19]), namespace=namespace)


def _uid_processes(uid, *, native=None, sdk=None):
    all_processes = []
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal(): continue
        need(len(all_processes) < 65536)
        try: identity = _proc_identity(int(path.name))
        except FileNotFoundError: continue
        all_processes.append(identity)
    selected = {i['pid']: i for i in all_processes if uid in i['uid']}
    # Independently reject native/SDK descendants even if their UID or group
    # changed. NNP is retained, but absence proof does not merely assume it.
    ancestors = {i['pid'] for i in (native, sdk) if i is not None} | set(selected)
    while True:
        added = [i for i in all_processes if i['pid'] not in selected and
                 (i['ppid'] in ancestors or
                  (native is not None and i['pgrp'] == native['pgrp']))]
        if not added: break
        selected.update({i['pid']: i for i in added}); ancestors.update(i['pid'] for i in added)
    return sorted(selected.values(), key=lambda i: i['pid'])


def _exclusive_stop(*, uid, sdk, native, boot, sdk_exited=False):
    need(uid == 978 and boot == Path('/proc/sys/kernel/random/boot_id').read_text().strip())
    need(sdk['namespace'] == os.readlink('/proc/self/ns/pid') and sdk['uid'] == [uid]*4)
    # Two actual enumerations, excluding ONLY the authenticated waiting SDK.
    for _ in range(2):
        observed = _uid_processes(uid, native=native, sdk=sdk)
        need(observed == ([] if sdk_exited else [sdk]))
        if sdk_exited:
            try: _proc_identity(sdk['pid'])
            except FileNotFoundError: pass
            else: need(False)
        if native is not None:
            try: _proc_identity(native['pid'])
            except FileNotFoundError: pass
            else: need(False)  # PID reuse is HOLD too.
    return dict(kind='exclusive-uid-proc-stop-v1', boot=boot, sdk=sdk, native=native)


class RootSourceCustody:
    """One existing caller fork, private SDK capability, durable Root HOLD.

    The 0700 outer sink is inaccessible to executor UID. Inner FD is CLOEXEC,
    SDK-only with dumpability zero. No task object can supply this capability.
    """
    @staticmethod
    def preflight():
        from live import _QA_RESULTS
        need(os.geteuid() == 0)
        for path in (_QA_RESULTS, *_QA_RESULTS.parents):
            info = path.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)

    def __init__(self, binding, allowed, *, uid, task_hash):
        import socket, tempfile, secrets
        from live import _QA_RESULTS
        self.preflight()
        need(type(allowed) in (list, tuple) and 0 < len(allowed) <= 256)
        need(all(type(n) is str and len(n.encode()) <= 1024 and not n.startswith('/')
                 and all(p and p not in ('.', '..') and not p.startswith('.')
                         and p.lower() not in ('home', 'auth', 'out', 'agents.md', 'gemini.md')
                         for p in n.split('/')) for n in allowed))
        self.binding, self.allowed, self.uid = binding, sorted(set(allowed)), uid
        self.nonce = secrets.token_hex(32)
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.outer = Path(tempfile.mkdtemp(prefix='gb-source-custody-', dir=_QA_RESULTS))
        os.chmod(self.outer, 0o700)
        self.outerfd = os.open(self.outer, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        (self.outer/'incoming').mkdir(mode=0o700)
        os.chown(self.outer/'incoming', uid, -1)
        self.cap = _directory(self.outerfd, 'incoming')
        self.server, self.peer = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
        self.record_path = _QA_RESULTS / ('source-custody-' + self.nonce + '.json')
        info = os.fstat(self.outerfd)
        self.record = dict(schema='GB_ROOT_SOURCE_CUSTODY_V1', state='HOLD', binding=asdict(binding),
            task_sha256=task_hash, allowed_paths=self.allowed, nonce=self.nonce, boot=self.boot, sink=str(self.outer),
            sink_identity=[info.st_dev, info.st_ino], checkpoint_ready=False)
        self._record()
        self.prepared = False
        self.checkpoint = None
        self.anchors = ()
        self.native_identity = None
        self.stop_proof = None
        self.capture_fds = tuple(os.open(self.outer / name,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
            for name in ('outer-stdout', 'outer-stderr'))

    def _record(self):
        from providers import atomic_write
        need(os.geteuid() == 0)
        atomic_write(self.record_path, self.record, 0o600)
        fd = os.open(self.record_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)

    def client(self):
        self.server.close(); os.close(self.outerfd)
        return CustodyClient(self.peer, self.cap, self.binding, self.allowed, self.uid, self.nonce, self.boot, self.capture_fds)

    def parent(self, pid):
        self.pid = pid; self.peer.close()
        self.sdk_identity = _proc_identity(pid)

    def stop_owned(self):
        """Timeout only: signal exact anchored owned identities through pidfds.

        Unknown descendants/exclusivity are HOLD, never a broad UID/group kill.
        """
        import signal
        need(self.native_identity is not None)
        processes = _uid_processes(self.uid, native=self.native_identity, sdk=self.sdk_identity)
        for identity in processes:
            if identity == self.sdk_identity: continue
            need(identity['uid'] == [self.uid]*4
                 and identity['namespace'] == self.sdk_identity['namespace']
                 and identity['pgrp'] == self.native_identity['pgrp']
                 and identity['start'] >= self.native_identity['start'])
        for identity in processes:
            if identity == self.sdk_identity: continue
            fd = os.pidfd_open(identity['pid'])
            try:
                need(_proc_identity(identity['pid']) == identity)
                signal.pidfd_send_signal(fd, signal.SIGKILL)
            finally: os.close(fd)

    def prove_stop(self, *, sdk_exited=False):
        proof = _exclusive_stop(uid=self.uid, sdk=self.sdk_identity,
                                native=self.native_identity, boot=self.boot, sdk_exited=sdk_exited)
        need(self.anchors)
        anchored = os.fstat(self.anchors[1])
        need([anchored.st_dev, anchored.st_ino] == self.record['source_anchor'])
        # Also bind the pathname to the anchored ws inode, not a replacement.
        current = os.stat('ws', dir_fd=self.anchors[0], follow_symlinks=False)
        need([current.st_dev, current.st_ino] == self.record['source_anchor'])
        self.stop_proof = proof
        self.record.update(owned_stop=proof); self._record()
        return proof

    def collect(self):
        from providers import loads
        if self.binding.provider == policy.AGY:
            self.prove_stop()  # Never trust a child-supplied reap boolean.
        fd = _directory(self.cap, 'source-checkpoint')
        try:
            info = os.fstat(fd)
            need(info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o700)
            for leaf in os.listdir(fd):
                info = os.stat(leaf, dir_fd=fd, follow_symlinks=False)
                need(stat.S_ISREG(info.st_mode) and info.st_uid == self.uid
                     and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1)
            raw = _bounded_file(fd, 'manifest.json', 2 << 20)
            m = loads(raw)
            need(m.get('schema') == 'GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1'
                 and m.get('validation') == 'bounded_secret_checked'
                 and m.get('binding') == asdict(self.binding)
                 and m.get('fingerprint') == fingerprint({k:v for k,v in m.items() if k != 'fingerprint'}))
            names, changed = m.get('payload_files'), m.get('changed_paths')
            need(type(names) is dict and type(changed) is list and set(changed) <= set(self.allowed)
                 and set(names) <= set(changed) and set(m.get('deleted', [])) == set(changed) - set(names)
                 and set(m.get('payload_hashes', {})) == set(names)
                 and names == {n:f'payload-{i}' for i,n in enumerate(sorted(names))}
                 and set(os.listdir(fd)) == {'manifest.json', *names.values()})
            total = 0
            for name, leaf in names.items():
                data = _bounded_file(fd, leaf, 8 << 20)
                total += len(data); need(total <= 64 << 20)
                need(hashlib.sha256(data).hexdigest() == m['payload_hashes'][name])
            os.rename('source-checkpoint', 'source-checkpoint', src_dir_fd=self.cap, dst_dir_fd=self.outerfd)
            for leaf in os.listdir(fd):
                child = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
                try: os.fchown(child, 0, 0); os.fchmod(child, 0o600); os.fsync(child)
                finally: os.close(child)
            os.fchown(fd, 0, 0); os.fchmod(fd, 0o700); os.fsync(fd); os.fsync(self.cap); os.fsync(self.outerfd)
            self.record.update(checkpoint_ready=True, checkpoint_sha256=hashlib.sha256(raw).hexdigest())
            self._record()  # durable Root custody BEFORE ACK; still HOLD
            if self.binding.provider == policy.AGY: self.prove_stop()
            self.checkpoint = m
        finally: os.close(fd)

    def service(self):
        import socket, struct
        from providers import loads
        raw, ancillary, flags, _ = self.server.recvmsg(8192, socket.CMSG_SPACE(struct.calcsize('3i')))
        need(raw and not flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC))
        credentials = [struct.unpack('3i', data) for level, kind, data in ancillary
                       if level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS]
        need(len(credentials) == 1 and credentials[0][:2] == (self.pid, self.uid))
        msg = loads(raw)
        need(type(msg) is dict and msg.get('nonce') == self.nonce and msg.get('boot') == self.boot
             and msg.get('binding') == fingerprint(asdict(self.binding)))
        op = msg.get('op')
        if op == 'PREPARED':
            need(not self.prepared and set(msg) == {'op','nonce','boot','binding','base','anchor'})
            base = msg['base']
            need(type(base) is str and base.startswith('gb-agy-author-') and '/' not in base and len(base) <= 128)
            tmp = os.open('/tmp', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try: root = _directory(tmp, base)
            finally: os.close(tmp)
            try:
                info = os.fstat(root)
                need(info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o700
                     and info.st_dev == os.fstat(self.cap).st_dev)
                work = _directory(root, 'ws')
                self.anchors = (root, work)
                info = os.fstat(work)
                need(info.st_uid == self.uid and stat.S_IMODE(info.st_mode) == 0o700
                     and msg['anchor'] == [info.st_dev, info.st_ino])
            except BaseException:
                if not self.anchors: os.close(root)
                raise
            observed_sdk = _proc_identity(self.pid)
            need(observed_sdk['start'] == self.sdk_identity['start'])
            self.sdk_identity = observed_sdk
            self.record.update(child_pid=self.pid, sdk_identity=observed_sdk, source_anchor=msg['anchor'])
            if self.binding.provider == policy.AGY:
                # Exclusive UID scope must already hold BEFORE paid launch.
                _exclusive_stop(uid=self.uid, sdk=self.sdk_identity, native=None, boot=self.boot)
            self._record(); self.prepared = True
        elif op == 'LAUNCHED':
            need(self.prepared and self.native_identity is None and
                 set(msg) == {'op','nonce','boot','binding','pid'})
            identity = _proc_identity(msg['pid'])
            need(identity['uid'] == [self.uid]*4 and identity['ppid'] == self.pid
                 and identity['pgrp'] == identity['pid']
                 and identity['namespace'] == self.sdk_identity['namespace'])
            from providers import AGY_CLI, AGY_CLI_SHA256
            native_exe = Path('/proc') / str(identity['pid']) / 'exe'
            need(os.path.samefile(native_exe, AGY_CLI)
                 and hashlib.sha256(native_exe.read_bytes()).hexdigest() == AGY_CLI_SHA256)
            self.native_identity = identity
            self.record.update(native_identity=identity, cli_sha256=AGY_CLI_SHA256)
            self._record()
        elif op == 'STOP':
            need(self.prepared and set(msg) == {'op','nonce','boot','binding'})
            self.prove_stop()
        elif op == 'CHECKPOINT':
            need(self.prepared and set(msg) == {'op','nonce','boot','binding'})
            if self.checkpoint is None: self.collect()
            else: self.prove_stop()
        elif op == 'HOLD':
            need(set(msg) <= {'op','nonce','boot','binding','outcomes'})
            outcomes = msg.get('outcomes', {})
            need(type(outcomes) is dict and set(outcomes) <= {str(i) for i in range(len(getattr(self, 'allowed', ())))}
                 and all(v in ('unvalidated_in_ws','unsafe_in_ws','unproven_in_ws','absent')
                         for v in outcomes.values()))
            self.record.update(fault=True, source_outcomes=outcomes); self._record()
        else: need(False)
        self.server.send(json.dumps(dict(op=op, nonce=self.nonce, ok=True)).encode())

    def rescue(self, *, sdk_exited=False):
        # Stop is independently proved BEFORE even an opaque rename. No reads
        # of the opaque tree, which may contain links, secrets and .agents.
        self.record.update(fault=True, opaque_workspace='HOLD'); self._record()
        if not self.anchors: return
        self.prove_stop(sdk_exited=sdk_exited)
        os.rename('ws', 'opaque-ws', src_dir_fd=self.anchors[0], dst_dir_fd=self.outerfd)
        info = os.stat('opaque-ws', dir_fd=self.outerfd, follow_symlinks=False)
        need([info.st_dev, info.st_ino] == self.record['source_anchor'])
        os.fchown(self.anchors[1], 0, 0); os.fchmod(self.anchors[1], 0o700)
        os.fsync(self.anchors[1]); os.fsync(self.anchors[0]); os.fsync(self.outerfd)
        self.record.update(opaque_workspace='ROOT_ONLY_UNVALIDATED', checkpoint_ready=False)
        self._record()

    def produce_capacity_operation(self, native, *, lease=None, claim_path=None):
        """Root fixed-results producer, after SDK exit, with real outer FD1/FD2.

        Captures facts only. It neither grants recovery policy nor adjudicates
        legacy lost-after-tree history. Invalid/missing facts remain HOLD.
        """
        from live import _QA_RESULTS
        from providers import atomic_write, typed_agy_capacity, AGY_MODEL, AGY_CLI_SHA256
        need(os.geteuid() == 0 and self.binding.provider == policy.AGY)
        need(self.checkpoint is not None and self.record.get('checkpoint_ready') is True
             and not self.record.get('fault') and self.native_identity is not None
             and self.record.get('cli_sha256') == AGY_CLI_SHA256)
        proof = _exclusive_stop(uid=self.uid, sdk=self.sdk_identity,
            native=self.native_identity, boot=self.boot, sdk_exited=True)
        need(not Path('/proc', str(self.pid)).exists())
        need(native.get('schema') == 'GB_AGY_AUTHOR_RECEIPT_V1'
             and native.get('phase') == 'failed_no_automatic_replay'
             and native.get('source_head') == self.binding.source_sha
             and native.get('task_sha256') == self.record['task_sha256']
             and native.get('exit_code') == 3 and native.get('charge_state') == 'charged'
             and not any(k.startswith('cleanup') and v == 'failed' for k,v in native.items())
             and native.get('oauth_refresh') != 'failed' and native.get('receipt_persist') != 'failed')
        streams = []
        for fd, field in zip(self.capture_fds, ('stdout_sha256','stderr_sha256')):
            before = os.fstat(fd); need(0 < before.st_size <= 2 << 20)
            raw = os.pread(fd, (2 << 20)+1, 0)
            need(_signature(before) == _signature(os.fstat(fd)) and len(raw) == before.st_size
                 and hashlib.sha256(raw).hexdigest() == native.get(field))
            os.fsync(fd); streams.append(raw)
        key = fingerprint(asdict(self.binding))
        final = _QA_RESULTS / ('capacity-operation-' + key + '.json')
        need(not final.exists())  # Immutable operation, never replay/overwrite.
        checkpoint_ref = self.outer/'source-checkpoint/manifest.json'
        op = dict(schema='GB_ROOT_CAPACITY_OPERATION_V1', binding=asdict(self.binding),
            nonce=self.nonce, boot=self.boot, executor_uid=self.uid, sdk_pid=self.pid,
            sdk_identity=self.sdk_identity, native_identity=self.native_identity,
            native_completed=True, source_sha=self.binding.source_sha, scope_id=self.binding.scope_id,
            allowed_paths=self.allowed, task_sha256=self.record['task_sha256'],
            cli_sha256=AGY_CLI_SHA256, control_origin='pinned-agy-outer-stderr-v1',
            exit_code=3, model=AGY_MODEL, owned_stop=proof, custody_ref=str(self.record_path),
            checkpoint_ref=str(checkpoint_ref), checkpoint_sha256=self.record['checkpoint_sha256'],
            raw_ref=str(self.outer/'outer-stdout'), stderr_ref=str(self.outer/'outer-stderr'),
            raw_sha256=hashlib.sha256(streams[0]).hexdigest(),
            stderr_sha256=hashlib.sha256(streams[1]).hexdigest(), native_ref=str(self.outer/'native-receipt.json'))
        if lease is not None or claim_path is not None:
            claim = capacity_claim(lease, claim_path, self.binding)
            need(op['task_sha256'] == capacity_task_hash(claim, self.binding))
            op['prospective'] = dict(policy=claim['capacity_policy'], claim_ref=str(claim_path),
                revision=claim['revision'], task_fingerprint=fingerprint(claim['task']))
        need(typed_agy_capacity(streams[1], streams[0], producer=op, binding=self.binding) is not None)
        atomic_write(op['native_ref'], native, 0o600)
        op['native_sha256'] = hashlib.sha256(Path(op['native_ref']).read_bytes()).hexdigest()
        os.fsync(self.outerfd)
        atomic_write(final, op, 0o600)
        fd = os.open(_QA_RESULTS, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
        return str(final)

    def close(self):
        if getattr(self, 'closed', False): return
        self.closed = True
        self.server.close()
        for fd in (*self.anchors, *self.capture_fds, self.cap, self.outerfd):
            try: os.close(fd)
            except OSError: self.record['capability_close'] = 'failed'


class CustodyClient(SourceQuarantine):
    def __init__(self, channel, cap, binding, allowed, uid, nonce, boot, capture_fds=()):
        super().__init__(cap, allowed, uid)
        self.channel, self.binding, self.nonce, self.boot = channel, binding, nonce, boot
        self.terminal = False
        self.capture_fds = capture_fds
        self.failed = False
        channel.settimeout(10)

    @staticmethod
    def protect_sdk():
        import ctypes
        need(ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0) == 0)

    def request(self, op, **fields):
        from providers import loads
        self.channel.send(json.dumps(dict(op=op, nonce=self.nonce, boot=self.boot,
            binding=fingerprint(asdict(self.binding)), **fields)).encode())
        need(loads(self.channel.recv(8192)) == dict(op=op, nonce=self.nonce, ok=True))

    def prepare(self, work):
        work = Path(work)
        need(work.name == 'ws' and work.parent.parent == Path('/tmp'))
        anchor = self.anchor(work)
        self.request('PREPARED', base=work.parent.name, anchor=anchor)
        self.ready = True

    def stop(self):
        self.request('STOP')

    def launched(self, process):
        self.request('LAUNCHED', pid=process.pid)

    def cleanup_authorized(self, work):
        # Only a synchronous authenticated Root CHECKPOINT ACK can release ws.
        return self.terminal and not self.failed

    def terminal_checkpoint(self, retention, work):
        if self.terminal: return
        try:
            need(not self.failed)
            self.stop()
            need(self.ready and retention.failure is None)
            if retention.result is None: retention.capture(work)
            retention.persist(Path('/proc/self/fd') / str(self.cap), self.binding)
            self.request('CHECKPOINT'); self.terminal = True
        except BaseException:
            self.failed = True
            self.quarantine()
            try: self.request('HOLD', outcomes=self.outcomes)
            except BaseException: pass
            raise RetentionError('root_custody_hold') from None


class DirectSourceCustody(SourceQuarantine):
    def __init__(self, root):
        self.root = root
        super().__init__(os.dup(root.cap), root.allowed, root.uid)

    def prepare(self, work):
        self.work_path = Path(work)
        self.process = None
        anchor = self.anchor(work)
        self.root.record.update(source_anchor=anchor); self.root._record(); self.ready = True

    def checkpoint(self, retention):
        retention.persist(Path('/proc/self/fd') / str(self.cap), self.root.binding)
        self.root.collect()

    def quarantine(self):
        if self.quarantined: return
        super().quarantine()
        self.root.record.update(fault=True, opaque_workspace='HOLD'); self.root._record()
        # Direct providers have an actual Root-owned Popen, unlike forked AGY.
        need(os.geteuid() == 0 and self.process is not None and owned_group_gone(self.process))
        need([self.work_path.lstat().st_dev, self.work_path.lstat().st_ino] ==
             self.root.record['source_anchor'])
        os.rename(self.work_path, self.root.outer/'opaque-ws')
        os.fchown(self.workfd, 0, 0); os.fchmod(self.workfd, 0o700); os.fsync(self.workfd)
        parent = os.open(self.work_path.parent, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try: os.fsync(parent)
        finally: os.close(parent)
        os.fsync(self.root.outerfd)
        self.root.record.update(opaque_workspace='ROOT_ONLY_UNVALIDATED'); self.root._record()
        self.quarantined = True


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
    """Report durable observer checkpoint; legacy callers may persist here.

    INVALID is diagnostic only, never a claim that source bytes survived.
    """
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
    """One source-only snapshot after ORIGINAL native owned reap.

    With checkpoint configured, persistence completes before native parsing or
    destructive cleanup resumes. This alone cannot guarantee fault custody;
    the native AGY caller must remain precharge HOLD until that seam exists.

    Full scans include ignored outputs for secret/link safety. Only untracked
    paths ignored by the original checkout are excluded from the diff. Bytes,
    manifests and saved payload hashes come from the same bounded reads.
    """
    def __init__(self, *, baseline, allowed, ignored, source_name, secrets,
                 control=None, max_files=10000, max_bytes=64 << 20, max_file=8 << 20,
                 checkpoint=None):
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
        self.checkpoint = checkpoint
        self.persisted = None
        self.custody = None

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
            if self.custody is not None and not self.custody.ready:
                self.custody.prepare(work)
        except BaseException as err:
            self.failure = 'retention_prepare_failed'
            self.failure_metadata = retention_failure('prepare', err)
            raise RetentionError('retention_prepare_failed') from err

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
            if isinstance(self.custody, DirectSourceCustody): self.custody.process = process
            reap(process)  # ORIGINAL native function, original Popen object
            need(owned_group_gone(process))
            if isinstance(self.custody, CustodyClient): self.custody.stop()
            if self.failure is None and self.result is None:
                self.capture(work)
                if isinstance(self.custody, DirectSourceCustody):
                    self.custody.checkpoint(self)
                elif self.checkpoint is not None:
                    self.persist(*self.checkpoint)
        except BaseException as err:
            # Observing must not replace the native result or exception.
            self.failure = 'retention_or_owned_reap_failed'
            self.failure_metadata = retention_failure('capture_or_reap', err)
            self.result = None
            if self.custody is not None:
                self.custody.quarantine()
                raise RetentionError('source_custody_hold') from None

    def popen(self, original, reap):
        observer = self
        def launch(*args, **kwargs):
            observer.prepare(kwargs['cwd'])
            originals = None
            if isinstance(observer.custody, CustodyClient):
                need(len(observer.custody.capture_fds) == 2)
                originals = (kwargs['stdout'], kwargs['stderr'])
                kwargs['stdout'], kwargs['stderr'] = observer.custody.capture_fds
            process = original(*args, **kwargs)
            if isinstance(observer.custody, CustodyClient):
                try: observer.custody.launched(process)
                except BaseException:
                    reap(process)
                    raise
            work = kwargs['cwd']
            class Observed:
                def __getattr__(self, name):
                    return getattr(process, name)
                def communicate(self, *a, **k):
                    try:
                        return process.communicate(*a, **k)
                    finally:
                        observer.observe(work, process, reap)
                        if originals is not None:
                            for fd, target in zip(observer.custody.capture_fds, originals):
                                need(os.fstat(fd).st_size <= 2 << 20)
                                raw = os.pread(fd, (2 << 20) + 1, 0)
                                need(len(raw) <= 2 << 20)
                                target.write(raw); target.flush()
            return Observed()
        return launch

    def persist(self, directory, binding):
        """Separate UNVALIDATED checkpoint, never native parsed-success evidence."""
        need(self.failure is None and self.result is not None)
        from providers import atomic_write
        destination = Path(directory) / 'source-checkpoint'
        identity = (str(destination.absolute()), fingerprint(asdict(binding)))
        if self.persisted is not None:
            need(self.persisted[0] == identity)
            return self.persisted[1]
        destination.mkdir(mode=0o700, exist_ok=False)
        r = self.result
        for index, name in enumerate(sorted(r['payloads'])):
            atomic_write(destination / f'payload-{index}', r['payloads'][name], 0o600)
        manifest = {k: v for k, v in r.items() if k != 'payloads'}
        manifest.update(schema='GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1', validation='bounded_secret_checked', binding=asdict(binding),
                        payload_files={n: f'payload-{i}' for i, n in enumerate(sorted(r['payloads']))})
        manifest['fingerprint'] = fingerprint(manifest)
        atomic_write(destination / 'manifest.json', manifest, 0o600)
        # atomic_write fsyncs file bytes; seal directory entries before allowing
        # native parsing/finally to delete the source workspace.
        for path in (destination, Path(directory)):
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        self.persisted = (identity, manifest)
        return manifest


def reconciled_stop(current, failure, *, checkpoint, checkpoint_ref, native_receipt,
                    receipt_refs, actual_effects, owned_reaped):
    """Called with fixed-path native receipt AFTER invoke and its finalizers.

    Usage unknown is deliberately not actual-effects unknown. Raw native error
    and charge receipts are retained separately; this function never clears them.
    """
    protected = _protected_stop_inputs(current, failure, checkpoint, checkpoint_ref, native_receipt, receipt_refs)
    if not protected:
        return None
    proc_stop = type(protected) is dict and protected.get('kind') == 'exclusive-uid-proc-stop-v1'
    if (not isinstance(failure, policy.CapacityFailure) or failure.binding != current
            or actual_effects != 'RECONCILED' or owned_reaped is not True
            or checkpoint.get('binding') != asdict(current)
            or checkpoint.get('schema') != 'GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1'
            or checkpoint.get('fingerprint') != fingerprint({k: v for k, v in checkpoint.items()
                                                           if k != 'fingerprint'})
            or not checkpoint_ref or not receipt_refs):
        return None
    # Native cleanup remains mandatory. Absent cgroups require actual protected
    # Root proc proof; a checkpoint validation label cannot substitute for stop.
    if current.provider == policy.AGY:
        if (native_receipt.get('schema') != 'GB_AGY_AUTHOR_RECEIPT_V1'
                or native_receipt.get('phase') != 'failed_no_automatic_replay'
                or (native_receipt.get('executor_reap') != 'cgroup-quiet'
                    and checkpoint.get('reconciliation') != 'ROOT_READONLY_INVENTORY_NO_SOURCE_EFFECT'
                    and not proc_stop)
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


def prospective_capacity_policy(pipeline):
    """Protected Root global activation; default OFF, exact pipeline generation."""
    try:
        from live import _qa_root_config
        value = _qa_root_config().get('author_capacity_recovery_policy')
        need(type(value) is dict and value.get('schema') == 'GB_ROOT_CAPACITY_POLICY_V1'
             and value.get('enabled') is True and value.get('pipeline_revision') == pipeline
             and policy._sha(pipeline) and type(value.get('generation')) is str
             and len(value['generation']) == 64
             and all(c in '0123456789abcdef' for c in value['generation']))
        return json.loads(json.dumps(value))
    except Exception:
        return None


def capacity_task_hash(claim, current):
    # Same frozen payload delivered to the native canonical task contract.
    task = dict(claim['task'], issue=claim['issue'], revision=claim['revision'])
    for key in ('worktree', 'runtime_base_sha', 'author_attempt', 'attempt',
                'findings', 'repair_findings', 'ci_failure', '_bound_author',
                '_author_operation', '_capacity_successor'):
        task.pop(key, None)
    task['_bound_author'] = claim['bound_author']
    task['_author_operation'] = current.operation
    if claim.get('capacity_successor'):
        task['_capacity_successor'] = claim['capacity_successor']
    return fingerprint(task)


def validate_capacity_identity(claim, current):
    from providers import digest
    need(str(claim['issue']) == current.task and claim['bound_author']['mode'] == 'on'
         and claim['bound_author']['revision'] == claim['revision']
         and claim['bound_author']['decision']['provider'] == current.provider
         and fingerprint(sorted(claim['task']['allowed_paths'])) == current.scope_id
         and claim['base_sha'] == current.original_base
         and digest(dict(revision=claim['revision'], attempt=claim['author_attempt'])) == current.operation)


def capacity_claim(lease, claim_path, current):
    from run import WriterLease
    from live import _qa_protected_bytes
    from providers import loads
    need(isinstance(lease, WriterLease) and claim_path is not None)
    claim = loads(_qa_protected_bytes(claim_path, results=True))
    lease.verify_capacity(claim)
    validate_capacity_identity(claim, current)
    need(claim.get('phase') in ('RUNNING', 'BLOCKED')
         and claim.get('owner_authorization') and type(claim.get('capacity_policy')) is dict
         and claim.get('capacity_policy')
         == prospective_capacity_policy(claim['bound_author']['pipeline']))
    return claim


def import_capacity_checkpoint(claim, lease):
    """Root readback and source-only import; existing owner-safe helper + git CAS."""
    from live import _qa_protected_bytes, git, owner_safe_atomic_import
    from providers import loads, atomic_write
    lease.verify_capacity(claim)
    need(os.geteuid() == 0)
    proposal = claim['capacity_proposal']
    stop = proposal['chain'][-1]
    current = policy.Operation(**stop['failure']['binding'])
    key, authority, op, native, failure = _recovery_inputs(current)
    need(authority.get('prospective') is True)
    control = protected_capacity_decoder(task={}, evidence_dir='', current=current)
    need(control is not None and control.failure == failure)
    ref = control.proof.checkpoint_ref
    checkpoint = loads(_qa_protected_bytes(ref, results=True))
    names = checkpoint['changed_paths']; deleted = checkpoint['deleted']
    need(type(names) is list and len(names) == len(set(names))
         and set(names) <= set(claim['task']['allowed_paths'])
         and set(deleted) <= set(names)
         and set(checkpoint['payload_files']) == set(names) - set(deleted)
         and set(checkpoint['payload_hashes']) == set(checkpoint['payload_files']))
    payloads = {}
    for i, name in enumerate(sorted(checkpoint['payload_files'])):
        need(checkpoint['payload_files'][name] == f'payload-{i}')
        raw = _qa_protected_bytes(Path(ref).parent / f'payload-{i}', results=True)
        need(len(raw) <= 8 << 20 and hashlib.sha256(raw).hexdigest() == checkpoint['payload_hashes'][name])
        payloads[name] = raw
    need(sum(map(len, payloads.values())) <= 64 << 20)
    work = claim['worktree']; source = current.source_sha
    need(Path(work).stat().st_uid == 1002
         and git(work, 'rev-parse', 'HEAD') == source and not git(work, 'status', '--porcelain'))
    for name in names:
        need(type(name) is str and not name.startswith('/')
             and all(p and p not in ('.', '..') and not p.startswith('.') for p in name.split('/')))
        target = Path(work) / name
        need(not any(p.is_symlink() for p in (target, *target.parents)))
    lease.verify_capacity(claim)
    def commit_receipt(head):
        from live import _QA_RESULTS
        ref_path = _QA_RESULTS / ('capacity-import-' + key + '.json')
        receipt = dict(schema='GB_ROOT_CAPACITY_IMPORT_V1', binding=asdict(current),
            checkpoint_fingerprint=checkpoint['fingerprint'], source_sha=source,
            checkpoint_sha=head, changed_paths=names, worktree=work,
            kind='commit_cas' if names else 'confirmed_clean_sha')
        if names:
            need(git(work, 'rev-list', '--parents', '-n', '1', head).split() == [head, source])
        lease.verify_capacity(claim)
        need(not ref_path.exists())
        atomic_write(ref_path, receipt, 0o600)
        need(loads(_qa_protected_bytes(ref_path, results=True)) == receipt)
        fd = os.open(_QA_RESULTS, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
    if not names:
        need(checkpoint['partial_state'] == 'confirmed_empty_diff')
        commit_receipt(source)
        return source, checkpoint
    # The producer's bounded secret-checked snapshot is authoritative only after
    # protected custody/hash revalidation. Never read opaque quarantined bytes.
    need(checkpoint.get('validation') == 'bounded_secret_checked')
    imported = True  # Partial importer failures also require bounded rollback.
    try:
        owner_safe_atomic_import(worktree=work, payloads=payloads, deleted=deleted)
        imported = True
        need(git(work, 'rev-parse', 'HEAD') == source)
        actual = sorted(filter(None, git(work, 'diff', '--name-only', '-z', 'HEAD').split('\0')))
        untracked = sorted(filter(None, git(work, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')))
        need(sorted(set(actual + untracked)) == sorted(names))
        for name, raw in payloads.items():
            need((Path(work) / name).read_bytes() == raw)
        need(all(not (Path(work) / name).exists() for name in deleted))
        lease.verify_capacity(claim)
        git(work, 'add', '--', *names)
        for name, raw in payloads.items():
            need((Path(work) / name).read_bytes() == raw
                 and git(work, 'rev-parse', ':' + name) == git(work, 'hash-object', '--', name))
        # Write a commit without moving HEAD, then compare-and-swap the ref.
        tree = git(work, 'write-tree')
        commit = git(work, '-c', 'user.name=agentagency-dev', '-c',
            'user.email=agentagency-dev@localhost', '-c', 'commit.gpgsign=false',
            'commit-tree', tree, '-p', source, '-m', f'lean: issue-{claim["issue"]} retained capacity checkpoint')
        need(policy._sha(commit))
        lease.verify_capacity(claim)
        git(work, 'update-ref', 'HEAD', commit, source)
        need(git(work, 'rev-parse', 'HEAD') == commit and not git(work, 'status', '--porcelain'))
        need(sorted(filter(None, git(work, 'diff', '--name-only', '-z', source, commit).split('\0'))) == sorted(names))
        commit_receipt(commit)
        return commit, checkpoint
    except Exception:
        # Only roll back our own import while the source reference is unchanged.
        # A raced reference is held for reconciliation, never reset over it.
        lease.verify_capacity(claim)
        if imported and git(work, 'rev-parse', 'HEAD') == source:
            changed_now = set(filter(None, git(work, 'diff', '--name-only', '-z', 'HEAD').split('\0')))
            unknown_now = set(filter(None, git(work, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')))
            need((changed_now | unknown_now) <= set(names))
            git(work, 'reset', '--hard', source)
            for name in payloads:
                if name not in checkpoint.get('before', {}):
                    target = Path(work) / name
                    if target.is_file() and not target.is_symlink(): target.unlink()
        raise


def _protected_stop_inputs(current, failure, checkpoint, checkpoint_ref, native_receipt, receipt_refs):
    """No caller dictionary/ref/boolean can substitute protected operation proof."""
    try:
        from live import _qa_protected_bytes, _qa_root_config, _QA_RESULTS
        from providers import loads
        key, _, op, observed_native, observed_failure = _recovery_inputs(current)
        need(observed_native == native_receipt and observed_failure == failure)
        authority = _recovery_inputs(current)[1]
        raw = _qa_protected_bytes(_QA_RESULTS / ('capacity-recovery-' + key + '.json'), results=True)
        r = loads(raw)
        need(r.get('schema') == 'GB_ROOT_CAPACITY_RECOVERY_V1' and r.get('binding') == asdict(current)
             and r.get('boot') == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
             and r.get('nonce') == authority.get('nonce') and r.get('state') == 'RECONCILED'
             and r.get('failure_fingerprint') == failure.fingerprint
             and r.get('checkpoint_ref') == checkpoint_ref and r.get('native_receipt') == native_receipt
             and tuple(r.get('receipt_refs', [])) == tuple(receipt_refs))
        raw = _qa_protected_bytes(checkpoint_ref, results=True)
        need(hashlib.sha256(raw).hexdigest() == r['checkpoint_sha256'] and loads(raw) == checkpoint)
        parent = Path(checkpoint_ref).parent
        need(set(checkpoint.get('changed_paths', [])) ==
             set(checkpoint.get('payload_files', {})) | set(checkpoint.get('deleted', [])))
        for i, name in enumerate(sorted(checkpoint.get('payload_files', {}))):
            leaf = checkpoint['payload_files'][name]; need(leaf == f'payload-{i}')
            need(hashlib.sha256(_qa_protected_bytes(parent / leaf, results=True)).hexdigest()
                 == checkpoint['payload_hashes'][name])
        return op.get('owned_stop') or True
    except Exception: return False


def _recovery_inputs(current):
    """Fixed Root operation/capture readback, never dataTask authority."""
    from live import _qa_protected_bytes, _qa_root_config, _QA_RESULTS
    from providers import loads, typed_agy_capacity
    key = fingerprint(asdict(current))
    authority = _qa_root_config().get('author_capacity_recovery', {}).get(key)
    fixed = _QA_RESULTS / ('capacity-operation-' + key + '.json')
    raw_op = _qa_protected_bytes(fixed, results=True)
    op = loads(raw_op)
    prospective = op.get('prospective')
    if prospective is not None:
        claim = loads(_qa_protected_bytes(prospective['claim_ref'], results=True))
        need(type(claim.get('capacity_policy')) is dict
             and claim.get('capacity_policy') == prospective.get('policy')
             == prospective_capacity_policy(claim['bound_author']['pipeline'])
             and claim.get('owner_authorization')
             and claim['revision'] == prospective['revision']
             and fingerprint(claim['task']) == prospective['task_fingerprint'])
        validate_capacity_identity(claim, current)
        need(op['task_sha256'] == capacity_task_hash(claim, current))
        need(op.get('owned_stop', {}).get('kind') == 'exclusive-uid-proc-stop-v1'
             and op.get('checkpoint_ref'))
        authority = dict(enabled=True, nonce=op.get('nonce'),
                         operation_sha256=hashlib.sha256(raw_op).hexdigest(), prospective=True)
    need(type(authority) is dict and authority.get('enabled') is True
         and type(authority.get('nonce')) is str and len(authority['nonce']) == 64
         and hashlib.sha256(raw_op).hexdigest() == authority.get('operation_sha256'))
    need(op.get('schema') == 'GB_ROOT_CAPACITY_OPERATION_V1' and op.get('binding') == asdict(current)
         and op.get('nonce') == authority['nonce'] and op.get('boot') ==
         Path('/proc/sys/kernel/random/boot_id').read_text().strip()
         and op.get('executor_uid') == 978 and op.get('native_completed') is True
         and op.get('source_sha') == current.source_sha and op.get('scope_id') == current.scope_id
         and type(op.get('task_sha256')) is str and len(op['task_sha256']) == 64
         and type(op.get('sdk_pid')) is int and op['sdk_pid'] > 1
         and not Path('/proc', str(op['sdk_pid'])).exists())
    if op.get('owned_stop', {}).get('kind') == 'exclusive-uid-proc-stop-v1':
        proof = _exclusive_stop(uid=978, sdk=op['sdk_identity'], native=op['native_identity'],
                                boot=op['boot'], sdk_exited=True)
        need(op['owned_stop'] == proof and proof['native'] is not None)
        custody = loads(_qa_protected_bytes(op['custody_ref'], results=True))
        need(custody.get('schema') == 'GB_ROOT_SOURCE_CUSTODY_V1'
             and custody.get('binding') == asdict(current) and custody.get('nonce') == op['nonce']
             and custody.get('boot') == op['boot'] and custody.get('task_sha256') == op['task_sha256']
             and custody.get('native_identity') == op['native_identity']
             and custody.get('sdk_identity') == op['sdk_identity']
             and custody.get('checkpoint_ready') is True and not custody.get('fault')
             and custody.get('checkpoint_sha256') == op.get('checkpoint_sha256')
             and custody.get('cli_sha256') == op.get('cli_sha256'))
        checkpoint_raw = _qa_protected_bytes(op['checkpoint_ref'], results=True)
        checkpoint = loads(checkpoint_raw)
        need(hashlib.sha256(checkpoint_raw).hexdigest() == op['checkpoint_sha256']
             and checkpoint.get('binding') == asdict(current)
             and checkpoint.get('validation') == 'bounded_secret_checked'
             and checkpoint.get('fingerprint') == fingerprint({k:v for k,v in checkpoint.items() if k != 'fingerprint'}))
    # Actual observation; cgroup-absent is not cgroup-quiet. Permission failures
    # are HOLD, and no absence observation is accepted from a caller boolean.
    need(_uid_processes(978) == [])
    def read(ref, expected):
        raw = _qa_protected_bytes(ref, results=True)
        need(hashlib.sha256(raw).hexdigest() == expected)
        return raw
    native = loads(read(op['native_ref'], op['native_sha256']))
    need(native.get('executor_reap') == 'cgroup-quiet' or
         op.get('owned_stop', {}).get('kind') == 'exclusive-uid-proc-stop-v1' or
         authority.get('adjudication') == 'LEGACY_526_ATTEMPT5_NO_SOURCE_EFFECT')
    need(native.get('schema') == 'GB_AGY_AUTHOR_RECEIPT_V1'
         and native.get('phase') == 'failed_no_automatic_replay'
         and native.get('source_head') == current.source_sha
         and native.get('task_sha256') == op['task_sha256'] and native.get('exit_code') == 3
         and native.get('charge_state') == 'charged'
         and not any(k.startswith('cleanup') and v == 'failed' for k,v in native.items())
         and native.get('oauth_refresh') != 'failed' and native.get('receipt_persist') != 'failed')
    raw = read(op['raw_ref'], op['raw_sha256'])
    stderr = read(op['stderr_ref'], op['stderr_sha256'])
    failure = typed_agy_capacity(stderr, raw, producer=op, binding=current)
    need(failure is not None)
    return key, authority, op, native, failure


def adjudicate_capacity_recovery(current, *, nonce=None, lease=None, claim_path=None):
    """Explicit Root operator API, to be called only after QA/CI/install.

    Requires an exact enabled protected policy and protected completed-operation
    capture. Acquires the existing global writer lease; never edits admissions,
    charge ledgers, raw/native records, or performs a model call/automatic replay.
    Unsupported evidence returns HOLD. This source operation never invokes it.
    """
    owned_here = False
    try:
        need(os.geteuid() == 0 and current.provider == policy.AGY)
        from run import WriterLease
        from live import _qa_protected_bytes, _QA_RESULTS
        from providers import loads, atomic_write
        # Scope is read from protected op, never a task-supplied lock bypass.
        key, authority, op, native, failure = _recovery_inputs(current)
        if authority.get('prospective'):
            capacity_claim(lease, claim_path, current)
            nonce = authority['nonce']
        else:
            need(lease is None and nonce == authority['nonce'])
            lease = WriterLease(current.task, op['allowed_paths']); lease.acquire()
            owned_here = True
        need(fingerprint(sorted(op['allowed_paths'])) == current.scope_id)
        final = _QA_RESULTS / ('capacity-recovery-' + key + '.json')
        if final.exists():
            need(protected_capacity_decoder(task={}, evidence_dir='', current=current) is not None)
            return dict(action='RECORDED', receipt=str(final))
        checkpoint_ref = op.get('checkpoint_ref')
        if checkpoint_ref:
            raw = _qa_protected_bytes(checkpoint_ref, results=True)
            checkpoint = loads(raw)
            need(native.get('executor_reap') == 'cgroup-quiet' or
                 op.get('owned_stop', {}).get('kind') == 'exclusive-uid-proc-stop-v1')
            need(hashlib.sha256(raw).hexdigest() == op['checkpoint_sha256'])
        else:
            # Bounded historical exception is an explicit inference over a
            # complete FIXED readonly inventory, never an observed after-tree.
            need(authority.get('adjudication') == 'LEGACY_526_ATTEMPT5_NO_SOURCE_EFFECT'
                 and current.task == '526'
                 and current.source_sha == 'd12752f6d0f0eceb8641b21ed608c4f22a2f2a07'
                 and op['raw_sha256'] == '02a5c97fd8c7756a8aeb3c9399f48c29a14b464a128d1ca871ae1629b48c83e1'
                 and op['stderr_sha256'] == '59ca98fcb2d3b6a93ae85b56d964223eb6b6e40594581fcbc692032d9c9d1e67'
                 and native.get('source_export_sha256') == '446e3b5d2f3d60ee06325170856d8d0f5a93612376aa5faf76e763fe6830547b'
                 and op.get('accepted_clean_source') == current.source_sha
                 and op.get('complete_readonly_inventory_sha256') ==
                 '8b04f12daf8c3b42584d631999a40c09510cecd05ede7442f3a5df9a3387b16a')
            checkpoint = dict(schema='GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1', binding=asdict(current),
                changed_paths=[], deleted=[], payload_files={}, payload_hashes={},
                partial_state='confirmed_empty_diff', reconciliation='ROOT_READONLY_INVENTORY_NO_SOURCE_EFFECT',
                private_after_tree_observed=False)
            checkpoint['fingerprint'] = fingerprint(checkpoint)
            checkpoint_ref = str(_QA_RESULTS / ('capacity-checkpoint-' + key + '.json'))
            need(not Path(checkpoint_ref).exists())
            atomic_write(checkpoint_ref, checkpoint, 0o600)
            raw = _qa_protected_bytes(checkpoint_ref, results=True)
        need(checkpoint.get('binding') == asdict(current)
             and set(checkpoint.get('changed_paths', [])) <= set(op['allowed_paths']))
        # Reobserve all identities immediately before the immutable receipt.
        need(_recovery_inputs(current)[2] == op)
        receipt = dict(schema='GB_ROOT_CAPACITY_RECOVERY_V1', state='RECONCILED',
            binding=asdict(current), boot=op['boot'], nonce=nonce,
            failure_fingerprint=failure.fingerprint, checkpoint_ref=checkpoint_ref,
            checkpoint_sha256=hashlib.sha256(raw).hexdigest(), native_receipt=native,
            receipt_refs=[op['native_ref'], str(_QA_RESULTS / ('capacity-operation-' + key + '.json'))])
        atomic_write(final, receipt, 0o600)
        fd = os.open(_QA_RESULTS, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
        return dict(action='RECORDED', receipt=str(final), source_effect=checkpoint.get('reconciliation', 'CHECKPOINT'))
    except Exception:
        return dict(action='HOLD', reason='protected_capacity_adjudication_unproven')
    finally:
        if owned_here: lease.release()


def protected_capacity_decoder(*, task, evidence_dir, error=None, current=None):
    """Existing Adapters.author_capacity seam; no strings or task authority."""
    try:
        from live import _QA_RESULTS, _qa_protected_bytes
        from providers import loads
        if current is None:
            route = bound_provider(task)
            need(route is not None)
            from live import git
            current = operation(task, route[0], git(task['worktree'], 'rev-parse', 'HEAD'))
        key, _, op, native, failure = _recovery_inputs(current)
        r = loads(_qa_protected_bytes(_QA_RESULTS / ('capacity-recovery-' + key + '.json'), results=True))
        checkpoint = loads(_qa_protected_bytes(r['checkpoint_ref'], results=True))
        proof = reconciled_stop(current, failure, checkpoint=checkpoint, checkpoint_ref=r['checkpoint_ref'],
            native_receipt=native, receipt_refs=r['receipt_refs'], actual_effects='RECONCILED', owned_reaped=True)
        if proof is None: return None
        return policy.CapacityStop(failure, proof)
    except Exception: return None
