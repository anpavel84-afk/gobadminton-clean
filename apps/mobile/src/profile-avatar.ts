import { sameActor, type Actor } from './participation.ts';
import { ProfileError, type AvatarReceipt, type OwnAvatar, type OwnProfile } from './profile.ts';

export type { AvatarReceipt, OwnAvatar };

/** On-device only. Source bytes must never be passed to the upload client. */
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_SOURCE_MAX_PIXELS = 50_000_000;
export const AVATAR_DERIVATIVE_MAX_BYTES = 512 * 1024;
export const AVATAR_PREPROCESS_MS = 12_000;
export const AVATAR_NETWORK_MS = 20_000;
export const AVATAR_SIZE = 512;
export const AVATAR_FORMATS =
  'Выберите JPEG, PNG или WebP без анимации и без прозрачности. Если фото в HEIC/HEIF, сохраните его как JPEG.';
/** Internal evidence bookkeeping — never shown as ordinary user guidance. */
export const AVATAR_WHITE_FLATTEN_BLOCKER =
  'Прозрачные изображения пока нельзя подготовить на устройстве: белый фон (web white-flatten) не доказан native crop/JPEG без extent/backgroundColor. Выберите непрозрачное JPEG/PNG/WebP.';
/** Plain Russian user-facing copy for unsupported transparency. */
export const AVATAR_TRANSPARENCY_USER =
  'Сейчас можно выбрать только непрозрачное фото JPEG, PNG или WebP. Прозрачные изображения пока не поддерживаются.';
export const AVATAR_IOS_ORIGINAL_UNPROVED =
  'iOS picker может молча перекодировать исходник в PNG без индикатора; original-container/animation/size parity не доказаны для каждой выборки.';
export const AVATAR_DERIVATIVE_OVERSIZE =
  'Не удалось уменьшить фото до допустимого размера. Выберите другое фото и попробуйте ещё раз.';

export class AvatarSourceError extends Error {
  readonly code: string;
  constructor(message: string, code = 'AVATAR_SOURCE') {
    super(message);
    this.code = code;
  }
}

export type AvatarMetadata = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  orientation: number;
  hasAlpha: boolean;
};
export type AvatarAction = 'replace' | 'remove';
export type AvatarDerivative = Readonly<{
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}>;
export type AvatarPacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  action: AvatarAction;
  profileVersion: number;
  derivative: AvatarDerivative | null;
}>;
export type AvatarPort = {
  mutate: (packet: AvatarPacket, authority: Actor) => Promise<AvatarReceipt>;
  reconcile: (authority: Actor) => Promise<OwnProfile>;
};
export type AvatarSnapshot = {
  actor: Actor | null;
  status: 'idle' | 'picking' | 'processing' | 'sending' | 'unknown';
  command?: { packet: AvatarPacket; status: 'sending' | 'unknown' };
  notice: string | null;
  error: string | null;
  blockers: string[];
};

export function cloneDerivativeBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function freezeAvatarPacket(input: {
  actor: Actor;
  key: string;
  action: AvatarAction;
  profileVersion: number;
  derivative: AvatarDerivative | null;
}): AvatarPacket {
  const derivative = input.derivative
    ? Object.freeze({
        mime: input.derivative.mime,
        // Uint8Array views cannot be Object.freeze'd; ownership is the cloned copy only.
        bytes: cloneDerivativeBytes(input.derivative.bytes),
      })
    : null;
  return Object.freeze({
    actor: Object.freeze({ ...input.actor }),
    key: input.key,
    action: input.action,
    profileVersion: input.profileVersion,
    derivative,
  });
}

