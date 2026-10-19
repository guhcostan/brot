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
      computer: 'none',
    });
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
