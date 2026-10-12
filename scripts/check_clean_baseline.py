#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
required=['apps/api/package.json','apps/web/package.json','infra/compose/docker-compose.yml','docs/ACTIVE_BACKLOG.md','docs/CLEAN_BASELINE_PROVENANCE.json','apps/web/public/brand/pwa/apple-touch-icon.png','apps/web/public/brand/pwa/icon-192.png','apps/web/public/brand/pwa/icon-512.png']
missing=[p for p in required if not (root/p).is_file()]
images=[str(p.relative_to(root)) for p in (root/'docs').rglob('*') if p.is_file() and p.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.gif'}]
bad=[str(p.relative_to(root)) for p in [root/'_automation/gobadminton-runner/backlog.json',root/'docs/product/backlog/registry.json'] if p.exists()]
if missing or images or bad:
 print('FAIL',dict(missing=missing,qa_binary_evidence=images[:5],legacy_queue=bad));sys.exit(1)
print('PASS clean source tree; no binary docs evidence; no legacy canonical queue')