/** Header/chunk inspection precedes allocation of a decoded raster; MIME alone is not authority. */
export function inspectAvatarSource(bytes: ArrayBuffer | Uint8Array, declaredType = ''): AvatarMetadata {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
  const v = new DataView(buffer);
  const ascii = (offset: number, count: number) => String.fromCharCode(...a.subarray(offset, offset + count));
  const invalid = () => {
    throw new AvatarSourceError('Фото повреждено или не удалось прочитать его размеры. Выберите другое фото.');
  };
  let mime: AvatarMetadata['mime'], width = 0, height = 0, orientation = 1, hasAlpha = false;
  const exif = (start: number, end: number) => {
    const t = ascii(start, 6) === 'Exif\0\0' ? start + 6 : start;
    if (t + 8 > end) invalid();
    const little = ascii(t, 2) === 'II';
    if (!little && ascii(t, 2) !== 'MM') invalid();
    if (v.getUint16(t + 2, little) !== 42) invalid();
    const directory = t + v.getUint32(t + 4, little);
    if (directory < t || directory + 2 > end) invalid();
    const count = v.getUint16(directory, little);
    if (directory + 2 + count * 12 > end) invalid();
    for (let i = 0; i < count; i++) {
      const entry = directory + 2 + i * 12;
      if (v.getUint16(entry, little) === 0x112 && v.getUint16(entry + 2, little) === 3 && v.getUint32(entry + 4, little) === 1) {
        orientation = v.getUint16(entry + 8, little);
        if (orientation < 1 || orientation > 8) invalid();
      }
    }
  };
  if (a.length >= 24 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    mime = 'image/png';
    if (ascii(12, 4) !== 'IHDR' || v.getUint32(8) !== 13) invalid();
    width = v.getUint32(16);
    height = v.getUint32(20);
    const colorType = a[25];
    if (colorType === 4 || colorType === 6) hasAlpha = true;
    for (let p = 8; p < a.length;) {
      if (p + 12 > a.length) invalid();
      const n = v.getUint32(p);
      if (n > a.length - p - 12) invalid();
      if (ascii(p + 4, 4) === 'acTL') throw new AvatarSourceError(AVATAR_FORMATS);
      if (ascii(p + 4, 4) === 'tRNS') hasAlpha = true;
      if (ascii(p + 4, 4) === 'eXIf') exif(p + 8, p + 8 + n);
      p += n + 12;
    }
  } else if (a.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    mime = 'image/webp';
    if (v.getUint32(4, true) + 8 !== a.length) invalid();
    for (let p = 12; p < a.length;) {
      if (p + 8 > a.length) invalid();
      const n = v.getUint32(p + 4, true), kind = ascii(p, 4), d = p + 8;
      if (n > a.length - d) invalid();
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (a[d]! & 2))) throw new AvatarSourceError(AVATAR_FORMATS);
      if (kind === 'EXIF') exif(d, d + n);
      if (kind === 'VP8X' && n >= 10) {
        if (a[d]! & 0x10) hasAlpha = true;
        width = 1 + a[d + 4]! + (a[d + 5]! << 8) + (a[d + 6]! << 16);
        height = 1 + a[d + 7]! + (a[d + 8]! << 8) + (a[d + 9]! << 16);
      } else if (!width && kind === 'VP8 ' && n >= 10 && ascii(d + 3, 3) === '\x9d\x01\x2a') {
        width = v.getUint16(d + 6, true) & 0x3fff;
        height = v.getUint16(d + 8, true) & 0x3fff;
      } else if (!width && kind === 'VP8L' && n >= 5 && a[d] === 0x2f) {
        const bits = v.getUint32(d + 1, true);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
        if (a[d + 4]! & 0x08) hasAlpha = true;
      } else if (kind === 'ALPH') hasAlpha = true;
      p = d + n + (n & 1);
      if (p > a.length) invalid();
    }
  } else if (a.length >= 4 && a[0] === 0xff && a[1] === 0xd8 && a[2] === 0xff) {
    mime = 'image/jpeg';
    for (let p = 2; p < a.length;) {
      if (a[p++] !== 0xff) invalid();
      while (a[p] === 0xff) p++;
      const marker = a[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker! >= 0xd0 && marker! <= 0xd7)) continue;
      if (p + 2 > a.length) invalid();
      const n = v.getUint16(p);
      if (n < 2 || p + n > a.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker!)) {
        if (n < 8) invalid();
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
      }
      if (marker === 0xe1 && n >= 16 && ascii(p + 2, 6) === 'Exif\0\0') exif(p + 2, p + n);
      p += n;
    }
  } else throw new AvatarSourceError(AVATAR_FORMATS);
  if (declaredType && declaredType !== mime) throw new AvatarSourceError(AVATAR_FORMATS);
  if (!width || !height) invalid();
  if (width * height > AVATAR_SOURCE_MAX_PIXELS) {
    throw new AvatarSourceError('Фото должно быть не больше 50 Мп. Выберите фото меньшего размера.');
  }
  return { mime, width, height, orientation, hasAlpha };
}

