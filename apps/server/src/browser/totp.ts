import { createHmac } from 'node:crypto';

/** RFC 6238 defaults: SHA-1, 6 digits and 30-second steps. */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Uppercases a pasted base32 key and strips the spaces and dashes people use to group it. */
export function normalizeBase32(secret: string): string {
  const clean = secret.replace(/[\s-]/g, '').toUpperCase();
  if (clean.length === 0 || !/^[A-Z2-7]+=*$/.test(clean)) throw new Error('a TOTP secret must be base32');
  return clean;
}

/** Decodes RFC 4648 base32 (padding optional). Throws on anything that is not base32. */
export function base32Decode(secret: string): Buffer {
  const clean = normalizeBase32(secret).replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('a TOTP secret must be base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  /** Seconds per step. Default 30. */
  stepSeconds?: number;
  /** Code length. Default 6; RFC 6238's test vectors use 8. */
  digits?: number;
  /** The moment to compute the code for, in milliseconds. Default now. */
  at?: number;
}

/** The RFC 6238 one-time code for a base32 secret. */
export function totpCode(secret: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? TOTP_DIGITS;
  const stepSeconds = options.stepSeconds ?? TOTP_STEP_SECONDS;
  const counter = Math.floor((options.at ?? Date.now()) / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The codes one step before, at, and one step after `at`: the window a TOTP verifier usually accepts. */
export function totpWindow(secret: string, at = Date.now(), options: Omit<TotpOptions, 'at'> = {}): string[] {
  const stepMs = (options.stepSeconds ?? TOTP_STEP_SECONDS) * 1000;
  return [-1, 0, 1].map((offset) => totpCode(secret, { ...options, at: at + offset * stepMs }));
}
