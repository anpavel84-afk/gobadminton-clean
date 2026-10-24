"""Read-only Git content identity. Unknown paths are executable/authoritative by default."""
import ast
import json
import posixpath
import hashlib
import tomllib
import io
import os
from pathlib import PurePosixPath
import re
import subprocess
from core import digest, loads, need


def git(repo, *args, data=None, env=None):
    environment = dict(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8',
        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0',
        GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0')
    if env: environment.update(env)
    p = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', '--no-pager', *args], cwd=repo, env=environment,
        input=data, capture_output=True, timeout=120)
    need(p.returncode == 0, 'Git object/operation unavailable: ' + args[0])
    return p.stdout


def exact(repo, sha):
    need(isinstance(sha, str) and re.fullmatch('[a-f0-9]{40}', sha), 'exact commit required')
    need(git(repo, 'rev-parse', '--verify', sha + '^{commit}').strip().decode() == sha,
         'commit identity mismatch')
    return sha


def tree(repo, sha, *, sources=None):
    exact(repo, sha)
    rows = []
    for row in git(repo, 'ls-tree', '-rz', '--full-tree', sha).split(b'\0'):
        if not row: continue
        meta, rawpath = row.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        path = rawpath.decode('utf-8', errors='strict')
        need(kind == 'blob' and mode in ('100644','100755','120000'), 'unsupported tree entry')
        rows.append((path, mode, oid))
    # One immutable Git batch instead of a subprocess for every file. Missing
    # objects still fail closed; no cache can conceal missing or replaced blobs.
    objects = list(dict.fromkeys(row[2] for row in rows))
    if not objects: return {}
    stream = io.BytesIO(git(repo, 'cat-file', '--batch', data=('\n'.join(objects)+'\n').encode()))
    blobs = {}
    for oid in objects:
        header = stream.readline().split()
        need(len(header)==3 and header[0].decode()==oid and header[1]==b'blob', 'missing Git blob')
        size = int(header[2]); need(size >= 0, 'invalid blob size')
        raw = stream.read(size)
        need(len(raw)==size and stream.read(1)==b'\n', 'truncated Git batch')
        blobs[oid] = dict(sha256=hashlib.sha256(raw).hexdigest(), bytes=size)
        if sources is not None:
            sources[oid] = raw if size <= 262144 and b'\0' not in raw else None
    need(not stream.read(), 'unexpected Git batch output')
    return {path:dict(mode=mode, oid=oid, **blobs[oid]) for path,mode,oid in rows}


def path_kind(path):
    p = PurePosixPath(path)
    # No arbitrary docs exemption. Rules, contracts, schemas, security and AGENTS
    # remain authoritative even when someone puts them under a harmless directory.
    lowered = path.lower()
    if any(word in lowered for word in ('agents', 'rule', 'adr', 'architecture', 'contract',
                                        'schema', 'security', 'policy', 'acceptance', 'dependency')):
        return 'runtime'
    if len(p.parts) == 3 and p.parts[:2] == ('docs', 'handoffs') and p.suffix == '.md':
        return 'doc'
    if (p.parent.as_posix() == 'scripts/chatops/tests' and p.name.startswith('test_')
            and p.suffix == '.py'):
        return 'test'
    if (p.parent.as_posix() in ('apps/api/test/unit','apps/web/test','apps/admin/test',
                               'packages/contracts/test') and p.name.endswith(('.test.ts','.test.tsx'))):
        return 'test'
    return 'runtime'



def classify(before, after, *, sources_before=None, sources_after=None):
    changes = []
    for path in sorted(before.keys() | after.keys()):
        old, new = before.get(path), after.get(path)
        if old == new: continue
        kind = path_kind(path)
        # Removal, executable bits, symlinks and type changes never bypass review.
        if new is None or new['mode'] != '100644' or old and old['mode'] != '100644':
            kind = 'runtime'
        changes.append(dict(path=path, kind=kind, before=old, after=new))
    exempt = [x['path'] for x in changes if x['kind'] in ('test', 'doc')]
    reason = next(('runtime/policy/mode/removal change: ' + x['path'] for x in changes
                   if x['kind'] == 'runtime'), None)
    if exempt and reason is None:
        for endpoint, files, sources in (('original', before, sources_before),
                                         ('candidate', after, sources_after)):
            reason = independence(files, sources, set(exempt))
            if reason:
                reason = endpoint + ': ' + reason
                break
    tests = [x['path'] for x in changes if x['kind'] == 'test']
    if reason is not None:
        # A path-only caller cannot mistake exemption eligibility for proven identity.
        for change in changes:
            if change['kind'] in ('test', 'doc'): change['kind'] = 'runtime'
    return dict(changes=changes, reusable=reason is None, reason=reason, tests=tests)


