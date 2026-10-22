import { describe, expect, it } from 'vitest';
import { base32Decode, normalizeBase32, totpCode, totpWindow } from './totp';

/** RFC 6238 Appendix B: the ASCII secret "12345678901234567890" in base32. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('decodes the RFC 4648 test vectors', () => {
    const vectors: Array<[string, string]> = [
      ['MY======', 'f'],
      ['MZXQ====', 'fo'],
      ['MZXW6===', 'foo'],
      ['MZXW6YQ=', 'foob'],
      ['MZXW6YTB', 'fooba'],
      ['MZXW6YTBOI======', 'foobar'],
    ];
    for (const [encoded, decoded] of vectors) {
      expect(base32Decode(encoded).toString('utf8')).toBe(decoded);
    }
  });

  it('normalizes a key a person pasted with spaces, dashes and lowercase', () => {
    expect(normalizeBase32(' jbsw y3dp-ehpk 3pxp ')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses anything that is not base32', () => {
    expect(() => base32Decode('not base32!')).toThrow(/base32/);
    expect(() => normalizeBase32('')).toThrow(/base32/);
  });
});

describe('TOTP (RFC 6238)', () => {
  /** The RFC's SHA-1 test vectors: eight digits at the listed unix times. */
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it('matches every RFC test vector', () => {
    for (const [seconds, expected] of vectors) {
      expect(totpCode(RFC_SECRET, { digits: 8, at: seconds * 1000 })).toBe(expected);
    }
  });

  it('defaults to six digits and the current step', () => {
    // The six-digit code is the low six digits of the eight-digit one at the same step.
    expect(totpCode(RFC_SECRET, { at: 59_000 })).toBe('287082');
    expect(totpCode(RFC_SECRET)).toMatch(/^\d{6}$/);
  });

  it('exposes the previous and next step for a verifier acceptance window', () => {
    const at = 1_111_111_109_000;
    const window = totpWindow(RFC_SECRET, at);
    expect(window).toHaveLength(3);
    expect(window[1]).toBe(totpCode(RFC_SECRET, { at }));
    expect(window[0]).toBe(totpCode(RFC_SECRET, { at: at - 30_000 }));
    expect(window[2]).toBe(totpCode(RFC_SECRET, { at: at + 30_000 }));
  });
});
