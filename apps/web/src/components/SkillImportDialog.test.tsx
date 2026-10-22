import { formatSkillFile, type Skill } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { SkillImportDialog, type SkillImportDialogProps } from './SkillImportDialog';

const created: Skill = {
  id: 'skill_1',
  botId: 'bot_1',
  name: 'Imported skill',
  description: 'A test skill.',
  body: '# Steps\n\n1. Do it.',
  version: 1,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
};

const validFile = formatSkillFile(created);

const noop = async () => created;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const importButton = (html: string): string => html.match(new RegExp(`<button[^>]*>${t('skills.importAction')}</button>`))?.[0] ?? '';

function render(overrides: Partial<SkillImportDialogProps> = {}): string {
  const props: SkillImportDialogProps = {
    open: true,
    botId: 'bot_1',
    botName: 'Capy',
    onClose: () => undefined,
    onImport: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<SkillImportDialog {...props} />);
}

describe('skill import dialog', () => {
  it('starts empty with the bot target and import disabled', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('skills.importTitle'));
    expect(text).toContain(t('skills.importPaste'));
    expect(text).toContain(t('skills.importChooseFile'));
    expect(text).toContain(t('skills.importPreview'));
    expect(text).toContain(t('skills.importPreviewEmpty'));
    expect(text).toContain(t('skills.importTargetBot', { name: 'Capy' }));
    expect(text).toContain(t('skills.importTargetShared'));
    expect(importButton(html)).toContain('disabled=""');
  });

  it('previews a valid SKILL.md: name, description, body and enabled import', () => {
    const html = render({ initialContent: validFile });
    const text = textOf(html);

    expect(text).toContain('Imported skill');
    expect(text).toContain('A test skill.');
    expect(text).toContain('# Steps');
    expect(text).not.toContain(t('skills.importPreviewEmpty'));
    expect(importButton(html)).not.toContain('disabled=""');
  });

  it('lists parse issues inline and keeps import disabled', () => {
    const html = render({ initialContent: 'not a skill file' });
    const text = textOf(html);

    expect(text).toContain(t('skills.importPreviewInvalid'));
    expect(importButton(html)).toContain('disabled=""');
  });
});
