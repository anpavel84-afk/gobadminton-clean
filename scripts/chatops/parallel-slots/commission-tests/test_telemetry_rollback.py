"""Exercise the actual installer's rollback block with no system mutations."""
import subprocess,sys,unittest
from pathlib import Path
class RollbackTests(unittest.TestCase):
 def test_cleanup_timeouts_and_previous_timer_state(self):
  text=(Path(__file__).resolve().parents[1]/'slot-live-telemetry.sh').read_text()
  part=text[text.index('except BaseException:\n errors=[]'):text.index("print('PASS: telemetry")]
  part=part.replace('except BaseException:\n','',1)
  part='\n'.join(line[1:] if line.startswith(' ') else line for line in part.splitlines()).rsplit('\nraise',1)[0]
  for enabled,active in [('disabled','inactive'),('enabled','active'),('enabled','inactive')]:
   restored=[];calls=[]
   class Mock:
    def run(self,*a,**k):raise subprocess.TimeoutExpired('systemctl',40)
   n={'signal':type('Signal',(),{'SIGHUP':1,'SIGINT':2,'SIGTERM':15,'SIG_IGN':0,'signal':staticmethod(lambda *a:None)})(),'subprocess':Mock(),'sys':sys,'timers':['a.timer','b.timer'],'services':['a.service','b.service'],'changed':['/a','/b'],'previous':{'/a':b'A','/b':b'B','/etc/systemd/system/a.timer':None,'/etc/systemd/system/b.timer':None},'prior':{u:(enabled,active) for u in ('a.timer','b.timer','a.service','b.service')},'write':lambda p,d:restored.append((p,d)),'system':lambda *a:calls.append(a)}
   exec(part,n)
   self.assertEqual(restored,[('/b',b'B'),('/a',b'A')])
   self.assertIn(('enable' if enabled=='enabled' else 'disable','a.timer'),calls)
   self.assertEqual(('start','a.timer') in calls,active=='active')
 def test_signal_exit_enters_rollback(self):
  text=(Path(__file__).resolve().parents[1]/'slot-live-telemetry.sh').read_text()
  handlers=text[text.index('def interrupted('):text.index('try:\n if remove:',text.index('def interrupted('))]
  for signum in (1,2,15):
   program='import os,signal\n'+handlers+'try:\n os.kill(os.getpid(),'+str(signum)+')\nexcept BaseException:\n print("rollback-entered",flush=True)\n raise\n'
   result=subprocess.run([sys.executable,'-c',program],capture_output=True,text=True)
   self.assertEqual(result.returncode,128+signum);self.assertIn('rollback-entered',result.stdout)
if __name__=='__main__':unittest.main()
