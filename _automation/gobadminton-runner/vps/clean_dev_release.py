"""Fixed DEV release job; existing Compose, protected QA, backup and rollback.

No task commands, production paths, feature-gate overrides or schema restoration.
Only a real Clean main publication and its own protected QA can trigger release.
"""
from __future__ import annotations
import fcntl
import hashlib
import importlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.error
import urllib.parse

ROOT = Path('/srv/gobadminton-clean/runner')
CODE_LINK = Path('/opt/gobadminton-clean/runner-code/current')
POLICY = Path('/etc/gobadminton-clean-control-plane/clean-dev-release-policy.json')
STORE = Path('/var/lib/gobadminton-clean-dev-release')
GIT = STORE / 'source.git'
DEV = Path('/srv/gobadminton-dev-preview')
COMPOSE = (DEV / 'docker-compose.yml', DEV / 'compose.full-germany-oauth-avatar-v003.yml')
PROJECT = 'gobadminton_dev_preview'
API = 'gobadminton-dev-preview-api'
WEB = 'gobadminton-dev-germany-web'
DB = 'gobadminton-dev-preview-db'
PUB = Path('/var/lib/gobadminton-clean-publisher/main-pm.receipt.json')
EVIDENCE = Path('/var/lib/gobadminton-clean-trusted-qa-evidence')
BROWSER = Path('/opt/gobadminton-clean-dev-release/browser')
NODE = BROWSER / 'node/bin/node'
CHROME = BROWSER / 'chromium/chrome'
PUBLIC = 'https://dev.gobadminton.ru'
REMOTE = 'https://github.com/anpavel84-afk/gobadminton-clean.git'
SHA = re.compile('[0-9a-f]{40}')
SUITES = {'qa-friends-dev-s1-api-20261013-v002': 'friends-s1-germany-dev-privacy-v001',
          'qa-radar-dev-map-ui-20261013-v002': 'radar-map-germany-dev-privacy-v001'}
BRANCHES = {'qa-friends-dev-s1-api-20261013-v002': 'feature/friends-s1-clean-source-20261013',
            'qa-radar-dev-map-ui-20261013-v002': 'feature/radar-dev-real-map-20261013'}
EVENTS = []
_POLICY_BYTES = None


class Blocked(RuntimeError):
    pass


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def protected(path, uid=0, limit=8_000_000):
    for ancestor in [path.parent, *path.parent.parents]:
        info = ancestor.lstat()
        if ancestor.is_symlink() or (uid == 0 and (info.st_uid != 0 or info.st_mode & 0o022)):
            raise Blocked('unprotected evidence/source path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != uid or before.st_mode & 0o022
                or before.st_nlink != 1 or not 0 < before.st_size <= limit):
            raise Blocked('unsafe protected input')
        raw = bytearray()
        while len(raw) <= limit:
            data = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not data:
                break
            raw.extend(data)
        after = os.fstat(fd)
        current = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after) or identity(before) != identity(current) or len(raw) != before.st_size:
            raise Blocked('protected input changed')
        return bytes(raw)
    finally:
        os.close(fd)


def parse(raw):
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise Blocked('duplicate evidence field')
            value[key] = item
        return value
    value = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise Blocked('evidence object required')
    return value


def command(args, *, data=None, timeout=1800):
    # Logs retain only operation, exit and output hash; never environment/stdout.
    started = time.monotonic()
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
                                 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                                 'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
                                 'GIT_NO_REPLACE_OBJECTS': '1'})
    EVENTS.append({'operation': Path(args[0]).name, 'exit_code': result.returncode,
                   'output_sha256': sha(result.stdout + result.stderr),
                   'seconds': round(time.monotonic() - started, 3)})
    if result.returncode:
        raise Blocked(Path(args[0]).name + ' failed; private output digest recorded')
    return result.stdout


def git(args):
    return command(['/usr/bin/git', '--git-dir=' + str(GIT), '-c', 'core.hooksPath=/dev/null',
                    '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
                    '-c', 'core.useReplaceRefs=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
                    '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', *args]).decode().strip()


