/** The download name for a skill: a lowercase slug of its name plus the SKILL.md suffix. */
export function skillFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return `${slug === '' ? 'skill' : slug}.SKILL.md`;
}
