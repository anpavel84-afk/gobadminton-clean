# Mobile boundary — iOS + Android

Одна React Native/Expo codebase; два платформенных binary. В этой папке пока нет Expo project, credentials или store artifacts.

Владеет native navigation/UI, secure application sessions, app links и platform permissions. Contracts/SDK/tokens общие, UI не копируется из DOM. Provider secrets, DB/ORM и server-only domain запрещены в bundle.

Expo SDK/RN/React выбираются совместно, dev builds проверяют реальные login redirects. Public iOS требует отдельного решения O-04; MAX/Сбер/Apple не включаются сами собой. [Mobile spec](../../docs/platforms/IOS_ANDROID.md), [Auth](../../docs/integrations/AUTH.md).
