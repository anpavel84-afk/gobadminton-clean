#!/usr/bin/python3
"""One no-auth/no-model native helper preflight inside whole-client namespace."""
import hashlib,json,os,pathlib,resource,subprocess,sys,time
ROOT=pathlib.Path('/srv/gobadminton-clean/worktrees/ops-native-provider-211-20261022')
sys.path.insert(0,str(ROOT/'scripts/chatops/actions_train'))
from native_guard import CURSOR_PIN,cursor_namespace_argv,no_new_privileges
BASE=pathlib.Path('/tmp/gb-cursor-211-native-namespace-preflight-r2')
def main():
    if os.geteuid()!=1002 or BASE.exists():raise RuntimeError('exact UID/fresh fixture required')
    BASE.mkdir(mode=0o700)
    for name in ('home','config','data','cache','tmp','work'):(BASE/name).mkdir(mode=0o700)
    policy={'sandbox':{'type':'workspace_readwrite','cwd':str(BASE/'work'),'readBoundary':'system',
        'hardcodedReadPaths':[],'additionalReadonlyPaths':{},'networkAccess':False,
        'additionalReadwritePaths':[],'disableTmpWrite':False}}
    p=BASE/'data/policy.json';p.write_text(json.dumps(policy))
    argv=cursor_namespace_argv(BASE,[str(CURSOR_PIN/'cursorsandbox'),'--policy',str(p),
        '--preflight-only','--','/bin/true'])
    env={'PATH':'/usr/bin:/bin','HOME':str(BASE/'home'),'TMPDIR':str(BASE/'tmp'),
        'XDG_CONFIG_HOME':str(BASE/'config'),'LANG':'C.UTF-8',
        'CURSOR_SANDBOX_POLICY_DIR':str(BASE/'data'),'CURSOR_DATA_DIR':str(BASE/'data')}
    def child():
        no_new_privileges();resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
    policy_hash=hashlib.sha256(p.read_bytes()).hexdigest()
    start=time.time()
    try:
        r=subprocess.run(argv,cwd=BASE/'work',env=env,stdin=subprocess.DEVNULL,
            capture_output=True,timeout=20,close_fds=True,start_new_session=True,preexec_fn=child)
        timed_out=False
    except subprocess.TimeoutExpired as e:
        r=subprocess.CompletedProcess(argv,None,e.stdout or b'',e.stderr or b'');timed_out=True
    (BASE/'stdout').write_bytes(r.stdout);(BASE/'stderr').write_bytes(r.stderr)
    d={'schema':'GB_CURSOR_NATIVE_NAMESPACE_PREFLIGHT_211_V1','uid':os.geteuid(),
        'model_calls':0,'authorization_loaded':False,'exit':r.returncode,'timeout':timed_out,'seconds':round(time.time()-start,3),
        'policy_sha256':policy_hash,
        'guard_sha256':hashlib.sha256((ROOT/'scripts/chatops/actions_train/native_guard.py').read_bytes()).hexdigest(),
        'helper_sha256':hashlib.sha256((CURSOR_PIN/'cursorsandbox').read_bytes()).hexdigest(),
        'stderr_sha256':hashlib.sha256(r.stderr).hexdigest(),'stderr':r.stderr.decode(errors='replace')[:4000]}
    (BASE/'receipt.json').write_text(json.dumps(d,indent=2));print(json.dumps(d))
if __name__=='__main__':main()
