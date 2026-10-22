import type { Bot } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { BrowserPanel, type BrowserPanelProps } from './BrowserPanel';
import { ClientProvider } from './client';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  browser: true,
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const noop = () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const typeInput = (html: string): string => html.match(/<input[^>]*placeholder="Text to type into the page"[^>]*>/)?.[0] ?? '';
const button = (html: string, label: string): string =>
  html.match(new RegExp(`<button[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</button>`))?.[0] ?? '';

function render(overrides: Partial<BrowserPanelProps> = {}): string {
  const props: BrowserPanelProps = { open: true, bot, onClose: noop, ...overrides };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <BrowserPanel {...props} />
    </ClientProvider>,
  );
}

describe('browser live panel', () => {
  it('watches in read-only mode with the input controls disabled', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('browserPanel.title', { name: 'Capy' }));
    expect(text).toContain(t('browserPanel.watching'));
    expect(text).toContain(t('browserPanel.takeControl'));
    expect(html).toContain('role="img"');
    expect(text).toContain(`aria-label="${t('browserPanel.frameAlt', { name: 'Capy' })}"`);
    expect(text).toContain(t('browserPanel.inputHint'));
    expect(typeInput(html)).toContain('disabled=""');
    expect(button(html, t('browserPanel.sendText'))).toContain('disabled=""');
    expect(button(html, t('browserPanel.keyEnter'))).toContain('disabled=""');
  });

  it('shows Hand back and enables the controls while the person holds control', () => {
    const html = render({ initialTakeover: { active: true, since: at } });
    const text = textOf(html);

    expect(text).toContain(t('browserPanel.youHaveControl'));
    expect(text).toContain(t('browserPanel.handBack'));
    expect(html).toContain('role="application"');
    expect(typeInput(html)).not.toContain('disabled=""');
    expect(button(html, t('browserPanel.keyEscape'))).not.toContain('disabled=""');
  });

  it('names a shared profile', () => {
    const text = textOf(render({ profile: { kind: 'shared', id: 'profile_1', name: 'Shared accounts' } }));

    expect(text).toContain(t('browserPanel.shared', { name: 'Shared accounts' }));
  });

  it('renders the screen error with a retry action', () => {
    const text = textOf(render({ initialUnavailable: 409 }));

    expect(text).toContain(t('browserPanel.screenUnavailable'));
    expect(text).toContain(t('browserPanel.screenUnavailableHint'));
    expect(text).toContain(t('browserPanel.retry'));
  });
});
