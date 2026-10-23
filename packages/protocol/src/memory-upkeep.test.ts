import { describe, expect, it } from 'vitest';
import { ApplyMemoryUpkeep, MemoryUpkeepReport, MemoryUpkeepScope } from './memory-upkeep';
import type { Memory } from './entities';

const at = '2026-10-22T12:00:00.000Z';

function memory(id: string, content: string): Memory {
  return { id, botId: 'bot_1', scope: 'bot', kind: 'fact', content, createdAt: at, updatedAt: at };
}

describe('MemoryUpkeepScope', () => {
  it('needs a bot for a bot scope and refuses one for the workspace', () => {
    expect(MemoryUpkeepScope.parse({ scope: 'bot', botId: 'bot_1' })).toEqual({ scope: 'bot', botId: 'bot_1' });
    expect(MemoryUpkeepScope.parse({ scope: 'workspace' })).toEqual({ scope: 'workspace' });
    expect(() => MemoryUpkeepScope.parse({ scope: 'bot' })).toThrow(/needs a botId/);
    expect(() => MemoryUpkeepScope.parse({ scope: 'workspace', botId: 'bot_1' })).toThrow(/no botId/);
    expect(() => MemoryUpkeepScope.parse({ scope: 'team' })).toThrow();
    expect(() => MemoryUpkeepScope.parse({})).toThrow();
    expect(() => MemoryUpkeepScope.parse({ scope: 'bot', botId: '' })).toThrow();
  });
});

describe('MemoryUpkeepReport', () => {
  it('round-trips a report and rejects negative counts', () => {
    const report = {
      scope: 'bot' as const,
      botId: 'bot_1',
      total: 3,
      removable: 2,
      groups: [
        {
          kind: 'fact' as const,
          keep: memory('m3', 'Likes tea'),
          remove: [memory('m2', 'likes tea.'), memory('m1', 'Likes  tea')],
        },
      ],
    };
    expect(MemoryUpkeepReport.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(() => MemoryUpkeepReport.parse({ ...report, removable: -1 })).toThrow();
    expect(() => MemoryUpkeepReport.parse({ ...report, groups: [{ kind: 'fact', keep: report.groups[0]?.keep }] })).toThrow();
  });

  it('keeps the workspace report free of a botId', () => {
    const parsed = MemoryUpkeepReport.parse({ scope: 'workspace', total: 0, removable: 0, groups: [] });
    expect(parsed.botId).toBeUndefined();
  });
});

describe('ApplyMemoryUpkeep', () => {
  it('requires a scope-valid body and 1..200 ids', () => {
    expect(ApplyMemoryUpkeep.parse({ scope: 'bot', botId: 'bot_1', removeIds: ['m1'] })).toEqual({
      scope: 'bot',
      botId: 'bot_1',
      removeIds: ['m1'],
    });
    expect(ApplyMemoryUpkeep.parse({ scope: 'workspace', removeIds: ['m1', 'm2'] }).removeIds).toEqual(['m1', 'm2']);
    expect(() => ApplyMemoryUpkeep.parse({ scope: 'bot', removeIds: ['m1'] })).toThrow(/needs a botId/);
    expect(() => ApplyMemoryUpkeep.parse({ scope: 'workspace', botId: 'bot_1', removeIds: ['m1'] })).toThrow(/no botId/);
    expect(() => ApplyMemoryUpkeep.parse({ scope: 'workspace', removeIds: [] })).toThrow();
    expect(() => ApplyMemoryUpkeep.parse({ scope: 'workspace', removeIds: [''] })).toThrow();
    expect(() =>
      ApplyMemoryUpkeep.parse({ scope: 'workspace', removeIds: Array.from({ length: 201 }, (_, index) => `m${index}`) }),
    ).toThrow();
  });
});
