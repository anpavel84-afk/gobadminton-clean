import sharp from "sharp";
import { problem } from "../auth/problem";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_KEY = /^[a-f0-9]{64}\.png$/;
export async function sanitizeAvatar(input: unknown, mime: string, slot: "avatar" | "cover" = "avatar"): Promise<Buffer> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw problem(422, "AVATAR_INVALID", "Выберите фотографию");
  if (input.length > AVATAR_MAX_BYTES) throw problem(413, "AVATAR_TOO_LARGE", "Фото должно быть не больше 5 МБ");
  const format = input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
    : input[0] === 255 && input[1] === 216 && input[2] === 255 ? "jpeg"
    : input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
  if (!format || mime !== `image/${format}`) throw problem(415, "AVATAR_TYPE", "Выберите JPEG, PNG или WebP");
  if (slot === "cover") {
    // Reject trailing containers and malformed chunk envelopes before decoding.
    if (format === "webp" && (input.length < 12 || input.readUInt32LE(4) + 8 !== input.length)) throw problem(422, "COVER_INVALID", "Фото повреждено");
    if (format === "jpeg") {
      let offset = 2, ended = false, entropy = false;
      while (offset < input.length) {
        if (entropy && input[offset] !== 255) { offset++; continue; }
        if (input[offset++] !== 255) break;
        while (input[offset] === 255) offset++;
        const marker = input[offset++];
        if (entropy && (marker === 0 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7))) continue;
        if (marker === 0xd9) { ended = offset === input.length; break; }
        entropy = false;
        if (marker === 0xd8 || marker === undefined || offset + 2 > input.length) break;
        if (marker === 1) continue;
        const length = input.readUInt16BE(offset);
        if (length < 2 || length > input.length - offset) break;
        offset += length;
        if (marker === 0xda) entropy = true;
      }
      if (!ended) throw problem(422, "COVER_INVALID", "Фото повреждено");
    }
    if (format === "png") {
      let offset = 8, ended = false;
      while (offset + 12 <= input.length) {
        const length = input.readUInt32BE(offset);
        if (length > input.length - offset - 12) break;
        const kind = input.toString("ascii", offset + 4, offset + 8);
        offset += length + 12;
        if (kind === "IEND") { ended = length === 0 && offset === input.length; break; }
      }
      if (!ended) throw problem(422, "COVER_INVALID", "Фото повреждено");
    }
  }
  // APNG is otherwise decoded as a still image by some libpng builds.
  if (format === "png") {
    for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      if (input.toString("ascii", offset + 4, offset + 8) === "acTL") throw problem(422, "AVATAR_INVALID", "Выберите фото без анимации");
      offset += 12 + length;
    }
  }
  try {
    const image = sharp(input, { failOn: "warning", limitInputPixels: 16_000_000, limitInputChannels: 4 });
    const meta = await image.metadata();
    if (meta.format !== format || !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || (meta.pages ?? 1) !== 1) throw new Error("dimensions/frames");
    // Decode and re-encode: default sharp output strips EXIF/XMP/ICC and ancillary metadata.
    const sanitized = await image.rotate().resize(slot === "cover" ? 1200 : 512, slot === "cover" ? 400 : 512, { fit: "cover" }).png().timeout({ seconds: 10 }).toBuffer();
    if (sanitized.length > 2 * 1024 * 1024) throw new Error("derivative size");
    return sanitized;
  } catch {
    throw problem(422, "AVATAR_INVALID", "Не удалось прочитать фото. Максимум 16 Мп и 8192 пикселя по стороне, без анимации.");
  }
}