def independence(files, sources, changed):
    """Bounded endpoint proof, using immutable blobs only; never imports candidate code.

    Test paths are candidates for exemption, not dependency roots. All other code
    and build inputs are consumers. Incomplete extraction declines reuse locally.
    """
    from native_antigravity import deps, ReviewError, JS
    if sources is None: return 'dependency blobs unavailable; addressed QA required'
    code = ('.py', *JS)
    configs = {p for p in files if p.endswith(('.json', '.yaml', '.yml', '.toml', '.sh'))
               or PurePosixPath(p).name in ('Makefile', 'Dockerfile')}
    executable = {p for p in files if p.endswith(code)}
    def testing(p):
        return bool(set(PurePosixPath(p).parts) & {'test', 'tests', '__tests__'}) or bool(
            re.search(r'(?:^|/)(?:vitest|jest)\.config\.', p))
    roots = {p for p in executable if not testing(p)} | configs
    queue, seen, size = sorted(roots), set(), 0
    aliases, packages = {}, {}
    def source(p):
        raw = sources.get(files[p]['oid'])
        if raw is None: raise ValueError('binary/oversized dependency: ' + p)
        return raw.decode('utf-8')
    try:
        for p in sorted(changed & files.keys()):
            text = source(p)
            if p.endswith('.py'): ast.parse(text)
        for p in sorted(configs):
            if PurePosixPath(p).name not in ('tsconfig.json', 'package.json'): continue
            data = json.loads(source(p))
            folder = posixpath.dirname(p)
            if p.endswith('tsconfig.json'):
                opt = data.get('compilerOptions', {})
                for key, targets in opt.get('paths', {}).items():
                    if not isinstance(targets, list) or not all(isinstance(t, str) for t in targets):
                        return 'unsupported build alias: ' + p
                    aliases.setdefault(folder, {})[key] = [posixpath.normpath(posixpath.join(
                        folder, opt.get('baseUrl', '.'), t)) for t in targets]
                if data.get('extends'): return 'unresolved tsconfig extends: ' + p
            elif data.get('name'):
                packages[data['name']] = (folder, data)
        def js_paths(target):
            return [target] + ([target[:-3] + e for e in ('.ts', '.tsx')] if target.endswith('.js') else []) + [
                target + e for e in (*JS, '/index.ts', '/index.tsx', '/index.js')]
        while queue:
            p = queue.pop()
            if p in seen: continue
            seen.add(p)
            if p in changed: return 'runtime consumer reaches changed exempt path: ' + p
            size += files[p]['bytes']
            if len(seen) > 12000 or size > 16 * 1024 * 1024:
                return 'dependency proof bound exceeded'
            if files[p]['mode'] not in ('100644', '100755'):
                return 'nonregular dependency consumer: ' + p
            text = source(p)
            targets = set()
            if p.endswith(code):
                groups = deps(p, text)  # existing extractor; no native collect/model path
                for alternatives, required in groups:
                    matches = set(alternatives) & files.keys()
                    if p.endswith('.py'):
                        # Support repository-local search paths without assuming cwd/sys.path.
                        matches |= {q for q in files for a in alternatives
                                    if q.endswith('/' + a)}
                    if required and not matches and (alternatives or p.endswith('.py')):
                        return 'unresolved local import/alias: ' + p
                    targets |= matches
                if p.endswith('.py'):
                    parsed = ast.parse(text)
                    # Include package initialization/re-exports for every resolved module.
                    for q in list(targets):
                        folder = posixpath.dirname(q)
                        while folder:
                            init = folder + '/__init__.py'
                            if init in files: targets.add(init)
                            folder = posixpath.dirname(folder)
                    names = {'__import__', 'import_module', 'spec_from_file_location',
                             'SourceFileLoader', 'exec', 'eval', 'open', 'read_text', 'read_bytes', 'glob', 'rglob',
                             'globals', 'locals', 'vars', '__getattribute__'}
                    # Local Python process loaders can execute changed tests even
                    # when no static import references them. Resolve explicit
                    # stdlib module and from-import aliases before scanning calls.
                    # Conservative uncertainty triggers addressed QA, never reuse.
                    subprocess_exec = {
                        'run', 'Popen', 'call', 'check_call', 'check_output',
                        'getoutput', 'getstatusoutput'
                    }
                    os_exec = {
                        'system', 'popen', 'execl', 'execle', 'execlp', 'execlpe',
                        'execv', 'execve', 'execvp', 'execvpe', 'posix_spawn',
                        'posix_spawnp', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe',
                        'spawnv', 'spawnve', 'spawnvp', 'spawnvpe', 'startfile'
                    }
                    subprocess_aliases, os_aliases = set(), set()
                    for node in ast.walk(parsed):
                        if isinstance(node, ast.Import):
                            for alias in node.names:
                                if alias.name == 'subprocess':
                                    subprocess_aliases.add(alias.asname or alias.name)
                                elif alias.name == 'os':
                                    os_aliases.add(alias.asname or alias.name)
                        elif isinstance(node, ast.ImportFrom):
                            if node.module in ('subprocess', 'os'):
                                # A wildcard can bind any executable loader
                                # without an explicit alias to inspect.
                                if any(alias.name == '*' for alias in node.names):
                                    return 'wildcard process loader requires addressed QA: ' + p
                                operations = subprocess_exec if node.module == 'subprocess' else os_exec
                                names.update(alias.asname or alias.name for alias in node.names
                                             if alias.name in operations)
                    # A module object can escape by assignment, tuple unpacking,
                    # function argument or return, after which its process-launch
                    # methods are invisible under the original import alias.
                    # Any such escape makes test-only QA reuse unprovable.
                    process_modules = subprocess_aliases | os_aliases
                    parent_of = {id(child): parent for parent in ast.walk(parsed)
                                 for child in ast.iter_child_nodes(parent)}
                    for node in ast.walk(parsed):
                        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) \
                                and node.id in process_modules:
                            parent = parent_of.get(id(node))
                            if not (isinstance(parent, ast.Attribute)
                                    and parent.value is node):
                                return 'escaped process module loader requires addressed QA: ' + p
                            if parent.attr in ('__dict__', '__class__', '__getattribute__'):
                                return 'dynamic process module introspection requires addressed QA: ' + p
                    for n in ast.walk(parsed):
                        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name):
                            if (n.value.id in subprocess_aliases and n.attr in subprocess_exec
                                    or n.value.id in os_aliases and n.attr in os_exec):
                                return 'dynamic process loader requires addressed QA: ' + p
                        if isinstance(n, ast.ImportFrom):
                            if n.module in ('importlib', 'importlib.util', 'importlib.machinery', 'builtins', 'io', 'runpy'):
                                names.update(a.asname or a.name for a in n.names)
                        # Reading/binding a loader object is already ambiguous:
                        # aliases need not call the original attribute/name directly.
                        loader_refs = names | {'run_path', 'run_module', 'system', 'popen',
                            'Popen', 'execv', 'execve', 'spawnv', 'load_module', '__builtins__'}
                        if isinstance(n, ast.Attribute) and n.attr in loader_refs:
                            return 'dynamic loader alias requires addressed QA: ' + p
                        if isinstance(n, ast.Name) and n.id in loader_refs:
                            return 'dynamic loader alias requires addressed QA: ' + p
                        if isinstance(n, ast.Call):
                            f = n.func
                            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ''
                            if name in names or name in ('getattr', 'setattr', 'globals', 'locals', 'vars'):
                                # Literal and computed loaders both need addressed QA. This
                                # includes aliased imports; static deps alone cannot prove absence.
                                return 'dynamic module/file loader requires addressed QA: ' + p
                    if re.search(r'\b(?:sys\.path|__path__|meta_path|path_hooks)\b', text):
                        return 'mutable Python import search path: ' + p
                else:
                    if re.search(r'\b(?:require|import)\s*\(\s*[^\s\'"]', text) or re.search(
                            r'\b(?:createRequire|eval|readFile|readFileSync|glob|require\.resolve)\b|(?:=|:)\s*require\b|\b(?:import|require)\s*/[/*]', text):
                        return 'dynamic JS loader requires addressed QA: ' + p
                    if any(q in text or PurePosixPath(q).name in text for q in changed):
                        return 'JS source references changed test/file: ' + p
                    if re.search(r'\b(?:entryPoints|entry|include|alias|loader)\s*:', text):
                        return 'unsupported JS build inputs: ' + p
                    if any(not re.match(r'''\s*\(\s*['"]''', text[m.end():])
                           for m in re.finditer(r'\brequire\b', text)):
                        return 'unsupported/aliased JS require: ' + p
                    specs = re.findall(r"(?:from|import|require)\s*\(?\s*['\"]([^'\"]+)['\"]", text)
                    for spec in specs:
                        if spec.startswith('.'): continue  # covered by deps()
                        resolved = [spec] if any(q in files for q in js_paths(spec)) else []
                        for folder, mapping in aliases.items():
                            if folder and not p.startswith(folder + '/'): continue
                            for key, values in mapping.items():
                                pattern = '^' + re.escape(key).replace(r'\*', '(.*)') + '$'
                                match = re.fullmatch(pattern, spec)
                                if match:
                                    resolved += [v.replace('*', match[1] if match.groups() else '') for v in values]
                        for name, (folder, data) in packages.items():
                            if spec == name or spec.startswith(name + '/'):
                                export = data.get('exports', data.get('main'))
                                if isinstance(export, dict):
                                    export = export.get('.' if spec == name else './' + spec[len(name)+1:])
                                if not isinstance(export, str): return 'unresolved package exports: ' + p
                                resolved.append(posixpath.normpath(posixpath.join(folder, export)))
                        if resolved:
                            matches = {q for t in resolved for q in js_paths(t) if q in files}
                            if not matches: return 'unresolved build alias: ' + p
                            targets |= matches
                        elif spec.startswith(('@/', '~/', '#')):
                            return 'unresolved build alias: ' + p
            else:
                # Config is data. Test discovery and noEmit checking are not runtime
                # consumption; all other build references/globs need an exclusion proof.
                config = json.loads(text) if p.endswith('.json') else None
                if p.endswith('pyproject.toml'):
                    data = tomllib.loads(text)
                    tool = data.get('tool', {})
                    tool.pop('pytest', None)  # test discovery does not create a runtime consumer
                    text = json.dumps(data)
                if PurePosixPath(p).name == 'package.json':
                    script = config.get('scripts', {})
                    def checking(k, v):
                        return (isinstance(v, str) and not re.search(r'[;&|`$]', v) and (
                            re.fullmatch(r'test(?::[\w-]+)?', k) and re.match(
                                r'^(?:python3? -m pytest|pytest|vitest|jest|node --test)\b', v)
                            or k == 'typecheck' and re.match(r'^tsc\b', v) and '--noEmit' in v
                            or k == 'lint' and re.match(r'^eslint\b', v)))
                    text = json.dumps({k:v for k,v in script.items()
                        if not checking(k, v)}) + json.dumps({k:v for k,v in config.items()
                        if k not in ('scripts', 'devDependencies', 'dependencies')})
                elif PurePosixPath(p).name.startswith('tsconfig') and config and config.get('compilerOptions', {}).get('noEmit') is True:
                    continue
                elif re.search(r'(?:vitest|jest|pytest)\.config|(?:^|/)pytest\.ini$', p):
                    continue
                def discovery(match):
                    return match[0] if re.search(r'[;&|`$]', match[0]) else ''
                text = re.sub(r'(?m)^\s*(?:run:\s*)?(?:python3? -m (?:pytest|unittest)|pytest|vitest|jest)\b[^\n]*',
                              discovery, text)
                if re.search(r'(?:^|[/\\])(?:tests?|__tests__)(?:[/\\]|[\s\"\']|$)', text):
                    return 'build/runtime reference to test tree: ' + p
                for q in changed:
                    if q in text or PurePosixPath(q).name in text:
                        return 'build/file reference consumes changed path: ' + p + ' -> ' + q
                if re.search(r'[*?$`]|\b(?:glob|entryPoints|entry|include|exports|extends|loader|alias|eval|exec)\b', text):
                    # Do not guess semantics of arbitrary build tools/configuration.
                    return 'unresolved build inputs/globs: ' + p
            for q in targets:
                if q in changed: return 'runtime consumer: ' + p + ' -> ' + q
                if files[q]['mode'] != '100644': return 'nonregular dependency: ' + q
                if q not in seen: queue.append(q)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, SyntaxError, RecursionError, ReviewError):
        return 'dependency/config parse uncertainty at ' + p
    return None


def equivalence(repo, original, candidate):
    sources_before, sources_after = {}, {}
    before = tree(repo, original, sources=sources_before)
    if original == candidate:
        after, sources_after = before, sources_before
    else:
        after = tree(repo, candidate, sources=sources_after)
    result = classify(before, after, sources_before=sources_before, sources_after=sources_after)
    result.update(original=original, candidate=candidate, before=digest(before), after=digest(after))
    return result
