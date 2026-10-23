#!/usr/bin/python3
"""Bounded #211 whole-client startup probe; no model inference or host changes."""
import hashlib,json,os,pathlib,signal,subprocess,sys,time
ROOT=pathlib.Path('/srv/gobadminton-clean/worktrees/ops-native-provider-211-20261022')
sys.path.insert(0,str(ROOT/'scripts/chatops/actions_train'))
from native_guard import restrict
PIN=pathlib.Path('/opt/gobadminton-cursor-cli/2026.10.01-e373342')
BASE=pathlib.Path('/tmp/gb-cursor-211-whole-client-v11-r2')
def main():
    if os.geteuid()!=1002:raise RuntimeError('qualification requires exact unprivileged UID1002')
    if BASE.exists():raise RuntimeError('probe directory exists; reconcile, never duplicate')
    BASE.mkdir(mode=0o700)
    for name in ('home','config','data','cache','tmp','work'):(BASE/name).mkdir(mode=0o700)
    # Status ignores inference env authentication; this is startup only.
    env={'PATH':'/usr/bin:/bin','HOME':str(BASE/'home'),'XDG_CONFIG_HOME':str(BASE/'config'),
      'XDG_DATA_HOME':str(BASE/'data'),'XDG_CACHE_HOME':str(BASE/'cache'),'TMPDIR':str(BASE/'tmp'),
      'AGENT_CLI_CREDENTIAL_STORE':'memory','DIRENV_DISABLE':'1','LANG':'C.UTF-8'}
    readonly=[str(PIN),str(BASE/'home')]
    for name in ('/lib/x86_64-linux-gnu','/usr/lib/x86_64-linux-gnu','/etc/ld.so.cache',
                 '/etc/ssl/openssl.cnf','/etc/ssl/certs','/etc/resolv.conf','/etc/hosts',
                 '/etc/nsswitch.conf','/etc/gai.conf','/dev/null','/dev/urandom','/dev/random'):
        if pathlib.Path(name).exists():readonly.append(name)
    writable=[str(BASE/name) for name in ('config','data','cache','tmp','work')]
    node=str(PIN/'node');argv=[node,str(PIN/'index.js'),'--sandbox=enabled',
      '--exclude-workspace-context','--disable-project-configs','--disable-auto-update',
      '--disable-indexing','--disable-codebase-ref','--allowed-tools','read_tool_call,edit_tool_call','status']
    with (BASE/'startup.stdout').open('xb') as out,(BASE/'startup.stderr').open('xb') as err:
        process=subprocess.Popen(argv,cwd=BASE/'work',env=env,stdin=subprocess.DEVNULL,
          stdout=out,stderr=err,close_fds=True,start_new_session=True,
          preexec_fn=lambda:restrict(readonly,writable,[node,'/lib64/ld-linux-x86-64.so.2']))
        start=pathlib.Path('/proc/'+str(process.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
        record={'schema':'GB_CURSOR_WHOLE_CLIENT_PROBE_211_V1','pid':process.pid,'start':start,
          'boot':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'model_calls':0,
          'purpose':'startup_status_not_auth_qualification','node_sha256':hashlib.sha256((PIN/'node').read_bytes()).hexdigest(),
          'sandbox':'enabled','filesystem':'whole_client_landlock','subprocesses':'seccomp_denied',
          'readonly':readonly,'writable':writable,'started_at':int(time.time())}
        try:record['exit']=process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
            record.update(exit=process.returncode,status='bounded_startup_timeout')
    record.update(stdout_bytes=(BASE/'startup.stdout').stat().st_size,
      stderr_bytes=(BASE/'startup.stderr').stat().st_size,
      auth_file_persisted=any(p.name=='auth.json' for p in BASE.rglob('auth.json')),finished_at=int(time.time()))
    (BASE/'startup-receipt.json').write_text(json.dumps(record,sort_keys=True,indent=2))
    print(json.dumps(record,sort_keys=True))
    raw=(BASE/'startup.stderr').read_text(errors='replace')
    print('STARTUP_STDERR',raw[:1400])
if __name__=='__main__':main()
