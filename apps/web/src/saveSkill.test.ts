import { describe, expect, it } from 'vitest';
import {
  buildSkillDraft,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  type SkillTranscriptEntry,
} from './saveSkill';

const message = (role: SkillTranscriptEntry extends infer _T ? 'user' | 'assistant' | 'system' : never, content: string, author?: string): SkillTranscriptEntry => ({
  kind: 'message',
  role,
  content,
  ...(author === undefined ? {} : { author }),
});

describe('buildSkillDraft', () => {
  it('prefills name from the title, description from the first assistant paragraph and a Markdown transcript', () => {
    const entries: SkillTranscriptEntry[] = [
      message('user', 'How do I reset the printer?', 'You'),
      message('assistant', 'Turn it off for ten seconds.\n\nThen turn it back on.', 'Capy'),
      message('user', 'Thanks!', 'You'),
      message('assistant', 'Anytime.', 'Capy'),
    ];

    expect(buildSkillDraft(entries, { title: 'Printer reset' })).toEqual({
      name: 'Printer reset',
      description: 'Turn it off for ten seconds.',
      body: '**You:** How do I reset the printer?\n\n**Capy:** Turn it off for ten seconds.\n\nThen turn it back on.\n\n**You:** Thanks!\n\n**Capy:** Anytime.',
    });
  });

  it('falls back to the role when a message has no author', () => {
    expect(buildSkillDraft([message('assistant', 'Hi there')]).body).toBe('**Assistant:** Hi there');
  });

  it('includes tools used between the kept messages', () => {
    const entries: SkillTranscriptEntry[] = [
      message('user', 'Check the site', 'You'),
      { kind: 'tool', tool: 'browser.open' },
      message('assistant', 'It is up.', 'Capy'),
    ];

    expect(buildSkillDraft(entries).body).toBe('**You:** Check the site\n\nused tool browser.open\n\n**Capy:** It is up.');
  });

  it('keeps only the last ten messages and the tools between them', () => {
    const entries: SkillTranscriptEntry[] = [];
    for (let index = 1; index <= 12; index += 1) {
      entries.push(message(index % 2 === 0 ? 'assistant' : 'user', `Line ${index}`, index % 2 === 0 ? 'Capy' : 'You'));
      if (index === 11) entries.push({ kind: 'tool', tool: 'shell' });
    }
    const body = buildSkillDraft(entries).body;

    expect(body).not.toContain('Line 2');
    expect(body).toContain('Line 3');
    expect(body).toContain('used tool shell');
    expect(body).toContain('Line 12');
    expect(body.match(/\*\*/g)).toHaveLength(20);
  });

  it('truncates every field to its cap', () => {
    const longTitle = 'T'.repeat(SKILL_NAME_MAX + 40);
    const longParagraph = 'P'.repeat(SKILL_DESCRIPTION_MAX + 80);
    const manyMessages: SkillTranscriptEntry[] = [];
    for (let index = 0; index < 10; index += 1) manyMessages.push(message('assistant', 'B'.repeat(4_000)));

    const draft = buildSkillDraft(manyMessages, { title: longTitle });
    expect(draft.name).toHaveLength(SKILL_NAME_MAX);
    expect(draft.body.length).toBeLessThanOrEqual(SKILL_BODY_MAX);
    expect(buildSkillDraft([message('assistant', longParagraph)]).description).toHaveLength(SKILL_DESCRIPTION_MAX);
  });

  it('is safe with an empty transcript and no title', () => {
    expect(buildSkillDraft([])).toEqual({ name: 'Conversation', description: '', body: '' });
    expect(buildSkillDraft([], { title: '  ' })).toEqual({ name: 'Conversation', description: '', body: '' });
    expect(buildSkillDraft([], { fallbackName: 'Conversa' }).name).toBe('Conversa');
  });

  it('skips blank messages but still builds the rest', () => {
    const body = buildSkillDraft([
      message('user', '   '),
      { kind: 'tool', tool: 'shell' },
      message('assistant', 'Done', 'Capy'),
    ]).body;

    expect(body).toBe('used tool shell\n\n**Capy:** Done');
  });
});
