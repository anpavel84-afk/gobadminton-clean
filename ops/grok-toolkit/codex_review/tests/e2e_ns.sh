#!/bin/bash
# Offline end-to-end test of installer + wrapper inside a private mount/UTS namespace (box only, as root).
set -u
H=/workspace/outputs/codex_review
SHA=${SHA:?}
X=$(mktemp -d /tmp/cr-e2e.XXXXXX)
mount --make-rprivate /
hostname __VPS_HOSTNAME__
cp -a /etc "$X/etc"; mount --bind "$X/etc" /etc
for d in /home /root /opt /usr/local/sbin /var/lib /var/log /var/backups; do mount -t tmpfs -o mode=755 tmpfs "$d"; done
mkdir -p /var/lib/sudo /root
useradd -m -U -s /bin/bash __OPS_USER__; useradd -m -U -s /bin/bash __EXEC_USER__
chmod 750 /home/__EXEC_USER__
install -d -m 0700 -o __EXEC_USER__ -g __EXEC_USER__ /home/__EXEC_USER__/.codex
printf '{"note":"FAKE-AUTH-DO-NOT-USE"}\n' >/home/__EXEC_USER__/.codex/auth.json
chown __EXEC_USER__: /home/__EXEC_USER__/.codex/auth.json; chmod 600 /home/__EXEC_USER__/.codex/auth.json
install -d -m 0755 /usr/local/sbin/gb-ops /usr/local/sbin/gb-ops/lib
install -m 0644 /workspace/outputs/gb_ops_bootstrap/src/lib.sh /usr/local/sbin/gb-ops/lib.sh
install -m 0755 /workspace/outputs/gb_ops_bootstrap/src/status /usr/local/sbin/gb-ops/status
cat >/etc/sudoers.d/gb-__OPS_USER__-ops <<'S'
# managed by gb-ops-bootstrap (test copy)
Cmnd_Alias GBOPS_CMDS = /usr/local/sbin/gb-ops/status ""
Defaults!GBOPS_CMDS env_reset, !setenv, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
__OPS_USER__ ALL=(root) NOPASSWD: GBOPS_CMDS
S
chmod 440 /etc/sudoers.d/gb-__OPS_USER__-ops
install -d -m 0700 -o __OPS_USER__ -g __OPS_USER__ /var/lib/gb-ops-stage /var/lib/gb-ops-stage/files
install -d -m 0755 /opt/gobadminton-clean-qa/bin /opt/gobadminton-clean-qa/codex-path
install -m 0755 "$H/tests/fake-codex" /opt/gobadminton-clean-qa/bin/codex
: >/opt/gobadminton-clean-qa/fake-calls.log; chmod 666 /opt/gobadminton-clean-qa/fake-calls.log
touch /var/log/gb-ops.log; chmod 640 /var/log/gb-ops.log
P=0; F=0; t() { if eval "$2"; then P=$((P+1)); echo "  ok   $1"; else F=$((F+1)); echo "  FAIL $1"; fi; }
GS() { setpriv --reuid=__OPS_USER__ --regid=__OPS_USER__ --init-groups env -i HOME=/home/__OPS_USER__ PATH=/usr/bin:/bin "$@"; }
stage() { GS sh -c "cat > /var/lib/gb-ops-stage/files/$1"; }
review() { echo "$1" | GS sudo -n /usr/local/sbin/gb-ops/codex-review 2>&1; }

echo "== installer DRY"; DRY=1 bash "$H/codex-review-install.sh" >"$X/dry.log" 2>&1; t "dry exit 0" '[ $? = 0 ]'
t "dry changed nothing" '! getent passwd gobadminton-clean-prompt-review >/dev/null && [ ! -e /usr/local/sbin/gb-ops/codex-review ]'
echo "== installer"
cp "$H/codex-review-install.sh" /root/codex-review-install.sh
bash /root/codex-review-install.sh >"$X/inst.log" 2>&1; rc=$?; t "install exit 0" "[ $rc = 0 ]" || cat "$X/inst.log"
tail -n 12 "$X/inst.log" | sed 's/^/    | /'
t "auth copy 0600 svc" '[ "$(stat -c "%U %a" /var/lib/gobadminton-clean-prompt-reviewer/.codex/auth.json)" = "gobadminton-clean-prompt-review 600" ]'
t "only auth.json in CODEX_HOME" '[ "$(ls -A /var/lib/gobadminton-clean-prompt-reviewer/.codex)" = auth.json ]'
t "installer never printed auth" '! grep -q FAKE-AUTH "$X/inst.log"'
t "wrapper root 0755" '[ "$(stat -c "%U %a" /usr/local/sbin/gb-ops/codex-review)" = "root 755" ]'
t "visudo ok" 'visudo -c >/dev/null'
t "old sudo rule kept" 'grep -q GBOPS_CMDS /etc/sudoers.d/gb-__OPS_USER__-ops'
t "svc no shell" '[ "$(getent passwd gobadminton-clean-prompt-review | cut -d: -f7)" = /usr/sbin/nologin ]'
bash /root/codex-review-install.sh >"$X/inst2.log" 2>&1; t "re-install idempotent" '[ $? = 0 ] && [ "$(grep -c "BEGIN gb-codex-review" /etc/sudoers.d/gb-__OPS_USER__-ops)" = 1 ]'

