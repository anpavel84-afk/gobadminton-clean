#!/usr/bin/env python3
"""Task-local author docs/source verification; no app/SQL/runtime or QA acceptance.

Run from any cwd. Emits evidence JSON to stdout; does not write repository files.
The only executed model is the pinned finite serialized proposal, in memory.
"""
from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
FOLDER = Path(__file__).resolve().parents[1]
PACKAGE = FOLDER.relative_to(ROOT).as_posix() + '/'
HANDOFF = 'docs/handoffs/2026-10-09_fsg-s0-lock-map-repair-02-v001.md'
BASE = '31d09f45776d7b397a1f66c8f4c9131eb3401f04'
COMPARISON = '65fd416b30238cc9eb7e95555a17bd9cb0beb374'
FAILED = '2485b75c032a5dfed5e1faff9535619382bea28c'
QA = 'cd9d3f3ef61893692bd394f98d98a8ad64322030'
OLD = 'docs/workbench/pm/fsg-s0-contract-gate-reconciliation-20261009-v001/'
DRAFT = 'WORKING DRAFT — NOT APPROVED — NOT CANONICAL'
checks = []


def git(*args):
    return subprocess.check_output(['git', '-c', 'gc.auto=0', *args], cwd=ROOT)


def read(sha, path):
    return git('show', sha + ':' + path)


def text(path):
    return read(BASE, path).decode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def check(name, condition, **details):
    if not condition:
        raise AssertionError((name, details))
    checks.append(dict(check=name, result='PASS', **details))


def method(body, start, end):
    return body.split(start, 1)[1].split(end, 1)[0]


def ordered(body, *tokens):
    cursor = 0
    for token in tokens:
        cursor = body.index(token, cursor) + len(token)
    return True


manifest = json.loads((FOLDER / 'evidence/source-manifest.json').read_text())
check('queued_base_not_failed_candidate', manifest['base_sha'] == BASE and BASE != FAILED,
      base_sha=BASE, comparison_sha=COMPARISON, prior_candidate_sha=FAILED,
      prior_candidate_tree=git('rev-parse', FAILED+'^{tree}').decode().strip())
for entry in manifest['source_files']:
    check_hash = digest(read(BASE, entry['path']))
    assert check_hash == entry['sha256'] == digest((ROOT/entry['path']).read_bytes()), entry['path']
check('all_current_source_hashes_match_pinned_git_and_workspace', True, files=len(manifest['source_files']))
for entry in manifest['original_package_files']:
    assert digest(read(FAILED, entry['path'])) == entry['sha256'], entry['path']
check('complete_original_package_hash_custody', True, files=len(manifest['original_package_files']))
prior = json.loads(read(QA, 'docs/workbench/qa/qa-fsg-s0-contract-gate-reconciliation-20261009-v001/verdict.json'))
check('original_terminal_FAIL_retained', prior['verdict']=='FAIL' and prior['candidate_sha']==FAILED
      and prior['blocking_findings'][0]['id']=='B01', prior_qa_sha=QA, blocking_gap_count=prior['blocking_gap_count'])

REPAIR01 = '55ef0136facdf2996378e29aa56eaf962a69f1e9'
REPAIR01QA = '26d5233723b430a6dc9e42a70d2760391157f83a'
PREVIOUS_BASE = '8d7b4088072657e77c2c3827ecf84872b607ad9d'
PREVIOUS_PACKAGE = 'docs/delivery/fsg-s0-lock-map-repair-01-20261009-v001/'
for entry in manifest['repair01_package_files']:
    assert digest(read(REPAIR01, entry['path'])) == entry['sha256'], entry['path']
for entry in manifest['historical_record_files']:
    assert digest(read(entry['sha'], entry['path'])) == entry['sha256'], entry['path']
