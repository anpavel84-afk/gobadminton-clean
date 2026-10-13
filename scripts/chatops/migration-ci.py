#!/usr/bin/env python3
"""Exercise fresh migrations and N-1 schema upgrade in a disposable CI container.
This checks schema mechanics, NOT semantic compatibility with all production data.
"""
import os, re, subprocess
from pathlib import Path

if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('GitHub Actions only')
container = os.environ['PG_CONTAINER']
base = os.environ.get('BASE_SHA', '')
root = Path.cwd()

def run(args, *, data=None):
    return subprocess.run(args, input=data, check=True, stdout=subprocess.PIPE).stdout

def sql(database, text):
    return run(['docker','exec','-i',container,'psql','-U','gobadminton','-d',database,
                '-v','ON_ERROR_STOP=1','-At'], data=text.encode())

def new_db(name):
    run(['docker','exec',container,'dropdb','-U','gobadminton','--if-exists','--force',name])
    run(['docker','exec',container,'createdb','-U','gobadminton',name])

def migrate(name):
    env = os.environ.copy()
    env['DATABASE_URL'] = f"postgres://gobadminton:{env['CI_DB_PASSWORD']}@127.0.0.1:{env['CI_DB_PORT']}/{name}"
    subprocess.run(['pnpm','--filter','@gobadminton/api','run','db:migrate'],env=env,check=True)

new_db('gb_fresh')
migrate('gb_fresh'); migrate('gb_fresh')  # actual migrator rerun must be idempotent
if not re.fullmatch(r'[0-9a-f]{40}', base) or base == '0'*40:
    # First DEV bootstrap can test fresh installation. PROD supplies a mandatory baseline.
    if os.environ.get('REQUIRE_BASELINE') == '1':
        raise SystemExit('PROD requires BASE_SHA from the last accepted production release')
    print('Fresh migration checks PASS; first DEV baseline not available')
    raise SystemExit(0)
paths = run(['git','ls-tree','-r','--name-only',base,'--','apps/api/migrations']).decode().splitlines()
paths = sorted(p for p in paths if re.fullmatch(r'apps/api/migrations/[0-9]{4}_[a-z0-9_]+\.sql',p))
if not paths:
    raise SystemExit('No baseline migrations')
new_db('gb_upgrade')
sql('gb_upgrade', 'CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());')
for path in paths:
    old = run(['git','show',f'{base}:{path}'])
    if not (root/path).is_file() or (root/path).read_bytes() != old:
        raise SystemExit(f'Historical migration deleted/modified: {path}')
    migration_id = Path(path).stem
    sql('gb_upgrade', "BEGIN;\n"+old.decode()+f"\nINSERT INTO schema_migrations(id) VALUES ('{migration_id}');\nCOMMIT;")
migrate('gb_upgrade'); migrate('gb_upgrade')
# Compare fresh vs upgraded schema, and verify a real dump restores on a separate CI database.
a = run(['docker','exec',container,'pg_dump','-U','gobadminton','--schema-only','--no-owner','--no-acl','gb_fresh']).decode()
b = run(['docker','exec',container,'pg_dump','-U','gobadminton','--schema-only','--no-owner','--no-acl','gb_upgrade']).decode()
def normalize(text):
    return '\n'.join(x for x in text.splitlines() if not x.startswith(('\\restrict','\\unrestrict','--')))
if normalize(a) != normalize(b):
    raise SystemExit('Fresh and upgraded schemas differ')
dump = run(['docker','exec',container,'pg_dump','-U','gobadminton','-Fc','--no-owner','--no-acl','gb_upgrade'])
new_db('gb_restore')
run(['docker','exec','-i',container,'pg_restore','-U','gobadminton','-d','gb_restore','--exit-on-error','--no-owner','--no-acl'], data=dump)
if sql('gb_upgrade','select id from schema_migrations order by id') != sql('gb_restore','select id from schema_migrations order by id'):
    raise SystemExit('Restored migration ledger differs')
print('Fresh, upgrade, idempotent migrator, immutable history, restore: PASS')