def compose_args(overlay=None):
    result = ['/usr/bin/docker', 'compose', '--project-name', PROJECT,
              '--project-directory', str(DEV), '--env-file', str(DEV / '.env')]
    for path in COMPOSE:
        result.extend(['-f', str(path)])
    if overlay is not None:
        if overlay.parent != STORE or overlay.name not in {'current-overlay.json', 'candidate-overlay.json', 'rollback-overlay.json'}:
            raise Blocked('unknown DEV overlay')
        result.extend(['-f', str(overlay)])
    return result


def record(path, value, gid=None):
    with tempfile.NamedTemporaryFile(dir=STORE, delete=False) as stream:
        temporary = Path(stream.name)
        if gid is not None:
            os.fchown(stream.fileno(), -1, gid)
        os.fchmod(stream.fileno(), 0o640 if gid is not None else 0o600)
        stream.write((json.dumps(value, sort_keys=True) + '\n').encode())
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(STORE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def bind(publication, planner, qa, producer, policy, contract):
    if (publication.get('schema') != 'GBCLEAN_PUBLISH_RECEIPT_V1'
            or publication.get('task_id') != 'main-pm' or publication.get('status') != 'PUBLISHED'
            or publication.get('real_publication') is not True or publication.get('branch') != 'main'
            or not SHA.fullmatch(str(publication.get('candidate_sha', '')))
            or not SHA.fullmatch(str(publication.get('expected_remote_sha', '')))
            or planner.get('result_commit') != publication['candidate_sha']
            or planner.get('action') not in {'merged', 'merged_and_enqueued'}):
        raise Blocked('actual accepted main publication required')
    qa_id = planner.get('accepted_qa_task_id')
    if qa_id not in SUITES:
        raise Blocked('only own Friends/Radar QA can authorize DEV')
    identity = {'schema_version': 1, 'qa_task_id': qa_id, 'producer_task_id': qa_id.removeprefix('qa-'),
                'candidate_sha': qa.get('candidate_sha'), 'candidate_tree': qa.get('candidate_tree'),
                'branch': qa.get('branch'), 'suite_id': SUITES[qa_id]}
    if (qa.get('project') != 'GoBadminton' or producer.get('project') != 'GoBadminton'
            or qa.get('task_id') != qa_id or qa.get('producer_task_id') != identity['producer_task_id']
            or qa.get('ok') is not True or qa.get('acceptance_state') != 'SOURCE_ACCEPTED'
            or qa.get('verdict') != 'PASS' or qa.get('blocking_findings') != []
            or qa.get('merge_recommendation') != 'MERGE_RECOMMENDED'
            or identity['branch'] != BRANCHES[qa_id]
            or qa.get('candidate_sha') != planner.get('merged_candidate_sha')
            or producer.get('task_id') != identity['producer_task_id'] or producer.get('ok') is not True
            or any(producer.get(k) != identity[k] for k in ('candidate_sha', 'candidate_tree', 'branch'))):
        raise Blocked('own producer/QA exact candidate binding required')
    contract.verify_runner_receipt(qa, EVIDENCE)
    protected_policy = contract.protected_json(EVIDENCE / 'policy.json')
    protected_job = contract.protected_json(EVIDENCE / (qa['trusted_job'] + '.json'))
    if (protected_policy.get('source_qa_authorizations', {}).get(qa['trusted_job']) != contract.digest(identity)
            or protected_job['job']['source_tree'] != identity['candidate_tree']
            or protected_job['job']['suite_id'] != identity['suite_id']):
        raise Blocked('independent protected QA identity not authorized')
    return identity


def validate_policy(policy, authority):
    required = {'schema', 'owner_event', 'publisher_uid', 'submitter_uid', 'runtime_gid', 'browser_uid',
                'module_sha256', 'compose_sha256', 'approved_additive_migrations',
                'node_sha256', 'browser_sha256', 'browser_dependencies_sha256'}
    if set(policy) != required or policy['schema'] != 'GBCLEAN_DEV_RELEASE_POLICY_V1':
        raise Blocked('exact root DEV policy required')
    if any(policy.get(k) != authority[k] for k in ('owner_event', 'publisher_uid', 'submitter_uid', 'runtime_gid')):
        raise Blocked('DEV policy differs from exact Owner/control principals')
    for key in ('browser_uid', 'publisher_uid', 'submitter_uid', 'runtime_gid'):
        if type(policy[key]) is not int or policy[key] <= 0:
            raise Blocked('typed DEV actor/group identities required')
    if policy['browser_uid'] in {policy['publisher_uid'], policy['submitter_uid']}:
        raise Blocked('separate nonroot browser identity required')
    if set(policy['compose_sha256']) != {p.name for p in (*COMPOSE, DEV / '.env')}:
        raise Blocked('exact existing DEV Compose/env preimages required')
    for value in [*policy['compose_sha256'].values(), *policy['module_sha256'].values(),
                  *policy['approved_additive_migrations'].values(), policy['node_sha256'],
                  policy['browser_sha256'], policy['browser_dependencies_sha256']]:
        if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
            raise Blocked('exact typed source/runtime preimage hashes required')
    if any(not re.fullmatch('[0-9]{4}_[a-z0-9_]+', migration)
           for migration in policy['approved_additive_migrations']):
        raise Blocked('invalid fixed additive migration approval')


def overlay(api_image, web_image, source_sha, *, old_env=None):
    if not all(re.fullmatch('sha256:[0-9a-f]{64}', image) for image in (api_image, web_image)):
        raise Blocked('actual immutable Docker image IDs required')
    api_env = {'GIT_SHA': source_sha} if old_env is None else old_env['api']
    web_env = {'GIT_SHA': source_sha} if old_env is None else old_env['web']
    return {'services': {'api': {'image': api_image, 'environment': api_env},
                         'web': {'image': web_image, 'environment': web_env},
                         'migrate': {'image': api_image, 'environment': {'GIT_SHA': source_sha}}}}


def migrations(source, applied, approvals):
    files = {p.stem: p for p in (source / 'apps/api/migrations').glob('*.sql')}
    if set(applied) - set(files):
        raise Blocked('DEV has migration history absent from accepted source')
    pending = sorted(set(files) - set(applied))
    for migration in pending:
        if approvals.get(migration) != sha(files[migration].read_bytes()):
            raise Blocked('unapproved pending migration; no schema operation')
    return pending


def extract(raw, target):
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise Blocked('unsafe Git archive member')
        archive.extractall(target, filter='data')


def inspect_container(name):
    if name not in {API, WEB, DB}:
        raise Blocked('container outside fixed DEV set')
    return json.loads(command(['/usr/bin/docker', 'inspect', name]))[0]


def check_container(info, name, port):
    if info['Name'] != '/' + name or info['Config']['Labels'].get('com.docker.compose.project') != PROJECT:
        raise Blocked('DEV container identity/project mismatch')
    ports = info['HostConfig']['PortBindings'] or {}
    expected = {} if port is None else {('3000/tcp' if name == API else '3001/tcp'): [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]}
    if ports != expected:
        raise Blocked('DEV port isolation changed')


def check_database_binding(config, database):
    environment = dict(item.split('=', 1) for item in database['Config']['Env'])
    if environment.get('POSTGRES_DB') != 'gobadminton' or environment.get('POSTGRES_USER') != 'gobadminton':
        raise Blocked('DEV database/user identity differs')
    network = config['networks']['isolated_dev_backend']['name']
    if network != 'gobadminton_dev_preview_internal' or network not in database['NetworkSettings']['Networks']:
        raise Blocked('DEV isolated database network differs')
    migrate_networks = config['services']['migrate']['networks']
    if set(migrate_networks) != {'isolated_dev_backend'}:
        raise Blocked('migration is not restricted to existing isolated DEV network')
    for service in ('api', 'migrate'):
        url = urllib.parse.urlsplit(config['services'][service]['environment']['DATABASE_URL'])
        if (url.scheme not in {'postgres', 'postgresql'} or url.hostname != 'db'
                or url.port != 5432 or url.username != 'gobadminton' or url.path != '/gobadminton'
                or url.query or url.fragment):
            raise Blocked('DEV migration/API database binding outside fixed DB alias')


def smoke(expected_sha, *, privacy=True):
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:18084/v1/meta', timeout=5) as response:
                meta = json.load(response)
            with urllib.request.urlopen('http://127.0.0.1:18084/v1/ready', timeout=5) as response:
                ready = json.load(response)
            with urllib.request.urlopen('http://127.0.0.1:18086/health', timeout=5) as response:
                if response.status != 200:
                    raise Blocked('DEV web unhealthy')
            if meta.get('gitSha') == expected_sha and meta.get('nodeEnv') == 'production' and ready.get('status') == 'ready':
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        raise Blocked('DEV health/source version timed out')
    with urllib.request.urlopen(PUBLIC + '/v1/meta', timeout=8) as response:
        if response.geturl() != PUBLIC + '/v1/meta' or json.load(response).get('gitSha') != expected_sha:
            raise Blocked('public DEV source version differs from local accepted source')
    if not privacy:
        return
    try:
        with urllib.request.urlopen('http://127.0.0.1:18084/v1/me/friendships?view=accepted', timeout=5):
            raise Blocked('guest could read private Friends relation')
    except urllib.error.HTTPError as error:
        if error.code not in {401, 403}:
            raise Blocked('unexpected guest privacy response')


BROWSER_SCRIPT = r"""
const {chromium}=require('/opt/gobadminton-clean-dev-release/browser/node_modules/playwright');
(async()=>{const browser=await chromium.launch({executablePath:'/opt/gobadminton-clean-dev-release/browser/chromium/chrome',headless:true});
try{const context=await browser.newContext();const page=await context.newPage();const errors=[];
page.on('pageerror',()=>errors.push('pageerror'));const mutations=[];
page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())&&new URL(r.url()).hostname==='dev.gobadminton.ru')mutations.push(r.method());});
await page.goto('https://dev.gobadminton.ru/players',{waitUntil:'networkidle'});
const city=page.getByRole('combobox',{name:'Город',exact:true});if(await city.count()) {const options=await city.locator('option').evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent})));const m=options.find(o=>/Москв/.test(o.text));if(m)await city.selectOption(m.value);}
const map=page.getByRole('link',{name:'Показать на карте',exact:true});if(await map.count())await map.first().click();else await page.goto('https://dev.gobadminton.ru/players/radar',{waitUntil:'networkidle'});
await page.waitForLoadState('networkidle');let realMap=false;let mapState='GATED_GUEST';
if(await page.locator('[data-map-ready="true"] canvas').count()){
await page.getByRole('button',{name:'Увеличить карту',exact:true}).click();
await page.getByRole('button',{name:'Уменьшить карту',exact:true}).click();realMap=true;mapState='READY';
}else{
await page.locator('.g2-map-fallback').getByRole('heading',{name:'Карта пока недоступна',exact:true}).waitFor({timeout:30000});
await page.getByRole('link',{name:'К списку игроков',exact:true}).waitFor();
if(await page.locator('.g2-map-marker,.g2-map-list-row,[aria-label="Игроки на карте"]').count())throw new Error('private map data visible to guest');
}
if(errors.length||mutations.length)throw new Error('guest browser error/privacy mutation');
console.log(JSON.stringify({outcome:'PASS',guest:true,realMap,mapState,mutationCount:0}));
}finally{await browser.close();}})().catch(()=>{console.log(JSON.stringify({outcome:'BLOCKED'}));process.exit(2)});
"""


def tree_hash(root):
    value = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise Blocked('browser dependency symlink refused')
        if path.is_file():
            raw = protected(path, limit=128 * 1024 * 1024)
            value.update(path.relative_to(root).as_posix().encode() + b'\0' + bytes.fromhex(sha(raw)))
    return value.hexdigest()


def browser(policy):
    import pwd
    actor = pwd.getpwnam('gobadminton-clean-dev-browser')
    if actor.pw_uid != policy['browser_uid'] or actor.pw_uid in {0, policy['submitter_uid'], policy['publisher_uid']}:
        raise Blocked('separate nonroot browser identity required')
    if (sha(protected(NODE, limit=128 * 1024 * 1024)) != policy['node_sha256']
            or sha(protected(CHROME, limit=512 * 1024 * 1024)) != policy['browser_sha256']
            or tree_hash(BROWSER / 'node_modules') != policy['browser_dependencies_sha256']):
        raise Blocked('pinned browser runtime unavailable/changed')
    result = parse(command(['/usr/sbin/runuser', '-u', actor.pw_name, '--', str(NODE), '-e', BROWSER_SCRIPT], timeout=120))
    if result not in [{'outcome': 'PASS', 'guest': True, 'realMap': True, 'mapState': 'READY', 'mutationCount': 0},
                      {'outcome': 'PASS', 'guest': True, 'realMap': False, 'mapState': 'GATED_GUEST', 'mutationCount': 0}]:
        raise Blocked('actual guest map browser smoke failed')
    return result


def release(policy, publication, planner, identity):
    main_sha = publication['candidate_sha']
    current = STORE / 'current-overlay.json'
    candidate_overlay = STORE / 'candidate-overlay.json'
    old_overlay = STORE / 'rollback-overlay.json'
    receipt_path = STORE / (main_sha + '.json')
    if receipt_path.exists():
        old = parse(protected(receipt_path))
        if old.get('status') == 'DONE':
            if old.get('main_sha') != main_sha or old.get('source_sha') != identity['candidate_sha']:
                raise Blocked('historic DEV proof does not bind this accepted source')
            if inspect_container(API)['Image'] != old['new_images']['api'] or inspect_container(WEB)['Image'] != old['new_images']['web']:
                raise Blocked('DEV changed since completed release; recovery required')
            smoke(main_sha)
            return old
        raise Blocked('interrupted/failed DEV release requires recovery; no blind retry')
    if git(['ls-remote', '--refs', REMOTE, 'refs/heads/main']).split() != [main_sha, 'refs/heads/main']:
        raise Blocked('published main is stale; no DEV mutation')
    git(['fetch', '--no-tags', REMOTE, 'refs/heads/main'])
    if git(['rev-parse', 'FETCH_HEAD']) != main_sha:
        raise Blocked('main changed during fetch')
    git(['merge-base', '--is-ancestor', identity['candidate_sha'], main_sha])
    baseline = publication['expected_remote_sha']
    if git(['merge-base', identity['candidate_sha'], baseline]) == identity['candidate_sha']:
        raise Blocked('old QA source already on publication baseline; not this merged candidate')
    expected_tree = git(['merge-tree', '--write-tree', baseline, identity['candidate_sha']]).splitlines()[0]
    if any(not (path.startswith('docs/') or path == '_automation/gobadminton-runner/backlog.json')
           for path in git(['diff', '--name-only', expected_tree, main_sha]).splitlines()):
        raise Blocked('DEV result contains product source outside exact accepted merge')
    if git(['rev-parse', main_sha + '^{tree}']) != publication.get('candidate_tree'):
        raise Blocked('actual published main tree differs')
    if git(['rev-parse', identity['candidate_sha'] + '^{tree}']) != identity['candidate_tree']:
        raise Blocked('QA candidate tree mismatch')
    for path in (*COMPOSE, DEV / '.env'):
        if sha(protected(path)) != policy['compose_sha256'][path.name]:
            raise Blocked('DEV compose/env preimage changed')
    source = STORE / ('source-' + main_sha)
    source.mkdir(mode=0o700, exist_ok=True)
    if source.is_symlink() or any(source.iterdir()):
        raise Blocked('previous incomplete source preparation; recovery required')
    archive = command(['/usr/bin/git', '--git-dir=' + str(GIT), 'archive', main_sha])
    extract(archive, source)
    api_old, web_old, db_old = (inspect_container(name) for name in (API, WEB, DB))
    for info, name, port in ((api_old, API, 18084), (web_old, WEB, 18086), (db_old, DB, None)):
        check_container(info, name, port)
    old_env = {name: dict(item.split('=', 1) for item in info['Config']['Env'])
               for name, info in (('api', api_old), ('web', web_old))}
    old_sha = old_env['api'].get('GIT_SHA', '')
    if old_env['api'].get('NODE_ENV') != 'production' or old_env['web'].get('NODE_ENV') != 'production':
        raise Blocked('DEV existing environment unexpected')
    before_cfg = json.loads(command(compose_args(current if current.exists() else None) + ['config', '--format', 'json']))
    check_database_binding(before_cfg, db_old)
    for name in ('api', 'web'):
        if any(str(v) != old_env[name].get(k) for k, v in before_cfg['services'][name]['environment'].items()):
            raise Blocked('DEV effective Compose does not match running environment')
    pending_ids = command(['/usr/bin/docker', 'exec', DB, 'psql', '-U', 'gobadminton', '-d', 'gobadminton', '-Atc',
                           'SELECT id FROM schema_migrations ORDER BY id']).decode().splitlines()
    pending = migrations(source, pending_ids, policy['approved_additive_migrations'])
    images = {}
    for app in ('api', 'web'):
        tag = 'gobadminton-clean-dev-' + app + ':' + main_sha
        command(['/usr/bin/docker', 'build', '--label', 'org.opencontainers.image.revision=' + main_sha,
                 '--label', 'org.gobadminton.environment=DEV', '-f', str(source / ('apps/' + app + '/Dockerfile')),
                 '-t', tag, str(source)], timeout=3600)
        info = json.loads(command(['/usr/bin/docker', 'image', 'inspect', tag]))[0]
        if info['Config']['Labels'].get('org.opencontainers.image.revision') != main_sha:
            raise Blocked('built image source label mismatch')
        images[app] = info['Id']
    record(candidate_overlay, overlay(images['api'], images['web'], main_sha))
    record(old_overlay, overlay(api_old['Image'], web_old['Image'], old_sha, old_env=old_env))
    backup = command(['/usr/bin/docker', 'exec', DB, 'pg_dump', '-U', 'gobadminton', '-d', 'gobadminton',
                      '--format=custom', '--no-owner', '--no-acl'])
    if not backup.startswith(b'PGDMP'):
        raise Blocked('DEV backup did not return actual custom dump')
    backup_path = STORE / (main_sha + '.dump')
    with open(backup_path, 'xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(backup); stream.flush(); os.fsync(stream.fileno())
    command(['/usr/bin/docker', 'exec', '-i', DB, 'pg_restore', '--list'], data=backup)
    receipt = {'schema': 'GBCLEAN_DEV_RELEASE_V1', 'main_sha': main_sha, 'status': 'ATTEMPTING',
               'accepted_qa_task_id': identity['qa_task_id'], 'source_sha': identity['candidate_sha'],
               'source_tree': identity['candidate_tree'], 'publisher_receipt_sha256': sha(protected(PUB, policy['publisher_uid'])),
               'backup_sha256': sha(backup), 'old_images': {'api': api_old['Image'], 'web': web_old['Image']},
               'new_images': images, 'pending_additive_migrations': pending,
               'friends_feature_gate': old_env['api'].get('FRIENDS_INTERNAL_ENABLED', '0'), 'friend_ui_verified': False}
    record(receipt_path, receipt)
    mutated = False
    try:
        if (parse(protected(PUB, policy['publisher_uid'])) != publication
                or parse(protected(ROOT / 'autopilot-receipt.json', policy['submitter_uid'])) != planner):
            raise Blocked('publication proof changed before DEV operation')
        if _POLICY_BYTES is None or protected(POLICY) != _POLICY_BYTES:
            raise Blocked('root release policy changed')
        bind(publication, planner,
             parse(protected(ROOT / 'receipts' / (identity['qa_task_id'] + '.json'), policy['submitter_uid'])),
             parse(protected(ROOT / 'receipts' / (identity['producer_task_id'] + '.json'), policy['submitter_uid'])),
             policy, importlib.import_module('test_job_contract'))
        if git(['ls-remote', '--refs', REMOTE, 'refs/heads/main']).split() != [main_sha, 'refs/heads/main']:
            raise Blocked('main advanced before DEV operation')
        for path in (*COMPOSE, DEV / '.env'):
            if sha(protected(path)) != policy['compose_sha256'][path.name]:
                raise Blocked('DEV compose/env changed before operation')
        # Same accepted image; base Compose supplies only the actual DEV database.
        mutated = True
        command(compose_args(candidate_overlay) + ['run', '--rm', '--no-deps', 'migrate'], timeout=600)
        command(compose_args(candidate_overlay) + ['up', '-d', '--no-deps', 'api', 'web'], timeout=240)
        smoke(main_sha)
        browser_result = browser(policy)
        for name, image in ((API, images['api']), (WEB, images['web'])):
            if inspect_container(name)['Image'] != image:
                raise Blocked('DEV actual image differs from approved image')
        if inspect_container(DB)['Id'] != db_old['Id'] or inspect_container(API)['Mounts'] != api_old['Mounts']:
            raise Blocked('DEV database identity/avatar volume changed')
        # Preserve persistent DB/avatars; never restore schema or erase ledger.
        record(current, overlay(images['api'], images['web'], main_sha))
        result = {**receipt, 'status': 'DONE', 'browser': browser_result,
                  'database_schema_retained': True, 'operations': list(EVENTS)}
        record(receipt_path, result)
        record(STORE / 'latest.json', result, policy['runtime_gid'])
        return result
    except Exception as error:
        result = {**receipt, 'status': 'RECOVERY_REQUIRED', 'reason': str(error) if isinstance(error, Blocked) else type(error).__name__,
                  'database_schema_retained': True, 'rollback': 'NOT_NEEDED'}
        if mutated:
            try:
                command(compose_args(old_overlay) + ['up', '-d', '--no-deps', 'api', 'web'], timeout=240)
                smoke(old_sha, privacy=False)
                if inspect_container(API)['Image'] != api_old['Image'] or inspect_container(WEB)['Image'] != web_old['Image']:
                    raise Blocked('rollback old DEV image mismatch')
                for name, container_name in (('api', API), ('web', WEB)):
                    restored = dict(item.split('=', 1) for item in inspect_container(container_name)['Config']['Env'])
                    if restored != old_env[name]:
                        raise Blocked('rollback exact old environment mismatch')
                record(current, overlay(api_old['Image'], web_old['Image'], old_sha, old_env=old_env))
                result['rollback'] = 'OLD_APP_IMAGES_AND_ENV_RESTORED'
            except Exception:
                result['rollback'] = 'FAILED_RECOVERY_REQUIRED'
        result['operations'] = list(EVENTS)
        record(receipt_path, result)
        record(STORE / 'latest.json', result, policy['runtime_gid'])
        raise Blocked('DEV release failed; exact rollback result recorded')


def main():
    global _POLICY_BYTES
    if os.geteuid() != 0 or len(sys.argv) != 1 or not sys.flags.isolated:
        raise Blocked('fixed root service python3 -I, no CLI overrides')
    _POLICY_BYTES = protected(POLICY)
    policy = parse(_POLICY_BYTES)
    code = Path(__file__).resolve().parent
    if (CODE_LINK.lstat().st_uid != 0 or not CODE_LINK.is_symlink()
            or CODE_LINK.resolve(strict=True) != code or not code.is_relative_to(CODE_LINK.parent)):
        raise Blocked('fixed root-installed immutable DEV executable required')
    if set(policy['module_sha256']) != {'clean_dev_release.py', 'clean_runtime_access.py', 'test_job_contract.py'}:
        raise Blocked('installed release/authority/QA source pins required')
    for name, pin in policy['module_sha256'].items():
        if sha(protected(code / name)) != pin:
            raise Blocked('root installed source pin mismatch')
    sys.path.insert(0, str(code))
    access = importlib.import_module('clean_runtime_access')
    authority = access.policy()
    validate_policy(policy, authority)
    STORE.mkdir(mode=0o750, exist_ok=True)
    info = STORE.lstat()
    if (STORE.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
            or info.st_gid != policy['runtime_gid'] or stat.S_IMODE(info.st_mode) not in {0o750, 0o2750}):
        raise Blocked('root private-writer release store required')
    with open(STORE / 'release.lock', 'a+') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        publication = parse(protected(PUB, policy['publisher_uid']))
        planner = parse(protected(ROOT / 'autopilot-receipt.json', policy['submitter_uid']))
        qa_id = planner.get('accepted_qa_task_id')
        if qa_id not in SUITES:
            raise Blocked('nonrelease admission is not DEV release')
        qa = parse(protected(ROOT / 'receipts' / (qa_id + '.json'), policy['submitter_uid']))
        producer = parse(protected(ROOT / 'receipts' / (qa_id.removeprefix('qa-') + '.json'), policy['submitter_uid']))
        contract = importlib.import_module('test_job_contract')
        identity = bind(publication, planner, qa, producer, policy, contract)
        if not GIT.exists():
            command(['/usr/bin/git', 'init', '--bare', str(GIT)])
            os.chmod(GIT, 0o700)
        release(policy, publication, planner, identity)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('CLEAN_DEV_RELEASE_BLOCKED:' + (str(error) if isinstance(error, Blocked) else type(error).__name__), file=sys.stderr)
        raise SystemExit(2)
