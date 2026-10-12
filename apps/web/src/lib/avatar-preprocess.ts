/** On-device only. Source bytes must never be passed to the upload client. */
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_SOURCE_MAX_PIXELS = 50_000_000;
export const AVATAR_DERIVATIVE_MAX_BYTES = 512 * 1024;
export const AVATAR_PREPROCESS_MS = 12_000;
const SIZE = 512;
const FORMATS = 'Выберите JPEG, PNG или WebP без анимации. Если фото в HEIC/HEIF, сохраните его как JPEG.';
export class AvatarSourceError extends Error {}
export type AvatarMetadata = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; orientation: number };

/** Header/chunk inspection precedes allocation of a decoded raster; MIME alone is not authority. */
export function inspectAvatarSource(bytes: ArrayBuffer, declaredType = ''): AvatarMetadata {
  const a = new Uint8Array(bytes), v = new DataView(bytes);
  const ascii = (offset: number, count: number) => String.fromCharCode(...a.subarray(offset, offset + count));
  const invalid = () => { throw new AvatarSourceError('Фото повреждено или не удалось прочитать его размеры. Выберите другое фото.'); };
  let mime: AvatarMetadata['mime'], width = 0, height = 0, orientation = 1;
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
    width = v.getUint32(16); height = v.getUint32(20);
    for (let p = 8; p < a.length;) {
      if (p + 12 > a.length) invalid();
      const n = v.getUint32(p);
      if (n > a.length - p - 12) invalid();
      if (ascii(p + 4, 4) === 'acTL') throw new AvatarSourceError(FORMATS);
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
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (a[d]! & 2))) throw new AvatarSourceError(FORMATS);
      if (kind === 'EXIF') exif(d, d + n);
      if (kind === 'VP8X' && n >= 10) { width = 1 + a[d + 4]! + (a[d + 5]! << 8) + (a[d + 6]! << 16); height = 1 + a[d + 7]! + (a[d + 8]! << 8) + (a[d + 9]! << 16); }
      else if (!width && kind === 'VP8 ' && n >= 10 && ascii(d + 3, 3) === '\x9d\x01\x2a') { width = v.getUint16(d + 6, true) & 0x3fff; height = v.getUint16(d + 8, true) & 0x3fff; }
      else if (!width && kind === 'VP8L' && n >= 5 && a[d] === 0x2f) { const bits = v.getUint32(d + 1, true); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
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
        height = v.getUint16(p + 3); width = v.getUint16(p + 5);
      }
      if (marker === 0xe1 && n >= 16 && ascii(p + 2, 6) === 'Exif\0\0') {
        exif(p + 2, p + n);
      }
      p += n;
    }
  } else throw new AvatarSourceError(FORMATS);
  if (declaredType && declaredType !== mime) throw new AvatarSourceError(FORMATS);
  if (!width || !height) invalid();
  if (width * height > AVATAR_SOURCE_MAX_PIXELS) throw new AvatarSourceError('Фото должно быть не больше 50 Мп. Выберите фото меньшего размера.');
  return { mime, width, height, orientation };
}

/** Settles even for browser decoders/encoders that never call back; releases late bitmap results. */
export function avatarAbortable<T>(promise: Promise<T>, signal: AbortSignal, releaseLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); } };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => {
      if (settled) { releaseLate?.(value); return; }
      settled = true; signal.removeEventListener('abort', abort); resolve(value);
    }, error => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); reject(error); } });
  });
}

/** Some canvas engines attach a generated ICC profile. Remove metadata containers
 * explicitly as well as avoiding inheritance of the original photo's metadata. */
export function stripAvatarMetadata(bytes: ArrayBuffer, mime: string, orientationOnly = false): Blob {
  const a = new Uint8Array(bytes), v = new DataView(bytes);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  if (mime === 'image/webp') {
    const header = a.slice(0, 12); parts.push(header);
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
    new DataView(header.buffer).setUint32(4, parts.reduce((n, p) => n + p.length, 0) - 8, true);
  } else if (mime === 'image/jpeg') {
    parts.push(a.slice(0, 2));
    for (let p = 2; p < a.length;) {
      const start = p;
      while (a[p] === 0xff) p++;
      const marker = a[p++]!;
      if (marker === 0xda || marker === 0xd9) { parts.push(a.slice(start)); break; }
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(a.slice(start, p)); continue; }
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
  } else throw new AvatarSourceError('Не удалось подготовить формат фото.');
  return new Blob(parts, { type: mime });
}

