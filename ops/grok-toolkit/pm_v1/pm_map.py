#!/usr/bin/env python3
"""GoBadminton technical-PM dependency map V1 (stage 0): READ-ONLY, advisory, never claims.

Pure stdlib. Builds a compact map from open Issues + recorded links (depends_on, locks,
model, effort) + allowed_paths overlap. It can only TIGHTEN (mark more pairs incompatible);
it never marks anything "ready" and nothing in the executor imports its result.
"""
import argparse
import datetime as dt
import hashlib
import json

SCHEMA = 'GoBadminton.PmMap.v001'
DEFAULT_PROFILE = {'model': 'gpt-6.1-sol', 'effort': 'high'}
# Areas that always run alone (agreed rules). Prefix match on the path base.
ALWAYS_SOLO = ('apps/api/migrations/', 'apps/api/src/database/', 'packages/contracts/',
               '.github/', 'scripts/chatops/')
ALWAYS_SOLO_FILES = ('pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', 'eslint.config.mjs')
# Per-issue file names (docs/handoffs/ISSUE_<n>_*.md): never a real conflict.
IGNORED_PREFIXES = ('docs/handoffs/',)


def _norm(pattern):
    return (pattern[:-3], True) if pattern.endswith('/**') else (pattern, False)


def paths_overlap(a, b):
    (ba, ga), (bb, gb) = _norm(a), _norm(b)
    if (ba + '/').startswith(IGNORED_PREFIXES) or (bb + '/').startswith(IGNORED_PREFIXES):
        return False
    if ga and gb:
        return (ba + '/').startswith(bb + '/') or (bb + '/').startswith(ba + '/')
    if ga:
        return (bb + '/').startswith(ba + '/')
    if gb:
        return (ba + '/').startswith(bb + '/')
    return ba == bb


def solo_reasons(task):
    reasons = []
    if not task.get('locks'):
        reasons.append('no_locks_declared')
    elif task['locks'] == ['global']:
        reasons.append('lock_global')
    for p in task['allowed_paths']:
        base, glob = _norm(p)
        if any((base + '/').startswith(s) or (glob and s.startswith(base + '/'))
               for s in ALWAYS_SOLO) or (not glob and base in ALWAYS_SOLO_FILES):
            reasons.append('solo_path:' + p)
    return reasons


def locks_conflict(a, b):
    if 'global' in a or 'global' in b:
        return True
    return any(x == y or x.startswith(y + ':') or y.startswith(x + ':') for x in a for y in b)


