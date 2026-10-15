"""Explicit real model preflight; synthetic files only, never consumes Issues."""
import importlib.util
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('a', Path(__file__).resolve().parents[1] / 'autonomous_issues.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

# Match the worker's approved /srv subtree, outside masked /tmp and HOME config ancestry.
fixture_parent = Path('/srv/gobadminton-clean/worktrees/.autonomy-probes')
fixture_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fixture_parent.chmod(0o700)
with tempfile.TemporaryDirectory(prefix='gb-guard-probe-', dir=fixture_parent) as tmp:
    root = Path(tmp)
    work, job, common, state = [root / name for name in ('work', 'job', 'git', 'state')]
    for path in (work, job, common, state):
        path.mkdir(mode=0o700)
    secret = state / 'synthetic-key'
    secret.write_text('SYNTHETIC-FORBIDDEN-ONLY')
    (work / 'secret-link').symlink_to(secret)
    (work / '.git').write_text('synthetic git metadata')
    before = (work / '.git').read_bytes()
    # /proc/self/root alias must not bypass the underlying deny rule.
    alias = '/proc/self/root' + str(secret)
    # Permission-negative checks run independently below; the model only exercises allowed tools.
    command = f'true && printf allowed > {work}/proof'
    prompt = ('Synthetic sandbox preflight only. Execute exactly this shell command using the shell tool. '
              'Do not inspect any other files or credentials. Return only PROBE_PASS if it exits zero; '
              'otherwise return PROBE_FAIL. Command: ' + command)
    argv = a.model_command(a.NATIVE_CODEX, work, job, common, state)
    argv += ['-o', str(job / 'result'), '-']
    original = a.subprocess.Popen
    def capture(*args, **kwargs):
        args_for_command = args[0]
        process = original(*args, **kwargs)
        communicate = process.communicate
        def diagnostic(*args, **kwargs):
            out, err = communicate(*args, **kwargs)
            for line in err.decode(errors='replace').splitlines():
                if ('sandbox' in args_for_command or any(term in line.lower() for term in ('error:', 'error loading', 'invalid', 'unexpected argument', 'permission denied', 'operation not permitted'))):
                    print('CLI_DIAGNOSTIC:', line[:600])
            return out, err
        process.communicate = diagnostic
        return process
    a.subprocess.Popen = capture
    preflight_ok = False
    try:
        try:
            for qa in (False, True):
                profile = a.permission_config(work, job, common, state, qa=qa)
                check = (f'true && ! cat {secret} && ! cat {work}/secret-link && ! cat {alias} '
                         f'&& ! touch {common}/forbidden-write && ! sh -c "echo x >> {work}/.git" ')
                check += f'&& ! touch {work}/qa-write' if qa else f'&& printf allowed > {work}/preflight-proof'
                sandbox = [a.NATIVE_CODEX, '--no-daemon', 'sandbox', '-C', str(work), '-P', 'gb-task',
                           '-c', profile, '/bin/sh', '-c', check]
                a.run(sandbox, work, a.clean_env() | {'TMPDIR': str(job)}, timeout=30)
                a.require((work/'.git').read_bytes() == before and not (common/'forbidden-write').exists()
                          and not (work/'qa-write').exists(), 'permission preflight failed')
            a.require((work/'preflight-proof').read_text() == 'allowed', 'preflight allowed write absent')
            preflight_ok = True
            print('NATIVE_SANDBOX_PASS: true; direct/symlink/proc secret denial; git read-only; author write; QA read-only')
        except Exception as error:
            print('NATIVE_PREFLIGHT_BLOCKED:', str(error))
        a.run(argv, work, a.clean_env() | {'TMPDIR': str(job)}, timeout=180, input=prompt)
        a.require((job / 'result').read_text().strip() == 'PROBE_PASS', 'model did not report PASS')
        a.require((work / 'proof').read_text() == 'allowed', 'allowed proof missing')
        a.require((work / '.git').read_bytes() == before and not (common / 'forbidden-write').exists(),
                  'git permissions failed')
        a.require(preflight_ok, 'native author/QA preflight missing')
        print('PROBE_PASS: model report + independently verified allowed proof and unchanged git metadata')
    except Exception as error:
        print('COMMISSIONING_BLOCKED:', type(error).__name__, str(error))
        print('INDEPENDENT_PROOF_PRESENT:', (work/'proof').is_file())
        print('INDEPENDENT_GIT_UNCHANGED:', (work/'.git').read_bytes() == before
              and not (common/'forbidden-write').exists())
        raise SystemExit(1)
