import { describe, expect, it } from 'vitest';
import { AdminAction, AdminActivity, AdminActivityQuery } from './activity';

const at = '2026-10-22T12:00:00.000Z';

const created = {
  id: 'act_1',
  action: 'created' as const,
  targetType: 'bot',
  targetId: 'bot_1',
  summary: 'Created bot "Capy"',
  actor: 'local',
  at,
};

describe('AdminAction', () => {
  it('lists exactly the audited writes', () => {
    expect(AdminAction.options).toEqual(['created', 'updated', 'deleted', 'revoked', 'ran']);
  });
});

describe('AdminActivity', () => {
  it('round-trips a created activity', () => {
    expect(AdminActivity.parse(JSON.parse(JSON.stringify(created)))).toEqual(created);
  });

  it('allows a settings entry without a targetId and an actor that is a device name', () => {
    const settings = { ...created, action: 'updated' as const, targetType: 'settings', actor: 'iPhone' };
    const { targetId: _ignored, ...withoutId } = settings;
    expect(AdminActivity.parse(withoutId)).toEqual(withoutId);
  });

  it('rejects an unknown action and a summary above 300 characters', () => {
    expect(() => AdminActivity.parse({ ...created, action: 'opened' })).toThrow();
    expect(() => AdminActivity.parse({ ...created, summary: 'x'.repeat(301) })).toThrow();
    expect(() => AdminActivity.parse({ ...created, summary: '' })).toThrow();
  });
});

describe('AdminActivityQuery', () => {
  it('defaults the limit to 50 and coerces query strings', () => {
    expect(AdminActivityQuery.parse({})).toEqual({ limit: 50 });
    expect(AdminActivityQuery.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(AdminActivityQuery.parse({ limit: '200' })).toEqual({ limit: 200 });
    expect(() => AdminActivityQuery.parse({ limit: '0' })).toThrow();
    expect(() => AdminActivityQuery.parse({ limit: '201' })).toThrow();
    expect(() => AdminActivityQuery.parse({ limit: 'abc' })).toThrow();
    expect(() => AdminActivityQuery.parse({ limit: '1.5' })).toThrow();
  });
});