repair01verdict = json.loads(read(REPAIR01QA, 'docs/handoffs/evidence/qa-fsg-s0-lock-map-reverify-01-20261009-v001/verdict.json'))
check('repair01_complete_package_and_terminal_FAIL_B02_retained',
      repair01verdict['verdict']=='FAIL' and repair01verdict['candidate_sha']==REPAIR01
      and repair01verdict['terminal_for_candidate'] and repair01verdict['blocking_findings'][0]['id']=='B02'
      and repair01verdict['B01_disposition']=='CORRECTED_IN_NEW_CANDIDATE',
      candidate_sha=REPAIR01, candidate_tree=git('rev-parse',REPAIR01+'^{tree}').decode().strip(), qa_sha=REPAIR01QA,
      package_files=len(manifest['repair01_package_files']), historical_records=len(manifest['historical_record_files']))
check('repair02_count_and_queued_base_not_failed_ancestry', manifest['repair_attempt']==2 and manifest['max_repairs']==5
      and BASE not in [FAILED,REPAIR01] and all(subprocess.run(['git','merge-base','--is-ancestor',failed,BASE],cwd=ROOT).returncode==1 for failed in [FAILED,REPAIR01]),
      repair_attempt=2, max_repairs=5, planning_source_sha=manifest['planning_source_sha'])
identity = text('apps/api/src/auth/identity.service.ts')
link = method(identity, '  async linkIdentityToUser(', '  async unlinkProvider(')
unlink = method(identity, '  async unlinkProvider(', '  /** Test helper:')
resolve = method(identity, '  async resolveOrCreateUser(', '  async findByExternalIdentity(')
lookup = method(identity, '  async findByExternalIdentity(', '  async getUser(')
identity_map=(FOLDER/'LEGACY_LOCK_MAP.md').read_text().split('## Identity link / unlink / resolve')[1].split('[Legacy Radar start292')[0]
# Extract SQL literals in direct methods: comments/parameter userId cannot substitute for users SQL.
sql = lambda body: re.findall(r'`([^`]+)`',body)
check('B02_direct_link_unlink_external_identity_locks_not_user_first',
      ordered(link, 'this.pool.connect()', 'await client.query("BEGIN")', 'SELECT user_id FROM external_identities',
              'WHERE issuer_namespace = $1 AND subject = $2', 'FOR UPDATE', 'const owner =', 'if (owner)',
              'SELECT id FROM external_identities', 'WHERE user_id = $1 AND provider_key = $2', 'LIMIT 1', 'FOR UPDATE', 'INSERT INTO external_identities')
      and ordered(unlink, 'this.pool.connect()', 'await client.query("BEGIN")', 'SELECT id, provider_key',
                  'FROM external_identities', 'WHERE user_id = $1', 'FOR UPDATE', 'const providers = new Set',
                  'if (!providers.has(providerKey))', 'if (providers.size <= 1)', 'DELETE FROM external_identities', 'await client.query("COMMIT")')
      and all(not re.search(r'\b(?:FROM|JOIN|UPDATE|INTO)\s+users\b',statement,re.I) for body in [link,unlink] for statement in sql(body))
      and all(token not in body for body in [link,unlink] for token in ['actorFence','mutations.','pairs.','FOR NO KEY UPDATE'])
      and all('client: PoolClient' not in body for body in [link,unlink])
      and 'ORDER BY' not in unlink,
      link_explicit='own BEGIN → external issuer/subject FOR UPDATE → conditional user/provider external FOR UPDATE → INSERT',
      unlink_explicit='own BEGIN → existing external identities FOR UPDATE → provider checks → DELETE',
      user_ActorFence='no prior explicit users row lock or ActorFence in direct methods', SQL_runtime='NOT_RUN')
same_owner = link.split('if (owner === userId)',1)[1].split('const sameProvider',1)[0]
insert_error = link.split('} catch (_error)',1)[1].split('await client.query("COMMIT")',1)[0]
check('B02_link_early_returns_and_rollback_pool_lookup_reachable',
      ordered(same_owner,'UPDATE external_identities','await client.query("COMMIT")','return "already_linked"',
              'await client.query("ROLLBACK")','"IDENTITY_COLLISION"')
      and 'INSERT INTO external_identities' not in same_owner and 'SELECT id FROM external_identities' not in same_owner
      and ordered(insert_error, 'await client.query("ROLLBACK")', 'await this.findByExternalIdentity', 'return "already_linked"', '"IDENTITY_COLLISION"')
      and 'this.pool.query' in lookup and 'FOR UPDATE' not in lookup,
      missing_rows='no nonexistent tuple lock inferred', implicit_insert='only reached on new-link path', fallback='plain pool SELECT after ROLLBACK')
