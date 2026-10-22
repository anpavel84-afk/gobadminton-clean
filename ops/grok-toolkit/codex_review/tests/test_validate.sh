#!/bin/bash
# shellcheck disable=SC2034,SC2015,SC2016
# Unit tests for the pure validation functions of src/codex-review (extracted between markers).
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BODY_MAX=65536
eval "$(sed -n '/^# --- BEGIN validate/,/^# --- END validate/p' "$HERE/src/codex-review")"
pass=0; fail=0
ok()  { if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected ok): $*"; fi; }
bad() { if "$@"; then fail=$((fail+1)); echo "FAIL (expected reject): $*"; else pass=$((pass+1)); fi; }
S=0123456789abcdef0123456789abcdef01234567
ok  parse_req "M0b.body.txt $S"
[ "$RQ_NAME" = M0b.body.txt ] && [ "$RQ_SHA" = $S ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL parse fields"; }
ok  parse_req "  M1f1.body.json   $S  "
ok  parse_req "a.md $S"
bad parse_req ""
bad parse_req "M0b.body.txt"
bad parse_req "M0b.body.txt $S extra"
bad parse_req "M0b.body.txt ${S^^}"
bad parse_req "M0b.body.txt ${S:0:39}"
bad parse_req "M0b.body.txt ${S}0"
bad parse_req "M0b.body.txt g123456789abcdef0123456789abcdef01234567"
bad parse_req "../etc/passwd.txt $S"
bad parse_req "a..b.txt $S"
bad parse_req ".hidden.txt $S"
bad parse_req "-rf.txt $S"
bad parse_req "dir/file.txt $S"
bad parse_req "body.sh $S"
bad parse_req "body $S"
bad parse_req "bo\$dy.txt $S"
bad parse_req "body;id.txt $S"
bad parse_req "$(printf 'a%.0s' {1..130}).txt $S"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
printf 'GOBADMINTON_AUTONOMY_V1\n{"goal":"Карта — ok\\tтаб"}\r\n\t\n' >"$T/good"; ok body_ok "$T/good"
: >"$T/empty"; bad body_ok "$T/empty"
printf 'a\0b' >"$T/nul"; bad body_ok "$T/nul"
printf 'a\033[31mred' >"$T/esc"; bad body_ok "$T/esc"
printf 'a\x7f' >"$T/del"; bad body_ok "$T/del"
printf '\xff\xfe bad utf8' >"$T/latin"; bad body_ok "$T/latin"
head -c 65536 /dev/zero | tr '\0' 'a' >"$T/max"; ok body_ok "$T/max"
head -c 65537 /dev/zero | tr '\0' 'a' >"$T/big"; bad body_ok "$T/big"
[ "$(review_name M0b.body.txt $S 20261019T060000Z)" = "M0b.body-01234567-20261019T060000Z.txt" ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL review_name"; }
echo 'Error: The model `gpt-6.1-sol` does not exist or you do not have access to it.' >"$T/e1"; ok model_rejected "$T/e1"
echo 'error: unsupported model: gpt-6.1-sol' >"$T/e2"; ok model_rejected "$T/e2"
echo 'stream error: 401 Unauthorized' >"$T/e3"; bad model_rejected "$T/e3"
echo 'timeout waiting for response' >"$T/e4"; bad model_rejected "$T/e4"
out=$(printf '%s\n' 'token: eyJhbGciOiJSUzI1NiJ9.payload.sig' '"refresh_token": "rt_abc"' 'Authorization: Bearer abc.def' 'key sk-proj-ABCDEFGH' 'x=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123' 'normal error line 42' | redact)
if printf '%s' "$out" | grep -q -E 'eyJ|rt_abc|abc\.def|sk-proj|ABCDEFGHIJKLMNOPQRSTUVWXYZ'; then fail=$((fail+1)); echo "FAIL redact leaked: $out"; else pass=$((pass+1)); fi
printf '%s' "$out" | grep -q 'normal error line 42' && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL redact removed normal line"; }
echo "validate tests: $pass passed, $fail failed"; [ "$fail" = 0 ]
