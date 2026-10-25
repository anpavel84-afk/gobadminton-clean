import importlib.util,io,json,unittest,zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('attention',Path(__file__).with_name('attention-inline.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Attention(unittest.TestCase):
 def test_outcomes(self):
  for status in ('confirmed','waiting','running'):self.assertIsNone(a.attention({'status':status},'success'))
  for status in ('deferred','unknown','refused','error'):self.assertEqual(a.attention({'status':status},'success')[0],status)
 def test_actual_exhaustion(self):
  v={'status':'deferred','last':{'reason':'attempts exhausted'}};self.assertIn('исчерпан',a.attention(v,'success')[1])
 def test_untrusted_strings_not_echoed(self):
  self.assertNotIn('credential-value',a.attention({'status':'unknown','reason':'credential-value'},'success')[1])
 def test_workflow_failure_without_artifact(self):self.assertEqual(a.attention({},'failure')[0],'workflow_failed')
 def test_trusted_origin(self):
  v=dict(repository={'id':a.RID},head_repository={'id':a.RID},path='.github/workflows/train-stage.yml',event='workflow_dispatch',head_branch='dev',status='completed',actor={'id':a.OWNER},run_attempt=1)
  self.assertTrue(a.valid_run(v))
  for key,value in [('head_repository',{'id':1}),('head_branch','fork'),('event','pull_request'),('actor',{'id':1}),('path','.github/workflows/arbitrary.yml')]:self.assertFalse(a.valid_run(v|{key:value}))
 def test_safe_zip_parse(self):
  raw=io.BytesIO()
  with zipfile.ZipFile(raw,'w') as z:z.writestr('stage.json',json.dumps({'status':'deferred'}))
  self.assertEqual(a.read_stage(raw.getvalue()),{'status':'deferred'})
 def test_zip_paths_not_extracted(self):
  raw=io.BytesIO()
  with zipfile.ZipFile(raw,'w') as z:z.writestr('../stage.json','{}')
  with self.assertRaises(a.Refused):a.read_stage(raw.getvalue())
 def test_size_bound(self):
  with self.assertRaises(a.Refused):a.read_stage(b'x'*(a.MAX+1))
if __name__=='__main__':unittest.main()
