#!/usr/bin/python3
"""Reviewed root-only reversible #211 native namespace helper install; no train writes."""
import argparse,hashlib,json,os,pathlib,stat,subprocess,tempfile,time
PIN=pathlib.Path('/opt/gobadminton-cursor-cli/2026.10.01-e373342')
SOURCE=pathlib.Path('/usr/bin/bwrap')
BINARY=PIN/'gb-bwrap'
PROFILE=pathlib.Path('/etc/apparmor.d/gobadminton-cursor-namespace')
JOURNAL=pathlib.Path('/var/lib/gobadminton-actions-train/cursor-namespace-211.json')
SHA='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
POLICY=('abi <abi/4.0>,\ninclude <tunables/global>\n\n'
    'profile gobadminton_cursor_namespace '+str(BINARY)+' flags=(default_allow) {\n  userns,\n}\n').encode()
def need(ok,why):
    if not ok:raise RuntimeError(why)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def tree(path):
    for p in (path,*path.parents):
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'untrusted root parent')
def regular(path):
    tree(path.parent);s=path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1
        and not s.st_mode&0o7022,'untrusted root file')
    try:caps=os.getxattr(path,'security.capability',follow_symlinks=False)
    except OSError as e:
        need(e.errno in (61,95),'cannot establish absence of file capabilities');caps=b''
    need(not caps,'file capabilities refused')
    return path.read_bytes()
def put(path,raw,mode):
    tree(path.parent)
    fd,name=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
    try:
        os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(name,path)
        d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if os.path.exists(name):os.unlink(name)
def save(j):put(JOURNAL,(json.dumps(j,sort_keys=True,indent=2)+'\n').encode(),0o600)
def parser(*args):
    r=subprocess.run(['/sbin/apparmor_parser',*args],stdin=subprocess.DEVNULL,capture_output=True,timeout=20)
    need(r.returncode==0,'AppArmor parser refused exact profile: '+r.stderr.decode(errors='replace')[:1600])
def no_live_namespace():
    for p in pathlib.Path('/proc').glob('[0-9]*/attr/current'):
        try:s=p.read_text()
        except (OSError,ProcessLookupError):continue
        need('gobadminton_cursor_namespace' not in s,'namespace helper still in use; preserve installation')
def main():
    a=argparse.ArgumentParser();a.add_argument('mode',choices=['dry','apply','rollback','reconcile']);a.add_argument('--expected-source-sha',required=True);o=a.parse_args()
    need(os.geteuid()==0,'root-only installer')
    need(digest(pathlib.Path(__file__).read_bytes())==o.expected_source_sha,'reviewed installer SHA mismatch')
    tree(PIN);tree(PROFILE.parent);tree(JOURNAL.parent)
    existing=JOURNAL.exists() or JOURNAL.is_symlink()
    if o.mode=='rollback':
        need(existing,'no owned install journal');j=json.loads(regular(JOURNAL))
        need(j.get('schema')=='GB_CURSOR_NAMESPACE_INSTALL_211_V1' and j.get('binary')==str(BINARY)
             and j.get('profile')==str(PROFILE) and j.get('originally_absent') is True,'foreign install journal')
        no_live_namespace()
        if PROFILE.exists():need(digest(regular(PROFILE))==digest(POLICY),'profile changed; rollback refused')
        if BINARY.exists():need(digest(regular(BINARY))==SHA,'binary changed; rollback refused')
        if PROFILE.exists():
            loaded=pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text()
            if any(x.startswith('gobadminton_cursor_namespace ') for x in loaded.splitlines()):parser('-R',str(PROFILE))
            PROFILE.unlink()
        if BINARY.exists():BINARY.unlink()
        for parent in (PROFILE.parent,BINARY.parent):
            fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(fd)
            finally:os.close(fd)
        j.update(phase='rolled_back',rolled_back_at=int(time.time()));save(j);print(json.dumps(j));return
    if existing:
        j=json.loads(regular(JOURNAL))
        need(j.get('schema')=='GB_CURSOR_NAMESPACE_INSTALL_211_V1' and j.get('binary')==str(BINARY)
             and j.get('profile')==str(PROFILE) and j.get('originally_absent') is True
             and j.get('binary_sha256')==SHA and j.get('profile_sha256')==digest(POLICY), 'foreign install journal')
        need(j.get('phase')=='applied' or (o.mode=='reconcile' and j.get('phase')=='prepared'
             and j.get('installer_sha256')=='d26aa4927d802eb6631d965df4fc7cb7f7662020aa66f915ada03130e0b16408'),
             'prior journal requires reconciliation')
        need(digest(regular(BINARY))==SHA and digest(regular(PROFILE))==digest(POLICY),'installed namespace helper drift')
        need(stat.S_IMODE(BINARY.stat().st_mode)==0o755 and stat.S_IMODE(PROFILE.stat().st_mode)==0o644,'installed target mode drift')
        loaded=pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text()
        need(any(x=='gobadminton_cursor_namespace (unconfined)' for x in loaded.splitlines()),'exact default_allow profile label missing; reconcile')
        if o.mode=='reconcile' and j['phase']=='prepared':
            no_live_namespace();j.update(phase='applied',reconciled_at=int(time.time()),reconcile_installer_sha256=o.expected_source_sha,
                reconciliation_reason='correct expected kernel label for reviewed default_allow profile; no recopy or reload');save(j)
        print(json.dumps(dict(phase=j['phase'],binary_sha256=SHA,profile_sha256=digest(POLICY),
             apparmor_label='gobadminton_cursor_namespace (unconfined)',profile_flags='default_allow; exact executable userns exception')));return
    need(o.mode!='reconcile','no prepared journal to reconcile')
    raw=regular(SOURCE);need(digest(raw)==SHA,'system bwrap source drift')
    loaded=pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text()
    need(not any(x.startswith('gobadminton_cursor_namespace ') for x in loaded.splitlines()),'foreign named kernel profile exists')
    need(not BINARY.exists() and not BINARY.is_symlink() and not PROFILE.exists() and not PROFILE.is_symlink(),'unknown pre-existing target')
    with tempfile.TemporaryDirectory(prefix='cursor-211-profile-check-',dir=JOURNAL.parent) as d:
        p=pathlib.Path(d)/PROFILE.name;p.write_bytes(POLICY);parser('-Q','-T',str(p))
    j=dict(schema='GB_CURSOR_NAMESPACE_INSTALL_211_V1',phase='dry',binary=str(BINARY),profile=str(PROFILE),
           originally_absent=True,binary_sha256=SHA,profile_sha256=digest(POLICY),installer_sha256=o.expected_source_sha)
    if o.mode=='dry':print(json.dumps(j));return
    no_live_namespace();j.update(phase='prepared',at=int(time.time()));save(j)
    put(BINARY,raw,0o755);put(PROFILE,POLICY,0o644);parser('-r','-T',str(PROFILE))
    need(digest(regular(BINARY))==SHA and digest(regular(PROFILE))==digest(POLICY),'post-install drift')
    loaded=pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text()
    need(any(x=='gobadminton_cursor_namespace (unconfined)' for x in loaded.splitlines()),'exact default_allow profile label missing')
    j.update(phase='applied',applied_at=int(time.time()));save(j);print(json.dumps(j))
if __name__=='__main__':main()
