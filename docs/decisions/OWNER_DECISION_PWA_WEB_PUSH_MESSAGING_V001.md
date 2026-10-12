# OWNER DECISION — PWA Web Push for messaging v001

Status: OWNER_CONFIRMED — BINDING PRODUCT DIRECTION
Date: 2026-10-07
Scope: GoBadminton Web/PWA notifications

## Goal

GoBadminton must support system push notifications for the existing web/PWA product, especially the iPhone app installed through Add to Home Screen.

Critical first use case:

A user receives a new GoBadminton message while the PWA is not in the foreground. The device shows a normal system notification. Tapping it opens the relevant authorized conversation.

## P0 events

First delivery:
- new Direct Message;
- incoming Direct Message request / first message;
- new Game Chat message for currently eligible members other than the author.

Later extension may cover Game invitations, participation changes, Game cancellation/change and security/system events.

## iPhone/PWA platform rule

Use standards-based Web Push for Home Screen web apps.

Current Apple documentation states that Home Screen web apps on iOS/iPadOS 16.4+ can use Push API, Notifications API and Service Workers. Permission must be requested from a direct user gesture. Apple Developer Program membership is not required for standards-based Web Push.

Official references:
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

Re-check platform requirements before implementation admission.

## Permission UX

Do not request notification permission on first page load.

Expose an explicit action such as "Включить уведомления о сообщениях". Trigger the browser/OS prompt from that user action.

The product must distinguish:
- GoBadminton subscription/preference state;
- browser/OS permission state.

## Payload privacy

For P0, do not include the full private message body in push payload by default.

Use minimal copy such as:
- "Новое сообщение";
- "Новое сообщение в чате игры".

Do not include credentials, phone/email, or unnecessary private profile data.

## Delivery semantics

Push is only a delivery channel.

- PostgreSQL message state remains authoritative.
- Push failure never rolls back a committed message.
- Delivery may be at-least-once; duplicates must be harmless.
- Sender does not receive their own push.
- Muted conversation should suppress message push.
- Current authorization/preferences should be rechecked before external delivery where practical.
- Stale push should be suppressed when the message is already read before delivery where practical.

## Subscription/account semantics

A Web Push subscription is an installation/channel resource, not identity.

Support:
- multiple subscriptions per user;
- account switch/logout without leaking prior account notifications;
- explicit unsubscribe;
- pruning invalid/expired endpoints;
- no raw endpoint/key logging.

## Notification click

Tap should focus/open GoBadminton and navigate to the relevant conversation using ordinary authenticated routing. Never place authentication credentials in notification URLs.

If the resource is no longer available, fall back safely to Messages.

## Narrow service worker

The current PWA was intentionally delivered without service-worker/push/background-sync scope.

This decision authorizes planning for the minimal Service Worker needed for Web Push.

It does not authorize offline caching, background sync or unrelated background behavior.

## Server-side direction

Architect should evaluate this lean flow:

1. Message commit and durable push-delivery job/reference happen atomically.
2. Existing GoBadminton worker processes the job.
3. Worker rechecks recipient eligibility/preferences.
4. Worker sends standards-based Web Push using server-side VAPID credentials.
5. Delivery result supports bounded retry and invalid-subscription cleanup.

Prefer existing PostgreSQL/pg-boss worker architecture. Do not add Redis/Kafka/a new microservice solely for push.

## Future native compatibility

Web/PWA is first. Keep event semantics independent of channel so later native APNs/Android push can be added through another adapter without rewriting messaging.

## Required next step

Architect must perform a bounded integration reconciliation covering:
- current PWA no-service-worker baseline;
- subscription API/model;
- message/Game Chat event emission;
- pg-boss worker delivery;
- retries/dedupe;
- permission/settings UX contract;
- logout/account switch;
- payload privacy;
- click/deep-link behavior;
- VAPID credential handling;
- deployment/egress;
- independent QA including a physical iPhone Home Screen test.

This decision does not itself authorize implementation, deployment or live notification activation.
