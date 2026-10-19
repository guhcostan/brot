import { x25519 } from '@noble/curves/ed25519.js';

export interface DeviceKeys {
  /** base64url X25519 secret key. Stays in the phone's secure store. */
  secretKey: string;
  /** base64url X25519 public key. Sent to the server at pairing. */
  publicKey: string;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 section 5 base64url, unpadded. React Native has no Buffer, so this stays dependency-free. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 0b111111]!;
  }
  return out;
}

/**
 * The device's long-lived X25519 identity (docs/REMOTE-CONTROL.md, pairing step 4). The server
 * records the public half today; the relay handshake will use the pair later.
 * `randomBytes` must be a CSPRNG, e.g. expo-crypto's getRandomBytes.
 */
export function createDeviceKeys(randomBytes: (length: number) => Uint8Array): DeviceKeys {
  const secret = randomBytes(32);
  if (secret.length !== 32) throw new Error('Expected 32 random bytes for the device key');
  return { secretKey: toBase64Url(secret), publicKey: toBase64Url(x25519.getPublicKey(secret)) };
}
