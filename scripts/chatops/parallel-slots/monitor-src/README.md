# Slot telemetry

These are readable copies of the payload embedded in `../slot-live-telemetry.sh`.
The installer is the reviewed deployment unit; do not overwrite files manually.

Each concrete systemd timer runs every 30 seconds as its own executor UID.
The exporter reads only that UID's checkpoint and fixed systemd process metadata,
then atomically publishes an allowlisted `telemetry.json` in that slot's public
outbox. It does not modify the checkpoint or the executor unit, run a model,
contact GitHub, or read authentication material.

The monitor treats observations older than 90 seconds as stale. Observation age,
checkpoint modification age, process state and task phase are separate fields.
QA PASS and CI PASS are tied to the current head SHA. A requested model is not
presented as independently confirmed model identity. Runtime V1 publication is
retained for compatibility; it is not a heartbeat.

Run regressions from any checkout:
```sh
python3 -B scripts/chatops/parallel-slots/commission-tests/test_telemetry.py
python3 -B scripts/chatops/parallel-slots/commission-tests/test_telemetry_rollback.py
node scripts/chatops/parallel-slots/commission-tests/test-telemetry-ui.cjs scripts/chatops/parallel-slots/monitor-src/app.js
```

Source hashes, independent review results and actual deployment observations are
recorded in `docs/operations/chatops/PARALLEL_SLOTS_COMMISSION_20261021.md`.