check('B02_resolve_distinct_join_and_insert_branches',
      ordered(resolve, 'await client.query("BEGIN")', 'FROM external_identities ei', 'JOIN users u', 'FOR UPDATE OF ei, u',
              'if (existing.rowCount', 'UPDATE external_identities', 'UPDATE users SET display_name', 'await client.query("COMMIT")',
              'INSERT INTO users', 'INSERT INTO external_identities', 'await client.query("ROLLBACK")', 'await this.findByExternalIdentity')
      and 'FOR UPDATE OF ei, u' not in link+unlink,
      join='one explicit matched identity/user locking statement; no OF-list physical row-order proof', lookup='separate plain fallback')
DDL=text('apps/api/migrations/0002_identity_session.sql')
check('B02_implicit_FK_unique_write_effects_separate_from_explicit_lock_order',
      'user_id uuid NOT NULL REFERENCES users (id)' in DDL and 'UNIQUE (issuer_namespace, subject)' in DDL
      and 'UNIQUE (user_id, provider_key)' not in DDL
      and all(token in identity_map for token in ['Explicit vs implicit','FK','unique','existing-owner return','LIMIT 1','physical order']),
      limitation='schema/source distinction only; no observed DB lock graph or provider uniqueness guarantee')
auth=text('apps/api/src/auth/auth.service.ts')
auth_tx=text('apps/api/src/auth/auth-transaction.service.ts')
consumer=text('apps/api/src/auth/consumer-auth.service.ts')
sessions=text('apps/api/src/auth/session.service.ts')
callback=auth.split('transaction = await this.transactions.consume',1)[1].split('  private async completeLinkCallback(',1)[0]
linkcaller=method(auth,'  private async completeLinkCallback(', '  private async requireSession(')
unlinkcaller=method(auth,'  async unlinkProvider(', '  async listSessions(')
consume=method(auth_tx,'  async consume(', '\n}')
sessionlookup=method(sessions,'  async lookupActiveSession(', '  async readCsrfToken(')
check('B02_caller_boundaries_do_not_inherit_users_first_transaction',
      ordered(callback,'if (transaction.purpose === "link")','this.completeLinkCallback','this.identities.resolveOrCreateUser', 'this.sessions.createConsumerSession')
      and ordered(consume,'await client.query("BEGIN")','FROM auth_transactions','FOR UPDATE','UPDATE auth_transactions',
                  'await client.query("COMMIT")','return {','client.release()')
      and ordered(linkcaller,'this.sessions.lookupActiveSession','transaction.boundSessionId','transaction.boundUserId',
                  'adapter.exchangeCode','adapter.fetchVerifiedIdentity','this.identities.linkIdentityToUser(transaction.boundUserId, identity)')
      and ordered(unlinkcaller,'this.consumerAuth.requireCookieMutation','this.identities.unlinkProvider(consumer.userId, providerKey)')
      and all(token not in linkcaller+unlinkcaller for token in ['pool.connect','client.query','mutations.','actorFence'])
      and 'FOR UPDATE' not in sessionlookup and 'this.pool.query' in sessionlookup
      and 'FOR UPDATE' not in consumer and 'actorFence' not in consumer,
      consume='own committed/released auth_transactions lock before Identity call',
      auth='plain lookups/checks and IDs passed, no shared PoolClient; no MutationRunner retry claimed')
