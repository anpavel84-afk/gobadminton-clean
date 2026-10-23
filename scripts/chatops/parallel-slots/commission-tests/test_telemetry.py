import importlib.util, unittest, tempfile, os, json, datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'monitor-src'
spec=importlib.util.spec_from_file_location('telemetry',ROOT/'slot_telemetry.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
class TelemetryTests(unittest.TestCase):
 def test_sha_binding_and_no_private_fields(self):
  head='a'*40
  a={'issue':151,'phase':'ci','attempt':1,'head':head,'task':{'model':'gpt-6.1-sol','effort':'high'},'qa':{'verdict':'PASS','reviewed_sha':head},'ci':{'id':39600000000,'sha':head,'jobs':[{'conclusion':'success'}]*7},'secret':'DO_NOT_EXPORT'}
  result=t.project(a)
  self.assertEqual(result['ci']['run_id'],39600000000)
  self.assertEqual(result['ci']['passed'],7)
  self.assertNotIn('DO_NOT_EXPORT',json.dumps(result))
  a['qa']['reviewed_sha']='b'*40;a['ci']['sha']='b'*40
  result=t.project(a)
  self.assertEqual(result['qa']['verdict'],'MISMATCH');self.assertEqual(result['ci']['result'],'MISMATCH')
 def test_unsafe_files(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'state'
   for case in ('symlink','fifo','writable','oversize','wrongowner'):
    if os.path.lexists(p):p.unlink()
    if case=='symlink':p.symlink_to('/etc/passwd')
    elif case=='fifo':os.mkfifo(p)
    else:
     p.write_text('x'*2097153 if case=='oversize' else '{}')
     if case=='writable':p.chmod(0o666)
    with self.subTest(case=case),self.assertRaises((ValueError,OSError)):
     t.read(p,99999 if case=='wrongowner' else os.getuid())
 def test_monitor_freshness_and_invalid(self):
  source=(ROOT/'writer.py').read_text().replace('/usr/local/lib/gb-ops-monitor/opsmon/slot_telemetry.py',str(ROOT/'slot_telemetry.py'))
  n={'__name__':'fixture','__file__':str(ROOT/'writer.py')};exec(compile(source,'fixture','exec'),n)
  now=datetime.datetime.now(datetime.timezone.utc);stamp=int(now.timestamp())
  with tempfile.TemporaryDirectory() as d:
   for slot in ('slot1','slot2'):
    p=Path(d)/slot;p.mkdir()
    (p/'status.json').write_text(json.dumps({'schema':'GB_SLOT_STATUS_V1','slot':slot,'active':None,'done':[],'parked':[],'at':stamp-1000,'integrating':False}))
    (p/'telemetry.json').write_text(json.dumps({'schema':'GB_SLOT_TELEMETRY_V1','slot':slot,'at':stamp,'checkpoint_at':None,'checkpoint_status':'ABSENT','process':{'active':'active','sub':'running','pid':123},'task':None}))
   owners={'slot1':os.getuid(),'slot2':os.getuid()}
   cards,_=n['slot_publications'](d,now,owners);self.assertTrue(all(c['status']=='FRESH' for c in cards))
   p=Path(d)/'slot2'/'telemetry.json';v=json.loads(p.read_text());v['at']=stamp-91;p.write_text(json.dumps(v))
   cards,_=n['slot_publications'](d,now,owners);self.assertEqual(cards[1]['status'],'STALE')
   v['task']={'secret':'DO_NOT_EXPORT'};p.write_text(json.dumps(v))
   cards,_=n['slot_publications'](d,now,owners);self.assertEqual(cards[1]['status'],'STALE');self.assertNotIn('DO_NOT_EXPORT',json.dumps(cards))
   p.unlink();cards,_=n['slot_publications'](d,now,owners);self.assertEqual(cards[1]['status'],'STALE')
if __name__=='__main__':unittest.main()
