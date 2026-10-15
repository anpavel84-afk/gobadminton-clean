# Issue #15 — published canonical reference / attempt 4

From: source author → PM / independent QA4. Date: 2026-10-15. Status: READY_FOR_REVIEW, no visual approval or QA PASS.
Base: `98753ee2e4fd9e71dde58a41bb47307702c221af`, branch `automation/issue-15`, initially clean.
Assignment: #15 bounded source repair under PM recovery input / [PR40 authorization reference](https://github.com/anpavel84-afk/gobadminton-clean/pull/40#issuecomment-6189785049). Source-only; no commit/push, runtime or privacy-flag effects.

## Authority and provenance

Owner decision: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
Primary published URLs (Owner-published GoBadminton Figma Make):
- https://nougat-wise-76949869.figma.site/#guide
- https://nougat-wise-76949869.figma.site/#construction-kit
- https://nougat-wise-76949869.figma.site/#mygames

PM supplied read-only capture observed 2026-10-15T10:24:58.281990+00:00 on Germany. Author read README, manifest, full guide text and relevant rendered DOM; visually inspected created-games.png, guide-gamecard.png and kit-identity.png. These are published reference captures, not application screenshots. No Figma tool or PLAN access was used. Frozen PLAN tree digest was NOT reverified. Linked operations guide is absent from checkout. PNGs remain ignored external evidence; retained hashes below identify supplied files, not a claim of fresh network capture.

## STYLE_GUIDE_PARITY and bounded gaps

FACT: published My Games has status/body/action siblings. Body order: type, title, date/time, venue, level/capacity. No organizer slot. Guide §06 agrees. Preserve this hierarchy, columns, responsive rules, status and actions.

STYLE_GUIDE_GAP #15-personal-creator: Owner #15 requires a creator photo where the published personal card has no identity. Compose kit §08 Avatar/IdentityRow as a compact final row inside existing body, after the existing metadata. Reuse Avatar safety/fallback and discovery avatar dimensions/tokens; 8px spacing. No discovery footer border/padding, new panel, action or column. This is a bounded extension, not exact frozen-screen parity or OWNER_VISUAL_OVERRIDE.

Detail/manager: supplied Open/Management captures did not navigate and are NOT detail screens. Exact screen parity remains UNVERIFIED. Existing organizer dt/dd is retained; compose the observed kit DefinitionList + inline Avatar/IdentityRow in its value, with a 24px avatar and unchanged contact placement. No claim to have inspected a published detail/manager screen.

Discovery: guide §03 explicitly has organizer for regular and trainer for trainer-led. Preserve separate trainer name/initials with self-declared label. STYLE_GUIDE_GAP #15-dual-identity: trainer-led also requires creator photo; retain trainer identity as a distinct compact kit row before existing organizer/action footer. Never apply creator media to trainer. Existing action position and activity/status semantics remain. No OWNER_VISUAL_OVERRIDE asserted.

These mappings supersede prior unsupported parity/no-gap prose as source rationale only. Historical FAIL/BLOCKED remain valid for their reviewed candidates. Independent QA4 may reject this repair.

## Supplied evidence hashes

