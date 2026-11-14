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
