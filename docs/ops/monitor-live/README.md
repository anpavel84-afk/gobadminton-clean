# OPS monitor: live-only `server.py` (reference copy)

**Reference copy, not the installer and not authority.** The OPS monitor web server is installed on the VPS at `/usr/local/lib/gb-ops-monitor/opsmon/server.py` and has no source in this repository. This record captures the live bytes so a change to it is not untracked drift. Installation facts come from the install receipts and the exact live file, not from this document.

| Item | Value |
|---|---|
| Live path | `/usr/local/lib/gb-ops-monitor/opsmon/server.py` (root:root 644) |
| Copy in repo | [server.py.live.txt](server.py.live.txt) (13324 bytes, `.txt` so it is never run or imported) |
| Previous live SHA-256 | `087aeaffc5b01fa9c3d46c7ba728a0add77702d0c96b52cdf5343f737f8f0ea0` |
| Current live SHA-256 | `6a6c094e20b404bb09a299fc735325c385a08436877778f370f3c9394cee6ca4` |
| Changed | 2026-10-24 about 16:02 America/Sao_Paulo, with PR #279 (external runs card) |

The file holds no secrets: the PIN salt/hash and cookie secret are read from a separate root-owned config file.

## The only change (one line, `KNOWN['top']` allow-list)

```diff
-            'source_mode', 'slots', 'counts_complete', 'parked_count'),
+            'source_mode', 'slots', 'counts_complete', 'parked_count', 'external_runs'),
```

The web server filters `snapshot.json` by this allow-list. Without `'external_runs'` the writer output of PR #279 (`monitor_payload/writer.py`) would be dropped before it reaches the page.

## Rollback

Backup on the VPS: `/var/backups/gb-ops-monitor-ext-20261024T190211Z/` (root-only; holds the old writer.py, app.js and server.py and `rollback.sh`).

```
sudo bash /var/backups/gb-ops-monitor-ext-20261024T190211Z/rollback.sh
```

## Verifying drift

`sudo sha256sum /usr/local/lib/gb-ops-monitor/opsmon/server.py` must equal the current SHA-256 above, or a later record must supersede it. Updating the live file means updating this copy and hash in the same change.
