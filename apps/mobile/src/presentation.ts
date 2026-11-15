import type { PublicGame } from './public-api.ts';

export function canShareGame(game: Pick<PublicGame, 'status' | 'visibility'>): boolean {
  return game.status === 'published' && game.visibility === 'public';
}

// Pure native subset of web discovery-presentation.ts/discoveryFormat.
// Unsupported keys have no consumer label and are omitted.
export function formatLabel(key: string): string | null {
  switch (key) {
    case 'doubles': return 'Парная игра';
    case 'singles': return 'Одиночная игра';
    case 'mixed':
    case 'mixed_doubles': return 'Микст';
    default: return null;
  }
}

// web level-guide.ts: exact scale/version identity; NTRP v1 half-steps
// 1.0…7.0 and gb-social-pilot v1 symbols only. Never guess a foreign scale.
export function levelLabel(rule: PublicGame['levelRule']): string {
  if (!rule.allowedLevelIds.length) return 'Не указаны';
  const unknown = 'Уточните у организатора';
  if (rule.scaleVersion !== 1) return unknown;
  if (rule.scaleId === 'ntrp') {
    const values = rule.allowedLevelIds.map(id => {
      const trimmed = id.trim().replace(',', '.');
      const value = Number(trimmed);
      const snapped = Math.round(value * 2) / 2;
      return trimmed && Number.isFinite(value) && value >= 1 && value <= 7 && Math.abs(value - snapped) <= 1e-9
        ? snapped.toFixed(1).replace('.', ',') : null;
    });
    return values.every(value => value !== null) ? `NTRP ${values.join(' · ')}` : unknown;
  }
  if (rule.scaleId === 'gb-social-pilot') {
    const labels = rule.allowedLevelIds.map(id => {
      switch (id) {
        case 'beginner': return 'Начинающий';
        case 'intermediate': return 'Средний';
        case 'advanced': return 'Продвинутый';
        default: return null;
      }
    });
    return labels.every(label => label !== null) ? labels.join(' · ') : unknown;
  }
  return unknown;
}

