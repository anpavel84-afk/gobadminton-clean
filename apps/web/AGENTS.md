# GoBadminton web — дополнительный контекст

Сначала [START_HERE.md](../../START_HERE.md) и [корневой AGENTS.md](../../AGENTS.md); принятая редакция полного регламента и правила full/scoped delivery указаны там. Этот вложенный файл уточняет framework context, не расширяет права и не задаёт маршруты моделей. Для визуальных изменений действует [Style Guide first](../../docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