check('B02_all_summaries_match_method_specific_source',
      all(token in identity_map for token in ['No explicit users row lock precedes','Returns before user/provider query or insertion',
                  'No explicit users SELECT/UPDATE or ActorFence','FOR UPDATE OF ei, u','Caller boundaries / reachability','rollback'])
      and 'serialize on user before identity work' not in (FOLDER/'LEGACY_LOCK_MAP.md').read_text()
      and 'direct Identity link/unlink own transactions lock external identities first' in (FOLDER/'SOURCE_MATRIX.md').read_text()
      and 'Direct Identity link/unlink are separate own transactions' in (FOLDER/'S1_CONTRACT_AND_CONCURRENCY.md').read_text(),
      disposition='CORRECTED_IN_NEW_CANDIDATE_PENDING_INDEPENDENT_QA', runtime_defect='NOT_ASSERTED')

inv = text('apps/api/src/invitations/invitations.service.ts')
create = method(inv, '  async create(', '  async accept(').split('execute: async (client)', 1)[1]
accept = method(inv, '  async accept(', '  async decline(').split('execute: async (client)', 1)[1]
check('B01_create_profile_before_Pair_and_Accept_Pair_before_profile',
      ordered(create, 'await this.lockGame', 'await this.gameAuthority.assertCanManage', 'await this.lockAccounts',
              'await this.assertSocialEligible', 'await this.pairs.lockOrCreate',
              'await this.assertInviteeParticipationAllowsInvite', "status = 'pending'", 'await this.proofHook.assertOptionalProof',
              'INSERT INTO game_invitations', 'await this.proofHook.assertFinalProof')
      and ordered(accept, 'await this.lockGameThenInvitation', 'await this.lockAccounts',
                  'await this.pairs.lockOrCreate', 'await this.assertSocialEligible', 'await this.participations.confirmInviteeFromInvitation'),
      existing_create='actor/session → idempotency → Game/manager → accounts SHARE → profiles SHARE → Pair → Participation → pending invitation',
      existing_accept='actor/session → idempotency → Game → invitation → accounts SHARE → Pair → profiles SHARE → Participation confirmation',
      limitation='Static call/SQL order only; no runtime deadlock or deadlock-freedom claim')
accounts = method(inv, '  private async lockAccounts(', '  private async assertSocialEligible(')
profiles = method(inv, '  private async assertSocialEligible(', '  private async assertNoBilateralBlock(')
pair = text('apps/api/src/safety/pair-fence.service.ts')
check('invitation_account_profile_and_Pair_helper_SQL',
      ordered(accounts, '[...new Set(userIds)].sort()', 'for (const id of sorted)', 'FROM users WHERE id = $1 FOR SHARE')
      and 'WHERE user_id IN ($1, $2)\n       FOR SHARE' in profiles and 'ORDER BY' not in profiles
      and ordered(pair, 'this.sortedPair(userA, userB)', 'INSERT INTO social_pairs', 'ON CONFLICT', 'FROM social_pairs', 'FOR UPDATE'),
      profile_row_acquisition_order='NOT_PROVEN: one unordered IN query', pair_identity='sorted endpoints of one pair')
runner = text('apps/api/src/common/mutation-runner.service.ts')
fence = text('apps/api/src/common/actor-fence.service.ts')
idem = text('apps/api/src/common/idempotency.service.ts')
check('actual_actor_session_idempotency_prelude_and_replay',
      ordered(runner, 'await client.query("BEGIN")', 'SET LOCAL lock_timeout', 'SET LOCAL statement_timeout',
              'await this.actorFence.assertActiveConsumerInTransaction', 'await this.idempotency.reserveOrReplay',
              'await input.authorizeReplay', 'await input.execute', 'await this.idempotency.complete')
      and 'FOR NO KEY UPDATE OF u' in fence and 'FOR UPDATE OF s' not in fence
      and ordered(idem, 'INSERT INTO idempotency_records', 'ON CONFLICT (actor_id, operation, key_hash) DO NOTHING', 'this.readCompletedReceipt'),
      session_lock='no session row-lock in ActorFence SQL', replay='separate callback, not execute order')
