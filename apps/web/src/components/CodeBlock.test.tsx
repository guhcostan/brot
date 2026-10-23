import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { CodeBlock } from './CodeBlock';
import { MarkdownText } from './MarkdownText';

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

describe('CodeBlock', () => {
  it('shows the language label, the exact code and a copy affordance', () => {
    const html = renderToStaticMarkup(<CodeBlock language="ts" code={'const x = 1;\nconsole.log(x);'} />);
    const text = textOf(html);

    expect(text).toContain('ts');
    expect(text).toContain('const x = 1;');
    expect(html).toContain(`aria-label="${t('copy.copyCode')}"`);
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toContain('```');
  });

  it('falls back to the localized Code label without a language', () => {
    expect(textOf(renderToStaticMarkup(<CodeBlock code="plain" />))).toContain(t('copy.code'));
  });
});

describe('MarkdownText', () => {
  it('renders text runs and promotes fenced code blocks to copyable cards', () => {
    const html = renderToStaticMarkup(<MarkdownText text={'Before\n```js\nx()\n```\nAfter'} />);
    const text = textOf(html);

    expect(text).toContain('Before');
    expect(text).toContain('After');
    expect(text).toContain('x()');
    expect(text).toContain('js');
    expect(html).toContain(`aria-label="${t('copy.copyCode')}"`);
  });
});
