"""Closed OLD/NEW Owner identities and installed C5 pair; offline source only."""
import ast
import contextlib
import copy
import hashlib
import itertools
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from test_actions_train_owner_package import grant, ledger, CONTROLLER
import test_actions_train_pkg_finish as F
import antigravity_qa_recovery as Q
import owner_package_admission as A
import native_antigravity as N
import context_policy as P
from core import digest, Refused

REPO=Path(__file__).resolve().parents[3]
COMMENT=6405000001  # Synthetic, never fetched or posted.
OLD=Q.OWNER_PACKAGE_SOURCES[Q.FRESH_SOURCE_HEAD]
NEW=Q.OWNER_PACKAGE_SOURCES[Q.SMALL_SOURCE_HEAD]
INSTALLED_RULES_SIZE=113203


def package(source=NEW, comment=COMMENT, controller=Q.INSTALLED_C5_CONTROLLER, rules=Q.INSTALLED_C5_RULES):
    value=ledger()
    value.update(owner_comment=comment,controller_sha=controller,rules_sha256=rules,
                 source_base=source.base,source_head=source.head)
    rows=[]
    for role,pin in Q.owner_package_input_pins(source).items():
        g=grant(role)
        g.update(owner_comment=comment,controller_revision=controller,rules_sha256=rules,
                 base=source.base,head=source.head,input_revision=pin[0],input_path=pin[1],input_sha256=pin[2])
        rows.append(dict(grant=g,operation=None))
    value['grants']={digest(row['grant']):row for row in rows}
    return value


def comment_body(value):
    roles={row['grant']['role']:row['grant'] for row in value['grants'].values()}
    body=dict(schema=Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,
              owner_comment=value['owner_comment'],controller_sha=value['controller_sha'],
              rules_sha256=value['rules_sha256'],source_base=value['source_base'],
              source_head=value['source_head'],model=N.MODEL,max_calls=2,
              calls=[{k:g[k] for k in ('role','input_revision','input_path','input_sha256')}
                     for g in (roles['technical_pm_product_analyst'],roles['independent_qa'])])
    return A.PREFIX+json.dumps(body,sort_keys=True,separators=(',',':')),body


def authorize(value, *, existing=None):
    with patch.object(A,'owner_comment',return_value=comment_body(value)), \
         patch.object(Q,'addressed_input',return_value='immutable input checked separately'):
        return A.authorize(value['owner_comment'],value['controller_sha'],existing=existing)


