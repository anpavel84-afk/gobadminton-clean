"""Cursor Auto author adapter inside the existing Actions stage and worker lock."""
import hashlib
import grp
import pwd
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import tempfile
import time
from core import need, digest, loads
from native_guard import CURSOR_PIN, cursor_namespace_argv, no_new_privileges

MARKER = Path('/etc/gobadminton-slots/cursor-author.json')
AUTH = Path('/home/agentagency-dev/.config/cursor/auth.json')
SLOT_UIDS = {'slot1': 1002, 'slot2': 978}
PIN_HASHES = {'node': 'e0e46d3a1c0667117303412647cafcbcefb1be7612493015ec8fd6b7440162a4',
              'index.js': '39218adfc45db4c75727b3a19c61ac12ff671aa4417c94591a1b1469658c59ea',
              'cursorsandbox': '615ec4dd5ebfbc31868ee7043781a7c060e3909c4f4b085816a1ff5518ad5ef7'}
MAX_FILE, MAX_TREE, MAX_STREAM = 8 << 20, 64 << 20, 8 << 20
AUTHOR_TOOLS = 'shell_tool_call,delete_tool_call,glob_tool_call,grep_tool_call,read_tool_call,edit_tool_call,ls_tool_call,read_lints_tool_call'


def author_config(work):
    # Writes are private to the exported task environment. Trusted import below
    # enforces immutable allowed_paths; builds/tests may create ignored outputs.
    return {'permissions': {'allow': ['Read('+str(work)+'/**)', 'Write('+str(work)+'/**)'], 'deny': []},
            'sandbox': {'mode': 'enabled', 'networkAccess': 'user_config_with_defaults',
                        'networkAllowlist': ['dev.gobadminton.ru', 'localhost', '127.0.0.1'],
                        'readBoundary': 'system'}}
AUTORULE_NAMES = {'AGENTS.md', 'CLAUDE.md', '.cursorrules', '.mcp.json'}
AUTORULE_DIRS = {'.git', '.cursor', '.codex', '.claude', '.agents'}


def _read(path, owners, limit):
    """Exact fd traversal: root never follows a user-controlled auth symlink."""
    path = Path(path)
    need(path.is_absolute(), 'absolute trusted input required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            n = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            os.close(fd); fd = n
            s = os.fstat(fd)
            private_config = path == AUTH and part == '.config' and s.st_uid == 1002 and s.st_gid == 1002
            if private_config:
                group = grp.getgrgid(1002)
                private_config = group.gr_name == 'agentagency-dev' and not group.gr_mem and {u.pw_uid for u in pwd.getpwall() if u.pw_gid == 1002} == {1002}
            need(s.st_uid in owners and not s.st_mode & (0o002 if private_config else 0o022),
                 'untrusted native input metadata')
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'invalid native input file')
        raw = os.read(fd, limit + 1)
        need(len(raw) <= limit, 'native input too large')
        return raw
    finally:
        os.close(fd)


def qualification(slot, task_hash):
    need(slot in SLOT_UIDS, 'unsupported Cursor slot')
    m = loads(_read(MARKER, {0}, 16384))
    need(m.get('schema') == 'GB_CURSOR_AUTHOR_211_V1' and m.get('phase') in ('canary', 'ready')
         and slot in m.get('slots', []), 'Cursor author not qualified for slot')
    need(m['phase'] == 'ready' or m.get('canary_task_sha256') == task_hash,
         'Cursor restricted to reviewed train canary')
    for name in ('native_cursor.py', 'native_guard.py'):
        need(m.get('modules', {}).get(name) == hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest(),
             'Cursor installed module drift')
    for name, expected in PIN_HASHES.items():
        need(hashlib.sha256(_read(CURSOR_PIN/name, {0}, 256 << 20)).hexdigest() == expected,
             'Cursor executable pin drift')
    return m


def available(slot, task_hash):
    try:
        qualification(slot, task_hash)
        return True, 'qualified native author'
    except Exception as e:
        return False, 'Cursor qualification unavailable: ' + str(e)[:180]


