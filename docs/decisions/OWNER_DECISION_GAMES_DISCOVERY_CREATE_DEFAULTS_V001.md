# Owner decision — Games discovery and Create Game defaults v001

Date: 2026-10-06
Status: **OWNER_CONFIRMED / ACTIVE**

## 1. Discovery: date is optional

On the Games discovery page, the selected city remains the only default search dimension.

The **When / date filter is unset by default**. With no date selected:
- show all future published public games in the selected city;
- never show already-started/past games;
- order strictly by `startsAt ASC` (and stable id tie-break from the API);
- pagination continues the same all-future feed.

When the user explicitly selects a date:
- filter to that selected city calendar day;
- still exclude games whose start is already in the past;
- keep the activity filter combinable with the date filter.

The UI must provide a clear way to return from a selected date to **all upcoming games**.

## 2. Game title is optional for the user

The Create Game title field is optional.

If the user supplies a non-empty custom title:
- trim it;
- preserve it;
- keep the existing maximum length.

If title is omitted or blank, the server owns the default:
- regular game → **«Игра»**;
- trainer-led game → **«Игра с тренером»**.

Do not derive the default from venue name.

The database may continue storing a non-null title; **no migration is required**. Existing game titles are untouched.

The preview must show the same effective title that the server will store.

## 3. Default capacity

Create Game default capacity is **4**.

The user can still change it within the existing allowed range. Backend capacity invariants remain unchanged.

## Delivery

Treat this as the immediate Owner feedback slice after the accepted A + #64 preview and before unrelated product work.

Sequence:
Implementation → bounded independent QA → PM merge → immediate preview deploy → lean smoke.

Routing:
- Implementation: Codex GPT-6.1 Sol / medium;
- QA: Codex GPT-6 Luna / medium;
- deploy + postdeploy smoke: Codex GPT-6 Luna / low.
