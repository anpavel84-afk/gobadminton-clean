# OPS #208 · Idle ready slots

Owner-authorized implementation; base DEV0e1d79e8d9ad2797817b6b134693fb2cf8fea766.

- #207 body was invalid after ordinary report changed updated_at. Exactly one immutable Owner comment6349771538 restores the SAME task. No duplicate Issue/validator relaxation.
- Dispatcher only: queue:single, cancel-in-progress:false. Retains one current pending wake while running reconciliation finishes. Every pass reads all current Issues and their comments; task intent stays durable. Stage queue untouched. Receiver rechecks admission/dependencies/generation/reservations and writes pending before fork, so repeated/delayed dispatch is not a second author.
- Extend installed UID1002 watchdog, using existing two-minute timer and SMTP sender/backoff. No Supervisor, model polling, repair or task writes. Observe fixed root-owned read-only Actions export; mode disabled suppresses idle alerts. Only per-slot actual dispatch_pending intent proves readiness; global ready counts do not. Episode stable over repeated reconciliations; reset on busy/changed slot generation. After >180s records SLOT_IDLE_WITH_READY_TASK with slot, elapsed, run and cause. Global assigned Issue lists are not a per-slot target: alerts deliberately omit an unproven Issue link. Stale evidence records SLOT_IDLE_EVIDENCE_STALE rather than claiming current authorization. After15minutes same episode uses existing deduplicated SMTP channel; config remains untouched.
- Old SMTP config exists but enabled=false and host/from absent. Timer inactive before this change. Email delivery cannot be claimed until Owner configures existing private watchdog SMTP file. Observation can run without SMTP; no credentials copied from another project.

Installation: exact reviewed train_watchdog.py replaces only /home/agentagency-dev/.local/libexec/gobadminton-train-watchdog.py after SHA check/back-up, as agentagency-dev; no root controller or service definition edits. Existing timer enabled after testing. Rollback stop timer, restore backed-up script and prior enabled state. Workflow rollback via normal PR revert; do not cancel active stage operations.

QA and actual run/CLI receipts appended in #208. Synthetic two-task simulation is separate from real hosted proof. PROD/PLAN/VPN, #177/#181 receipts and attempts untouched.
