#!/usr/bin/env python3
"""Regression: private planner_note must not appear in public status projection.

Q-MON-PN-01 — load_owner_instruction_summary() feeds /api/status and
monitor-push. Synthetic private marker must be absent from published JSON.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

MARKER = "PRIVATE_PLANNER_NOTE_MARKER_QMONPN01_DO_NOT_PUBLISH"

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import dashboard  # noqa: E402


class PublicPlannerNoteRedactionTest(unittest.TestCase):
    def test_synthetic_private_note_absent_from_public_projection(self) -> None:
        with tempfile.TemporaryDirectory(prefix="owner-inbox-redact-") as tmp:
            inbox = Path(tmp)
            payload = {
                "id": "20261006T000000Z-synthetic-qmonpn01",
                "status": "NEW",
                "created_at": "2026-10-06T00:00:00+00:00",
                "updated_at": "2026-10-06T00:00:00+00:00",
                "planner_note": (
                    f"Owner-private instruction body containing {MARKER} "
                    "must never reach public status JSON."
                ),
                "text": "safe public-ish title only",
            }
            (inbox / f"{payload['id']}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            previous = dashboard.OWNER_INBOX_DIR
            dashboard.OWNER_INBOX_DIR = inbox
            try:
                summary = dashboard.load_owner_instruction_summary()
            finally:
                dashboard.OWNER_INBOX_DIR = previous

            published = json.dumps(
                {"owner_instructions": summary},
                ensure_ascii=False,
            )
            self.assertNotIn(MARKER, published)
            self.assertNotIn('"planner_note"', published)

            latest = summary.get("latest") or []
            self.assertEqual(len(latest), 1)
            item = latest[0]
            self.assertEqual(item.get("id"), payload["id"])
            self.assertEqual(item.get("status"), "NEW")
            self.assertNotIn("planner_note", item)
            self.assertIn("NEW", summary.get("counts") or {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
