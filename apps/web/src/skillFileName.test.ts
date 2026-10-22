import { describe, expect, it } from 'vitest';
import { skillFileFallbackFromId, skillFileFilename, skillFileSlug } from './skillFileName';

describe('skill export filenames', () => {
  it('slugifies names and appends .SKILL.md', () => {
    expect(skillFileSlug('Refund triage')).toBe('refund-triage');
    expect(skillFileSlug('Promoções & CSVs')).toBe('promocoes-csvs');
    expect(skillFileSlug('***')).toBe('skill');
    expect(skillFileFilename('Refund triage')).toBe('refund-triage.SKILL.md');
  });

  it('derives a fallback from the skill id when the server sends no filename', () => {
    expect(skillFileFallbackFromId('skill_refund_triage')).toBe('refund-triage.SKILL.md');
    expect(skillFileFallbackFromId('3f1c')).toBe('3f1c.SKILL.md');
  });
});