| File | SHA-256 |
| --- | --- |
| construction-kit.png | `454d6be3086fe2001501bcf38860ea9f9683503be0db8294c86e3eb895abc0e3` |
| construction-kit.txt | `bab2d7579a211163d267323afa394c05d7a7094ae7c804ed790a76a3e2677824` |
| created-games.dom.html | `1dcf113d624f22a7107273b57584992b2b249c309206a23eff637d131410af68` |
| created-games.png | `71e539ceacb3a40317a967201bcfaa65ba5a2497f86df1bc9ba22b0faf548ebb` |
| created-games.txt | `b7b9e94464894c61ca87e3e7aa9c78eaff1ad4c255ac363149e2b87b87c7d2cd` |
| guide-gamecard.png | `84c3cfacc55abbaf4f079e3c23a73ce4f67c2601f8c8c52411681d6acf49983b` |
| guide.dom.html | `898dfcce619a9a97e4bf8f6b7efb6b47e43b4409f7cac25b80fb62e8f24e4cf9` |
| guide.png | `72609a00754383e255a0dc81a996fb9c0d9502004c9ce238f50b0bc0d2e95fde` |
| guide.txt | `bab2d7579a211163d267323afa394c05d7a7094ae7c804ed790a76a3e2677824` |
| kit-identity.png | `874b491ac5327f2ebfe230667d65d17760fe66b7ed4a7d54014ae4c4b595a6ca` |
| my-games-manage-action-no-navigation.dom.html | `1dcf113d624f22a7107273b57584992b2b249c309206a23eff637d131410af68` |
| my-games-manage-action-no-navigation.png | `e1719a41093b074a871a59f780309ace50b46568505484010e4b50a104cc2d49` |
| my-games-manage-action-no-navigation.txt | `b7b9e94464894c61ca87e3e7aa9c78eaff1ad4c255ac363149e2b87b87c7d2cd` |
| my-games-open-action-no-navigation.dom.html | `f80d5b73c35af98bb76c66e43f0cc88db910a53af57b0597668388add1144024` |
| my-games-open-action-no-navigation.png | `0c5f6c7cb2b884f823d159e419829d6da3474f00a460f717308b069469866cb9` |
| my-games-open-action-no-navigation.txt | `0b7b4d39a094cd51ec308544df8847d1dcea11b108fc138ccdf3526c85cacce4` |
| my-games.dom.html | `d55d73d921ec076e544370709aed9a434d015cbe14fa812fb8a1a16e48be2a28` |
| my-games.png | `aef80f66566cbd8ca3fdddf5f5b7f9abbda3d31425547526d4ea4fe1925ad76d` |
| my-games.txt | `0b7b4d39a094cd51ec308544df8847d1dcea11b108fc138ccdf3526c85cacce4` |

## Relevant primary-source DOM (verbatim excerpts)

These complete relevant elements preserve source structure/classes; production class names are adapters, not proof of parity. Other unrelated guide families are omitted.

### Published Created Games main DOM

```html
<main class="my-games-page"><section class="my-games-header"><div><span class="eyebrow">Личный раздел</span><h1>Мои игры</h1><p>Заявки, подтверждённые игры и события, которые вы создали.</p></div><button class="button button--primary ">+ Создать игру</button></section><section class="relationship-bar"><div class="segmented" aria-label="Relationship"><button class="">Участвую</button><button class="is-active">Созданные мной</button></div><button class="history-link">История созданных игр →</button></section><section class="personal-list"><div class="personal-list__heading"><span><small>Ваши публикации</small><h2>Созданные игры</h2></span><span>4</span></div><article class="personal-card personal-card--published"><div class="personal-card__status"><span class="status-badge status-badge--published">Опубликовано</span></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Игра в миксы</h3><strong>Завтра, 29 апр. · 19:00 — 21:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Арена Бадминтон</p><span>Средний · 4 свободных места</span></div><div class="personal-card__action"><button class="button button--outline ">Управление <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--published"><div class="personal-card__status"><span class="status-badge status-badge--published">Опубликовано</span></div><div class="personal-card__body"><span class="type-badge type-badge--trainer">С тренером</span><h3>Техника короткой подачи</h3><strong>Чт, 1 мая · 18:00 — 20:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Смэш Клуб</p><span>Все уровни · с тренером</span></div><div class="personal-card__action"><button class="button button--outline ">Управление <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--published"><div class="personal-card__status"><span class="status-badge status-badge--published">Опубликовано</span><span class="status-badge status-badge--attention">2 заявки ждут ответа</span></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Парная игра в субботу</h3><strong>Сб, 3 мая · 12:00 — 14:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Спортзал Сокол</p><span>Средний · 2 свободных места</span></div><div class="personal-card__action"><button class="button button--outline ">Управление <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--draft"><div class="personal-card__status"><span class="status-badge status-badge--draft">Черновик</span><small>Ещё не опубликована</small></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Вечерняя игра</h3><strong>Дата не выбрана · Время не выбрано</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Площадка не выбрана</p><span>Условия не заполнены</span></div><div class="personal-card__action"><button class="button button--dark ">Продолжить <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article></section></main>
```

### Guide §03 regular/trainer cards