proof = text('apps/api/src/radar/radar-proof.service.ts')
geographic = text('apps/api/src/radar/geographic-proof.ts')
unified = text('apps/api/src/radar/unified-proof.ts')
check('conditional_invitation_geographic_unified_fence_and_late_presence_SQL',
      'if (!this.proofHook.usesGeographicFence(normalized.discoveryProof)) await this.lockAccounts' in create
      and 'usesGeographicFence' not in accept and 'discoveryProof' not in accept
      and 'proof.startsWith("u1.")' in proof and 'proof !== undefined' in proof and 'proof !== null' in proof
      and 'await this.pairs.lockOrCreate(client, p.context.viewerId, p.targetId)' in proof
      and 'await this.pairs.lockOrCreate(client, geo.viewerUserId, geo.targetUserId)' in proof
      and 'ORDER BY user_id FOR SHARE' in geographic and 'ORDER BY user_id FOR SHARE' in unified
      and 'redeemUnifiedProof(client, p, true)' in proof and 'redeemGeographicProof(client, payload, true)' in proof,
      skipped='accounts SHARE only, not actor or create profiles', SQL='Pair reentry → presence SHARE; final held recheck')
dm = text('apps/api/src/messaging/messaging.service.ts')
dmc = method(dm, '  async createRequest(', '  async accept(').split('execute: async (client)', 1)[1]
dma = method(dm, '  async accept(', '  async decline(').split('execute: async (client)', 1)[1]
dmd = method(dm, '  async decline(', '  async listConversations(').split('execute: async (client)', 1)[1]
dms = method(dm, '  async sendMessage(', '  async markRead(').split('execute: async (client)', 1)[1]
contact = method(dm, '  private async assertContactEligible(', '  private async assertCurrentSocialEligible(')
check('DM_create_decisions_send_are_distinct_existing_orders',
      ordered(dmc, 'await this.lockAccounts', 'await this.assertContactEligible', 'await this.assertDmGameContext',
              'await this.pairs.lockOrCreate', 'FOR UPDATE', 'await this.proofHook.assertOptionalProof')
      and all(ordered(body, 'await this.lockConversation', 'await this.lockAccounts', 'await this.pairs.lockOrCreate') for body in [dma,dmd,dms])
      and all('assertCurrentSocialEligible' not in body and 'assertContactEligible' not in body for body in [dma,dmd])
      and ordered(dms, 'await this.pairs.lockOrCreate', 'await this.assertCurrentSocialEligible')
      and 'WHERE user_id = $1`' in contact and 'WHERE user_id = $1 FOR SHARE' in contact,
      decisions='conversation → accounts → Pair, no profile-SHARE helper', accepted_send='profiles SHARE after Pair')
safety = text('apps/api/src/safety/safety.service.ts')
block = method(safety, '  async block(', '  async unblock(').split('execute: async (client)',1)[1]
profile = text('apps/api/src/profiles/profiles.service.ts')
session = text('apps/api/src/auth/session.service.ts')
radar = text('apps/api/src/radar/radar.service.ts')
publishing = text('apps/api/src/radar/unified-publishing.service.ts')
check('block_profile_session_Radar_graph_peer_helpers',
      ordered(block, 'await this.pairs.lockOrCreate', 'INSERT INTO user_blocks', 'UPDATE conversations')
      and ordered(profile.split('execute: async (client)',1)[1], 'FROM player_social_profiles', 'FOR UPDATE', 'await withdrawGeographicConsent')
      and ordered(method(session, '  async revokeSession(', '  async listActiveSessionsForUser('), 'FOR NO KEY UPDATE OF u', 'UPDATE app_sessions', 'DELETE FROM radar_presences')
      and ordered(method(radar, '  async start(', '  async renew(').split('execute: async (client)',1)[1], 'await this.assertRadarEligible', 'await this.lockPresence')
      and 'FROM player_social_profiles\n       WHERE user_id = $1\n       FOR UPDATE' in radar
      and ordered(publishing.split('execute: async (client)',1)[1], 'await this.requireProfile', 'FROM radar_presences WHERE user_id=$1 FOR UPDATE')
      and 'FROM player_social_profiles WHERE user_id=$1 FOR UPDATE' in publishing,
      limitation='mapped existing path variants; not a universal Radar lock order')