class SourceTuples(unittest.TestCase):
    def test_closed_immutable_table_and_historical_pins(self):
        self.assertEqual(len(Q.OWNER_PACKAGE_SOURCES),2)
        self.assertEqual(OLD,('b0e4d233bc150f42ada86c4c0f56897c57e0d0fe',
            '12f35ac4430348ae811cf712d9bb24d2a19b62e6',
            '6a53099160f0ae7312f6d282b061c5230e7d2536',
            'scripts/chatops/tests/fixtures/agy-236-independent-qa-12f35ac.json',
            'c1672961885bea637d1ff21ffd05accc73837fe669e853f4b911d9f7ad7dcee9'))
        self.assertEqual(NEW,('e6af59ea2bc6922ed12585b128d9e14b263e9f20',
            'de193c74c11e1fef33d1e3c8405abe5a40081b87',
            '1d6c79990bef8d1e21e55360a8f8ee7e874f1315',
            'scripts/chatops/tests/fixtures/agy-325-independent-qa-de193c7.json',
            '6b6d391f35739b5f9dc15fa1a5968bc6be00bfdfcf4b4b5707cc834db693771d'))
        with self.assertRaises(TypeError):Q.OWNER_PACKAGE_SOURCES['f'*40]=NEW
        with self.assertRaises(AttributeError):NEW.base='f'*40
        self.assertEqual((A.SOURCE_BASE,A.SOURCE_HEAD),(NEW.base,NEW.head))
        self.assertEqual(A.EXPECTED_PINS,Q.owner_package_input_pins(NEW))

    def test_both_roles_new_and_historical_dynamic_old(self):
        for source in (OLD,NEW):
            value=package(source,comment=6404499964 if source==OLD else COMMENT)
            self.assertIs(Q.owner_package_ledger(value),value)
            for row in value['grants'].values():
                g=row['grant']
                self.assertIs(Q.validate_addressed_grant(g,enrollment=True),g)
                self.assertIs(Q.owner_package_source(g['base'],g['head']),source)

    def test_every_mixed_or_unknown_source_and_qa_tuple_refuses(self):
        for base,head,revision,path,sha in itertools.product(
                (OLD.base,NEW.base,'f'*40),(OLD.head,NEW.head,'e'*40),
                (OLD.qa_input_revision,NEW.qa_input_revision,'d'*40),
                (OLD.qa_input_path,NEW.qa_input_path,'scripts/chatops/tests/fixtures/agy-other.json'),
                (OLD.qa_input_sha256,NEW.qa_input_sha256,'0'*64)):
            if (base,head,revision,path,sha) in (OLD,NEW):continue
            value=package()
            qa=next(row['grant'] for row in value['grants'].values() if row['grant']['role']=='independent_qa')
            qa.update(base=base,head=head,input_revision=revision,input_path=path,input_sha256=sha)
            with self.subTest(base=base,head=head,revision=revision,path=path,sha=sha):
                with self.assertRaises(Refused):Q.validate_addressed_grant(qa,enrollment=True)
                value['source_base']=base;value['source_head']=head
                value['grants']={digest(row['grant']):row for row in value['grants'].values()}
                with self.assertRaises(Refused):Q.owner_package_ledger(value)
        analyst=next(row['grant'] for row in package()['grants'].values()
                     if row['grant']['role']=='technical_pm_product_analyst')
        for change in ({'base':OLD.base},{'head':OLD.head,'input_revision':OLD.head},
                       {'base':'f'*40},{'input_revision':OLD.head},{'input_sha256':'0'*64},
                       {'input_path':NEW.qa_input_path}):
            with self.subTest(change=change),self.assertRaises(Refused):
                Q.validate_addressed_grant(analyst|change,enrollment=True)

    def test_legacy_fresh_and_supplement_require_old_only(self):
        from test_actions_train_stage3_grants import fresh
        from test_actions_train_stage3_supplement import grant as supplement
        for factory in (fresh,supplement):
            for role in A.EXPECTED_PINS:
                g=factory(role)
                self.assertEqual(Q.validate_addressed_grant(g),g)
                pin=Q.owner_package_input_pins(NEW)[role]
                g.update(base=NEW.base,head=NEW.head,input_revision=pin[0],input_path=pin[1],input_sha256=pin[2])
                with self.assertRaises(Refused):Q.validate_addressed_grant(g,enrollment=True)


