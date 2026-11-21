# GoBadminton DEV на iPhone (iOS)

Статус: конфигурация Expo (I1), навигация назад (I2), шрифты (I3), экраны/Modal (I4), медиа HEIC (I5), вход (I6) и polish (I7) в исходниках. iOS-сборка, подпись, установка на устройство и вход на устройстве **NOT_TESTED**. Android-конфигурация (`expo.android`, `versionCode`) не менялась этими шагами.

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
4. Перед любой отправкой в App Store — **Sign in with Apple** (App Review Guideline 4.8), т.к. есть вход через сторонний сервис. Это отдельная задача и решение Owner. Нужно только перед TestFlight-external / App Store.

## Ограничения iOS

- **Вход (I6):** HTTPS-callback через `ASWebAuthenticationSession` доступен только на **iOS ≥ 17.4** (`expo-web-browser` 58, `#available(iOS 17.4)` + `preferUniversalLinks: true`). На iOS это уже передаётся из `src/auth.tsx` только в ветке `Platform.OS === 'ios'`; Android по-прежнему вызывает `openAuthSessionAsync` с двумя аргументами. На iOS 16.4–17.3 вход заранее блокируется notice/Alert (`IOS_AUTH_UNSUPPORTED`), `beginLogin` не вызывается.
- **Назад (I2):** аппаратной кнопки «Назад» нет (`BackHandler.ios.js` — заглушка), обработчики `hardwareBackPress` на iOS не вызываются. Внутренние слои (редактирование профиля, story, оверлеи карты, tutorial/info/match в player-browse) закрывает жест swipe-back через `bindIosBack` + `usePreventRemove`; экранные кнопки закрытия сохранены.
- **Экраны (I4):** Modal используют `supportedOrientations={iosModalOrientations}` (на Android `undefined`); pageSheet/formSheet — `IosSheetSafeArea`; поиск игроков — iOS `clearButtonMode` / `returnKeyType="search"`.
- **Медиа (I5):** HEIC/HEIF с iOS picker конвертируется в JPEG перед crop; на Android конвертера нет.
- **Клавиатура в venue-create formSheet (I7):** RN 0.88 `KeyboardAvoidingView` считает overlap по `layout` родителя, а не окна; для formSheet detent `0.9` iOS передаёт `keyboardVerticalOffset` ≈ 10% высоты окна только из sheet-пути. Android `behavior` остаётся `undefined`.
- Только iPhone (`supportsTablet: false`).
