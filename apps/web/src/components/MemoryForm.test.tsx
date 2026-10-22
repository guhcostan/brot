import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { MemoryForm, type MemoryFormProps } from './MemoryForm';

const noop = async () => undefined;

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<MemoryFormProps> = {}): string {
  const props: MemoryFormProps = {
    onClose: () => undefined,
    onCreate: noop,
    onUpdate: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<MemoryForm {...props} />);
}

describe('shared memory editor', () => {
  it('offers a kind select, a required textarea and the create action', () => {
    const text = textOf(render());

    expect(text).toContain(t('memory.kind'));
    expect(text).toContain(t('memory.kind.fact'));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain(t('memory.kind.summary'));
    expect(text).toContain(t('memory.content'));
    expect(text).toContain(t('memory.contentHint'));
    expect(text).toContain(t('memory.create'));
    expect(text).not.toContain(t('memory.save'));
  });

  it('prefills an edit and swaps the action to save', () => {
    const html = render({ memory: { id: 'mem_1', kind: 'preference', content: 'Prefers short summaries.' } });
    const text = textOf(html);

    expect(text).toContain(t('memory.save'));
    expect(text).not.toContain(t('memory.create'));
    expect(html).toContain('Prefers short summaries.');
  });
});
