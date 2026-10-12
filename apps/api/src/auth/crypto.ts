import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const AES_ALGO = "aes-256-gcm";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256Hex(pepper: string, value: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function hashSecret(pepper: string, secret: string): string {
  return hmacSha256Hex(pepper, secret);
}

export function secretsEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length !== rightBuf.length) {
    // Compare against self to keep timing closer to constant for length mismatches.
    timingSafeEqual(leftBuf, leftBuf);
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

export function hashedSecretsEqual(
  pepper: string,
  plain: string,
  expectedHash: string,
): boolean {
  return secretsEqual(hashSecret(pepper, plain), expectedHash);
}

function deriveAesKey(pepper: string): Buffer {
  return createHash("sha256").update(`gobadminton-auth-aes:${pepper}`, "utf8").digest();
}

/** Encrypt short secrets at rest (PKCE verifier). Format: v1.<iv>.<tag>.<ciphertext> base64url. */
export function sealSecret(pepper: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, deriveAesKey(pepper), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function openSecret(pepper: string, payload: string): string {
  const [version, ivB64, tagB64, bodyB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !bodyB64) {
    throw new Error("Invalid sealed secret format");
  }
  const decipher = createDecipheriv(
    AES_ALGO,
    deriveAesKey(pepper),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bodyB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}
