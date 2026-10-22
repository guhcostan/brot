/** A skill name as a download slug: lowercase ASCII words joined by dashes. */
export function skillFileSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'skill' : slug;
}

/** The download name for an exported skill: `<slug>.SKILL.md`. */
export function skillFileFilename(name: string): string {
  return `${skillFileSlug(name)}.SKILL.md`;
}

/** A filename when the server sent no content-disposition: the skill id, minus its kind prefix. */
export function skillFileFallbackFromId(skillId: string): string {
  return skillFileFilename(skillId.replace(/^skill[-_]/i, ''));
}