def existing_auth_for_stage(slot, task_hash):
    """Root fork reads existing login before setuid; token stays private memory.

    No auth file, permissions, login or billing mechanism is modified. Never put
    this value in request/journal JSON, argv, errors or public process receipts.
    """
    need(os.geteuid() == 0, 'Cursor login loading requires existing root bridge')
    qualification(slot, task_hash)
    value = loads(_read(AUTH, {0, 1002}, 65536))
    token = value.get('accessToken')
    need(isinstance(token, str) and 10 <= len(token) <= 16384
         and all(33 <= ord(c) <= 126 for c in token), 'existing Cursor login unavailable')
    return token


def source_name(name):
    need(isinstance(name, str) and name and len(name) <= 240
         and all(p not in ('', '.', '..') for p in name.split('/'))
         and not name.startswith('/') and '\\' not in name and all(c.isprintable() for c in name),
         'unsafe exported source name')
    parts = Path(name).parts
    return not any(p in AUTORULE_DIRS for p in parts) and not any(p in AUTORULE_NAMES for p in parts)


def _source(path, root):
    need(not any(p.is_symlink() for p in (path, *path.parents) if p == root or root in p.parents),
         'symlink source refused')
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= MAX_FILE,
         'nonregular/oversized source refused')
    return path.read_bytes()


def export(bridge, work):
    files, total = {}, 0
    for name in filter(None, bridge.git('ls-files', '-z', cwd=bridge.work).split('\0')):
        if not source_name(name): continue
        raw = _source(bridge.work/name, bridge.work)
        total += len(raw)
        need(total <= MAX_TREE and len(files) < 10000, 'source export limit exceeded')
        p = work/name; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw); p.chmod(0o755 if (bridge.work/name).stat().st_mode & 0o111 else 0o644)
        files[name] = hashlib.sha256(raw).hexdigest()
    need(files, 'empty source export')
    return files


def snapshot(work, bridge, baseline):
    # Ignore only untracked generated outputs according to the ORIGINAL trusted
    # checkout. The candidate cannot relax import by editing its .gitignore.
    def ignored(name):
        result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                                 'check-ignore', '--no-index', '--quiet', '--', name],
                                cwd=bridge.work, env=bridge.env, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=15)
        need(result.returncode in (0, 1), 'trusted ignore check failed')
        return result.returncode == 0
    files, total = {}, 0
    for parent, dirs, names in os.walk(work, followlinks=False):
        for name in list(dirs):
            p = Path(parent)/name; rel = p.relative_to(work).as_posix()
            tracked = any(n.startswith(rel+'/') for n in baseline)
            if not tracked and ignored(rel+'/'):
                dirs.remove(name); continue
            need(not p.is_symlink(), 'native output symlink directory refused')
        for name in names:
            p = Path(parent)/name; rel = p.relative_to(work).as_posix()
            if rel not in baseline and ignored(rel): continue
            need(source_name(rel), 'native output instruction/Git configuration refused')
            raw = _source(p, work); total += len(raw)
            need(total <= MAX_TREE and len(files) < 10000, 'native output bound exceeded')
            files[rel] = hashlib.sha256(raw).hexdigest()
    return files


def process_boundary(parent_pid, node, uid):
    for _ in range(40):
        pending, seen = [parent_pid], set()
        while pending:
            pid = pending.pop()
            if pid in seen: continue
            seen.add(pid); p = Path('/proc')/str(pid)
            try:
                argv = p.joinpath('cmdline').read_bytes().split(b'\0')
                if argv and argv[0].decode(errors='replace') == node:
                    fields = dict(l.split(':', 1) for l in p.joinpath('status').read_text().splitlines() if ':' in l)
                    label = p.joinpath('attr/current').read_text().strip()
                    maps = [tuple(map(int,l.split())) for l in p.joinpath('uid_map').read_text().splitlines() if l.strip()]
                    ns = {n: os.readlink(p/'ns'/n) for n in ('mnt', 'pid', 'user')}
                    need('gobadminton_cursor_namespace' in label and 'unpriv_bwrap' not in label
                         and fields.get('NoNewPrivs', '').strip() == '1'
                         and int(fields.get('CapEff', '1'),16) == 0
                         and len(maps) == 1 and maps[0][1:] == (uid, 1)
                         and all(ns[n] != os.readlink(Path('/proc/self/ns')/n) for n in ns),
                         'Cursor namespace or host privilege boundary refused')
                    return dict(pid=pid, apparmor=label, uid_map=maps, effective_capabilities='0',
                                no_new_privs=True, namespaces=ns)
                pending += [int(v) for v in p.joinpath('task',str(pid),'children').read_text().split()]
            except (OSError, ValueError): pass
        time.sleep(0.05)
    need(False, 'Cursor native process not observed before prompt')


