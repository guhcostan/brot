import { describe, expect, it } from 'vitest';
import type { Policy } from '@brot/protocol';
import { matchesPolicy, verdictFor } from './broker';

function policy(overrides: Partial<Policy>): Policy {
  return {
    id: 'p',
    botId: 'b',
    tool: 'shell',
    effect: 'allow',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const request = { tool: 'shell', args: { command: 'git push origin main' } };

describe('policy matching', () => {
  it('matches the tool exactly or through the * wildcard', () => {
    expect(matchesPolicy(policy({ tool: 'shell' }), request)).toBe(true);
    expect(matchesPolicy(policy({ tool: 'browser' }), request)).toBe(false);
    expect(matchesPolicy(policy({ tool: '*' }), request)).toBe(true);
  });

  it('matches argPattern against the JSON-encoded args', () => {
    expect(matchesPolicy(policy({ argPattern: 'git push' }), request)).toBe(true);
    expect(matchesPolicy(policy({ argPattern: 'rm -rf' }), request)).toBe(false);
  });

  it('treats an invalid argPattern as no match', () => {
    expect(matchesPolicy(policy({ argPattern: '([' }), request)).toBe(false);
  });
});

describe('verdicts', () => {
  it('asks when no policy matches', () => {
    expect(verdictFor([], request)).toBe('ask');
    expect(verdictFor([policy({ tool: 'browser' })], request)).toBe('ask');
  });

  it('allows on a matching allow policy', () => {
    expect(verdictFor([policy({ effect: 'allow' })], request)).toBe('allow');
  });

  it('lets a matching deny win over a matching allow', () => {
    const policies = [policy({ effect: 'allow' }), policy({ effect: 'deny', argPattern: 'push' })];
    expect(verdictFor(policies, request)).toBe('deny');
  });
});
