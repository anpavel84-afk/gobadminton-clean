"""One-turn complete native stdin; only offline synthetic subprocesses, never AGY."""
import copy,hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
from test_actions_train_antigravity import N,rows,wire,SHA
ROOT=Path(__file__).resolve().parents[3]
FIXTURES=Path(__file__).with_name('fixtures')

class Transport(unittest.TestCase):
 def test_explicit_mode_and_actual_failure_stay_fail_closed(self):
  events=rows();_,receipt=N.parse_stream(wire(events),SHA)
  self.assertEqual(receipt['requested_permission_mode'],'always-proceed')
  for mode in ('request-review','auto','bypass','',None):
   events=rows();events[0]['init']['permission_mode']=mode
   with self.subTest(mode=mode),self.assertRaises(N.ReviewError):N.parse_stream(wire(events),SHA)
  raw=(FIXTURES/'agy-a76-headless-denied.jsonl').read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'a6621a708f1c7b590bbd292d83509c63c1c28da02f28ecbcd3ef02ce6f98b306')
  with self.assertRaises(N.ReviewError):N.parse_stream(raw,SHA)
  for patch_value in ({'denied_actions':['read_file']},{'structured_output':None,'response':''}):
   events=rows();events[-1]['result'].update(patch_value)
   with self.assertRaises(N.ReviewError):N.parse_stream(wire(events),SHA)
 def test_whole_unicode_wire_finite_bounds_before_charge_or_launch(self):
  text='rules\n'+('漢字 🎾 "quoted" \t\r\n'*24000)
  payload,meta=N.input_payload(text)
  self.assertEqual(payload.count(b'\n'),1);self.assertTrue(payload.endswith(b'\n'))
  self.assertEqual(json.loads(payload),{'event':'user','message':{'content':text}})
  self.assertEqual(meta['semantic_input_bytes'],len(text.encode()));self.assertEqual(meta['stdin_bytes'],len(payload))
  self.assertNotEqual(meta['semantic_input_sha256'],meta['stdin_sha256'])
  with tempfile.TemporaryDirectory() as temp:
   charge=Mock();popen=Mock()
   for text in ('x'*(N.MAX_INPUT+1),'\0'*N.MAX_INPUT):
    with self.subTest(kind='semantic' if text[0]=='x' else 'wire'),self.assertRaises(N.ReviewError):
     N.invoke(text,30,work=Path('/tmp'),slot='slot2',task_hash='x',charge=charge,popen=popen,evidence_dir=Path(temp)/'evidence')
   charge.assert_not_called();popen.assert_not_called()
 def test_real_cpython_pipe_large_full_input_eof_and_actual_write_count(self):
  prompt=('FULL_RULES_AND_CONTEXT 漢字 🎾\n'*16000)
  payload,meta=N.input_payload(prompt);self.assertGreater(len(payload),291920)
  code='import sys,json,hashlib; data=sys.stdin.buffer.read(); print(json.dumps(dict(bytes=len(data),sha=hashlib.sha256(data).hexdigest(),messages=len(data.splitlines()))))'
  process=subprocess.Popen(['/usr/bin/python3','-I','-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  stdout,stderr=process.communicate(input=payload,timeout=15)
  self.assertEqual(process.returncode,0,stderr);self.assertEqual(process._input_offset,len(payload))
  self.assertEqual(json.loads(stdout),dict(bytes=meta['stdin_bytes'],sha=meta['stdin_sha256'],messages=1))
 def test_actual_draft_baseline_closure_and_truthful_fixture_diff_fit_whole_stdin(self):
  # #230 has no author candidate. This comment-only diff exercises existing baseline
  # content and exact inert task draft, without claiming future candidate coverage.
  draft=json.loads((FIXTURES/'agy-230-inert-task-draft.json').read_text())
  with tempfile.TemporaryDirectory() as temp:
   work=Path(temp)
   tracked=subprocess.check_output(['git','ls-files','apps/web'],cwd=ROOT,text=True).splitlines()
   for name in tracked:
    source=ROOT/name
    if source.is_file():
     target=work/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
   def git(*args):return subprocess.check_output(['git','-c','user.name=offline','-c','user.email=offline@example.invalid','-c','commit.gpgsign=false',*args],cwd=work).decode().strip()
   git('init','-q');git('add','.');git('commit','-qm','baseline source fixture');base=git('rev-parse','HEAD')
   for name in draft['allowed_paths'][:2]:
    with (work/name).open('a') as f:f.write('\n// Offline transport fixture comment: 漢字 🎾\n')
   git('add','.');git('commit','-qm','comment-only fixture diff');head=git('rev-parse','HEAD')
   source,_=N.collect(work,base,head,json.dumps(draft,ensure_ascii=False))
   data=json.loads(source.split('DATA_JSON:\n')[1]);self.assertEqual(data['missing_context'],[])
   self.assertIn('Offline transport fixture comment',data['diff'])
   import context_policy as C
   rules=(ROOT/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()
   assembled,context=C.inject(source,True,work,(rules,dict(commit=C.RULES_COMMIT,sha256=C.RULES_SHA256,bytes=C.RULES_SIZE,revision='1.1',delivery='explicit_full_stdin')))
   payload,meta=N.input_payload(assembled)
   self.assertGreater(meta['semantic_input_bytes'],120<<10)
   self.assertEqual(json.loads(payload)['message']['content'],assembled)
   self.assertIn(rules,assembled);self.assertEqual(context['sha256'],C.RULES_SHA256)
   print('230 baseline+inert draft+fixture diff bytes:',meta['semantic_input_bytes'],'wire:',meta['stdin_bytes'])
 def test_review_receipt_matches_exact_captured_wire_and_preserves_rules(self):
  import context_policy as C
  rules=(ROOT/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()
  accepted=(rules,dict(commit=C.RULES_COMMIT,sha256=C.RULES_SHA256,bytes=C.RULES_SIZE,delivery='explicit_full_stdin'))
  before=copy.deepcopy(accepted);captured={};charge=Mock()
  with tempfile.TemporaryDirectory() as temp:
   directory=Path(temp)/'evidence'
   class Process:
    pid=99999999;returncode=0
    def communicate(self,input,timeout):
     captured['wire']=input;self._input_offset=len(input)
    def wait(self):return 0
    def poll(self):return 0
   def popen(argv,**kw):
    charge.assert_called_once()
    prepared=[json.loads(f.read_text()) for folder in directory.iterdir() for f in folder.glob('phase-*')]
    self.assertFalse(any(x.get('input_delivery')=='written' for x in prepared))
    captured['argv']=argv;kw['stdout'].write(wire(rows()));kw['stdout'].flush();return Process()
   def git(work,*args):
    if args==('rev-parse','HEAD'):return SHA.encode()
    if args[:1]==('rev-parse',):return b'/tmp/candidate/.git'
    return b''
   with patch.object(N,'qualification',return_value={'phase':'canary'}),patch.object(N.os,'geteuid',return_value=978),patch.object(N,'trusted',return_value=b'PRIVATE_AUTH'),patch.object(N,'git',git),patch.object(N,'collect',return_value=('SOURCE_CONTEXT_漢字',None)),patch.object(N,'filesystem_roots',return_value=([],[],[])),patch.object(N.os,'killpg'),patch.object(N,'_verify_apparmor_precharge',return_value=None):
    result,receipt=N.review(Path('/tmp/candidate'),'b'*40,SHA,'task',30,slot='slot2',task_hash='f'*64,charge=charge,popen=popen,accepted_rules=accepted,evidence_dir=directory)
   semantic=json.loads(captured['wire'])['message']['content'].encode()
   self.assertEqual(receipt['semantic_input_sha256'],hashlib.sha256(semantic).hexdigest())
   self.assertEqual(receipt['stdin_sha256'],hashlib.sha256(captured['wire']).hexdigest())
   self.assertEqual(receipt['semantic_input_bytes'],len(semantic));self.assertEqual(receipt['stdin_bytes'],len(captured['wire']))
   self.assertEqual(receipt['input_delivery'],'written');self.assertEqual(receipt['input_transport'],'stream-json')
   self.assertEqual(receipt['rules_context']['delivery'],'explicit_full_stream_json_stdin')
   self.assertEqual(receipt['rules_context']['stdin_sha256'],receipt['stdin_sha256'])
   self.assertEqual(receipt['rules_context']['sha256'],C.RULES_SHA256)
   self.assertEqual(receipt['effective_permission_mode'],'always-proceed')
   self.assertEqual(accepted,before);self.assertNotIn(semantic.decode(),captured['argv'])
 def test_broken_timeout_short_absent_and_written_delivery_are_truthful(self):
  for kind in ('broken','timeout','short','absent','written'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as temp:
    directory=Path(temp)/'evidence';charge=Mock();captured={}
    class Process:
     pid=99999999;returncode=None
     def communicate(self,input,timeout):
      captured['wire']=input
      if kind=='broken':raise BrokenPipeError('private detail')
      if kind=='timeout':raise subprocess.TimeoutExpired('private argv',timeout)
      if kind!='absent':self._input_offset=len(input) if kind=='written' else 3
      self.returncode=0
     def poll(self):return self.returncode
     def wait(self):
      if self.returncode is None:self.returncode=-9
    def popen(argv,**kw):
     captured['argv']=argv;captured['stdin']=kw['stdin'];kw['stdout'].write(b'output');kw['stdout'].flush();return Process()
    with patch.object(N,'qualification',return_value={'phase':'canary'}),patch.object(N.os,'geteuid',return_value=978),patch.object(N,'trusted',return_value=b'PRIVATE_AUTH'),patch.object(N,'git',return_value=b'/tmp/candidate/.git'),patch.object(N,'filesystem_roots',return_value=([],[],[])),patch.object(N.os,'killpg'),patch.object(N,'_verify_apparmor_precharge',return_value=None):
     if kind=='written':
      raw,receipt=N.invoke('full 漢字 context',30,work=Path('/tmp/candidate'),slot='slot2',task_hash='x',charge=charge,popen=popen,evidence_dir=directory)
      self.assertEqual(receipt['input_delivery'],'written');self.assertEqual(receipt['stdin_sha256'],hashlib.sha256(captured['wire']).hexdigest())
     else:
      with self.assertRaisesRegex(N.ReviewError,'AGY_TIMEOUT' if kind=='timeout' else 'AGY_STDIN_FAILED'):
       N.invoke('full 漢字 context',30,work=Path('/tmp/candidate'),slot='slot2',task_hash='x',charge=charge,popen=popen,evidence_dir=directory)
    charge.assert_called_once();self.assertEqual(captured['stdin'],subprocess.PIPE)
    self.assertNotIn('full 漢字 context',captured['argv']);self.assertNotIn('-p',captured['argv'])
    evidence=next(directory.iterdir());meta=json.loads(sorted(evidence.glob('phase-*'))[-1].read_text())
    self.assertEqual(meta['input_delivery'],'written' if kind=='written' else 'incomplete' if kind in ('short','absent') else 'unknown')
    self.assertEqual(meta['charge_state'],'charged')

if __name__=='__main__':unittest.main()
