import { describe, expect, it } from 'vitest';
import {
  ImportTeamPackage,
  TEAM_PACKAGE_FORMAT,
  TEAM_PACKAGE_HEADING,
  TEAM_PACKAGE_IMPORT_MAX_CHARS,
  TEAM_PACKAGE_MAX_BYTES,
  TEAM_PACKAGE_VERSION,
  TeamPackage,
  formatTeamPackage,
  parseTeamPackage,
  type TeamPackage as TeamPackageValue,
} from './team-package';

const exportedAt = '2026-10-22T12:00:00.000Z';

function minimal(): TeamPackageValue {
  return {
    format: TEAM_PACKAGE_FORMAT,
    version: TEAM_PACKAGE_VERSION,
    exportedAt,
    teams: [],
    bots: [{ key: 'b1', name: 'Ada', job: 'Researcher', instructions: 'Be brief.' }],
    rooms: [],
    routines: [],
    skills: [],
  };
}

function full(): TeamPackageValue {
  return {
    format: TEAM_PACKAGE_FORMAT,
    version: TEAM_PACKAGE_VERSION,
    exportedAt,
    teams: [{ key: 't1', name: 'Growth', instructions: 'Ship weekly.', chief: 'b1' }],
    bots: [
      { key: 'b1', name: 'Ada', job: 'Lead', instructions: '', avatar: 'capivara:black', team: 't1' },
      { key: 'b2', name: 'Grace', job: 'Ops', instructions: 'Keep the lights on.' },
    ],
    rooms: [
      { title: 'Launch', lead: 'b1', members: ['b1', 'b2'], responder: 'mention' },
      { title: 'Daily', lead: 'b2', members: ['b2', 'b1'] },
    ],
    routines: [
      {
        bot: 'b1',
        name: 'Digest',
        instruction: 'Summarise.',
        cron: '0 9 * * *',
        timezone: 'America/Sao_Paulo',
        catchUp: false,
        rememberLastRun: true,
        enabled: false,
      },
    ],
    skills: [
      { name: 'Triage', description: 'Sort the inbox', body: '# Triage', bot: 'b1' },
      { name: 'Tone', description: 'House voice', body: '# Tone' },
    ],
  };
}

describe('TeamPackage', () => {
  it('defaults nothing and requires the format marker, version and a bot', () => {
    expect(TeamPackage.parse(minimal())).toEqual(minimal());
    expect(() => TeamPackage.parse({ ...minimal(), format: 'brot.other' })).toThrow();
    expect(() => TeamPackage.parse({ ...minimal(), version: 2 })).toThrow();
    expect(() => TeamPackage.parse({ ...minimal(), bots: [] })).toThrow();
    expect(() => TeamPackage.parse({ ...minimal(), exportedAt: 'yesterday' })).toThrow();
  });

  it('is strict, so unknown fields fail instead of being dropped', () => {
    expect(() => TeamPackage.parse({ ...minimal(), extra: true })).toThrow();
    const bot = minimal().bots[0];
    if (bot === undefined) throw new Error('the fixture needs a bot');
    expect(() => TeamPackage.parse({ ...minimal(), bots: [{ ...bot, model: 'mock-1' }] })).toThrow();
  });

  it('accepts every optional field of a full package', () => {
    expect(TeamPackage.parse(full())).toEqual(full());
  });

  it('rejects duplicate keys per kind and dangling references', () => {
    const pkg = full();
    const [bot] = pkg.bots;
    if (bot === undefined) throw new Error('the fixture needs a bot');
    expect(() => TeamPackage.parse({ ...pkg, bots: [...pkg.bots, bot] })).toThrow(/duplicate bot key/);
    const [team] = pkg.teams;
    if (team === undefined) throw new Error('the fixture needs a team');
    expect(() => TeamPackage.parse({ ...pkg, teams: [...pkg.teams, team] })).toThrow(/duplicate team key/);

    expect(() => TeamPackage.parse({ ...pkg, bots: [{ ...bot, team: 't9' }] })).toThrow(/unknown team/);
    expect(() => TeamPackage.parse({ ...pkg, teams: [{ key: 't1', name: 'Growth', instructions: '', chief: 'b9' }] })).toThrow(
      /unknown bot/,
    );
    expect(() =>
      TeamPackage.parse({ ...pkg, routines: [{ ...pkg.routines[0], bot: 'b9' }] }),
    ).toThrow(/unknown bot/);
    expect(() => TeamPackage.parse({ ...pkg, skills: [{ name: 'x', description: '', body: '', bot: 'b9' }] })).toThrow(
      /unknown bot/,
    );
  });

  it('accepts auto as a responder alias, and rejects an unknown one', () => {
    const pkg = full();
    const [room] = pkg.rooms;
    if (room === undefined) throw new Error('the fixture needs a room');
    expect(TeamPackage.parse({ ...pkg, rooms: [{ ...room, responder: 'auto' }] }).rooms[0]?.responder).toBe('auto');
    expect(() => TeamPackage.parse({ ...pkg, rooms: [{ ...room, responder: 'round-robin' }] })).toThrow();
  });

  it('rejects a room whose lead is unknown, not a member, or listed twice', () => {
    const pkg = full();
    expect(() => TeamPackage.parse({ ...pkg, rooms: [{ title: 'x', lead: 'b9', members: ['b1', 'b2'] }] })).toThrow(
      /unknown bot/,
    );
    expect(() => TeamPackage.parse({ ...pkg, rooms: [{ title: 'x', lead: 'b1', members: ['b2', 'b2'] }] })).toThrow(
      /unknown bot|duplicate/,
    );
    expect(() => TeamPackage.parse({ ...pkg, rooms: [{ title: 'x', lead: 'b2', members: ['b1', 'b2'] }] })).not.toThrow();
    expect(() => TeamPackage.parse({ ...pkg, rooms: [{ title: 'x', lead: 'b9', members: ['b1'] }] })).toThrow();
  });

  it('caps names and instructions', () => {
    const bot = minimal().bots[0];
    if (bot === undefined) throw new Error('the fixture needs a bot');
    expect(() => TeamPackage.parse({ ...minimal(), bots: [{ ...bot, name: 'x'.repeat(501) }] })).toThrow();
    expect(() => TeamPackage.parse({ ...minimal(), bots: [{ ...bot, instructions: 'x'.repeat(50_001) }] })).toThrow();
    expect(TeamPackage.parse(full()).bots[0]?.avatar).toBe('capivara:black');
  });
});