export async function preprocessAvatar(source: File, parentSignal?: AbortSignal): Promise<Blob> {
  if (!source.size || source.size > AVATAR_SOURCE_MAX_BYTES) throw new AvatarSourceError('Фото должно быть не больше 10 МБ. Выберите фото меньшего размера.');
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new AvatarSourceError('Подготовка фото заняла слишком долго. Попробуйте другое фото.')), AVATAR_PREPROCESS_MS);
  const signal = controller.signal;
  let bitmap: ImageBitmap | undefined, image: HTMLImageElement | undefined, url: string | undefined, canvas: HTMLCanvasElement | undefined;
  try {
    const bytes = await avatarAbortable(source.arrayBuffer(), signal);
    const meta = inspectAvatarSource(bytes, source.type);
    // Browser PNG/WebP/JPEG EXIF support differs. Remove EXIF before decode and
    // explicitly apply its orientation once; preserve source color profiles for decode.
    const input = stripAvatarMetadata(bytes, meta.mime, true);
    // Request downsampling to cap the canvas-side bitmap; engines may still use a full bounded source decode.
    let drawable: CanvasImageSource, width: number, height: number;
    if (typeof createImageBitmap === 'function') {
      const w = meta.width, h = meta.height;
      const scale = Math.min(1, 2048 / Math.max(w, h));
      try { bitmap = await avatarAbortable(createImageBitmap(input, { imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(w * scale)), resizeHeight: Math.max(1, Math.round(h * scale)), resizeQuality: 'high' }), signal, late => late.close()); }
      catch { if (signal.aborted) throw signal.reason; /* Older engines may not support bitmap options. */ }
    }
    if (bitmap) { drawable = bitmap; width = bitmap.width; height = bitmap.height; }
    else {
      image = new Image(); url = URL.createObjectURL(input);
      const loaded = new Promise<void>((resolve, reject) => { image!.onload = () => resolve(); image!.onerror = () => reject(new AvatarSourceError('Не удалось прочитать фото на этом устройстве. Сохраните его как JPEG и попробуйте снова.')); image!.src = url!; });
      await avatarAbortable(loaded, signal);
      drawable = image; width = image.naturalWidth; height = image.naturalHeight;
    }
    if (!width || !height) throw new AvatarSourceError('Не удалось прочитать фото. Выберите другое фото.');
    canvas = document.createElement('canvas'); canvas.width = SIZE; canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new AvatarSourceError('Не удалось подготовить фото на этом устройстве.');
    // A centered square commutes with rotation/mirroring. Map that square into
    // the oriented output coordinates rather than trusting decoder EXIF behavior.
    const side = Math.min(width, height);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, SIZE, SIZE);
    const orientationTransforms: [number, number, number, number, number, number][] = [
      [-1, 0, 0, 1, SIZE, 0], [-1, 0, 0, -1, SIZE, SIZE], [1, 0, 0, -1, 0, SIZE],
      [0, 1, 1, 0, 0, 0], [0, 1, -1, 0, SIZE, 0], [0, -1, -1, 0, SIZE, SIZE], [0, -1, 1, 0, 0, SIZE],
    ];
    if (meta.orientation !== 1) context.setTransform(...orientationTransforms[meta.orientation - 2]!);
    context.drawImage(drawable, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    for (const mime of ['image/webp', 'image/jpeg']) {
      for (const quality of [0.9, 0.8, 0.65, 0.5, 0.35]) {
        const result = await avatarAbortable(new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, mime, quality)), signal);
        if (!result || result.type !== mime) break; // e.g. unsupported WebP silently returns PNG.
        if (result.size) {
          const bytes = await avatarAbortable(result.arrayBuffer(), signal);
          const encoded = inspectAvatarSource(bytes, result.type);
          const stripped = stripAvatarMetadata(bytes, result.type);
          if (encoded.width === SIZE && encoded.height === SIZE && encoded.orientation === 1 && stripped.size <= AVATAR_DERIVATIVE_MAX_BYTES) return stripped;
          if (stripped.size > AVATAR_DERIVATIVE_MAX_BYTES) continue;
          break;
        }
      }
    }
    throw new AvatarSourceError('Не удалось уменьшить фото. Выберите другое фото и попробуйте ещё раз.');
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof AvatarSourceError) throw error;
    throw new AvatarSourceError('Не удалось подготовить фото. Выберите другое фото или сохраните его как JPEG.');
  } finally {
    clearTimeout(timer); parentSignal?.removeEventListener('abort', abort);
    bitmap?.close();
    if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
    if (url) URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