normalize = lambda body: body.replace(COMPARISON, BASE).replace('qa-fsg-s0-contract-gate-reconciliation-20261009-v001', 'qa-fsg-s0-lock-map-reverify-02-20261009-v001')
old_s1 = normalize(read(FAILED, OLD+'S1_CONTRACT_AND_CONCURRENCY.md').decode())
new_s1 = (FOLDER/'S1_CONTRACT_AND_CONCURRENCY.md').read_text()
legacy_marker = '### Legacy compatibility that the draft order does not solve'
check('all_S1_schema_wire_lifecycle_and_proposed_lock_sections_unchanged',
      old_s1.split(legacy_marker)[0] == new_s1.split(legacy_marker)[0])
marker = '## Tested semantics vs mandatory future PostgreSQL evidence'
def remove_joint(body):
    return '\n'.join(line for line in body.split(marker)[1].splitlines() if not line.startswith('| Joint legacy liveness'))
check('retained_serialized_semantics_and_all_other_future_cases_unchanged', remove_joint(old_s1)==remove_joint(new_s1))
old_gates = normalize(read(FAILED, OLD+'GATES_AND_NEXT_INTAKE.md').decode())
check('entire_non_B01_S2_S3_gates_DD_intake_unchanged_except_base_and_QA_recipient',
      old_gates==(FOLDER/'GATES_AND_NEXT_INTAKE.md').read_text(),
      preserved=['OQ-01 YES CLOSED','G-05','G-06','G-08','G-03','G-07','S2 one recipient/nonseat','S3 distinct actionable Game/formal precedence/game:null/UNKNOWN','DD-FR-01..03/Style Guide'])
old_matrix=normalize(read(FAILED,OLD+'SOURCE_MATRIX.md').decode())
check('immutable_authority_matrix_unchanged', old_matrix.split('## Immutable authority inputs')[1].split('PR head refs')[0]
      ==(FOLDER/'SOURCE_MATRIX.md').read_text().split('## Immutable authority inputs')[1].split('Historical producer/QA')[0])
check('corrected_summaries_explicitly_separate_existing_create_Accept_from_proposals',
      'sorted users FOR SHARE → profiles FOR SHARE → Pair' in new_s1
      and 'sorted users FOR SHARE → Pair → profiles FOR SHARE' in new_s1
      and 'no new SQL locking prescription' in new_s1
      and 'Current non-geographic invitation create: actor → Game/manager → sorted users FOR SHARE → Pair → profile SHARE' not in new_s1)
future=(FOLDER/'FUTURE_JOINT_SQL_CRITERIA.md').read_text()
check('future_joint_criteria_complete_and_NOT_RUN',
      all(token in future for token in ['J01','J02','J03','J04','J05','J06','J07','J08','J09','J10',
          'two independent','barriers','both commit orders','lock_timeout','statement_timeout','pg_locks','SQLSTATE','exhaustion','NOT_RUN',
          'SHARE vs SHARE is compatible','impossible downstream barrier']),
      executed_SQL='NOT_RUN', implementation='NOT_ADMITTED')

normal01=lambda body: body.replace(PREVIOUS_BASE,BASE).replace('qa-fsg-s0-lock-map-reverify-01-20261009-v001','qa-fsg-s0-lock-map-reverify-02-20261009-v001')
previous_s1=normal01(read(REPAIR01,PREVIOUS_PACKAGE+'S1_CONTRACT_AND_CONCURRENCY.md').decode())
check('repair01_B01_legacy_paragraphs_retained_except_B02_addition',
      all(paragraph in new_s1 for paragraph in previous_s1.split(legacy_marker)[1].split(marker)[0].strip().split('\n\n')),
      retained='source create profile-before-Pair; Accept inverse; separate DM decisions/send and liveness caveat')
