import { x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { createDeviceKeys, toBase64Url } from './keys';

describe('toBase64Url', () => {
  it('matches RFC 4648 test vectors without padding', () => {
    const enc = (s: string) => toBase64Url(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg');
    expect(enc('fo')).toBe('Zm8');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foobar')).toBe('Zm9vYmFy');
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});

describe('createDeviceKeys', () => {
  it('derives the X25519 public key from 32 random bytes', () => {
    const secret = new Uint8Array(32).map((_, i) => i + 1);
    const keys = createDeviceKeys(() => secret);
    expect(keys.secretKey).toBe(toBase64Url(secret));
    expect(keys.publicKey).toBe(toBase64Url(x25519.getPublicKey(secret)));
    expect(keys.publicKey).toHaveLength(43);
  });

  it('refuses a short random source', () => {
    expect(() => createDeviceKeys(() => new Uint8Array(16))).toThrow();
  });
});
