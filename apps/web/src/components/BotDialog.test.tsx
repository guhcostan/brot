import type { Bot } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { BotDialog, type BotDialogProps } from './BotDialog';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4.1-flash',
  computer: 'sandbox',
  egress: { mode: 'deny', allow: [] },
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const noop = async () => undefined;

function render(overrides: Partial<BotDialogProps> = {}): string {
  const props: BotDialogProps = {
    open: true,
    loadProviders: async () => [],
    onCreate: noop,
    onUpdate: noop,
    onDelete: noop,
    onOpenSettings: () => undefined,
    browserStatus: async () => ({ state: 'stopped' }),
    startBrowserLogin: async () => ({ state: 'login' }),
    closeBrowser: noop,
    onClose: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<BotDialog {...props} />);
}

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

const TOGGLE_OFF = '<input type="checkbox" class="room-check mt-0.5"/>';
const TOGGLE_ON = '<input type="checkbox" class="room-check mt-0.5" checked=""/>';

describe('BotDialog host browser', () => {
  it('offers the host browser as an opt-in for a new bot', () => {
    const html = render();
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(text).toContain(t('botForm.browserHint'));
    expect(html).toContain(TOGGLE_OFF);
    expect(html).not.toContain(TOGGLE_ON);
  });

  it('hides the opt-in for a sandbox bot with a desktop and says why', () => {
    const text = textOf(render({ bot: { ...bot, desktop: true } }));
    expect(text).toContain(t('botForm.browserDesktop'));
    expect(text).not.toContain(t('botForm.browserOnHost'));
    expect(text).not.toContain(t('botForm.browserHint'));
  });

  it('shows the state and the sign-in action for a bot that already has a browser', () => {
    const html = render({ bot: { ...bot, computer: 'none', browser: true } });
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(html).toContain(TOGGLE_ON);
    expect(text).toContain(t('botForm.browserState.checking'));
    expect(text).toContain(t('botForm.browserLogin'));
    expect(text).not.toContain('>Close<');
  });

  it('keeps the opt-in off for an existing bot without a browser', () => {
    const html = render({ bot });
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(html).toContain(TOGGLE_OFF);
    expect(text).not.toContain(t('botForm.browserState.checking'));
  });
});