def build(issues, done, parked, active, validate, since, now=None):
    """issues: GitHub open-issue objects. validate(issue, since, now)->task or raises.
    Returns the map dict (without timestamp inside the fingerprinted part)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    done, parked = set(done), set(parked)
    nodes, rejected = {}, []
    for issue in sorted(issues, key=lambda i: i['number']):
        n = issue['number']
        if n in done or n in parked or 'pull_request' in issue:
            continue
        try:
            task = validate(issue, since, now)
        except Exception as error:  # not claimable: show why (typos in new fields surface here)
            if str(issue.get('body', '')).startswith('GOBADMINTON_AUTONOMY_V1'):
                rejected.append({'issue': n, 'reason': str(error)[:120]})
            continue
        locks = task.get('locks') or ['global']
        solo = solo_reasons(task)
        profile = ({'model': task['model'], 'effort': task['effort'], 'source': 'declared'}
                   if 'model' in task else dict(DEFAULT_PROFILE, source='default'))
        nodes[n] = {'issue': n, 'title': (issue.get('title') or '')[:90],
                    'status': 'active' if n == active else 'queued',
                    'depends_on': task.get('depends_on', []), 'locks': locks,
                    'solo': solo, 'profile': profile,
                    'allowed_paths': task['allowed_paths']}
    for node in nodes.values():
        node['deps'] = [{'issue': d, 'status': 'done' if d in done else 'parked' if d in parked
                         else 'open' if d in nodes else 'unknown'} for d in node['depends_on']]
        node['blocked_by_deps'] = [x['issue'] for x in node['deps'] if x['status'] != 'done']
    cycles = _cycles(nodes)
    pairs = []
    ids = sorted(nodes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            na, nb = nodes[a], nodes[b]
            why = []
            if na['solo'] or nb['solo']:
                why.append('solo')
            if locks_conflict(na['locks'], nb['locks']):
                why.append('locks')
            if any(paths_overlap(x, y) for x in na['allowed_paths'] for y in nb['allowed_paths']):
                why.append('paths')
            if b in na['depends_on'] or a in nb['depends_on']:
                why.append('depends')
            pairs.append({'a': a, 'b': b, 'parallel_candidate': not why, 'why_not': why})
    facts = {'schema': SCHEMA, 'nodes': [nodes[i] for i in ids], 'pairs': pairs,
             'cycles': cycles, 'rejected': rejected,
             'advice': 'ADVISORY ONLY: claiming is unchanged; the executor stays the only authority'}
    facts['fingerprint'] = hashlib.sha256(json.dumps(
        facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    facts['generated_at'] = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    return facts


def _cycles(nodes):
    seen, stack, found = set(), [], []

    def visit(n):
        if n in stack:
            found.append(stack[stack.index(n):] + [n])
            return
        if n in seen or n not in nodes:
            return
        seen.add(n)
        stack.append(n)
        for d in nodes[n]['depends_on']:
            visit(d)
        stack.pop()
    for n in sorted(nodes):
        visit(n)
    return found


def capsule(pm_map, issue):
    """Compact per-task capsule for the future PM (no paths list, no goal text)."""
    node = next(n for n in pm_map['nodes'] if n['issue'] == issue)
    parallel = [p['b'] if p['a'] == issue else p['a'] for p in pm_map['pairs']
                if issue in (p['a'], p['b']) and p['parallel_candidate']]
    return {'schema': 'GoBadminton.PmCapsule.v001', 'issue': issue,
            'depends_on': node['deps'], 'locks': node['locks'], 'solo': node['solo'],
            'profile': node['profile'], 'paths_count': len(node['allowed_paths']),
            'parallel_with': parallel, 'map_fingerprint': pm_map['fingerprint'],
            'llm_default': 'NONE'}


def fetch_open_issues(repo='anpavel84-afk/gobadminton-clean'):
    """ONE unauthenticated read (public quota is 60/h shared with the executor): keep >=10 min apart."""
    import urllib.request
    req = urllib.request.Request(
        f'https://api.github.com/repos/{repo}/issues?state=open&per_page=100',
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'gobadminton-pm-map-v1'})
    with urllib.request.urlopen(req, timeout=30) as r:  # 403/429 -> exception -> keep old file
        return json.loads(r.read(2 * 1024 * 1024))


def write_atomic(path, value):
    import os
    tmp = f'{path}.tmp{os.getpid()}'
    with open(tmp, 'w') as f:
        json.dump(value, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main():  # thin CLI: no writes except --out; never touches executor state
    ap = argparse.ArgumentParser(description='PM dependency map V1 (read-only, advisory)')
    ap.add_argument('--issues', help='saved issues JSON; default: one live read')
    ap.add_argument('--state-dir', help='executor state dir (state.json, parked.json), read-only')
    ap.add_argument('--module', required=True, help='path to the installed autonomous_issues.py')
    ap.add_argument('--out', help='write map here atomically; default stdout')
    a = ap.parse_args()
    import importlib.util
    spec = importlib.util.spec_from_file_location('autonomous_issues', a.module)
    ai = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ai)
    done, parked, active = [], [], None
    if a.state_dir:
        st = json.load(open(a.state_dir + '/state.json'))
        done = st.get('done', [])
        active = (st.get('active') or {}).get('issue')
        try:
            parked = [e['issue'] for e in json.load(open(a.state_dir + '/parked.json'))['parked']]
        except FileNotFoundError:
            pass
    issues = json.load(open(a.issues)) if a.issues else fetch_open_issues()
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    result = build(issues, done, parked, active, ai.validate_issue, since)
    if a.out:
        write_atomic(a.out, result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
