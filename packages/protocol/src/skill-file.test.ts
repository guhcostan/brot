import { describe, expect, it } from 'vitest';
import { ImportSkill, formatSkillFile, parseSkillFile } from './skill-file';

const skill = { name: 'review-pull-requests', description: 'Review a pull request carefully.', body: '# Review\n\n1. Read the diff.' };

function parseOk(text: string, options?: { name?: string }) {
  const result = parseSkillFile(text, options);
  if (!result.ok) throw new Error(`expected a parsed skill, got: ${result.issues.map((issue) => issue.message).join('; ')}`);
  return result.skill;
}

describe('formatSkillFile', () => {
  it('writes name and description in frontmatter followed by the body', () => {
    expect(formatSkillFile(skill)).toBe(
      ['---', 'name: review-pull-requests', 'description: Review a pull request carefully.', '---', '', '# Review\n\n1. Read the diff.'].join('\n'),
    );
  });

  it('quotes a value only when a plain key: value would lose it', () => {
    const formatted = formatSkillFile({ name: 'My Skill', description: 'Use when: reviewing', body: 'Body' });
    expect(formatted).toContain('name: My Skill');
    expect(formatted).toContain('description: "Use when: reviewing"');

    expect(formatSkillFile({ name: 'x', description: '', body: '' })).toContain('description: ""');
    expect(formatSkillFile({ name: '#1', description: 'has # hash', body: '' })).toContain('name: "#1"');
    expect(formatSkillFile({ name: 'x', description: 'has # hash', body: '' })).toContain('description: "has # hash"');
  });
});

describe('parseSkillFile', () => {
  it('round-trips a formatted skill', () => {
    expect(parseOk(formatSkillFile(skill))).toEqual(skill);
    expect(parseOk(formatSkillFile({ name: 'plain', description: '', body: '' }))).toEqual({
      name: 'plain',
      description: '',
      body: '',
    });
    // CRLF is a document line ending, so the parsed body itself comes back with LF.
    expect(parseOk(formatSkillFile({ name: 'ops', description: 'Run: deploy', body: 'line\r\nline' }))).toEqual({
      name: 'ops',
      description: 'Run: deploy',
      body: 'line\nline',
    });
  });

  it('accepts CRLF line endings everywhere', () => {
    const text = formatSkillFile(skill).replace(/\n/g, '\r\n');
    expect(parseOk(text)).toEqual(skill);
  });

  it('strips single and double quotes and trailing spaces', () => {
    const text = ["---", "name: 'quoted-name'  ", 'description: "A quoted: description"  ', 'unknown: ignored', '---', 'Body.'].join('\n');
    expect(parseOk(text)).toEqual({ name: 'quoted-name', description: 'A quoted: description', body: 'Body.' });
  });

  it('ignores unknown frontmatter keys, comments and blank lines', () => {
    const text = [
      '---',
      '# a comment',
      'name: with-extras',
      '',
      'version: 2',
      'license: MIT',
      'metadata:',
      '  nested: ignored',
      '---',
      'Body text.',
    ].join('\n');
    expect(parseOk(text)).toEqual({ name: 'with-extras', description: '', body: 'Body text.' });
  });

  it('takes the body verbatim when there is no frontmatter, with the name supplied separately', () => {
    expect(parseOk('Just some text.', { name: 'from-route' })).toEqual({
      name: 'from-route',
      description: '',
      body: 'Just some text.',
    });
  });

  it('reports a missing name with a clear issue', () => {
    const result = parseSkillFile('No frontmatter here.');
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toEqual([
      { path: ['name'], message: expect.stringMatching(/needs a name/) },
    ]);
  });

  it('reports an unclosed frontmatter', () => {
    const result = parseSkillFile('---\nname: broken\n');
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues[0]?.message).toMatch(/not closed/);
  });

  it('applies the caps with one issue per broken field', () => {
    const long = parseSkillFile(`---\nname: ${'a'.repeat(121)}\ndescription: ${'d'.repeat(501)}\n---\nbody`);
    expect(long.ok).toBe(false);
    expect(long.ok ? [] : long.issues.map((issue) => issue.path)).toEqual([['name'], ['description']]);

    const bigBody = parseSkillFile(`---\nname: big\n---\n${'x'.repeat(500_001)}`);
    expect(bigBody.ok).toBe(false);
    expect(bigBody.ok ? [] : bigBody.issues).toEqual([
      { path: ['body'], message: expect.stringMatching(/500000/) },
    ]);

    expect(parseOk(`---\nname: big\n---\n${'x'.repeat(500_000)}`).body).toHaveLength(500_000);
  });

  it('rejects a name that is not a single line', () => {
    const result = parseSkillFile('---\nname: "two\\nlines"\n---\nbody');
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues[0]?.message).toMatch(/single line/);
  });

  it('accepts a raw JSON object as a fallback', () => {
    expect(parseOk('{"name":"json-skill","description":"From JSON","body":"# Body"}')).toEqual({
      name: 'json-skill',
      description: 'From JSON',
      body: '# Body',
    });
    expect(parseOk('{"name":"json-skill"}')).toEqual({ name: 'json-skill', description: '', body: '' });
    expect(parseOk('{ "name": "with-fallback" }', { name: 'ignored' }).name).toBe('with-fallback');
  });

  it('reports broken JSON and wrong JSON fields', () => {
    const broken = parseSkillFile('{"name":');
    expect(broken.ok).toBe(false);
    expect(broken.ok ? [] : broken.issues[0]?.message).toMatch(/not valid JSON/);
    expect(parseSkillFile('["not-an-object"]').ok).toBe(false);
    const wrong = parseSkillFile('{"name":1,"body":2}');
    expect(wrong.ok).toBe(false);
    expect(wrong.ok ? [] : wrong.issues.map((issue) => issue.path)).toEqual([['name'], ['body']]);
  });
});

describe('ImportSkill', () => {
  it('requires content and takes an optional bot and fallback name', () => {
    expect(ImportSkill.parse({ content: '# x' })).toEqual({ content: '# x' });
    expect(ImportSkill.parse({ content: '# x', botId: 'bot_1', name: 'fallback' })).toEqual({
      content: '# x',
      botId: 'bot_1',
      name: 'fallback',
    });
    expect(() => ImportSkill.parse({ content: '' })).toThrow();
    expect(() => ImportSkill.parse({ content: 'x'.repeat(600_001) })).toThrow();
    expect(ImportSkill.parse({ content: 'x'.repeat(600_000) }).content).toHaveLength(600_000);
  });
});