check('repair01_S1_and_gates_unchanged_except_B02_legacy_and_joint_row_metadata',
      previous_s1.split(legacy_marker)[0]==new_s1.split(legacy_marker)[0]
      and remove_joint(previous_s1)==remove_joint(new_s1)
      and normal01(read(REPAIR01,PREVIOUS_PACKAGE+'GATES_AND_NEXT_INTAKE.md').decode())==(FOLDER/'GATES_AND_NEXT_INTAKE.md').read_text())
previous_map=normal01(read(REPAIR01,PREVIOUS_PACKAGE+'LEGACY_LOCK_MAP.md').decode())
current_map=(FOLDER/'LEGACY_LOCK_MAP.md').read_text()
start=previous_map.index('Identity [provider resolution33]'); end=previous_map.index(' No complete production account disable/purge API',start)
previous_map=previous_map[:start]+'Identity methods have distinct transaction/lock paths, traced separately below.'+previous_map[end:]
previous_map=previous_map.replace('# Existing legacy lock map — B01 source correction', '# Existing legacy lock map — B01 retained, B02 Identity correction')
previous_map=previous_map.replace('freshly fetched main `7e24b4a40d7594293df3c72d0792f702dbb89be8`','freshly fetched main `89b0dc040ecf7dac9d70cb5e77ff39e0a7f98941`')
without_identity=current_map.split('## Identity link / unlink / resolve')[0]+'[Legacy Radar start292'+current_map.split('[Legacy Radar start292',1)[1]
check('entire_repair01_non_Identity_legacy_map_retained', previous_map==without_identity)
previous_matrix=normal01(read(REPAIR01,PREVIOUS_PACKAGE+'SOURCE_MATRIX.md').decode())
current_matrix=(FOLDER/'SOURCE_MATRIX.md').read_text()
rows=lambda body:[line for line in body.split('## Present source vs proposed target')[1].split('## Active overlap observation')[0].splitlines() if not line.startswith('| Account lifecycle')]
check('all_non_Identity_source_matrix_propositions_retained', rows(previous_matrix)==rows(current_matrix))

previous_future=normal01(read(REPAIR01,PREVIOUS_PACKAGE+'FUTURE_JOINT_SQL_CRITERIA.md').decode())
previous_future=previous_future.replace('| J08 account/status/session and0023 coexistence | Actual admitted account/status SQL writers, owner user fence,',
        '| J08 account/status/session and0023 coexistence | Actual admitted account/status SQL writers (enumerate their own actual fences), session-revoke user fence,')
without_j11='\n'.join(line for line in future.splitlines() if not line.startswith('| J11'))+'\n'
check('repair01_J01_J10_preserved_except_B02_writer_fence_qualifier',previous_future==without_j11)
check('future_Identity_J11_is_NOT_RUN_reachable_method_boundaries_and_implicit_waits',
      all(token in future for token in ['J11','existing same/other owner','LIMIT 1','FOR UPDATE OF ei, u',
          'commits/releases','implicit','MutationRunner retries','NOT_RUN']),SQL='NOT_RUN',new_locking_prescription='NONE')

prior_checks=json.loads(read(QA,'docs/workbench/qa/qa-fsg-s0-contract-gate-reconciliation-20261009-v001/checks.json'))
authority=next(c['sources'] for c in prior_checks['checks'] if c['check']=='pinned_authority_custody')
for e in authority:
    assert digest(read(e['sha'],e['path']))==e['sha256'], e
check('Owner_Architect_Product_PM_exact_authority_hashes', True, sources=authority)
DD='f48187ddafbb2e769acd38f94b708ecb7b375d9a'
dd_files=git('ls-tree','-r','--name-only',DD,'docs/workbench/design/friends-social-games-integration-design-spec-v001').decode().splitlines()
for path in dd_files:
    assert read(DD,path)==read(BASE,path)==(ROOT/path).read_bytes(),path
