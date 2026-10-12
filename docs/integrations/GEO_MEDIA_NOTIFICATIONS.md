# География, медиа и сообщения

Статус: **TECH_SELECTED**; визуальная карта и внешние доставки — отдельные delivery slices.

## Geo

Venue содержит coordinates, country/city, timezone, normalized address и provenance. API принимает именованные latitude/longitude и radiusMeters; ограничивает bounding area, временное окно и limit. Radius filter — `ST_DWithin` для geography с GiST index, не ручное расстояние по текстовым адресам [S06].

Каталог и карта используют **один** Discovery use case, одинаковые filters/visibility. Карта — представление результатов, не источник domain IDs. Display coordinates стилизованной схемы не подменяют реальные coordinates. Геолокация пользователя необязательна; доступен выбор города/района. Политика не включает background location.

На первом этапе достаточно списка и разрешённой ссылки во внешнюю навигацию. Следующая карта может быть схематической/стилизованной; design/provider не выбран. Условия tile/geocoding storage и attribution обязательны для проверки; нельзя скрейпить карты или хранить provider data без прав. Court booking и расписания клубов — другая интеграция, не следствие наличия точки на карте.

## Media

Сначала только действительно необходимые avatar/venue/organizer изображения. Backend выдаёт ограниченную upload policy по actor, размеру, типу и ключу. Upload попадает в quarantine; server проверяет magic bytes, размер/декодирование, удаляет EXIF, перекодирует разрешённый raster и отмечает ready. SVG/HTML uploads не принимаются по умолчанию. Private bucket, signed reads или явная public derivative.

Внешний social avatar URL не скачивается произвольным fetch: allowlist провайдера, защита private IP/redirect/SSRF, timeout и size limits. Не хранить аватар без цели/разрешения пользователя. На profile deletion удаляются originals и derivatives. URL/ключи хранения не становятся доменными идентификаторами.

## Notifications

Business status сохраняется до отправки. Внутреннее Notification связано с событием и получателем; DeliveryAttempt — канал/попытка. Worker использует retries с backoff, finite retry budget и dead-letter/manual recovery. Дедупликация по event/recipient/channel; повтор может дойти до внешнего поставщика, поэтому пользовательские сообщения также должны быть duplicate-tolerant.

Для initial pilot нет обещания, что игрок получил push: inbox и актуальная карточка остаются источником статуса; O-06 определяет операционный канал. Для mobile release push adapters должны учитывать consent, device logout/reassignment, token expiry и disable notifications. Payload — короткий event/reference, без телефона/списка участников; детали загружаются после авторизации.

Будущие channels: APNs/FCM, при необходимости иные Android transports, email и Telegram только после принятия сценария. Expo — tooling choice, не обязательство использовать Expo Push Service или стороннюю аналитику. Provider outage не откатывает участие; отменённая игра не должна породить устаревшее приглашение из старой очереди.