```html
<section class="guide-section"><div class="guide-title"><span>03</span><h2>Core components</h2></div><div class="guide-grid guide-grid--cards"><article class="game-card  game-card--compact"><div class="game-card__image"><img alt="" src="/assets/badminton-gear.jpg"><span class="type-badge ">Обычная игра</span></div><div class="game-card__content"><div class="game-card__topline"><span>Завтра, 29 апр.</span><span class="spots">4 места</span></div><strong class="game-card__time">19:00 — 21:00</strong><h3>Игра в миксы</h3><p class="venue">Арена Бадминтон</p><p class="address"><img class="icon" alt="" src="/assets/360c7.svg"> Ленинградский проспект, 31А</p><div class="meta-row"><span>Средний</span><span>Открыто для всех</span></div><div class="host-row"><span class="avatar avatar--lime">А</span><span><small>Организатор</small><strong>Алексей К.</strong></span><button class="button button--outline ">Подробнее <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></div></article><article class="game-card game-card--trainer game-card--compact"><div class="game-card__image"><img alt="" src="/assets/badminton-courts.jpg"><span class="type-badge type-badge--trainer">С тренером</span></div><div class="game-card__content"><div class="game-card__topline"><span>Завтра, 29 апр.</span><span class="spots">2 места</span></div><strong class="game-card__time">18:00 — 20:00</strong><h3>Техника: скорость у сетки</h3><p class="venue">Смэш Клуб</p><p class="address"><img class="icon" alt="" src="/assets/360c7.svg"> ул. Правды, 24</p><div class="meta-row"><span>Все уровни</span><span>Открыто для всех</span><span class="price">По договорённости</span></div><div class="host-row"><span class="avatar avatar--purple">Д</span><span><small>Тренер</small><strong>Дмитрий С.</strong></span><button class="button button--dark ">Подробнее <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></div></article><div class="guide-panel nav-preview"><small>Navigation</small><button class="logo-button" aria-label="GoBadminton home"><img alt="GoBadminton" src="/assets/67df8.svg"></button><div class="nav-preview__links"><strong>Игры</strong><span>Мои игры</span><span>Профиль</span></div><div class="mobile-nav-preview"><span><img class="icon" alt="" src="/assets/f8ab5.svg">Игры</span><span><img class="icon" alt="" src="/assets/f569e.svg">Мои игры</span><span><img class="icon" alt="" src="/assets/159f8.svg">Профиль</span></div></div></div></section>
```

### Guide §06 personal GameCard family

```html
<section id="guide-cards" class="guide-section"><div class="guide-title"><span>06</span><h2>Game card family</h2></div><div class="card-family-labels"><span>Regular</span><span>Trainer-led</span><span>Participating</span><span>Owned</span><span>Draft</span><span>Cancelled</span><span>Compact mobile</span><span>Desktop list</span></div><div class="component-stack"><article class="personal-card personal-card--confirmed"><div class="personal-card__status"><span class="status-badge status-badge--confirmed">Место подтверждено</span><small>Вы в составе игры</small></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Игра в миксы</h3><strong>Завтра, 29 апр. · 19:00 — 21:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Арена Бадминтон</p><span>Средний · парная игра</span></div><div class="personal-card__action"><button class="button button--outline ">Открыть игру <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--published"><div class="personal-card__status"><span class="status-badge status-badge--published">Опубликовано</span><span class="status-badge status-badge--attention">2 заявки ждут ответа</span></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Парная игра в субботу</h3><strong>Сб, 3 мая · 12:00 — 14:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Спортзал Сокол</p><span>Средний · 2 свободных места</span></div><div class="personal-card__action"><button class="button button--outline ">Управление <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--draft"><div class="personal-card__status"><span class="status-badge status-badge--draft">Черновик</span><small>Ещё не опубликована</small></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Вечерняя игра</h3><strong>Дата не выбрана · Время не выбрано</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Площадка не выбрана</p><span>Условия не заполнены</span></div><div class="personal-card__action"><button class="button button--dark ">Продолжить <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article><article class="personal-card personal-card--cancelled"><div class="personal-card__status"><span class="status-badge status-badge--cancelled">Игра отменена</span><small>Предыдущее подтверждение больше не действует</small></div><div class="personal-card__body"><span class="type-badge ">Обычная игра</span><h3>Свободная игра после работы</h3><strong>Сб, 26 апр. · 20:00 — 22:00</strong><p><img class="icon" alt="" src="/assets/360c7.svg"> Центр Бадминтона</p><span>Любой уровень · парная игра</span></div><div class="personal-card__action"><button class="button button--outline ">Открыть игру <img class="icon" alt="" src="/assets/e70cd.svg"></button></div></article></div><p class="component-note">Маркер «С тренером» относится только к самой игре. Профиль организатора не меняет тип обычной игры.</p></section>
```

