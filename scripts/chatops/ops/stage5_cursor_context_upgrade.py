#!/usr/bin/python3
"""Reviewed Stage 5 Cursor scoped-context install (Owner pt425u); fixed targets only.

Pattern: cost_policy_upgrade.py (quiescence, write-ahead journal, exact backups, disabled install,
hosted shadow activation, state-preserving rollback). dry has ZERO effects. Targets are exactly
stage.py and context_cursor_delivery.py. Anything else that differs between the installed tree and
the reviewed bundle (for example a pending rules/#304 bump) refuses: install that FIRST.
The cursor-author marker modules native_cursor.py/native_guard.py must be byte-identical (installed,
bundle, pinned). Never edits the marker, budgets, ledgers, task state or the models.
Scoped Cursor delivery stays DORMANT after this install unless the installed native_guard binds the
canon read-only (see recipient_rules_readonly); this script does not change that.
"""
import argparse, copy, hashlib, json, os, pathlib, re, sys, time, urllib.request
INSTALL=pathlib.Path("/usr/local/lib/gb-actions-train")
sys.path.insert(0,str(INSTALL))
import receiver,installer
STATE=receiver.STATE
JOURNAL=STATE/"stage5-cursor-context.json"
BACKUP=STATE/"stage5-cursor-context-backup"
TARGETS={"stage.py","context_cursor_delivery.py"}
FROZEN={"native_cursor.py":"02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089",
        "native_guard.py":"dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762"}
INSTALLED_RULES=INSTALL/"accepted-engineering-rules.md"
BUNDLE_RULES="docs/rules/ENGINEERING_OPERATING_MODEL.md"
def need(v,m):receiver.need(v,m)
def preserved():
    roots=(receiver.AUTONOMY/"slots",STATE/"history")
    files=[p for root in roots if root.exists() for p in root.rglob("*") if p.is_file()]
    files += [STATE/n for n in ("slot1.json","slot2.json","recovery.json")]
    files += [p for slot in ("slot1","slot2") for p in
              (receiver.AUTONOMY/"outbox"/slot/"ledger.json",receiver.AUTONOMY/"outbox"/slot/"ledger.json.bak") if p.exists()]
    files += [pathlib.Path("/etc/gobadminton-slots")/n for n in ("cursor-author.json","budgets.json")
              if (pathlib.Path("/etc/gobadminton-slots")/n).exists()]
    return {str(p):installer.sha(p) for p in sorted(set(files))}
def quiet():
    receiver.units_quiet(receiver.UNITS)
    for slot in ("slot1","slot2"):
        j=receiver.journal(slot);state,_=receiver.checkpoint(slot)
        if j["pending"]:
            from qa_recovery import safe_pending
            need(safe_pending(j,state,receiver.alive),"pending live/unknown effect; wait normally")
        active=state.get("active")
        need(not active or active["phase"] in ("candidate","pr_wait","qa","ci","done"),
             "source writer/publish/integration not at safe boundary")
        import pwd
        uid=pwd.getpwnam("agentagency-dev" if slot=="slot1" else "gb-slot2").pw_uid
        receiver.no_models(uid,slot)
        receiver.free_lock(receiver.AUTONOMY/"slots"/slot/"worker.lock")
        receiver.free_lock(receiver.AUTONOMY/"locks"/(slot+".lease"))
        if active and active["phase"]!="done":
            if active["phase"]=="qa":need(j["pending"] is not None,"unresolved QA boundary")
            else:installer.safe_state(slot,activation=True)
    need(not (STATE/"integration.json").exists(),"integration in flight")
    need(not any(v["status"].endswith("_pending") for v in receiver.recovery_journal()["receipts"].values()),
         "recovery stage in flight")
