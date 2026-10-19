import { describe, expect, it } from 'vitest';
import {
  CreateBot,
  CreateRoutine,
  PairingComplete,
  PostMessage,
  ResolveApproval,
  UpdateBot,
} from './requests';

describe('request schemas', () => {
  it('applies CreateBot defaults', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' })).toEqual({
      name: 'Ada',
      job: 'Researcher',
      instructions: '',
      engine: 'mock',
      computer: 'sandbox',
      egress: { mode: 'deny', allow: [] },
    });
  });

  it('gives each parsed CreateBot its own egress object', () => {
    const first = CreateBot.parse({ name: 'Ada', job: 'Researcher' });
    const second = CreateBot.parse({ name: 'Grace', job: 'Researcher' });
    first.egress.allow.push('example.com');
    expect(second.egress.allow).toEqual([]);
  });

  it('requires hostAcknowledged for computer host on CreateBot', () => {
    const base = { name: 'Ada', job: 'Researcher', computer: 'host' };
    expect(() => CreateBot.parse(base)).toThrow(/hostAcknowledged/);
    expect(() => CreateBot.parse({ ...base, hostAcknowledged: false })).toThrow(/hostAcknowledged/);
    expect(CreateBot.parse({ ...base, hostAcknowledged: true }).computer).toBe('host');
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', computer: 'none' }).computer).toBe('none');
  });

  it('validates egress on CreateBot', () => {
    expect(() =>
      CreateBot.parse({ name: 'Ada', job: 'x', egress: { mode: 'allowlist', allow: ['https://github.com'] } }),
    ).toThrow();
    expect(
      CreateBot.parse({ name: 'Ada', job: 'x', egress: { mode: 'allowlist', allow: ['*.github.com'] } }).egress,
    ).toEqual({ mode: 'allowlist', allow: ['*.github.com'] });
  });

  it('requires hostAcknowledged for computer host on UpdateBot only when computer is set', () => {
    expect(() => UpdateBot.parse({ computer: 'host' })).toThrow(/hostAcknowledged/);
    expect(UpdateBot.parse({ computer: 'host', hostAcknowledged: true })).toEqual({
      computer: 'host',
      hostAcknowledged: true,
    });
    expect(UpdateBot.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(UpdateBot.parse({ egress: { mode: 'deny', allow: [] } })).toEqual({ egress: { mode: 'deny', allow: [] } });
    expect(() => UpdateBot.parse({ egress: { mode: 'deny', allow: ['example.com'] } })).toThrow();
  });

  it('requires name and job on CreateBot', () => {
    expect(() => CreateBot.parse({ job: 'Researcher' })).toThrow();
    expect(() => CreateBot.parse({ name: 'Ada', job: '' })).toThrow();
  });

  it('keeps UpdateBot fields optional', () => {
    expect(UpdateBot.parse({ pinned: true })).toEqual({ pinned: true });
    expect(() => UpdateBot.parse({ computer: 'cloud' })).toThrow();
  });

  it('requires non-empty message content', () => {
    expect(PostMessage.parse({ content: 'hi' })).toEqual({ content: 'hi' });
    expect(() => PostMessage.parse({ content: '' })).toThrow();
  });

  it('validates approval decisions', () => {
    expect(ResolveApproval.parse({ decision: 'allow_always' })).toEqual({ decision: 'allow_always' });
    expect(() => ResolveApproval.parse({ decision: 'maybe' })).toThrow();
  });

  it('defaults routine enabled to true and pairing role to full', () => {
    const routine = CreateRoutine.parse({
      botId: 'bot_1',
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    expect(routine.enabled).toBe(true);

    const pairing = PairingComplete.parse({ token: 't', deviceName: 'Phone', publicKey: 'pk' });
    expect(pairing.role).toBe('full');
  });
});