check('seven_frozen_DD_files_byte_identical', len(dd_files)==7, files=dd_files, freeze_sha=DD)
freshness=json.loads((FOLDER/'evidence/publication-freshness.json').read_text())
material=['apps','packages','docs/workbench/design','docs/manifest/OWNER_DECISIONS.md','docs/decisions']
check('pinned_planning_and_fresh_main_material_sources_unchanged_no_overlapping_writer',
      not git('diff','--name-only',BASE,manifest['planning_source_sha'],'--',*material).strip()
      and not git('diff','--name-only',BASE,freshness['fresh_remote_main_sha'],'--',*material).strip()
      and not freshness['material_source_authority_frozen_drift']
      and freshness['active_lock_observation']==[{'id':'fsg-s0-lock-map-repair-02-20261009-v001','locks':['docs:fsg-s0']}],
      fresh_main_sha=freshness['fresh_remote_main_sha'],observed_at=freshness['checked_at'],limitation='point-in-time source observation; no S1 lock reservation or runtime proof')

links=set(); local=0
for p in list(FOLDER.rglob('*.md'))+[ROOT/HANDOFF]:
    body=p.read_text();assert DRAFT in body,p
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)',body):
        if target.startswith('https://github.com/anpavel84-afk/gobadminton/blob/'):
            match=re.fullmatch(r'https://github.com/anpavel84-afk/gobadminton/blob/([0-9a-f]{40})/(.+?)(?:#L(\d+))?',target)
            assert match,target
            blob=read(match[1],match[2]);assert not match[3] or 0<int(match[3])<=len(blob.splitlines()),target
            links.add(target)
        elif '://' not in target:
            assert (p.parent/target.split('#')[0]).resolve().exists(),(p,target)
            local+=1
check('all_Markdown_draft_status_local_links_immutable_targets_and_line_bounds', True, immutable_links=len(links), local_links=local)
paths=json.loads((ROOT/'packages/contracts/openapi.json').read_text())['paths']
check('unchanged_contract_migration_inventory', len(paths)==78 and not [p for p in paths if any(t in p for t in ['friend','recommend','game-attention','game-cards'])]
      and sorted(p.name for p in (ROOT/'apps/api/migrations').glob('*.sql'))[-1]=='0023_user_game_preferences.sql', OpenAPI_paths=len(paths))
record=json.loads((FOLDER/'evidence/serialized-model-rerun.json').read_text())
source=read('4388a5a8c28963143cd39d1eb1778b9f2974d5c1','docs/workbench/architecture/friends-social-games-v001/evidence/state_model.py')
model=subprocess.run(['python3','-'],input=source,capture_output=True,cwd=ROOT)
check('pinned_serialized_model_rerun_reproducible_only_65_proposal_assertions', model.returncode==record['exit_code']==0
      and digest(source)==record['model_source_sha256'] and json.loads(model.stdout)==record['result']
      and record['result']['checks']==len(record['result']['passed'])==65,
      source_sha256=digest(source), limitation=record['result']['scope'])
changed=set(git('diff','--name-only',BASE).decode().splitlines())|set(git('ls-files','--others','--exclude-standard').decode().splitlines())
check('exact_task_Git_write_allowlist', all(p.startswith(PACKAGE) or p==HANDOFF for p in changed), changed_files=sorted(changed))
whitespace=subprocess.run(['git','diff','--check',BASE],cwd=ROOT,capture_output=True,text=True)
check('git_diff_check', whitespace.returncode==0, output=whitespace.stdout+whitespace.stderr)
# Also covers as-yet untracked package files before staging.
for p in changed:
    lines=(ROOT/p).read_text().splitlines()
    assert all(line.rstrip()==line for line in lines),p
check('untracked_or_staged_docs_trailing_whitespace', True)
print(json.dumps(dict(status=DRAFT, task_id='fsg-s0-lock-map-repair-02-20261009-v001', base_sha=BASE,
    checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), author_docs_verification='checks_completed', checks=checks,
    independent_qa='NOT_RUN', application_SQL_browser_CI_runtime='NOT_RUN'),ensure_ascii=False,indent=2))
