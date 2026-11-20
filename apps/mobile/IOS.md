# GoBadminton DEV на iPhone (iOS I1: конфигурация)

Статус: подготовлена только конфигурация Expo. iOS-сборка, подпись, установка на устройство и вход **NOT_TESTED**. Android-конфигурация (`expo.android`, `versionCode` 17) не менялась.

## Что настроено

- `app.json` → `expo.ios`: `bundleIdentifier` `ru.gobadminton.mobile.dev` (без изменений), `supportsTablet: false`, `associatedDomains` `applinks:dev.gobadminton.ru` и `webcredentials:dev.gobadminton.ru`, `infoPlist.ITSAppUsesNonExemptEncryption: false`. `buildNumber` не задан: повышение версии решает Owner.
- `eas.json`: профили `development` (сборка для iOS Simulator) и `preview` (`distribution: internal`), `appVersionSource: local`; без credentials и без `submit`.
- Каталог `ios/` не хранится в Git (CNG): он генерируется при сборке.

## Как собрать и запустить

Вариант 1 — Mac с Xcode (локально):

1. `pnpm install` в корне репозитория.
2. В `apps/mobile`: `npx expo run:ios` — сборка и запуск в iOS Simulator.
3. Для iPhone: подключить устройство, `npx expo run:ios --device`; в Xcode (`ios/*.xcworkspace` → Signing & Capabilities) выбрать Team. Associated Domains требует платного аккаунта.

Вариант 2 — EAS Build (облако Expo, нужен аккаунт Expo):

- Simulator: `eas build --platform ios --profile development`.
- iPhone (ad hoc): `eas build --platform ios --profile preview`; устройство регистрируется через `eas device:create`. Credentials EAS запросит интерактивно — в Git их не добавлять.

## Что должен предоставить Owner

1. Apple Developer Program (платный аккаунт) и **Team ID**.
2. Файл AASA на `https://dev.gobadminton.ru/.well-known/apple-app-site-association` (HTTPS, `application/json`, без редиректов), где `TEAMID` — Team ID:

   ```json
   {
     "applinks": {
       "details": [
         { "appIDs": ["TEAMID.ru.gobadminton.mobile.dev"], "components": [{ "/": "/auth/native/callback" }] }
       ]
     },
     "webcredentials": { "apps": ["TEAMID.ru.gobadminton.mobile.dev"] }
   }
   ```

   Android `assetlinks.json` этим не затрагивается.
3. Тестовый iPhone с **iOS ≥ 17.4** для проверки входа.
4. Перед любой отправкой в App Store — **Sign in with Apple** (App Review Guideline 4.8), т.к. есть вход через сторонний сервис. Это отдельная задача и решение Owner.

## Ограничения iOS

- **HTTPS-callback входа только на iOS ≥ 17.4.** `expo-web-browser` 58 (`ios/WebAuthSession.swift`) использует `ASWebAuthenticationSession` с `callback: .https(host:path:)` только при `#available(iOS 17.4)` **и** опции `preferUniversalLinks: true`; иначе — старый API `callbackURLScheme`, который HTTPS-redirect `https://dev.gobadminton.ru/auth/native/callback` не перехватывает. Минимальная iOS для Expo SDK 58 — 16.4, поэтому на iOS 16.4–17.3 вход не завершится.
- **Блокер следующего шага:** `src/auth.tsx` вызывает `openAuthSessionAsync(start.url, NATIVE_REDIRECT)` без `preferUniversalLinks: true` (по умолчанию `false` в `WebBrowserOptions.swift`). Для входа на iOS нужен отдельный шаг: передать опцию только при `Platform.OS === 'ios'`, чтобы Android-путь (`_openAuthSessionPolyfillAsync`) получал прежние аргументы.
- **Нет аппаратной кнопки «Назад».** В React Native 0.88 `BackHandler.ios.js` — заглушка: обработчики `hardwareBackPress` (story, profile, map, player-browse) на iOS не вызываются. Возврат — только экранными кнопками и жестом навигации.
- Только iPhone (`supportsTablet: false`).
