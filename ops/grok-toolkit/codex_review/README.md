# codex-review — read-only Codex review of Issue bodies (gb-ops)

Files
- src/codex-review           wrapper -> /usr/local/sbin/gb-ops/codex-review (sha256 4ad1ef62d946e4e926bfa04cf5f7d4934bba67e935416a55ef7aec19ba27c7e5)
- installer.tpl + build.sh   -> codex-review-install.sh (sha256 59815aef65fe6c0f326bb33399284e38fdf84af4dfece4c58f1fd09e113f6f13), wrapper embedded base64 + sha-checked
- tests/test_validate.sh     unit tests of input validation / redaction (36)
- tests/e2e_ns.sh + fake-codex   offline e2e of installer+wrapper+--remove in a private mount/UTS namespace on the box (44)
- vps.py                     paramiko helper (__OPS_USER__)
- root_cmd.txt               the one root command for Pavel

Staged: /var/lib/gb-ops-stage/files/codex-review-install.sh (__OPS_USER__ 0600), sha256 verified on server; DRY=1 run on server OK.
Install: see root_cmd.txt.  Rollback: sudo bash /root/codex-review-install.sh --remove
Use (__OPS_USER__): stage body into /var/lib/gb-ops-stage/files/NAME.body.txt, then
  echo "NAME.body.txt <40-hex sha>" | sudo /usr/local/sbin/gb-ops/codex-review
  -> /var/lib/gb-ops-stage/reviews/NAME.body-<sha8>-<UTCstamp>.txt  (runs up to ~15 min; run with nohup for long sessions)

Successor review (Owner rule 2026-10-19): pass prior QA findings with the body, no wrapper change needed:
  python3 /workspace/outputs/issue_lint/make_review_input.py BODY.txt qa_history.json NAME.review-input.txt --issues N
  stage NAME.review-input.txt instead of the bare body; the appendix is marked "НЕ часть тела, НЕ включать в REVISED_BODY".
  QA history source: /home/__EXEC_USER__/.gb-autonomy-state/qa-<issue>-a<k>.json (read-only).
