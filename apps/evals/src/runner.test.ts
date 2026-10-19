import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { BrotApi } from './api';
import { notableEventsOf, preflight, skipReasonFor } from './runner';
import { standardPolicy } from './approvals';
import type { RunOptions } from './args';
import type { Case } from './types';

const options: RunOptions = {
  base: 'http://127.0.0.1:1',
  model: 'opencode-go/deepseek-v4.1-flash',
  engine: 'dsh',
  out: '/tmp/unused',
  maxUsd: 5,
  caseTimeoutMs: 1000,
  pollMs: 1,
  keepComputers: false,
  list: false,
  help: false,
};

describe('preflight', () => {
  it('says which server it tried when none answers', async () => {
    const down = new BrotApi('http://127.0.0.1:1', (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(preflight(down, options)).rejects.toThrow(/No Brot server answers at http:\/\/127\.0\.0\.1:1/);
  });

  it('refuses the dsh engine when the provider key is not stored', async () => {
    const api = new BrotApi('http://brot.test', (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return new Response(JSON.stringify({ ok: true, version: '0.1.0', protocol: 1 }));
      if (url.endsWith('/api/engines')) return new Response(JSON.stringify([{ id: 'dsh', availability: { available: true } }]));
      if (url.endsWith('/api/secrets')) return new Response(JSON.stringify([]));
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    await expect(preflight(api, options)).rejects.toThrow(/no key for provider "opencode-go"/);
  });
});

describe('notableEventsOf', () => {
  it('lists blocked hosts, computer errors, failed runs and handoffs, and nothing else', () => {
    const events = [
      { id: '1', type: 'network.blocked', at: '2026-10-19T10:00:00.000Z', threadId: 't', botId: 'b1', host: 'x.com' },
      { id: '2', type: 'computer.status', at: '2026-10-19T10:00:01.000Z', threadId: 't', computerId: 'c', botId: 'b1', state: 'error', reason: 'exited' },
      { id: '3', type: 'run.failed', at: '2026-10-19T10:00:02.000Z', threadId: 't', error: 'server restarted' },
      { id: '4', type: 'handoff', at: '2026-10-19T10:00:03.000Z', threadId: 't', fromBotId: 'b1', toBotId: 'b2' },
      { id: '5', type: 'message.delta', at: '2026-10-19T10:00:04.000Z', threadId: 't', messageId: 'm', delta: 'hi' },
    ] as CanonicalEvent[];
    const names: Record<string, string> = { b1: 'onca', b2: 'tuca' };
    expect(notableEventsOf(events, (id) => names[id] ?? id)).toEqual([
      'network.blocked: onca tried x.com',
      'computer.status: onca error exited',
      'run.failed: server restarted',
      'handoff: onca to tuca',
    ]);
  });
});

describe('skipReasonFor', () => {
  it('gives later and gap cases a reason, and runs the rest', () => {
    const base: Pick<Case, 'id' | 'title' | 'status' | 'setup' | 'run' | 'check'> = {
      id: 'X',
      title: 'x',
      status: 'now',
      setup: async () => undefined,
      run: async () => undefined,
      check: () => [],
    };
    expect(skipReasonFor(base)).toBeUndefined();
    expect(skipReasonFor({ ...base, status: 'later', note: 'needs a model route' })).toBe('later: needs a model route');
    expect(skipReasonFor({ ...base, status: 'gap' })).toBe('gap: the product does not have this yet');
  });

  it('gives a policy a name for the report', () => {
    expect(standardPolicy().name).toBe('standard');
  });
});