/** Some encoders attach ICC/EXIF/XMP. Strip metadata containers explicitly. */
export function stripAvatarMetadata(bytes: ArrayBuffer | Uint8Array, mime: string, orientationOnly = false): Uint8Array {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
  const v = new DataView(buffer);
  const parts: Uint8Array[] = [];
  if (mime === 'image/webp') {
    const header = a.slice(0, 12);
    parts.push(header);
    for (let p = 12; p < a.length;) {
      const n = v.getUint32(p + 4, true), end = p + 8 + n + (n & 1);
      const kind = String.fromCharCode(...a.subarray(p, p + 4));
      if (!(orientationOnly ? ['EXIF'] : ['ICCP', 'EXIF', 'XMP ']).includes(kind)) {
        const chunk = a.slice(p, end);
        if (kind === 'VP8X') chunk[8] = chunk[8]! & ~(orientationOnly ? 0x08 : 0x2c);
        parts.push(chunk);
      }
      p = end;
    }
    new DataView(header.buffer, header.byteOffset, header.byteLength).setUint32(4, parts.reduce((n, p) => n + p.length, 0) - 8, true);
  } else if (mime === 'image/jpeg') {
    parts.push(a.slice(0, 2));
    for (let p = 2; p < a.length;) {
      const start = p;
      while (a[p] === 0xff) p++;
      const marker = a[p++]!;
      if (marker === 0xda || marker === 0xd9) {
        parts.push(a.slice(start));
        break;
      }
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
        parts.push(a.slice(start, p));
        continue;
      }
      const end = p + v.getUint16(p);
      const metadata = orientationOnly ? marker === 0xe1 : (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
      if (!metadata) parts.push(a.slice(start, end));
      p = end;
    }
  } else if (mime === 'image/png' && orientationOnly) {
    parts.push(a.slice(0, 8));
    for (let p = 8; p < a.length;) {
      const end = p + 12 + v.getUint32(p);
      if (String.fromCharCode(...a.subarray(p + 4, p + 8)) !== 'eXIf') parts.push(a.slice(p, end));
      p = end;
    }
  } else if (mime === 'image/png') {
    // Full PNG metadata strip is not required for JPEG derivatives; reject opaque PNG upload path unless orientation-only.
    throw new AvatarSourceError('Не удалось подготовить формат фото.');
  } else throw new AvatarSourceError('Не удалось подготовить формат фото.');
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function assertOpaqueAvatarSource(meta: AvatarMetadata): void {
  if (meta.hasAlpha) throw new AvatarSourceError(AVATAR_TRANSPARENCY_USER, 'WHITE_FLATTEN_UNPROVEN');
}

export function assertDerivativeReady(bytes: Uint8Array, mime: string): AvatarDerivative {
  const meta = inspectAvatarSource(bytes, mime);
  if (meta.width !== AVATAR_SIZE || meta.height !== AVATAR_SIZE || meta.orientation !== 1) {
    throw new AvatarSourceError('Не удалось подготовить квадрат 512×512 без EXIF-ориентации. Выберите другое фото.');
  }
  if (meta.hasAlpha) throw new AvatarSourceError(AVATAR_TRANSPARENCY_USER, 'WHITE_FLATTEN_UNPROVEN');
  const stripped = stripAvatarMetadata(bytes, meta.mime);
  if (stripped.byteLength > AVATAR_DERIVATIVE_MAX_BYTES) {
    throw new AvatarSourceError(AVATAR_DERIVATIVE_OVERSIZE, 'DERIVATIVE_OVERSIZE');
  }
  const verified = inspectAvatarSource(stripped, meta.mime);
  if (verified.width !== AVATAR_SIZE || verified.height !== AVATAR_SIZE || verified.orientation !== 1) {
    throw new AvatarSourceError('Не удалось очистить метаданные фото.');
  }
  return Object.freeze({
    mime: meta.mime,
    bytes: cloneDerivativeBytes(stripped),
  });
}

export function avatarDeadline<T>(
  promise: Promise<T>,
  ms: number,
  retire: () => void,
  releaseLate?: (value: T) => void,
  releaseLateRejection?: (error: unknown) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      retire();
      reject(new AvatarSourceError('Подготовка фото заняла слишком долго. Попробуйте другое фото.', 'DEADLINE'));
    }, ms);
    promise.then(
      value => {
        if (settled) {
          releaseLate?.(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        if (settled) {
          releaseLateRejection?.(error);
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Visible pixel size after one native orientation normalize (EXIF 5–8 swap axes). No guessed extra rotate. */
export function avatarOrientedSize(
  meta: Pick<AvatarMetadata, 'width' | 'height' | 'orientation'>,
): { width: number; height: number } {
  const swap = meta.orientation >= 5 && meta.orientation <= 8;
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

type AvatarGate = {
  isTextBusy: () => boolean;
  currentProfile: () => OwnProfile | null;
  applyReceipt: (receipt: AvatarReceipt) => void;
  /** Full authoritative GET rebase; preserves each dirty local draft field. */
  rebaseProfile: (fresh: OwnProfile) => void;
};

const initial = (): AvatarSnapshot => ({
  actor: null, status: 'idle', notice: null, error: null, blockers: [],
});

/** Root-lifetime avatar owner. One packet per dispatch; no automatic resume after login/restart. */
export class ProfileAvatarCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private uncertain = false;
  private quarantined: AvatarPacket | null = null;
  private readonly port: AvatarPort;
  private readonly random: () => string;
  private readonly gate: AvatarGate;
  constructor(port: AvatarPort, random: () => string, gate: AvatarGate) {
    this.port = port;
    this.random = random;
    this.gate = gate;
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private show(p: Partial<AvatarSnapshot>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach(f => f());
  }
  private current(actor: Actor) {
    return sameActor(actor, this.state.actor);
  }
  /** Active prepare/send only — UNKNOWN must stay !busy so explicit Retry is reachable. */
  busy = () =>
    this.state.status === 'picking' ||
    this.state.status === 'processing' ||
    this.state.command?.status === 'sending';
  /** Blocks replacement and peer text writes while UNKNOWN or in-flight; Retry remains reachable via !busy. */
  blocksEdits = () =>
    this.busy() || this.state.status === 'unknown' || this.state.command?.status === 'unknown';
  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || (!actor && !this.state.actor)) return;
    if (this.state.command) this.quarantined = this.state.command.packet;
    if (actor && this.quarantined?.actor.actorId !== actor.actorId) this.quarantined = null;
    const packet = actor ? this.quarantined : null;
    if (actor) this.quarantined = null;
    this.serial++;
    this.uncertain = false;
    this.state = initial();
    this.show({
      actor: actor ? Object.freeze({ ...actor }) : null,
      ...(packet
        ? {
            command: { packet, status: 'unknown' as const },
            status: 'unknown' as const,
            notice:
              'Результат фото неизвестен. Можно явно повторить только прежнюю операцию с тем же ключом и данными.',
          }
        : {}),
    });
  }
  forget = () => {
    this.quarantined = null;
    this.uncertain = false;
    this.serial++;
    this.state = initial();
    this.show({});
  };
  /** Duplicate taps collapse while a command owns the fence. */
  change = async (prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled'>) => {
    await this.run('replace', prepare);
  };
  remove = async () => {
    await this.run('remove', async () => null);
  };
  retry = async () => {
    const { actor, command } = this.state;
    if (actor && command?.status === 'unknown' && command.packet.actor.actorId === actor.actorId) {
      await this.dispatch(command.packet, actor);
    }
  };
  private async run(
    action: AvatarAction,
    prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled' | null>,
  ) {
    const actor = this.state.actor;
    const profile = this.gate.currentProfile();
    if (!actor || !profile || this.blocksEdits() || this.gate.isTextBusy()) return;
    if (action === 'remove' && !profile.avatar.uploadedUrl) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor);
    this.show({
      status: action === 'replace' ? 'picking' : 'processing',
      notice: null,
      error: null,
      blockers: action === 'replace' ? [AVATAR_IOS_ORIGINAL_UNPROVED] : [],
    });
    let derivative: AvatarDerivative | null = null;
    try {
      if (this.uncertain) {
        this.show({ status: 'processing' });
        const fresh = await this.port.reconcile(actor);
        if (retired()) return;
        this.uncertain = false;
        this.gate.rebaseProfile(fresh);
      }
      const prepared = await prepare(retired);
      if (retired()) return;
      if (prepared === 'cancelled') {
        this.show({ status: 'idle', notice: null, error: null });
        return;
      }
      derivative = prepared;
      const packet = freezeAvatarPacket({
        actor,
        key: this.random(),
        action,
        profileVersion: this.gate.currentProfile()?.version ?? profile.version,
        derivative,
      });
      await this.dispatch(packet, actor);
    } catch (error) {
      if (retired()) return;
      const message =
        error instanceof AvatarSourceError
          ? error.message
          : 'Не удалось подготовить фото. Выберите другое фото или сохраните его как JPEG.';
      const blockers =
        error instanceof AvatarSourceError && error.code === 'WHITE_FLATTEN_UNPROVEN'
          ? [AVATAR_WHITE_FLATTEN_BLOCKER, AVATAR_IOS_ORIGINAL_UNPROVED]
          : [AVATAR_IOS_ORIGINAL_UNPROVED];
      this.show({ status: 'idle', command: undefined, error: message, blockers, notice: null });
    }
  }
  private async dispatch(packet: AvatarPacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, status: 'sending', notice: null, error: null });
    const valid = () =>
      this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    try {
      const receipt = await this.port.mutate(packet, authority);
      if (!valid()) return;
      if (receipt.version < packet.profileVersion) throw new ProfileError('invalid');
      this.uncertain = false;
      this.gate.applyReceipt(receipt);
      this.show({
        command: undefined,
        status: 'idle',
        notice:
          packet.action === 'replace'
            ? 'Фото сохранено.'
            : 'Фото удалено. Показываем инициалы.',
        error: null,
      });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ProfileError && error.kind === 'business' && error.status === 409) {
        this.uncertain = false;
        try {
          const fresh = await this.port.reconcile(authority);
          if (!valid()) return;
          this.gate.rebaseProfile(fresh);
          this.show({
            command: undefined,
            status: 'idle',
            error:
              'Профиль изменился на другом устройстве. Локальный черновик сохранён — проверьте поля перед новым фото.',
            notice: null,
          });
        } catch {
          if (!valid()) return;
          this.show({
            command: undefined,
            status: 'idle',
            error: 'Профиль изменился. Обновите данные перед повтором.',
            notice: null,
          });
        }
        return;
      }
      if (
        error instanceof ProfileError &&
        error.kind === 'business' &&
        error.status < 500 &&
        error.code !== 'COMMAND_IN_PROGRESS'
      ) {
        this.uncertain = false;
        this.show({
          command: undefined,
          status: 'idle',
          error:
            error.status === 422 || error.status === 415
              ? 'Фото не удалось прочитать. Выберите JPEG, PNG или WebP без анимации и без прозрачности.'
              : 'Не удалось подтвердить сохранение фото. Проверьте соединение и попробуйте ещё раз.',
          notice: null,
        });
        return;
      }
      this.uncertain = true;
      try {
        const fresh = await this.port.reconcile(authority);
        if (!valid()) return;
        this.uncertain = false;
        this.gate.rebaseProfile(fresh);
        this.show({
          command: undefined,
          status: 'idle',
          error: 'Не удалось подтвердить сохранение фото. Проверьте соединение и попробуйте ещё раз.',
          notice: null,
        });
      } catch {
        if (!valid()) return;
        this.show({
          command: { packet, status: 'unknown' },
          status: 'unknown',
          notice:
            'Результат фото неизвестен. Проверка повторит только эту операцию с прежними данными и ключом.',
          error: 'Не удалось подтвердить сохранение фото. Проверьте соединение и попробуйте ещё раз.',
        });
      }
    }
  }
}
