import { describe, expect, it } from 'vitest';
import { defaultEgressPolicy, EgressHost, EgressPolicy, MAX_EGRESS_HOSTS } from './egress';

describe('EgressHost', () => {
  it.each(['github.com', 'api.github.com', '*.github.com', 'xn--bcher-kva.example', 'a-b.c-d.co.uk'])(
    'accepts %s',
    (host) => {
      expect(EgressHost.parse(host)).toBe(host);
    },
  );

  it('trims and lowercases', () => {
    expect(EgressHost.parse('  API.GitHub.COM ')).toBe('api.github.com');
  });

  it.each([
    ['a URL', 'https://github.com'],
    ['a scheme-relative URL', '//github.com'],
    ['a path', 'github.com/api'],
    ['a query', 'github.com?x=1'],
    ['credentials', 'user@github.com'],
    ['a port', 'github.com:443'],
    ['an IPv4 literal', '140.82.112.3'],
    ['a private IPv4 literal', '10.0.0.1'],
    ['an IPv6 literal', '[::1]'],
    ['localhost', 'localhost'],
    ['a name under localhost', 'api.localhost'],
    ['a .local name', 'printer.local'],
    ['a .internal name (metadata)', 'metadata.google.internal'],
    ['a single label', 'intranet'],
    ['a bare wildcard', '*'],
    ['a wildcard on a TLD only', '*.com'],
    ['a wildcard not in the leading label', 'api.*.com'],
    ['a partial wildcard', 'a*.github.com'],
    ['a trailing dot', 'github.com.'],
    ['a leading hyphen', '-bad.com'],
    ['an underscore', 'bad_host.com'],
    ['an all-numeric TLD', 'example.123'],
    ['an empty string', ''],
    ['an over-long name', `${'a'.repeat(64)}.com`],
  ])('rejects %s', (_label, host) => {
    expect(() => EgressHost.parse(host)).toThrow();
  });
});

describe('EgressPolicy', () => {
  it('defaults to a fresh deny-all policy', () => {
    const first = defaultEgressPolicy();
    expect(first).toEqual({ mode: 'deny', allow: [] });
    expect(defaultEgressPolicy()).not.toBe(first);
  });

  it('accepts an allowlist', () => {
    const policy = { mode: 'allowlist', allow: ['api.github.com', '*.example.com'] };
    expect(EgressPolicy.parse(policy)).toEqual(policy);
  });

  it('accepts an empty allowlist', () => {
    expect(EgressPolicy.parse({ mode: 'allowlist', allow: [] })).toEqual({ mode: 'allowlist', allow: [] });
  });

  it('rejects hosts in deny mode', () => {
    expect(() => EgressPolicy.parse({ mode: 'deny', allow: ['github.com'] })).toThrow(/must be empty/);
  });

  it('rejects duplicate hosts, including ones that differ only by case', () => {
    expect(() => EgressPolicy.parse({ mode: 'allowlist', allow: ['github.com', 'GitHub.com'] })).toThrow(
      /duplicate/,
    );
  });

  it('rejects an unknown mode and more than the maximum hosts', () => {
    expect(() => EgressPolicy.parse({ mode: 'allow-all', allow: [] })).toThrow();
    const many = Array.from({ length: MAX_EGRESS_HOSTS + 1 }, (_, i) => `host${i}.example.com`);
    expect(() => EgressPolicy.parse({ mode: 'allowlist', allow: many })).toThrow();
  });

  it('reports the offending host with its index', () => {
    const result = EgressPolicy.safeParse({ mode: 'allowlist', allow: ['github.com', 'https://evil.test'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['allow', 1]);
  });
});