### Kit §08 Avatar / IdentityRow

```html
<article class="kit-board "><header><span>Avatar / IdentityRow</span><h3>People components</h3></header><div class="avatar-size-family"><span><span class="avatar avatar--lime">А</span><small>Initials</small></span><span class="photo-avatar large"><img alt="" src="/assets/badminton-gear.jpg"></span><span><span class="avatar avatar--purple">Д</span><small>Trainer</small></span><span class="avatar-with-dot"><span class="avatar avatar--yellow">М</span><i></i></span></div><div class="identity-row-sample"><span class="avatar avatar--yellow">М</span><span><strong>Мария Л.</strong><small>Средний · Москва</small></span><span class="status-badge status-badge--available">Ищу игру</span><button>→</button></div><div class="avatar-stacks"><span><span class="avatar avatar--lime">А</span><span class="avatar avatar--yellow">М</span></span><span><span class="avatar avatar--lime">А</span><span class="avatar avatar--yellow">М</span><span class="avatar avatar--purple">Д</span></span><span><span class="avatar avatar--lime">А</span><span class="avatar avatar--yellow">М</span><span class="avatar avatar--purple">Д</span><span class="avatar avatar--lime">О</span><b>+1</b></span></div></article>
```

### Kit §08 DataRow / DefinitionList

```html
<article class="kit-board kit-board--wide"><header><span>DataRow / DefinitionList</span><h3>Consumer data patterns</h3></header><div class="data-patterns"><dl><div><dt>Уровень</dt><dd>Средний</dd></div><div><dt>Город</dt><dd>Москва</dd></div><div><dt>Формат</dt><dd>Парная игра</dd></div></dl><div class="data-row"><span><small>Активная сессия</small><strong>Chrome · Москва</strong></span><em>Сейчас</em><button>•••</button></div><div class="consumer-table"><header><span>Участник</span><span>Статус</span><span>Дата</span><span></span></header><div><span><span class="avatar avatar--lime">МЛ</span>Мария Л.</span><span class="status-badge status-badge--confirmed">В игре</span><time>03.10</time><button>•••</button></div><div><span><span class="avatar avatar--lime">ДС</span>Дмитрий С.</span><span class="status-badge status-badge--pending">Ожидает</span><time>03.10</time><button>•••</button></div><div><span><span class="avatar avatar--lime">ОВ</span>Ольга В.</span><span class="status-badge status-badge--confirmed">В игре</span><time>03.10</time><button>•••</button></div></div></div><p class="kit-note">Mobile adaptation: table rows become stacked cards; actions remain trailing and labeled.</p></article>
```

## Source work / evidence limits / handoff

Changed GameDetailComposition.tsx and discovery.css for bounded identity composition; DiscoveryGameCard.tsx retains separate trainer identity. Browser regression declares its browser globals. Managed-games synthetic opt-in fixture now supplies city, consent version and opted-in timestamp, including conflict updates; production constraints unchanged. Regression assertions are retained and extended for trainer/creator separation and personal-card hierarchy.

Supplied CI diagnostic reports hosted Product CI 38711097109 failed on base (browser no-undef, lost trainer name, invalid directory opt-in fixture); this is input data, not fresh author verification.
Actually performed: read-only Git state/source/rule/evidence inspection, three reference PNG inspections, source/test/document writes. NOT_TESTED: lint, compile, tests, browser execution, QA4, hosted full Product CI, DEV paired images/backup/digests/server acceptance, synthetic product smoke and UAT. No self-QA, service, DB, network deployment, git metadata, commit or push actions. Current live dev not read: this sandbox has no admitted network input for current dev; base is the exact local candidate, not a claim about live DEV.

Next bounded action: authorized publisher produces exact resulting SHA and durable GitHub permalink; fresh independent read-only QA4 inspects that SHA with these canonical inputs and runs required regressions. CI and DEV/UAT gates remain separate and pending. No new SHA/permalink exists from this author. Rollback: integrator reverts only this attempt's source/test/docs changes relative to base; no schema/runtime rollback required. Do not erase historical findings or unrelated work.
