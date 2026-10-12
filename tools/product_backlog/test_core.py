import copy, tempfile, unittest
from pathlib import Path
from core import *
from manage import apply

class LedgerTests(unittest.TestCase):
 def record(self):
  reg={'schema':SCHEMA,'project':PROJECT,'revision':0,'next_number':1,'events':[],'tasks':[],
   'updated_at':now(),'coverage':{'feedback_crosswalk':{f'{i:03}':['GB-001'] for i in range(1,18)}}}
  patch={'title':'Загрузить свою обложку','area':'Профиль','request':'Своя обложка, отдельная от аватара.','acceptance':['Изображение сохраняется.'],
   'sources':[{'kind':'owner_chat','label':'Пожелание Owner','ref':'owner-chat:2026-10-10'}]}
  apply(reg,patch,'pm','owner-chat:2026-10-10','Новая просьба',0);return reg
 def test_register_stable_id(self):
  r=self.record();self.assertEqual(r['tasks'][0]['id'],'GB-001');self.assertEqual(r['next_number'],2);validate(r)
 def test_optimistic_lock(self):
  r=self.record()
  with self.assertRaises(ValueError):apply(r,{'id':'GB-001','status':'accepted'},'pm','proof','reason',0)
 def test_no_silent_removal(self):
  before=self.record();after=copy.deepcopy(before);after['tasks']=[]
  with self.assertRaises(ValueError):validate(after,before)
 def test_no_edit_without_event(self):
  r=self.record();r['tasks'][0]['title']='Забыть обложку'
  with self.assertRaises(ValueError):validate(r)
 def test_no_rewrite_history(self):
  r=self.record();r['events'][0]['reason']='Подмена'
  with self.assertRaises(ValueError):validate(r)
 def test_pm_cannot_accept_as_owner(self):
  r=self.record()
  with self.assertRaises(ValueError):apply(r,{'id':'GB-001','owner_verification':{'state':'accepted','evidence':'pm-said-done'}},'pm','proof','reason',1)
 def test_implementation_cannot_write_qa_pass(self):
  r=self.record()
  with self.assertRaises(ValueError):apply(r,{'id':'GB-001','qa':{'state':'passed','evidence':'own-tests'}},'implementation','proof','reason',1)
 def test_merge_is_not_deployment(self):
  r=self.record();apply(r,{'id':'GB-001','status':'accepted','code':{'state':'source_merged'}},'pm','github:sha','Приняты исходники',1)
  self.assertEqual(r['tasks'][0]['deployment']['state'],'not_deployed');self.assertNotEqual(r['tasks'][0]['status'],'confirmed')
 def test_sources_cannot_be_erased(self):
  r=self.record()
  with self.assertRaises(ValueError):apply(r,{'id':'GB-001','sources':[]},'pm','proof','reason',1)
 def test_wrong_project(self):
  r=self.record();r['project']='OtherProject'
  with self.assertRaises(ValueError):validate(r)
 def test_safe_projection(self):
  r=self.record();out=public_snapshot(r,'a'*40)
  self.assertEqual(out['tasks'][0]['title'],'Загрузить свою обложку');self.assertNotIn('events',out);self.assertEqual(out['project'],PROJECT)
 def test_failed_transaction_does_not_save(self):
  r=self.record()
  with tempfile.TemporaryDirectory() as name:
   path=Path(name)/'registry.json';atomic(path,r)
   try:apply(copy.deepcopy(r),{'id':'GB-001','status':'confirmed'},'pm','proof','reason',1)
   except ValueError:pass
   self.assertEqual(load(path),r)
 def test_title_update_has_history(self):
  r=self.record();before=copy.deepcopy(r);apply(r,{'id':'GB-001','title':'Менять собственную обложку профиля'},'pm','owner-chat:clarification','Уточнение, номер сохранён',1)
  validate(r,before);self.assertEqual(r['revision'],2);self.assertEqual(r['tasks'][0]['id'],'GB-001')
if __name__=='__main__':unittest.main()
