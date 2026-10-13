"""QA-PR11 repair: distinct Git-domain predicate must bind SSH aliases to true provider."""
from __future__ import annotations
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    import psutil
except ModuleNotFoundError:
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *args, **kwargs: ())

import runner

ORIGIN="anpavel84-afk/gobadminton-clean.git"

class RemoteAliasReviewRegression(unittest.TestCase):
    def test_known_github_alias_normalization(self):
        for host in ("github.com","github-gobadminton-clean",
                     "github-gobadminton","github-gobadminton-readonly"):
            self.assertEqual(runner._trusted_git_remote_hostname(host),"github.com")
        for host in ("unverified-github","myprivate-cname.example",
                     "localhost","ssh-alias"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                runner._trusted_git_remote_hostname(host)

    def exercise(self, other_remote: str):
        with tempfile.TemporaryDirectory() as p:
            root=Path(p)
            main=root/"product"/"repo"
            other=root/"otherrepo"
            (main/".git").mkdir(parents=True)
            (other/".git").mkdir(parents=True)
            args=["codex","exec","-C",str(other)]
            proc=SimpleNamespace(
                info={"cmdline":args},
                cwd=lambda:str(other),
                cmdline=lambda:list(args),
                uids=lambda:SimpleNamespace(real=1002),
            )
            cfg={"workspace":str(main),"dev_root":str(root/"product")}
            main_remote="git@github-gobadminton-clean:"+ORIGIN
            def fake_run(argv,**kwargs):
                cwd=Path(argv[2]) if len(argv)>2 and argv[0]=="git" and argv[1]=="-C" else None
                if cwd not in (main,other):raise AssertionError(argv)
                op=argv[3:]
                if op==["rev-parse","--git-common-dir"]:
                    answer=".git\n"
                elif op==["remote"]:
                    answer="origin\n"
                elif op in (["remote","get-url","--all","origin"],
                            ["remote","get-url","--push","--all","origin"]):
                    answer=(main_remote if cwd==main else other_remote)+"\n"
                else:
                    raise AssertionError("unexpected Git call "+str(argv))
                return SimpleNamespace(returncode=0,stdout=answer,stderr="")
            with patch.object(runner.subprocess,"run",side_effect=fake_run):
                return runner.verified_disjoint_codex(proc,cfg)

    def test_same_clean_repo_ssh_alias_vs_https_is_NOT_disjoint(self):
        self.assertFalse(self.exercise("https://github.com/"+ORIGIN))

    def test_same_clean_repo_git_ssh_alias_vs_literal_host_is_NOT_disjoint(self):
        self.assertFalse(self.exercise("git@github.com:"+ORIGIN))

    def test_unknown_alias_must_FAIL_CLOSED(self):
        self.assertFalse(self.exercise("git@anonymous-alias:"+ORIGIN))

    def test_provably_other_github_repo_is_disjoint(self):
        self.assertTrue(self.exercise("https://github.com/independent-owner/unrelated-code.git"))

if __name__=="__main__":
    unittest.main()
