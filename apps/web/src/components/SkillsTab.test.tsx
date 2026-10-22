import type { Skill } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { SkillsTab, type SkillsTabProps } from './SkillsTab';

const at = '2026-10-19T09:00:00.000Z';

const skill = (extra: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill => ({
  description: 'A reusable procedure.',
  body: '# Steps',
  version: 1,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const skills: Skill[] = [
  skill({ id: 'skill_1', botId: 'bot_1', name: 'Refund triage' }),
  skill({ id: 'skill_shared', name: 'Weekly plan' }),
];

const noopAsync = async () => undefined;

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<SkillsTabProps> = {}): string {
  const props: SkillsTabProps = {
    botId: 'bot_1',
    botName: 'Capy',
    skills,
    onCreate: noopAsync,
    onUpdate: noopAsync,
    onDelete: noopAsync,
    onExport: async () => ({ content: '# skill', filename: 'skill.SKILL.md' }),
    onImport: async () => skills[0]!,
    ...overrides,
  };
  return renderToStaticMarkup(<SkillsTab {...props} />);
}

describe('skills tab import/export', () => {
  it('shows an export action on every skill row and the import button in the header', () => {
    const text = textOf(render());

    expect(text).toContain(t('skills.exportNamed', { name: 'Refund triage' }));
    expect(text).toContain(t('skills.exportNamed', { name: 'Weekly plan' }));
    expect(text).toContain(t('skills.import'));
    expect(text).toContain(t('skills.new'));
    expect(text).toContain(t('skills.shared'));
  });

  it('renders no import dialog content until it is opened', () => {
    const text = textOf(render());

    expect(text).not.toContain(t('skills.importPaste'));
    expect(text).not.toContain(t('skills.importTargetShared'));
  });

  it('keeps the empty state and its actions when there are no skills', () => {
    const text = textOf(render({ skills: [] }));

    expect(text).toContain(t('skills.emptyTitle'));
    expect(text).toContain(t('skills.import'));
    expect(text).toContain(t('skills.new'));
  });
});
