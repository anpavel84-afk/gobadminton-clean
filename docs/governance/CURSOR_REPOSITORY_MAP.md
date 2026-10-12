# Cursor Repository & Source Map

## Product repository

`anpavel84-afk/gobadminton` owns code, contracts, canonical docs, prompts, handoffs and runtime records.

## Agent launcher repository

`anpavel84-afk/agents` owns role bootstrap/authority launchers. Do not put GoBadminton application code there.

## Primary development execution host

Germany VPS `vmi3510488`:
- repo: `/srv/gobadminton-dev/repo`;
- worktrees: `/srv/gobadminton-dev/worktrees`;
- runner: `/srv/gobadminton-dev/runner`;
- Git remote host alias: `github-gobadminton`;
- repository-specific GitHub write access: enabled.

The live backend tree `/srv/gobadminton` is separate deployment material and is not the development checkout.

## PLAN recovery workspace

`C:\Users\PLAN\Documents\gobadminton`

PLAN is paused recovery/reference only. Do not use it as a concurrent writer after Germany VPS cutover.

## Runtime aliases

### Moscow web
`gobadminton-moscow`
→ root@194.87.214.217  
→ device `ruvds-68jzd`

### Germany backend
`gobadminton-backend`
→ root@169.58.183.182  
→ device `vmi3510488`

Both aliases use project-dedicated ED25519 identities and strict host-key checking.

## Runtime ownership

Moscow: web/nginx only.  
Germany: API/DB/worker only.

Do not infer authority from SSH access. Exact assignment controls writes.
