import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { SaveSkillDialog, type SaveSkillDialogProps } from './SaveSkillDialog';

const draft = {
  name: 'Printer reset',
  description: 'Turn it off for ten seconds.',
  body: '**You:** How do I reset the printer?\n\n**Capy:** Turn it off for ten seconds.',
};

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<SaveSkillDialogProps> = {}): string {
  const props: SaveSkillDialogProps = {
    open: true,
    initialDraft: draft,
    onClose: () => undefined,
    onSave: async () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<SaveSkillDialog {...props} />);
}

const saveButton = (html: string): string => html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';

describe('SaveSkillDialog', () => {
  it('prefills the editable fields from the conversation draft', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('skills.saveTitle'));
    expect(text).toContain(t('skills.saveDescription'));
    expect(text).toContain(`value="${draft.name}"`);
    expect(text).toContain(`value="${draft.description}"`);
    expect(text).toContain('How do I reset the printer?');
    expect(text).toContain(t('skills.saveBodyHint'));
    expect(text).toContain(t('skills.saveAction'));
    expect(saveButton(html)).not.toContain('disabled=""');
  });

  it('disables saving until a name and a body are present', () => {
    expect(saveButton(render({ initialDraft: { ...draft, name: '   ' } }))).toContain('disabled=""');
    expect(saveButton(render({ initialDraft: { ...draft, body: '' } }))).toContain('disabled=""');
  });

  it('shows an inline error slot', () => {
    const html = render({ initialError: 'This bot already has the maximum number of skills.' });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('This bot already has the maximum number of skills.');
  });

  it('shows the saved confirmation inline', () => {
    const html = render({ initialSaved: true });

    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain(t('skills.saved'));
  });
});
