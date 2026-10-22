import { TEAM_PACKAGE_FORMAT, TEAM_PACKAGE_VERSION, formatTeamPackage, type TeamPackage } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { packageIssueText, previewTeamPackage } from './teamPackagePreview';

const at = '2026-10-19T09:00:00.000Z';

const pkg: TeamPackage = {
  format: TEAM_PACKAGE_FORMAT,
  version: TEAM_PACKAGE_VERSION,
  exportedAt: at,
  teams: [{ key: 't1', name: 'Growth', instructions: 'Win Acme.', chief: 'b1' }],
  bots: [
    { key: 'b1', name: 'Capy', job: 'Chief', instructions: 'Lead.', team: 't1' },
    { key: 'b2', name: 'Onça', job: 'Fixer', instructions: 'Fix.' },
  ],
  rooms: [{ title: 'Acme renewal', lead: 'b1', members: ['b1', 'b2'] }],
  routines: [{ bot: 'b1', name: 'Morning brief', instruction: 'Brief me.', cron: '0 8 * * 1-5', enabled: true }],
  skills: [{ name: 'Customer follow-up', description: 'Write a follow-up.', body: '# Follow-up' }],
};

describe('previewTeamPackage', () => {
  it('summarizes a valid package with counts and names', () => {
    const result = previewTeamPackage(formatTeamPackage(pkg));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.counts).toEqual({ teams: 1, bots: 2, rooms: 1, routines: 1, skills: 1 });
    expect(result.preview.teams).toEqual(['Growth']);
    expect(result.preview.bots).toEqual(['Capy', 'Onça']);
    expect(result.preview.rooms).toEqual(['Acme renewal']);
    expect(result.preview.routines).toEqual(['Morning brief']);
    expect(result.preview.skills).toEqual(['Customer follow-up']);
  });

  it('accepts raw JSON as well as the Markdown wrapper', () => {
    const result = previewTeamPackage(JSON.stringify(pkg));
    expect(result.ok && result.preview.counts.bots).toBe(2);
  });

  it('returns parser issues for an empty or malformed package', () => {
    const empty = previewTeamPackage('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0]?.message).toContain('empty');

    const malformed = previewTeamPackage('# Brot team package\n\nno json here');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.issues[0]?.message).toContain('expected raw JSON');

    const unknownReference = previewTeamPackage(
      formatTeamPackage({ ...pkg, rooms: [{ title: 'Broken', lead: 'b9', members: ['b1', 'b9'] }] }),
    );
    expect(unknownReference.ok).toBe(false);
    if (!unknownReference.ok) expect(unknownReference.issues.some((issue) => issue.message === 'unknown bot b9')).toBe(true);
  });
});

describe('packageIssueText', () => {
  it('prefixes the path when the issue has one', () => {
    expect(packageIssueText({ path: ['bots', 0, 'team'], message: 'unknown team t9' })).toBe('bots.0.team: unknown team t9');
    expect(packageIssueText({ path: [], message: 'the package is empty' })).toBe('the package is empty');
  });
});