class RulesPairs(unittest.TestCase):
    def test_new_c5_authorization_round_trip_and_wrong_rules_refuse(self):
        value=authorize(package())
        self.assertIs(Q.owner_package_ledger(value),value)
        for row in value['grants'].values():Q.validate_addressed_grant(row['grant'],enrollment=True)
        self.assertEqual(authorize(value,existing=value),value)
        for rules in (A.RULES,'0'*64,Q.LEGACY_RULES_SHA256):
            wrong=package(rules=rules)
            with self.subTest(rules=rules):
                with self.assertRaises(Refused):authorize(wrong)
                with self.assertRaises(Refused):Q.owner_package_ledger(wrong)
                for row in wrong['grants'].values():
                    with self.assertRaises(Refused):Q.validate_addressed_grant(row['grant'],enrollment=True)
                with self.assertRaises(Refused):authorize(wrong,existing=wrong)
                with self.assertRaises(Refused):A.installed_rules_ok(Q.INSTALLED_C5_CONTROLLER,rules)
        A.installed_rules_ok(Q.INSTALLED_C5_CONTROLLER,Q.INSTALLED_C5_RULES)

    def test_c5_pair_is_closed_in_nonhistorical_addressed_branches(self):
        from test_actions_train_stage3_grants import fresh
        from test_actions_train_stage3_supplement import grant as supplement
        from test_actions_train_addressed_analysis import grant as original
        for factory in (fresh,supplement,original):
            g=factory()|dict(controller_revision=Q.INSTALLED_C5_CONTROLLER,rules_sha256=Q.INSTALLED_C5_RULES)
            self.assertEqual(Q.validate_addressed_grant(g,enrollment=True),g)
            for rules in (A.RULES,'0'*64):
                with self.subTest(factory=factory,rules=rules),self.assertRaises(Refused):
                    Q.validate_addressed_grant(g|dict(rules_sha256=rules),enrollment=True)

    def test_non_c5_retains_module_current_rules_only(self):
        good=package(controller=CONTROLLER,rules=A.RULES)
        self.assertEqual(authorize(good)['rules_sha256'],A.RULES)
        self.assertIs(Q.owner_package_ledger(good),good)
        A.installed_rules_ok(CONTROLLER,A.RULES)
        for rules in (Q.INSTALLED_C5_RULES,'0'*64):
            wrong=package(controller=CONTROLLER,rules=rules)
            with self.assertRaises(Refused):authorize(wrong)
            with self.assertRaises(Refused):Q.owner_package_ledger(wrong)
            with self.assertRaises(Refused):A.installed_rules_ok(CONTROLLER,rules)

    def test_historical_c5_comment_cannot_move_controller_even_with_current_rules(self):
        wrong=package(OLD,comment=Q.INSTALLED_C5_COMMENT,controller=CONTROLLER,rules=A.RULES)
        with self.assertRaises(Refused):A.admission_pins(Q.INSTALLED_C5_COMMENT,CONTROLLER)
        with self.assertRaises(Refused):authorize(wrong)
        with self.assertRaises(Refused):Q.owner_package_ledger(wrong)
        for row in wrong['grants'].values():
            with self.assertRaises(Refused):Q.validate_addressed_grant(row['grant'],enrollment=True)

    def test_existing_old_package_reauthenticates_own_tuple_and_body(self):
        for comment in (6376028125,Q.INSTALLED_C5_COMMENT,6404499964):
            for controller,rules in ((Q.INSTALLED_C5_CONTROLLER,Q.INSTALLED_C5_RULES),(CONTROLLER,A.RULES)):
                if comment==Q.INSTALLED_C5_COMMENT and controller!=Q.INSTALLED_C5_CONTROLLER:continue
                value=package(OLD,comment,controller,rules)
                value['body_sha256']=hashlib.sha256(comment_body(value)[0].encode()).hexdigest()
                self.assertEqual(authorize(value,existing=value),value)
                # OLD is for re-authentication, not the new admission default.
                with self.assertRaises(Refused):authorize(value)
                with patch.object(A,'owner_comment',return_value=comment_body(package(NEW,comment,controller,rules))), \
                     self.assertRaises(Refused):A.authorize(comment,controller,existing=value)

    def test_owner_body_mixed_pins_or_source_refuse(self):
        original=package()
        for source in (OLD,NEW):
            for role in A.EXPECTED_PINS:
                wrong=copy.deepcopy(original)
                g=next(row['grant'] for row in wrong['grants'].values() if row['grant']['role']==role)
                pin=Q.owner_package_input_pins(source)[role]
                g.update(input_revision=pin[0],input_path=pin[1],input_sha256=pin[2])
                if source==OLD:
                    with self.assertRaises(Refused):authorize(wrong)
        for field in ('source_base','source_head'):
            wrong=copy.deepcopy(original);wrong[field]=getattr(OLD,'base' if field=='source_base' else 'head')
            with self.assertRaises(Refused):authorize(wrong)

    def test_package_rules_still_requires_loaded_context_and_host_bytes(self):
        value=package()
        expected_context='d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806'
        def sha(path):return Q.INSTALLED_C5_RULES if Path(path).suffix=='.md' else expected_context
        with patch.object(A,'sha',side_effect=sha),self.assertRaises(Refused):A.package_rules_ok(value)
        with patch.object(P,'RULES_SHA256',Q.INSTALLED_C5_RULES):
            with patch.object(A,'sha',side_effect=sha):A.package_rules_ok(value)
            for filename in ('context_policy.py','accepted-engineering-rules.md'):
                with patch.object(A,'sha',side_effect=lambda p:'0'*64 if Path(p).name==filename else sha(p)), \
                     self.assertRaises(Refused):A.package_rules_ok(value)

    def test_fully_spent_new_c5_package_acceptance_plan(self):
        # Reuse all real archive/binding/receipt checks; only fixture identity changes.
        with patch.object(F,'ledger',side_effect=package),patch.object(F,'COMMENT',COMMENT), \
             patch.object(F,'CONTROLLER',Q.INSTALLED_C5_CONTROLLER):
            harness=F.PackageFinishTests();harness.setUp();self.addCleanup(harness.doCleanups)
            marker,receipt,key,qa=harness.accept_fixture()
            with patch.object(A.os,'geteuid',return_value=0):
                ready=A.acceptance_plan(COMMENT,Q.INSTALLED_C5_CONTROLLER,harness.j,marker,harness.l,receipt)
            self.assertEqual(ready['phase'],'ready')
            self.assertEqual(ready['accepted_canary']['operation'],key)
            self.assertEqual(ready['accepted_canary']['source_sha'],NEW.head)