def parse_stream(raw):
    need(len(raw) <= MAX_STREAM, 'Cursor transcript exceeds bound')
    events = [loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
    need(events and len(events) <= 20000 and all(type(e) is dict for e in events), 'invalid Cursor stream')
    results = [e for e in events if e.get('type') == 'result']
    init = [e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init']
    need(len(init) == 1 and init[0].get('model') == 'Auto', 'effective Cursor route not Auto')
    need(len(results) == 1 and results[0] is events[-1] and results[0].get('subtype') == 'success'
         and results[0].get('is_error') is False, 'Cursor terminal success missing')
    need(any(e.get('type') == 'assistant' for e in events), 'Cursor inference evidence missing')
    insecure = []
    for event in events:
        if event.get('type') != 'tool_call' or event.get('subtype') != 'completed': continue
        shell = event.get('tool_call', {}).get('shellToolCall')
        if not shell: continue
        policy = shell.get('args', {}).get('requestedSandboxPolicy', {}).get('type')
        result = shell.get('result', {})
        if policy not in ('TYPE_WORKSPACE_READWRITE', 'TYPE_WORKSPACE_READONLY') and ('success' in result or 'failure' in result):
            insecure.append(policy)
    need(not insecure, 'Cursor executed Shell without native sandbox; no source import')
    usage = results[0].get('usage')
    need(usage is None or type(usage) is dict and all(type(v) is int and v >= 0 for v in usage.values()),
         'invalid provider-reported Cursor usage')
    ids = {e['model_call_id'] for e in events if isinstance(e.get('model_call_id'),str)}
    return dict(effective_route='Auto', underlying_model=None, effort=None, provider_internal_calls=None,
                observed_model_call_ids=len(ids), provider_reported_usage=usage,
                tool_events=sum(e.get('type') == 'tool_call' and e.get('subtype') == 'completed' for e in events),
                retries=sum(e.get('type') == 'retry' for e in events), transcript_sha256=hashlib.sha256(raw).hexdigest())


def _stop(p):
    if p.poll() is None:
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    p.wait(timeout=5)


def invoke(bridge, rt, prompt, token, choice, *, popen, atomic, permitted):
    active = bridge.store.data['active']; task = active['task']
    qualification(rt.slot, digest(task))
    uid = SLOT_UIDS[rt.slot]
    need(os.geteuid() == uid and uid != 0 and isinstance(token,str) and token,
         'Cursor stage identity/auth unavailable')
    base = Path(tempfile.mkdtemp(prefix='gb-cursor-211-author-',dir='/tmp'))
    for n in ('home','config','data','cache','tmp','work'):(base/n).mkdir(mode=0o700)
    work = base/'work'; before = export(bridge,work)
    config = author_config(work)
    (base/'config/cli-config.json').write_text(json.dumps(config))
    env = {'PATH':'/opt/gb-slots/runtime/node/bin:/usr/bin:/bin','LANG':'C.UTF-8','HOME':str(base/'home'),'TMPDIR':str(base/'tmp'),
           'XDG_CONFIG_HOME':str(base/'config'),'XDG_DATA_HOME':str(base/'data'),'XDG_CACHE_HOME':str(base/'cache'),
           'CURSOR_CONFIG_DIR':str(base/'config'),'CURSOR_DATA_DIR':str(base/'data'),
           'CURSOR_SANDBOX_POLICY_DIR':str(base/'data/sandbox-policies'), 'DIRENV_DISABLE':'1',
           'AGENT_CLI_CREDENTIAL_STORE':'memory','CURSOR_AUTH_TOKEN':token}
    node = str(CURSOR_PIN/'node')
    command = [node,str(CURSOR_PIN/'index.js'),'--print','--output-format','stream-json','--model','auto',
               '--sandbox=enabled','--disable-project-configs','--disable-auto-update','--disable-indexing',
               '--disable-codebase-ref','--allowed-tools',AUTHOR_TOOLS,'--trust',
               '--single-turn','--workspace',str(work)]
    argv = cursor_namespace_argv(base,command)
    receipt = dict(schema='GB_CURSOR_AUTHOR_RECEIPT_V1',phase='prepared',issue=active['issue'],attempt=active['attempt'],
                   source_head=active.get('head') or active['base'],task_sha256=digest(task),
                   requested_route='cursor:auto',requested_model='auto',requested_effort=None,
                   job=str(base),rules_context=dict(choice['rules_context'],cwd=str(work)),
                   source_export_sha256=digest(before),started_at=int(time.time()),provider_internal_calls=None)
    path = rt.layout.outbox/'cursor-author-receipt.json'
    def save(): atomic(path, receipt)
    save()
    def child():
        no_new_privileges();resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_FSIZE,(512 << 20,512 << 20))
    p = None
    try:
        rt.budget.charge(rt.slot,'cursor','author')
        receipt['phase']='charged';save()
        with (base/'stream.jsonl').open('xb') as out,(base/'stderr').open('xb') as err:
            p = popen(argv,cwd=work,env=env,stdin=subprocess.PIPE,stdout=out,stderr=err,
                      close_fds=True,start_new_session=True,preexec_fn=child)
            receipt.update(phase='running',process=process_boundary(p.pid,node,uid));save()
            try:p.communicate(input=prompt.encode(),timeout=bridge.c.model_timeout)
            finally:_stop(p)
        receipt['exit']=p.returncode
        need(p.returncode == 0,'Cursor provider exited unsuccessfully; no source import')
        need((base/'stream.jsonl').stat().st_size <= MAX_STREAM and (base/'stderr').stat().st_size <= MAX_STREAM, 'Cursor output exceeds bound')
        raw=(base/'stream.jsonl').read_bytes()
        need(token.encode() not in raw and token.encode() not in (base/'stderr').read_bytes(),
             'Cursor credential output refused')
        result=parse_stream(raw);receipt.update(result)
        after_config=json.loads((base/'config/cli-config.json').read_text())
        need(after_config.get('permissions')==config['permissions']
             and all(after_config.get('sandbox',{}).get(k)==v for k,v in config['sandbox'].items()),
             'Cursor invocation permissions changed')
        need(not any(base.rglob('auth.json')),'Cursor auth persistence refused')
        after=snapshot(work,bridge,before)
        changed=sorted(n for n in set(before)|set(after) if before.get(n)!=after.get(n))
        need(changed and all(permitted(n,task['allowed_paths']) for n in changed),
             'Cursor returned empty or unauthorized source diff')
        payloads = {name: _source(work/name,work) for name in changed if name in after}
        need(all(token.encode() not in raw for raw in payloads.values()), 'provider credential in source output refused')
        for name in changed:
            target = bridge.work/name
            need(not any(x.is_symlink() for x in (target,*target.parents)), 'source destination symlink refused')
        receipt.update(phase='validated',changed_paths=changed,output_manifest_sha256=digest(after));save()
        # All model processes stopped; the existing trusted writer alone imports.
        for name in changed:
            target=bridge.work/name
            need(not any(x.is_symlink() for x in (target,*target.parents)), 'source destination symlink refused')
            if name not in after:
                target.unlink();continue
            raw=payloads[name]
            mode=stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
            target.parent.mkdir(parents=True,exist_ok=True)
            fd,tmp=tempfile.mkstemp(prefix='.cursor-source-',dir=target.parent)
            try:
                os.fchmod(fd,mode & 0o777)
                with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
                os.replace(tmp,target)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
        receipt.update(phase='imported',finished_at=int(time.time()));save()
        choice['native_receipt']=receipt
        return result
    except BaseException:
        if p is not None and p.poll() is None:_stop(p)
        receipt.update(phase='failed_no_automatic_replay',finished_at=int(time.time()));save()
        choice['native_receipt']=receipt
        raise
