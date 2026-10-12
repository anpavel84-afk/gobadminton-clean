# ADR-0003 — Web и native

Status: TECH_SELECTED по OD-002/OD-006. Date: 2026-10-01.

## Decision

Next.js web с SSR публичных карточек; одна React Native/Expo codebase для iOS/Android. Общие wire-contracts/SDK/design tokens, платформенные UI и navigation. Expo development builds; собственный backend, без обязательного EAS cloud.

## Alternatives

Два приложения Swift/Kotlin пока требуют дублирования команды и сценариев. Webview-only не выбран как native strategy. Универсальная UI codebase для DOM и native слишком связывает UX платформ. Web остаётся полноценным способом записаться, а не landing с принуждением установить приложение.

## Consequences

Нужно тестировать обе ОС и поддерживать старые mobile versions независимо от backend release. Expo SDK/RN/React pinned как совместимая связка после build; нельзя выбирать каждый latest отдельно. iOS 4.8/store accounts — отдельный gate, не отменяются решением о framework.

## Verification

F-01 tooling compatibility; F-06 real development builds с OAuth/deep links/accessibility; public release только после store gates. [Web](../platforms/WEB_AND_ADMIN.md), [mobile](../platforms/IOS_ANDROID.md).
