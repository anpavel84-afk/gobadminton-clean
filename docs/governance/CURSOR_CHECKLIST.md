# Cursor Preflight / Closeout Checklist

## Before write

- [ ] AGENTS.md read
- [ ] CURSOR.md read
- [ ] project-local .cursor/rules loaded
- [ ] exact assignment identified
- [ ] exact base SHA identified
- [ ] canonical docs loaded
- [ ] branch/HEAD verified
- [ ] dirty state understood
- [ ] no overlapping writer conflict
- [ ] target/runtime boundaries understood
- [ ] secrets handled outside Git

## Before PR

- [ ] scope did not expand
- [ ] relevant docs/contracts updated
- [ ] real checks executed
- [ ] no fake PASS
- [ ] no unrelated files/services touched
- [ ] no secret committed
- [ ] exact changed resources known

## Before deploy

- [ ] exact candidate SHA
- [ ] CI status known
- [ ] target preflight captured
- [ ] rollback path known
- [ ] shared-host collision check complete
- [ ] public exposure explicitly permitted

## Before handoff

- [ ] PR/commit permalinks
- [ ] test/CI evidence
- [ ] runtime smoke if applicable
- [ ] limitations/not checked
- [ ] rollback
- [ ] next bounded action
- [ ] GitHub handoff committed
