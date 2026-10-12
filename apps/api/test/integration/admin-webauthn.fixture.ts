import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
const hash = (b: string | Buffer) => createHash("sha256").update(b).digest();
const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
// Synthetic authenticator: real P-256 signatures and CBOR attestation, no verifier override.
export class SyntheticAuthenticator {
  readonly credential = randomBytes(32);
  readonly id = b64(this.credential);
  readonly pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  counter = 0;
  publicKey() {
    const jwk = this.pair.publicKey.export({ format: "jwk" });
    return Buffer.from(
      isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      ),
    );
  }
  register(challenge: string, origin = "http://localhost:18540", uv = true) {
    const clientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const count = Buffer.alloc(4),
      len = Buffer.alloc(2);
    len.writeUInt16BE(this.credential.length);
    const authData = Buffer.concat([
      hash("localhost"),
      Buffer.from([uv ? 0x45 : 0x41]),
      count,
      Buffer.alloc(16),
      len,
      this.credential,
      this.publicKey(),
    ]);
    const attestation = isoCBOR.encode(
      new Map<string, string | Map<string, never> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientData),
        attestationObject: b64(attestation),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
  assert(
    challenge: string,
    opts: {
      origin?: string;
      rpId?: string;
      uv?: boolean;
      counter?: number;
      invalidSignature?: boolean;
    } = {},
  ) {
    const clientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: opts.origin ?? "http://localhost:18540",
        crossOrigin: false,
      }),
    );
    const count = Buffer.alloc(4);
    count.writeUInt32BE(opts.counter ?? ++this.counter);
    const authData = Buffer.concat([
      hash(opts.rpId ?? "localhost"),
      Buffer.from([opts.uv === false ? 0x01 : 0x05]),
      count,
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, hash(clientData)]),
      this.pair.privateKey,
    );
    if (opts.invalidSignature)
      signature[signature.length - 1] = signature[signature.length - 1]! ^ 1;
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
