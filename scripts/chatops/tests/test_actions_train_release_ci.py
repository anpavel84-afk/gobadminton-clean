"""Real Git/CI auto-formation fixtures. No GitHub write or native model calls."""
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
import test_actions_train_release_equivalence as fixtures
release = fixtures.release
from test_actions_train import core, ROOT


class AutomaticRelease(fixtures.GitFixture):
    def setUp(self):
        super().setUp()
        manifest=json.loads((ROOT/release.MANIFEST).read_bytes())
        for path in list(manifest['files'])+[release.MANIFEST,*release.WORKFLOWS]:
            self.write(path,(ROOT/path).read_bytes())
        self.implementation=self.commit('implementation')
        self.accepted=release.prepare(self.repo,self.implementation,self.implementation,
            'refs/heads/baseline-release')['release']
        self.git('checkout','--detach','-q',self.accepted)
    def new_source(self):
        name='scripts/chatops/actions_train/monitor_extension.js'
        p=self.repo/name;p.write_bytes(p.read_bytes()+b'\n// distinct fixture runtime revision\n')
        m=json.loads((self.repo/release.MANIFEST).read_text())
        m['files'][name]=hashlib.sha256(p.read_bytes()).hexdigest()
        (self.repo/release.MANIFEST).write_text(json.dumps(m,sort_keys=True))
        return self.commit('new source')
    def test_auto_creates_reconstructible_deterministic_release_without_source_mutation(self):
        head=self.new_source();index=(self.repo/'.git/index').read_bytes()
        status=self.git('status','--porcelain');refs=self.git('for-each-ref','--format=%(refname) %(objectname)')
        one=release.automatic(self.repo,head,self.accepted,self.root/'artifact-one',head)
        two=release.automatic(self.repo,head,self.accepted,self.root/'artifact-two',head)
        self.assertEqual(one['status'],'generated');self.assertEqual(one['release'],two['release'])
        self.assertEqual(one['implementation'],head)
        self.assertEqual(self.git('rev-parse','HEAD'),head)
        self.assertEqual((self.repo/'.git/index').read_bytes(),index)
        self.assertEqual(self.git('status','--porcelain'),status)
        self.assertEqual(self.git('for-each-ref','--format=%(refname) %(objectname)'),refs)
        bundle=self.root/'artifact-one/release.bundle'
        self.assertEqual(hashlib.sha256(bundle.read_bytes()).hexdigest(),one['bundle_sha256'])
        self.git('bundle','verify',str(bundle))
        self.git('fetch','--no-tags',str(bundle),'refs/heads/train-auto-release-'+head[:18]+':refs/heads/imported-artifact')
        imported=self.git('rev-parse','refs/heads/imported-artifact');self.assertEqual(imported,one['release'])
        self.assertTrue(release.check(self.repo,imported,True)['runtime_identity_reusable'])
        self.assertEqual(self.git('show','-s','--format=%P',imported),head)
        for path in release.WORKFLOWS:
            self.assertEqual(release.refs(release.blob(self.repo,imported,path)),[head,head])
    def test_actual_PR_head_is_not_synthetic_merge_or_updated_base(self):
        head=self.new_source();self.git('branch','feature',head)
        self.git('checkout','-qb','updated-base',self.accepted)
        self.write('docs/handoffs/base-update.md','other independent writer')
        base=self.commit('independent base change')
        self.git('merge','--no-ff','-m','synthetic PR merge','feature')
        merged=self.git('rev-parse','HEAD');self.assertNotEqual(merged,head)
        result=release.automatic(self.repo,head,base,self.root/'pr-artifact',merged)
        self.assertEqual(result['implementation'],head);self.assertEqual(result['tested_checkout'],merged)
        self.assertEqual(result['inspected_base'],base);self.assertEqual(result['fork_point'],self.accepted)
        self.assertEqual(self.git('rev-parse','HEAD'),merged)
    def test_existing_release_and_unrelated_product_do_not_generate_again(self):
        result=release.automatic(self.repo,self.accepted,self.implementation,self.root/'existing',self.accepted)
        self.assertEqual(result['status'],'existing_release');self.assertEqual(result['release'],self.accepted)
        self.assertFalse((self.root/'existing/release.bundle').exists())
        self.write('apps/web/independent.ts','export const product = true;')
        head=self.commit('product only')
        result=release.automatic(self.repo,head,self.accepted,self.root/'product',head)
        self.assertEqual(result['status'],'not_applicable');self.assertIsNone(result['release'])
    def test_corrupt_manifest_never_triggers_regeneration(self):
        head=self.new_source()
        p=self.repo/release.MANIFEST;m=json.loads(p.read_text());m['files'][next(iter(m['files']))]='0'*64
        p.write_text(json.dumps(m));bad=self.commit('bad manifest')
        with self.assertRaises(core.Refused):release.automatic(self.repo,bad,self.accepted,self.root/'bad',bad)
        self.assertFalse((self.root/'bad/release.json').exists())
    def test_wrong_workflow_checkout_and_split_pins_refuse(self):
        head=self.new_source()
        with self.assertRaises(core.Refused):release.automatic(self.repo,head,self.accepted,self.root/'wrong-checkout','f'*40)
        p=self.repo/release.WORKFLOWS[0]
        p.write_text(p.read_text().replace(self.implementation,'f'*40,1));bad=self.commit('split pins')
        with self.assertRaises(core.Refused):release.automatic(self.repo,bad,self.accepted,self.root/'split',bad)
        self.assertFalse((self.root/'split/release.json').exists())
    def test_existing_artifact_is_not_overwritten(self):
        head=self.new_source();out=self.root/'artifact'
        release.automatic(self.repo,head,self.accepted,out,head);before=(out/'release.json').read_bytes()
        with self.assertRaises(core.Refused):release.automatic(self.repo,head,self.accepted,out,head)
        self.assertEqual((out/'release.json').read_bytes(),before)


class AutomaticReleaseWorkflow(unittest.TestCase):
    def test_existing_receiver_calls_pinned_generator_without_write_privileges(self):
        text=(ROOT/'.github/workflows/ci.yml').read_text()
        receiver=text.split('  receiver:',1)[1]
        self.assertIn('Checkout immutable release generator',receiver)
        self.assertIn('path: _train-release-tools',receiver)
        self.assertIn('persist-credentials: false',receiver)
        self.assertIn('prepare_train_release.py" auto',receiver)
        self.assertIn('github.event.pull_request.head.sha || github.sha',receiver)
        self.assertIn('--tool-revision "$TRAIN_TOOLS_SHA"',receiver)
        self.assertIn('name: train-release',receiver)
        self.assertNotIn('contents: write',text)
        self.assertNotIn('pull_request_target',text)
        self.assertNotIn('secrets.',receiver)
        self.assertEqual(text.count('  receiver:'),1)

if __name__=='__main__':unittest.main()