describe('formatTeamPackage and parseTeamPackage', () => {
  it('writes the heading and one fenced json block, and reads it back', () => {
    const markdown = formatTeamPackage(full());
    expect(markdown.startsWith(`${TEAM_PACKAGE_HEADING}\n\n\`\`\`json\n`)).toBe(true);
    expect(markdown.endsWith('\n```\n')).toBe(true);
    expect(parseTeamPackage(markdown)).toEqual({ ok: true, package: full() });
  });

  it('accepts the same JSON without the Markdown wrapper', () => {
    expect(parseTeamPackage(JSON.stringify(minimal()))).toEqual({ ok: true, package: minimal() });
  });

  it('accepts a routine that claims to be enabled; the importer pauses it anyway', () => {
    const pkg = full();
    const [routine] = pkg.routines;
    if (routine === undefined) throw new Error('the fixture needs a routine');
    const parsed = parseTeamPackage(JSON.stringify({ ...pkg, routines: [{ ...routine, enabled: true }] }));
    expect(parsed.ok && parsed.package.routines[0]?.enabled).toBe(true);
  });

  it('rejects an empty file, a missing wrapper, invalid JSON, and a malformed package', () => {
    const empty = parseTeamPackage('   ');
    expect(empty.ok).toBe(false);
    const noBlock = parseTeamPackage('# Brot team package\n\nnothing here');
    expect(noBlock.ok).toBe(false);
    if (noBlock.ok) throw new Error('expected a failure');
    expect(noBlock.issues[0]?.message).toMatch(/json block/);

    const badJson = parseTeamPackage('```json\n{ nope\n```');
    expect(badJson.ok).toBe(false);

    const badPackage = parseTeamPackage(JSON.stringify({ ...minimal(), version: 9 }));
    expect(badPackage.ok).toBe(false);
    if (badPackage.ok) throw new Error('expected a failure');
    expect(badPackage.issues[0]?.path).toEqual(['version']);
  });

  it('rejects a package over the size cap before parsing it', () => {
    const result = parseTeamPackage('x'.repeat(TEAM_PACKAGE_MAX_BYTES + 1));
    expect(result).toMatchObject({ ok: false, issues: [{ path: [] }] });
    if (result.ok) throw new Error('expected a failure');
    expect(result.issues[0]?.message).toMatch(/bytes/);
  });
});

describe('ImportTeamPackage', () => {
  it('requires file content within the body cap', () => {
    expect(ImportTeamPackage.parse({ content: '{}' })).toEqual({ content: '{}' });
    expect(() => ImportTeamPackage.parse({ content: '' })).toThrow();
    expect(() => ImportTeamPackage.parse({})).toThrow();
    expect(TEAM_PACKAGE_IMPORT_MAX_CHARS).toBeGreaterThan(TEAM_PACKAGE_MAX_BYTES);
  });
});
