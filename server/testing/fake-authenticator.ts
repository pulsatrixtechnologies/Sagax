// A software WebAuthn authenticator for tests (P-256, "none" attestation):
// it makes the browser's answers a real security key would, so the server's
// verification runs unchanged. Never used outside tests.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [key: string]: Cbor };

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) return Buffer.from([(major << 5) | 25, value >> 8, value & 0xff]);
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(value, 1);
  return out;
}

/** The few CBOR shapes WebAuthn needs: integers, text, bytes, arrays, maps. */
export function cbor(value: Cbor): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

export interface FakeAuthenticator {
  credentialId: string;
  counter: number;
  /** The browser's answer to navigator.credentials.create(). */
  register(options: { challenge: string; rp?: { id?: string } }, origin: string, rpId?: string): Record<string, unknown>;
  /** The browser's answer to navigator.credentials.get(). */
  assert(options: { challenge: string; rpId?: string }, origin: string, rpId?: string, flags?: { userVerified?: boolean }): Record<string, unknown>;
}

export function fakeAuthenticator(): FakeAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }) as { privateKey: KeyObject; publicKey: KeyObject };
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const credentialIdBytes = randomBytes(32);
  const cose = cbor(new Map<Cbor, Cbor>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")],
    [-3, Buffer.from(jwk.y, "base64url")],
  ]));
  const self: FakeAuthenticator = {
    credentialId: b64url(credentialIdBytes),
    counter: 0,
    register(options, origin, rpId) {
      const id = rpId ?? options.rp?.id ?? "localhost";
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4);
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialIdBytes.length);
      const authData = Buffer.concat([sha256(id), Buffer.from([0x01 | 0x04 | 0x40]), count, Buffer.alloc(16), idLength, credentialIdBytes, cose]);
      const attestationObject = cbor({ fmt: "none", attStmt: {}, authData });
      return {
        id: self.credentialId,
        rawId: self.credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestationObject), transports: ["usb"] },
      };
    },
    assert(options, origin, rpId, flags) {
      const id = rpId ?? options.rpId ?? "localhost";
      self.counter += 1;
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
      const count = Buffer.alloc(4);
      count.writeUInt32BE(self.counter);
      const authData = Buffer.concat([sha256(id), Buffer.from([flags?.userVerified === false ? 0x01 : 0x01 | 0x04]), count]);
      const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
      return {
        id: self.credentialId,
        rawId: self.credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(signature) },
      };
    },
  };
  return self;
}