echo "== wrapper happy path"
cp /workspace/outputs/map_split/M0b.body.txt "$X/b"; stage M0b.body.txt <"$X/b"
out=$(review "M0b.body.txt $SHA"); echo "$out" | sed 's/^/    | /'
f=$(ls -t /var/lib/gb-ops-stage/reviews/*.txt 2>/dev/null | head -1); cp "$f" /tmp/cr-last-review.txt
t "review file exists, __OPS_USER__ 600" '[ -n "$f" ] && [ "$(stat -c "%U %a" "$f")" = "__OPS_USER__ 600" ]'
t "header verdict NELZYA" 'grep -q "^verdict: NELZYA" "$f"'
t "model gpt-6.1-sol requested" 'grep -q "^model: gpt-6.1-sol (high)" "$f" && grep -q "model_seen: gpt-6.1-sol" "$f"'
t "repo_sha + dev_head in prompt" 'grep -q "repo_sha (checked out in the current directory): $SHA" "$f" && grep -q "dev HEAD at review time: [0-9a-f]\{40\}" "$f"'
t "codex ran as svc" 'grep "exec" /opt/gobadminton-clean-qa/fake-calls.log | tail -1 | grep -q "^uid=gobadminton-clean-prompt-review"'
t "work dir cleaned" '[ -z "$(ls -A /var/lib/gobadminton-clean-prompt-reviewer/work)" ]'
t "root tmp cleaned" '[ -z "$(ls -A /var/backups/gb-ops/tmp 2>/dev/null)" ]'
t "log line with sha" 'grep -q "codex-review done body=M0b.body.txt body_sha=$(sha256sum "$X/b" | cut -c1-12) repo_sha=$SHA" /var/log/gb-ops.log'
t "no auth in review/log" '! grep -q FAKE-AUTH "$f" /var/log/gb-ops.log'

echo "== model fallback"
touch /opt/gobadminton-clean-qa/REJECT_MODEL; sleep 1
review "M0b.body.txt $SHA" >"$X/o2"; f=$(ls -t /var/lib/gb-ops-stage/reviews/*.txt | head -1)
t "fallback recorded" 'grep -q "^model: CLI default (high) - gpt-6.1-sol was rejected" "$f" && grep -q "model_seen: default" "$f"'
rm -f /opt/gobadminton-clean-qa/REJECT_MODEL
echo "== failure path (redaction)"
touch /opt/gobadminton-clean-qa/FAIL; sleep 1
review "M0b.body.txt $SHA" >"$X/o3"; f=$(ls -t /var/lib/gb-ops-stage/reviews/*.txt | head -1)
t "failure -> NO_RESULT, exit!=0" 'grep -q "^verdict: NO_RESULT" "$f" && grep -q "exit code\|exit_code: 1" "$f"'
t "secret redacted in stderr tail" '! grep -q "rt_SECRET\|secretpayload" "$f" && grep -q REDACTED "$f"'
rm -f /opt/gobadminton-clean-qa/FAIL

echo "== refusals"
r() { review "$2" >"$X/r" 2>&1; local c=$?; if [ $c != 0 ] && grep -q "$3" "$X/r"; then P=$((P+1)); echo "  ok   refuse: $1"; else F=$((F+1)); echo "  FAIL refuse: $1 (rc=$c: $(tail -1 "$X/r"))"; fi; }
r "no sha" "M0b.body.txt" "need exactly"
r "short sha" "M0b.body.txt ${SHA:0:12}" "40 lowercase hex"
r "bad ext" "M0b.body.sh $SHA" "must end in"
r "traversal" "../x.txt $SHA" "not allowed"
r "prod word" "prod-fix.txt $SHA" "production"
r "plan word" "plan.txt $SHA" "production"
r "missing body" "nope.txt $SHA" "cannot open staged body"
GS ln -s /etc/shadow /var/lib/gb-ops-stage/files/link.txt; r "symlink body" "link.txt $SHA" "missing or symlinked"
stage a.txt </dev/null; GS ln /var/lib/gb-ops-stage/files/a.txt /var/lib/gb-ops-stage/files/hard.txt; r "hardlink body" "hard.txt $SHA" "rejected (links=2"
echo x >/var/lib/gb-ops-stage/files/rootown.txt; r "root-owned body" "rootown.txt $SHA" "owner=root"
head -c 70000 /dev/zero | tr '\0' a | stage big.txt; r "too big" "big.txt $SHA" "size=70000"
printf 'a\033b' | stage esc.txt; r "control chars" "esc.txt $SHA" "control characters"
stage ok.txt <"$X/b"; r "unknown sha" "ok.txt 0000000000000000000000000000000000000001" "shallow clone"
t "argv refused" 'echo "ok.txt $SHA" | GS sudo -n /usr/local/sbin/gb-ops/codex-review extra 2>&1 | grep -q "not allowed\|not allowed to execute\|may not run\|a password is required\|Sorry"'
t "__OPS_USER__ cannot read auth copy" '! GS cat /var/lib/gobadminton-clean-prompt-reviewer/.codex/auth.json 2>/dev/null'

echo "== remove"
bash /root/codex-review-install.sh --remove >"$X/rm.log" 2>&1; t "remove exit 0" '[ $? = 0 ]' || cat "$X/rm.log"
t "user gone" '! getent passwd gobadminton-clean-prompt-review >/dev/null'
t "home + auth copy gone" '[ ! -e /var/lib/gobadminton-clean-prompt-reviewer ]'
t "wrapper gone" '[ ! -e /usr/local/sbin/gb-ops/codex-review ]'
t "sudoers block gone, base kept" '! grep -q gb-codex-review /etc/sudoers.d/gb-__OPS_USER__-ops && grep -q GBOPS_CMDS /etc/sudoers.d/gb-__OPS_USER__-ops && visudo -c >/dev/null'
t "backups in /root" 'ls /root/gb-__OPS_USER__-ops.*.bak /root/codex-review.*.bak >/dev/null 2>&1'
echo "e2e: $P passed, $F failed"
rm -f /run/gb-ops-codex-review.lock
[ "$F" = 0 ]