export function gameTime(game: PublicGame) {
  const format = new Intl.DateTimeFormat('ru-RU', {
    timeZone: game.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  return `${format.format(new Date(game.startsAt))} — ${format.format(new Date(game.endsAt))} (${game.timezone})`;
}
export function deadline(game: PublicGame) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: game.timezone, dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(game.applicationDeadlineAt));
}
export function settlementLabel(game: PublicGame) {
  const settlement = game.settlement;
  if (settlement.purpose === 'no_trainer_fee') return 'Без тренерского сбора';
  if (settlement.priceStatus === 'by_agreement') return 'Стоимость с тренером — по договорённости';
  const digits = settlement.priceMinor.padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)} ${settlement.currency} / игрока за занятие`;
}
export function statusLabel(game: PublicGame) {
  return { published: 'Опубликована', cancelled: 'Отменена', completed: 'Завершена', draft: 'Черновик' }[game.status];
}

/** Accepted discovery date/time hierarchy, always in the game's actual timezone. */
export function cardWhen(game: PublicGame) {
  return {
    day: new Intl.DateTimeFormat('ru-RU', { timeZone: game.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(game.startsAt)),
    time: `${new Intl.DateTimeFormat('ru-RU', { timeZone: game.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(game.startsAt))} — ${new Intl.DateTimeFormat('ru-RU', { timeZone: game.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(game.endsAt))}`,
  };
}
export function discoveryCityHeading(name: string) {
  return name === 'Москва' ? 'в Москве' : name === 'Санкт-Петербург' ? 'в Санкт-Петербурге' : `· ${name}`;
}

export function playerLevelLabel(level: { scaleId: string; scaleVersion: number; levelId: string } | null): string {
  if (!level || level.scaleVersion !== 1) return 'Уровень не указан';
  if (level.scaleId === 'gb-social-pilot') {
    switch (level.levelId) {
      case 'beginner': return 'Начинающий';
      case 'intermediate': return 'Средний';
      case 'advanced': return 'Продвинутый';
      default: return 'Уровень не указан';
    }
  }
  // Accepted web level-guide.ts catalog: all 13 canonical NTRP v1 half-steps.
  if (level.scaleId === 'ntrp' && ['1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0'].includes(level.levelId)) return `NTRP ${level.levelId}`;
  return 'Уровень не указан';
}
export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => Array.from(p)[0]).join('').toLocaleUpperCase('ru') || '?';
}

// Discovery-only pure subset of accepted WEB level-guide.ts. No profile writes.
export function ntrpHalfstepIds(): string[] {
  return Array.from({ length: 13 }, (_, i) => (1 + i / 2).toFixed(1));
}
export function normalizeNtrpLevelId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(',', '.');
  if (!trimmed) return null;
  const value = Number(trimmed), snapped = Math.round(value * 2) / 2;
  return Number.isFinite(value) && value >= 1 && value <= 7 && Math.abs(value - snapped) <= 1e-9 ? snapped.toFixed(1) : null;
}
export function gameAllowsSelectedNtrpLevel(rule: PublicGame['levelRule'] | null | undefined, selected: string | null | undefined): boolean {
  if (!selected) return true;
  const want = normalizeNtrpLevelId(selected);
  return Boolean(want && rule?.scaleId === 'ntrp' && Number(rule.scaleVersion) === 1 && Array.isArray(rule.allowedLevelIds)
    && rule.allowedLevelIds.some(id => normalizeNtrpLevelId(id) === want));
}
export function filterGamesBySelectedNtrpLevel<T extends { levelRule: PublicGame['levelRule'] }>(games: readonly T[], selected: string | null | undefined): T[] {
  return selected ? games.filter(game => gameAllowsSelectedNtrpLevel(game.levelRule, selected)) : [...games];
}
const SKILL_BLURBS: Record<string, string> = {
  "1.0": "Только начинаю: держу ракетку, учусь попадать по волану.",
  "1.5": "Знаком с подачей и базовыми ударами, играю очень спокойно.",
  "2.0": "Могу коротко отбить обмен, ещё много ошибок и пауз.",
  "2.5": "Играю короткие партии в спокойном темпе, учусь держать площадку.",
  "3.0": "Регулярно играю: базовые удары стабильнее, темп любительский.",
  "3.5": "Уверенный любитель: меняю направление и темп, чувствую партнёра.",
  "4.0": "Сильная любительская игра, тактика и вариативность ударов.",
  "4.5": "Очень сильный любитель / уверенный клубный уровень.",
  "5.0": "Соревновательный любительский ориентир, высокая интенсивность.",
  "5.5": "Высокий соревновательный любительский ориентир.",
  "6.0": "Ориентир полупрофессиональной игры — без гарантии квалификации.",
  "6.5": "Ориентир близко к профессиональному — самооценка, не аттестат.",
  "7.0": "Профессиональный ориентир по самооценке, не сертификат федерации.",
};


export function levelGuideSkills() {
  return ntrpHalfstepIds().map(levelId => ({ levelId, label: levelId.replace('.', ','), summary: SKILL_BLURBS[levelId]! }));
}
export function levelGuideSkillFor(levelId: string) {
  return levelGuideSkills().find(skill => skill.levelId === normalizeNtrpLevelId(levelId)) ?? null;
}
export const LEVEL_GUIDE_DISCLAIMER = 'Уровень указываете вы сами — это ориентир для выбора игры, а не официальная квалификация и не гарантия совместимости.';
export const LEVEL_GUIDE_DISCOVERY_SCOPE_NOTE = 'Фильтр применяется только к уже загруженным играм списка (шкала ntrp v1). Другие шкалы не считаются совместимыми.';
export const LEVEL_GUIDE_MAP_HONESTY = 'Карта показывает все игры выбранного города. Фильтр уровня действует в списке; при возврате к списку он сохранится.';
export function discoveryListPresentation<T extends { levelRule: PublicGame['levelRule'] }>(raw: readonly T[], level: string, nextCursor: string | null) {
  const visible = filterGamesBySelectedNtrpLevel(raw, level);
  return { visible, count: `Найдено: ${visible.length}${nextCursor ? '+' : ''}${level ? ` · из ${raw.length} загруженных` : ''}`,
    levelEmpty: Boolean(level && raw.length && !visible.length), canLoadMore: Boolean(nextCursor) };
}

/** Calendar days belong to the selected city, not the browser's timezone. */
export function cityDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function nextCalendarDay(day: string, offset = 1): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function discoveryDayBounds(day: string, timeZone: string) {
  function midnight(value: string) {
    const target = Date.parse(`${value}T00:00:00Z`);
    let instant = target;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let n = 0; n < 4; n++) {
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
      const displayed = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      const correction = target - displayed;
      instant += correction;
      if (!correction) break;
    }
    return new Date(instant).toISOString();
  }
  return { startsFrom: midnight(day), startsBefore: midnight(nextCalendarDay(day)) };
}

export function discoveryDateLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}


/** Each request advances the lower bound; an unset day has no upper bound. */
export function futureDiscoveryBounds(day: string, timeZone: string, now = Date.now()): { startsFrom: string; startsBefore?: string } {
  if (!day) return { startsFrom: new Date(now).toISOString() };
  const bounds = discoveryDayBounds(day, timeZone);
  return { ...bounds, startsFrom: new Date(Math.max(Date.parse(bounds.startsFrom), now)).toISOString() };
}


/** Role bands use only the game's public facts; trainer identity never substitutes for organizer. */
export function gamePeople(game: PublicGame) {
  return [
    ...(game.activityKind === 'trainer_led' ? [{ role: 'Тренер', name: game.trainer?.displayName ?? 'Профиль недоступен', avatar: undefined, trainer: true }] : []),
    { role: 'Организатор', name: game.organizer.displayName, avatar: game.organizer.avatar, trainer: false },
  ];
}
