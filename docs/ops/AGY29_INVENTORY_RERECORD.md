# AGY #29 inventory re-record (stale rules entry)

Status: OPS source change. No live apply is claimed by this document.

## Root cause

The C5 installer (#294, receipt `STATE/agy29-nopolicy294-scoped-install.json`, sha256 `04106cc1…a704`) installed the EOM 1.4 `accepted-engineering-rules.md` (`017441de…2269`) but left that one `STATE/backup.json` `after` entry at EOM 1.3 (`38c34012…1c1c`). Later installers had to carry a narrow pinned exception for this pair. `agy29_inventory_rerecord.py` removes the cause with one verified write instead of copying the exception forward.

## What it writes

Only `STATE/backup.json`, only one 64-hex value: the `after` entry of `/usr/local/lib/gb-actions-train/accepted-engineering-rules.md` goes from `38c34012…` to `017441de…`. The edit is a byte-exact replacement inside the existing file (same length, same layout, same mode/owner); the parsed result is checked to differ from the original in that single entry only, and `manifest` stays `0f16f0d6…`. Its own receipt (`STATE/agy29-inventory-rerecord.json`) and backup (`STATE/agy29-inventory-rerecord-backup/inventory`) are the only other files. No lib, policy, rules, marker, budget, slot, ledger or admission file is touched; no model call is made.

## Gate (all must hold, otherwise refuse)

- root only; installer is root-owned, mode 0700, single link, in a root-owned non-writable directory (same `script_sane` gate as the package-finish installer);
- installed import paths and the pinned trusted lib set are root-owned and byte-identical to their pins;
- the bundle is a clean, plain, root-owned checkout of an exact two-parent dev merge commit with the CLEAN origin, scrubbed Git environment, and the running installer is byte-identical to `scripts/chatops/ops/agy29_inventory_rerecord.py` in that commit;
- slots idle, no model processes, units inactive and masked, no integration in flight, active policy at controller `41e12be2…` / workflow pin;
- `backup.json` has the old manifest, exactly 32 entries, the rules entry equal to `38c34012…`, the stale value appearing exactly once in the bytes and `017441de…` not at all;
- the C5 receipt bytes equal the pin; schema, `phase=active`, controller, manifest, `rules_sha256=017441de…` and `backups.rules.sha256=38c34012…` match; the C5 backup `rules` file is `38c34012…`; the live rules file is `017441de…`;
- every other inventory entry equals the live file hash (so other installers' targets may be pre- or post-install, but never silently drifted).

The observation (full protected state with streamed hashes, receipt provenance, inventory sha) is digested at `dry`; `apply` refuses unless the digest is unchanged, and re-checks it again after the backup phase.

## Verbs

```sh
/usr/bin/python3 -B /root/agy29_inventory_rerecord_<SHA8>.py dry --bundle /root/agy29-rerecord-bundle-<SHA8> --commit <MERGE_SHA>
/usr/bin/python3 -B /root/agy29_inventory_rerecord_<SHA8>.py apply --bundle /root/agy29-rerecord-bundle-<SHA8> --commit <MERGE_SHA> --observation-sha256 <DRY_OBSERVATION_SHA256>
/usr/bin/python3 -B /root/agy29_inventory_rerecord_<SHA8>.py verify --bundle /root/agy29-rerecord-bundle-<SHA8> --commit <MERGE_SHA>
/usr/bin/python3 -B /root/agy29_inventory_rerecord_<SHA8>.py rollback --bundle /root/agy29-rerecord-bundle-<SHA8> --commit <MERGE_SHA>
```

`dry` and `verify` are read-only. `apply` holds the controller lock, backs up the inventory, writes atomically (O_EXCL/NOFOLLOW temp, fchown/fchmod, fsync, rename, readback), switches the receipt to `active` and runs `verify`; any failure restores the original bytes automatically. `apply` on an already active, verified transaction is a no-op. `rollback` restores the exact original bytes and mode and refuses if `backup.json` holds neither the original nor the re-recorded bytes.

## Interaction with the package-finish installer

The package-finish installer accepts both forms of the rules entry. Either order works, but its own `dry` must be re-run after a re-record, because the re-record adds files under `STATE` that are part of its protected observation. Do not roll back the package-finish install while the re-record is active: roll the re-record back first (the package-finish rollback expects the inventory bytes it recorded).
