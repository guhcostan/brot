import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  decideNavigation,
  isLoopbackHost,
  isLoopbackOrigin,
  isSafeExternalUrl,
} from './security';

const APP = 'http://127.0.0.1:8798';

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name)
    ?.slice(name.length)
    .trim();
}

describe('decideNavigation', () => {
  it('keeps same-origin navigation in the window', () => {
    expect(decideNavigation('http://127.0.0.1:8798/chat/abc?x=1', APP)).toBe('allow');
  });

  it('sends web and mail links to the system browser', () => {
    expect(decideNavigation('https://example.com/docs', APP)).toBe('open-external');
    expect(decideNavigation('http://127.0.0.1:9999/other', APP)).toBe('open-external');
    expect(decideNavigation('mailto:team@example.com', APP)).toBe('open-external');
  });

  it('blocks other schemes and anything that does not parse', () => {
    expect(decideNavigation('file:///etc/passwd', APP)).toBe('block');
    expect(decideNavigation('javascript:alert(1)', APP)).toBe('block');
    expect(decideNavigation('data:text/html,hi', APP)).toBe('block');
    expect(decideNavigation('not a url', APP)).toBe('block');
  });
});

describe('isSafeExternalUrl', () => {
  it('allows only http, https and mailto', () => {
    expect(isSafeExternalUrl('https://brot.dev')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.co')).toBe(true);
    expect(isSafeExternalUrl('file:///Applications/Calculator.app')).toBe(false);
    expect(isSafeExternalUrl('javascript:void(0)')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });
});

describe('loopback host and origin checks', () => {
  it('accepts only the gateway own loopback names', () => {
    expect(isLoopbackHost('127.0.0.1:8798', 8798)).toBe(true);
    expect(isLoopbackHost('LocalHost:8798', 8798)).toBe(true);
    expect(isLoopbackHost('evil.test:8798', 8798)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:9', 8798)).toBe(false);
    expect(isLoopbackHost('127.0.0.1', 8798)).toBe(false);
    expect(isLoopbackHost(undefined, 8798)).toBe(false);
  });

  it('accepts only loopback http origins on the gateway port', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:8798', 8798)).toBe(true);
    expect(isLoopbackOrigin('http://localhost:8798', 8798)).toBe(true);
    expect(isLoopbackOrigin('https://localhost:8798', 8798)).toBe(false);
    expect(isLoopbackOrigin('http://evil.test', 8798)).toBe(false);
  });
});

describe('contentSecurityPolicy', () => {
  it('lets the built app load scripts only from its own origin', () => {
    const policy = contentSecurityPolicy({ kind: 'app' });
    expect(directive(policy, 'default-src')).toBe("'none'");
    expect(directive(policy, 'script-src')).toBe("'self'");
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('adds only what the Vite dev server needs, including its HMR websocket', () => {
    const policy = contentSecurityPolicy({ kind: 'dev', origin: 'http://127.0.0.1:5199' });
    expect(directive(policy, 'script-src')).toBe("'self' 'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toBe("'self' ws://127.0.0.1:5199");
    expect(policy).not.toContain('unsafe-eval');
  });
});
