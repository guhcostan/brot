import { z } from 'zod';

/** Caps for a SKILL.md document. The body cap matches what a skill may store. */
export const SKILL_FILE_NAME_MAX = 120;
export const SKILL_FILE_DESCRIPTION_MAX = 500;
export const SKILL_FILE_BODY_MAX = 500_000;

/** The largest import payload: a body at the cap plus frontmatter. */
const SKILL_FILE_CONTENT_MAX = 600_000;

/** A skill as a SKILL.md document holds it. */
export interface SkillFileData {
  name: string;
  description: string;
  body: string;
}

/** One reason a SKILL.md document could not be parsed. `path` points at the offending field. */
export interface SkillFileIssue {
  path: string[];
  message: string;
}

export type ParseSkillFileResult =
  | { ok: true; skill: SkillFileData }
  | { ok: false; issues: SkillFileIssue[] };

export interface ParseSkillFileOptions {
  /** The name to use when the document has no frontmatter. */
  name?: string;
}

/**
 * A SKILL.md import. `name` is the fallback for a document with no frontmatter, next to the same optional
 * query parameter on the route.
 */
export const ImportSkill = z.object({
  content: z.string().min(1).max(SKILL_FILE_CONTENT_MAX),
  botId: z.string().min(1).optional(),
  name: z.string().min(1).max(SKILL_FILE_NAME_MAX).optional(),
});
export type ImportSkill = z.infer<typeof ImportSkill>;

/**
 * Formats a skill as a SKILL.md document: `---` frontmatter with `name` and `description`, a blank line,
 * then the Markdown body. A value is JSON-quoted only when it would not survive as a plain `key: value`.
 */
export function formatSkillFile(skill: SkillFileData): string {
  return ['---', `name: ${formatValue(skill.name)}`, `description: ${formatValue(skill.description)}`, '---', '', skill.body].join('\n');
}

/**
 * Parses a SKILL.md document (or a JSON `{ name, description, body }` object as a fallback). It is forgiving:
 * CRLF, quoted values, unknown frontmatter keys and a missing frontmatter (with `options.name`) all work.
 */
export function parseSkillFile(text: string, options: ParseSkillFileOptions = {}): ParseSkillFileResult {
  const normalized = text.replace(/\r\n/g, '\n');
  const leading = normalized.trimStart();

  if (leading.startsWith('{')) {
    const parsed = parseJsonFallback(normalized);
    if (!parsed.ok) return parsed;
    return validate({ ...parsed.skill, name: parsed.skill.name === '' ? (options.name ?? '') : parsed.skill.name });
  }

  const lines = normalized.split('\n');
  let bodyStart = 0;
  let frontmatter: Record<string, string> | undefined;

  if (lines[0]?.trim() === '---') {
    let close = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index]?.trim() === '---') {
        close = index;
        break;
      }
    }
    if (close === -1) {
      return { ok: false, issues: [{ path: ['content'], message: 'the frontmatter is not closed by a second --- line' }] };
    }
    frontmatter = parseFrontmatter(lines.slice(1, close));
    bodyStart = close + 1;
  }

  const bodyLines = lines.slice(bodyStart);
  // The formatter writes one blank separator line after the frontmatter; drop it so a body round-trips.
  if (frontmatter !== undefined && bodyLines[0] === '') bodyLines.shift();
  const body = bodyLines.join('\n');
  const name = frontmatter?.name ?? options.name ?? '';
  const description = frontmatter?.description ?? '';
  return validate({ name, description, body });
}

/** `key: value` lines. Unknown keys are ignored; quoted values lose their quotes; trailing spaces trimmed. */
function parseFrontmatter(lines: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = unquote(trimmed.slice(colon + 1).trim());
    values[key] = value;
  }
  return values;
}

/** Removes matching single or double quotes. A double-quoted value is read as a JSON string when it is one. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not JSON; fall through to stripping the quotes.
    }
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function formatValue(value: string): string {
  if (value === '') return '""';
  const plain =
    value === value.trim() &&
    !value.includes('#') &&
    /^[A-Za-z0-9_][A-Za-z0-9 _\-./()@']*$/.test(value);
  return plain ? value : JSON.stringify(value);
}

function parseJsonFallback(
  text: string,
): { ok: true; skill: SkillFileData } | { ok: false; issues: SkillFileIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: ['content'], message: 'the content is not valid JSON' }] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: ['content'], message: 'the JSON must be an object with name, description and body' }] };
  }
  const record = value as Record<string, unknown>;
  const issues: SkillFileIssue[] = [];
  const name = typeof record.name === 'string' ? record.name : '';
  if (record.name !== undefined && typeof record.name !== 'string') {
    issues.push({ path: ['name'], message: 'the skill name must be a string' });
  }
  if (record.description !== undefined && typeof record.description !== 'string') {
    issues.push({ path: ['description'], message: 'the skill description must be a string' });
  }
  if (record.body !== undefined && typeof record.body !== 'string') {
    issues.push({ path: ['body'], message: 'the skill body must be a string' });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    skill: {
      name,
      description: typeof record.description === 'string' ? record.description : '',
      body: typeof record.body === 'string' ? record.body : '',
    },
  };
}

/** Applies the caps and returns the parsed skill, or one clear issue per broken field. */
function validate(skill: SkillFileData): ParseSkillFileResult {
  const issues: SkillFileIssue[] = [];
  const name = skill.name.trim();
  if (name === '') {
    issues.push({ path: ['name'], message: 'the SKILL.md needs a name in its frontmatter (or a name in the request)' });
  } else if (name.length > SKILL_FILE_NAME_MAX) {
    issues.push({ path: ['name'], message: `the skill name must be at most ${SKILL_FILE_NAME_MAX} characters` });
  } else if (name.includes('\n')) {
    issues.push({ path: ['name'], message: 'the skill name must be a single line' });
  }
  const description = skill.description.trim();
  if (description.length > SKILL_FILE_DESCRIPTION_MAX) {
    issues.push({
      path: ['description'],
      message: `the skill description must be at most ${SKILL_FILE_DESCRIPTION_MAX} characters`,
    });
  }
  if (skill.body.length > SKILL_FILE_BODY_MAX) {
    issues.push({ path: ['body'], message: `the skill body must be at most ${SKILL_FILE_BODY_MAX} characters` });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, skill: { name, description, body: skill.body } };
}