class RealInputAndSize(unittest.TestCase):
    def test_real_exact_inputs_pass_addressed_shape_and_analysis_pin(self):
        value=package()
        for row in value['grants'].values():
            g=row['grant']
            raw=subprocess.check_output(['git','show',g['input_revision']+':'+g['input_path']],cwd=REPO)
            self.assertEqual(hashlib.sha256(raw).hexdigest(),g['input_sha256'])
            marker=dict(phase='canary',adapter_revision=g['controller_revision'],qualification=dict(qualification_grant=g))
            # Real Git blob reads from the allowed object DB; emulate only the
            # isolated candidate HEAD and admitted marker, never root/live state.
            def git(work,*args):
                if args==('rev-parse','HEAD'):return (NEW.head+'\n').encode()
                self.assertEqual(args,('show',g['input_revision']+':'+g['input_path']))
                return subprocess.check_output(['git',*args],cwd=REPO)
            with patch.object(N,'git',side_effect=git),patch.object(N,'trusted',return_value=json.dumps(marker).encode()):
                self.assertEqual(Q.addressed_input(REPO,g),raw.decode())
            if g['role']=='independent_qa':
                contract=json.loads(raw)
                self.assertEqual(contract['source_sha'],NEW.head)
                self.assertLessEqual(len(contract['requirements'].encode()),16000)
                self.assertEqual(len(contract['checks']),1)
                self.assertEqual(contract['checks'][0]['exit_code'],0)
            else:
                self.assertEqual((g['input_revision'],g['input_path'],g['input_sha256']),
                    (NEW.head,Q.ANALYSIS_INPUT,'40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55'))
                self.assertEqual(raw,subprocess.check_output(['git','show',OLD.head+':'+Q.ANALYSIS_INPUT],cwd=REPO))

    def test_full_rules_small_range_size_and_old_range_refusal(self):
        # Exact fixed text of stage.qualify_qa, including its real contract/suffix.
        tree=ast.parse((REPO/'scripts/chatops/actions_train/stage.py').read_text())
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='qualify_qa')
        fixed=next(ast.literal_eval(node.value) for node in function.body
                   if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='text' for t in node.targets))
        self.assertEqual(N.qa_rules_overhead()-P.RULES_SIZE,574)
        self.assertEqual(N.QA_INPUT_LIMIT,262144)
        with tempfile.TemporaryDirectory(prefix='agy29-size-') as temp:
            for source in (NEW,OLD):
                work=Path(temp)/source.head[:7]
                # The assigned checkout's .git is read-only. Materialize an
                # archive and a disposable object DB; preserve the original SHAs
                # without checkout/fetch/commit or modifying the source .git.
                work.mkdir()
                raw=subprocess.check_output(['git','archive',source.head],cwd=REPO)
                with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                    archive.extractall(work,filter='data')
                subprocess.run(['git','init','--template=','-q',str(work)],check=True,capture_output=True)
                objects=Path(subprocess.check_output(['git','rev-parse','--path-format=absolute','--git-path','objects'],cwd=REPO).decode().strip())
                shutil.copytree(objects,work/'.git/objects',dirs_exist_ok=True)
                subprocess.run(['git','update-ref','HEAD',source.head],cwd=work,check=True,capture_output=True)
                contract=subprocess.check_output(['git','show',source.qa_input_revision+':'+source.qa_input_path],cwd=REPO).decode()
                text=fixed+'\nExact reviewed source/test contract DATA:\n'+contract+'\nRead-only candidate root: '+str(work.resolve())
                with patch.object(P,'RULES_SIZE',INSTALLED_RULES_SIZE):
                    if source==OLD:
                        with self.assertRaises(N.ReviewError) as error:
                            N.collect(work,source.base,source.head,text,compact_files=True)
                        self.assertEqual(error.exception.code,'AGY_INPUT_LIMIT')
                        print('AGY29_OLD_RANGE_REFUSAL '+error.exception.detail)
                    else:
                        stage,_=N.collect(work,source.base,source.head,text,compact_files=True)
                        stage_bytes=len(stage.encode())
                        total=stage_bytes+INSTALLED_RULES_SIZE+574
                        self.assertLessEqual(total,262144)
                        self.assertLessEqual(total,140000)
                        print('AGY29_SIZE stage_bytes=%d rules_bytes=%d overhead=574 total_bytes=%d' % (stage_bytes,INSTALLED_RULES_SIZE,total))


if __name__=='__main__':unittest.main()