def probe(run_id,j):
    def get(path):
        request=urllib.request.Request("https://api.github.com/repos/anpavel84-afk/gobadminton-clean/"+path,
            headers={"User-Agent":"gb-stage5-cursor-readonly","Accept":"application/vnd.github+json"})
        with urllib.request.urlopen(request,timeout=15) as response:raw=response.read(524289)
        need(len(raw)<=524288,"oversize proof")
        return json.loads(raw)
    run=get("actions/runs/"+str(run_id))
    need(run.get("path")==".github/workflows/train-dispatch.yml" and run.get("head_branch")=="dev"
         and run.get("event")=="workflow_dispatch" and run.get("status")=="completed"
         and run.get("conclusion")=="success" and run.get("repository",{}).get("id")==1416250340
         and run.get("head_repository",{}).get("id")==1416250340
         and run.get("actor",{}).get("id") in (318610566,41898282),"invalid hosted shadow proof")
    import datetime as dt,base64
    started=dt.datetime.fromisoformat(run["created_at"].replace("Z","+00:00")).timestamp()
    need(started>=j["installed_at"],"probe predates install")
    jobs=get("actions/runs/"+str(run_id)+"/attempts/"+str(run["run_attempt"])+"/jobs")["jobs"]
    for name in ("reconcile","publish_phase_drafts"):
        need(len([x for x in jobs if x["name"]==name and x["conclusion"]=="success"])==1,"shadow job not successful")
    raw=get("contents/.github/workflows/train-dispatch.yml?ref="+run["head_sha"])
    need(raw.get("encoding")=="base64","invalid workflow proof")
    need(hashlib.sha256(base64.b64decode(raw["content"])).hexdigest()==j["dispatch_sha256"],"shadow workflow differs")
    return {"run":run_id,"head":run["head_sha"],"attempt":run["run_attempt"]}
