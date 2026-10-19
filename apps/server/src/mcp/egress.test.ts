import { describe, expect, it } from 'vitest';
import { hostAllowed, isForbiddenAddress } from './egress';

describe('hostAllowed', () => {
  const allow = ['api.example.com', '*.github.com'];

  it('matches an exact host, ignoring case and a trailing dot', () => {
    expect(hostAllowed('api.example.com', allow)).toBe(true);
    expect(hostAllowed('API.Example.COM', allow)).toBe(true);
    expect(hostAllowed('api.example.com.', allow)).toBe(true);
  });

  it('does not match a parent or sibling of an exact host', () => {
    expect(hostAllowed('example.com', allow)).toBe(false);
    expect(hostAllowed('www.example.com', allow)).toBe(false);
  });

  it('matches subdomains of a wildcard but not the apex', () => {
    expect(hostAllowed('api.github.com', allow)).toBe(true);
    expect(hostAllowed('a.b.github.com', allow)).toBe(true);
    expect(hostAllowed('github.com', allow)).toBe(false);
  });

  it('does not match a name that merely ends with the wildcard suffix', () => {
    expect(hostAllowed('evilgithub.com', allow)).toBe(false);
    expect(hostAllowed('github.com.evil.net', allow)).toBe(false);
  });

  it('refuses everything with an empty allowlist', () => {
    expect(hostAllowed('api.example.com', [])).toBe(false);
  });
});

describe('isForbiddenAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
  ])('refuses %s', (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isForbiddenAddress(address)).toBe(false);
  });

  it('refuses anything that is not an IP address', () => {
    expect(isForbiddenAddress('example.com')).toBe(true);
    expect(isForbiddenAddress('fe80::1%eth0')).toBe(true);
  });
});
