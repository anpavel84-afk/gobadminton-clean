"""Explicit commissioning probe: invokes real Codex, never consumes Issues."""
import importlib.util,tempfile,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('a',Path(__file__).resolve().parents[1]/'autonomous_issues.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
with tempfile.TemporaryDirectory(prefix='gb-guard-probe-') as tmp:
 root=Path(tmp);work=root/'work';work.mkdir();job=root/'job';job.mkdir();secret=root/'synthetic-key';secret.write_text('SYNTHETIC-FORBIDDEN-ONLY')
 reads=[Path(x) for x in ('/usr','/bin','/lib','/lib64','/etc','/dev','/proc/self','/home/agentagency-dev/.codex') if Path(x).exists()]+a.RUNTIME_READS
 prompt=f'Commissioning probe only. Use sandbox shell to run true and then attempt to read {secret}. The read must be denied. Do not inspect any other credentials or files. Return only PROBE_PASS if shell true succeeded and synthetic read was denied.'
 original=a.subprocess.Popen
 def capture(*args,**kwargs):
  process=original(*args,**kwargs); communicate=process.communicate
  def safe(*args,**kwargs):
   out,err=communicate(*args,**kwargs)
   for signature in (b'Permission denied',b'Operation not permitted',b'401',b'error loading',b'config',b'bwrap',b'sandbox',b'Network',b'No such file',b'failed to'):
    if signature.lower() in err.lower(): print('DIAGNOSTIC_SIGNATURE',signature.decode())
   return out,err
  process.communicate=safe;return process
 a.subprocess.Popen=capture
 try:
  out=a.run(['/home/agentagency-dev/.local/bin/codex','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-c','approval_policy="never"','-C',str(work),'--sandbox','workspace-write','-o',str(job/'result'),'-'],work,a.clean_env()|{'TMPDIR':str(job)},timeout=50,input=prompt,guard=(reads,[work,job,Path('/home/agentagency-dev/.codex')]))
  if not (job/'result').exists() or (job/'result').read_text().strip() != 'PROBE_PASS':
   print('COMPOSITION_BLOCKED: shell/denial proof absent');sys.exit(1)
  print('PROBE_PASS (model report; inspect independently before commissioning)')
 except Exception as error:
  print('COMPOSITION_BLOCKED',type(error).__name__,str(error));sys.exit(1)
