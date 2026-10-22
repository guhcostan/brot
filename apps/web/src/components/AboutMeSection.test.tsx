import type { Memory } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_WORKSPACE_MEMORIES } from '../data/fixtures';
import { t } from '../i18n';
import { AboutMeSection } from './AboutMeSection';
import { ClientProvider } from './client';

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const memories = DEMO_WORKSPACE_MEMORIES;

function render(initialMemories: Memory[] | undefined = memories): string {
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <AboutMeSection initialMemories={initialMemories} />
    </ClientProvider>,
  );
}

describe('settings about me', () => {
  it('lists the workspace facts with kind badges, content and dates', () => {
    const text = textOf(render());

    expect(text).toContain(t('settings.aboutMeCount', { count: '3' }));
    expect(text).toContain(t('settings.aboutMeNew'));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain(t('memory.kind.fact'));
    expect(text).toContain('Prefers Portuguese (pt-BR) in conversation; writes English with customers.');
    expect(text).toContain('Lives in São Sebastião, on the coast of São Paulo.');
    expect(text).toContain('Works solo on Brot and does not have a team to delegate to.');
    expect(text).toContain(t('settings.aboutMeEdit'));
    expect(text).toContain(t('settings.aboutMeDeleteNamed', { content: memories[0]?.content ?? '' }));
  });

  it('shows the empty state and the new-fact action', () => {
    const text = textOf(render([]));

    expect(text).toContain(t('settings.aboutMeCount', { count: '0' }));
    expect(text).toContain(t('settings.aboutMeEmptyTitle'));
    expect(text).toContain(t('settings.aboutMeEmptyBody'));
    expect(text).toContain(t('settings.aboutMeNew'));
  });

  it('does not render the editor or delete confirmation until asked', () => {
    const text = textOf(render());

    expect(text).not.toContain(t('memory.content'));
    expect(text).not.toContain(t('settings.aboutMeDeleteBody'));
  });
});