def execute(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id=None,baseline=None):
    need(os.geteuid()==0,"root integrator only")
    quiet()
    if action=="activate":
        j=receiver.read(JOURNAL,0);p=receiver.read(receiver.POLICY,0)
        need(j["phase"]=="installed-disabled" and p["mode"]=="disabled","not disabled installed candidate")
        need(preserved()==j["preserved"],"authoritative state changed; no activation")
        need(all(installer.sha(pathlib.Path(k))==v["after"] for k,v in j["changes"].items()),"installed drift")
        evidence=probe(run_id,j)
        receiver.atomic(receiver.POLICY,p|{"mode":"active"},mode=0o644)
        j.update(phase="active",shadow=evidence);receiver.atomic(JOURNAL,j)
        receiver.publish_monitor(p|{"mode":"active"})
        return {"phase":"active","state_preserved":True,"shadow":evidence}
    if action=="rollback":
        j=receiver.read(JOURNAL,0);p=receiver.read(receiver.POLICY,0)
        need(p["mode"]=="disabled" and j["phase"] in ("applying","installed-disabled"),"no rollback after activation")
        need(preserved()==j["preserved"],"state changed; never rewind live effects")
        for i,(name,h) in enumerate(sorted(j["changes"].items())):
            need(installer.sha(pathlib.Path(name)) in (h["before"],h["after"]),"foreign drift")
            target=pathlib.Path(name)
            if h["before"] is None:target.unlink(missing_ok=True)
            else:
                source=BACKUP/str(i);need(installer.sha(source)==h["before"],"backup drift");installer.put(source,target,0o644)
        receiver.atomic(STATE/"backup.json",j["record_before"])
        receiver.atomic(receiver.POLICY,j["policy_before"],mode=0o644)
        j["phase"]="rolled-back";receiver.atomic(JOURNAL,j)
        return {"phase":"rolled-back","state_preserved":True}
    need(action in ("dry","apply"),"invalid action")
    receiver.trusted_tree(bundle);items=installer.payload(bundle,manifest)
    p=receiver.read(receiver.POLICY,0);record=receiver.read(STATE/"backup.json",0)
    need(re.fullmatch("[a-f0-9]{40}",baseline or "") and p["controller_sha"]==baseline
         and p["mode"] in ("active","disabled"),"wrong baseline controller (install the rules/#304 bump first)")
    need(all(installer.sha(pathlib.Path(k))==v for k,v in record["after"].items()),"baseline code drift")
    need(re.fullmatch("[a-f0-9]{40}",controller or "") and controller!=baseline,"immutable new controller required")
    changed={k:v for k,v in items.items() if installer.sha(k)!=installer.sha(v)}
    need(set(changed)=={INSTALL/n for n in TARGETS},
         "unexpected changed targets: installed tree must equal the bundle except stage.py and context_cursor_delivery.py")
    for name,pin in FROZEN.items():  # cursor-author marker modules: byte-identical installed/bundle/pinned
        need(installer.sha(INSTALL/name)==pin and installer.sha(items[INSTALL/name])==pin,"marker module not byte-identical to pin: "+name)
    # Rules-bump ordering gate: the pin is read from the bundle's (already installed, unchanged) context_policy.py;
    # installed accepted rules file == repo canon == that pin, else the scoped probe could never be true.
    policy_src=(bundle/"scripts/chatops/actions_train/context_policy.py").read_text()
    sha_m=re.search(r"^RULES_SHA256 = '([a-f0-9]{64})'$",policy_src,re.M);size_m=re.search(r"^RULES_SIZE = ([0-9]+)$",policy_src,re.M)
    need(sha_m and size_m,"rules pin not found in bundle context_policy.py")
    pin,size=sha_m.group(1),int(size_m.group(1))
    need(installer.sha(INSTALLED_RULES)==pin and INSTALLED_RULES.stat().st_size==size,"installed rules pin missing/stale: apply the rules bump first")
    canon=bundle/BUNDLE_RULES
    need(installer.sha(canon)==pin and canon.stat().st_size==size,"bundle canon differs from accepted rules pin")
    for source in items.values():receiver.trusted_tree(source)
    wf=bundle/".github/workflows/train-stage.yml";dispatcher=bundle/".github/workflows/train-dispatch.yml"
    need(installer.sha(wf)==stage_sha and installer.sha(dispatcher)==dispatch_sha
         and wf.read_bytes().count(("ref: "+controller).encode())==2
         and dispatcher.read_bytes().count(("ref: "+controller).encode())==2,"unreviewed workflow/pin")
    changes={str(k):{"before":installer.sha(k),"after":installer.sha(v)} for k,v in changed.items()}
    snapshot=preserved()
    if action=="dry":return {"dry":True,"changes":changes,"preserved_files":len(snapshot),"baseline":baseline,"controller":controller}
    need(not JOURNAL.exists() and not BACKUP.exists(),"prior upgrade journal exists; inspect")
    BACKUP.mkdir(mode=0o700)
    for i,(name,h) in enumerate(sorted(changes.items())):
        if h["before"] is not None:installer.put(pathlib.Path(name),BACKUP/str(i),0o600)
    nextpolicy=copy.deepcopy(p);nextpolicy.update(mode="disabled",controller_sha=controller,stage_workflow_sha256=stage_sha)
    nextpolicy["recovery"]["source_sha"]=controller
    j={"phase":"applying","installed_at":int(time.time()),"changes":changes,"preserved":snapshot,
       "policy_before":p,"record_before":record,"controller":controller,"baseline":baseline,"dispatch_sha256":dispatch_sha}
    receiver.atomic(JOURNAL,j)  # write-ahead journal and exact backups exist before any replacement
    receiver.atomic(receiver.POLICY,p|{"mode":"disabled"},mode=0o644)
    try:
        for target,source in changed.items():installer.put(source,target,0o644)
        need(preserved()==snapshot,"authoritative state changed")
        nextrecord=copy.deepcopy(record);nextrecord["manifest"]=manifest
        for target,source in items.items():nextrecord["after"][str(target)]=installer.sha(source)
        receiver.atomic(STATE/"backup.json",nextrecord)
        receiver.atomic(receiver.POLICY,nextpolicy,mode=0o644)
        j["phase"]="installed-disabled";receiver.atomic(JOURNAL,j)
        receiver.publish_monitor(nextpolicy)
        return {"phase":"installed-disabled","preserved_files":len(snapshot),"ledger_reset":False}
    except BaseException:
        raise  # remains disabled; explicit rollback uses exact backups, never restores task state
def main():
    p=argparse.ArgumentParser();p.add_argument("action",choices=("dry","apply","activate","rollback"))
    p.add_argument("--bundle",required=True,type=pathlib.Path);p.add_argument("--manifest",required=True)
    p.add_argument("--baseline-controller",required=True)
    p.add_argument("--controller",required=True);p.add_argument("--stage-hash",required=True);p.add_argument("--dispatch-hash",required=True)
    p.add_argument("--run",type=int);a=p.parse_args()
    lock=receiver.locked(STATE/"controller.lock")
    try:print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run,a.baseline_controller),sort_keys=True))
    finally:os.close(lock)
if __name__=="__main__":main()
