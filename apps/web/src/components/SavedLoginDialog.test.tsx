import type { SavedLogin } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { SavedLoginDialog, type SavedLoginDialogProps } from './SavedLoginDialog';

const at = '2026-10-19T09:00:00.000Z';

const login: SavedLogin = {
  id: 'login_1',
  name: 'GitHub',
  host: 'github.com',
  label: 'Personal account',
  hasTotp: true,
  createdAt: at,
  updatedAt: at,
};

const plainLogin: SavedLogin = { ...login, id: 'login_2', name: 'X/Twitter', host: 'x.com', hasTotp: false };
const noop = async () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const inputByPlaceholder = (html: string, placeholder: string): string =>
  html.match(new RegExp(`<input[^>]*placeholder="${placeholder}"[^>]*>`))?.[0] ?? '';

function render(overrides: Partial<SavedLoginDialogProps> = {}): string {
  const props: SavedLoginDialogProps = {
    open: true,
    onClose: () => undefined,
    onCreate: noop,
    onUpdate: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<SavedLoginDialog {...props} />);
}

describe('saved login dialog', () => {
  it('offers every create field, with a password input and TOTP hint', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.savedLoginDialogNew'));
    expect(text).toContain(t('settings.savedLoginName'));
    expect(text).toContain(t('settings.savedLoginHost'));
    expect(text).toContain(t('settings.savedLoginLabel'));
    expect(text).toContain(t('settings.savedLoginUsername'));
    expect(text).toContain(t('settings.savedLoginPassword'));
    expect(text).toContain(t('settings.savedLoginTotp'));
    expect(text).toContain(t('settings.savedLoginTotpHint'));
    expect(html).toMatch(/<input[^>]*type="password"[^>]*>/);
    expect(text).toContain(t('settings.savedLoginCreate'));
    expect(text).not.toContain(t('settings.savedLoginWriteOnly'));
    expect(text).not.toContain(t('settings.savedLoginClearTotp'));
  });

  it('prefills the metadata on edit and leaves values blank with leave-blank hints', () => {
    const html = render({ login });
    const text = textOf(html);

    expect(text).toContain(t('settings.savedLoginDialogEdit'));
    expect(text).toContain(t('settings.savedLoginWriteOnly'));
    expect(html).toContain('value="GitHub"');
    expect(html).toContain('value="github.com"');
    expect(html).toContain('value="Personal account"');

    const blank = inputByPlaceholder(html, t('settings.savedLoginLeaveBlank'));
    expect(blank).not.toBe('');
    expect(blank).toContain('value=""');
    const blanks = html.match(new RegExp(`placeholder="${t('settings.savedLoginLeaveBlank')}"`, 'g')) ?? [];
    expect(blanks).toHaveLength(3);
    expect(text).toContain(t('settings.savedLoginSave'));
  });

  it('offers removing a stored TOTP secret only when the login has one', () => {
    expect(textOf(render({ login }))).toContain(t('settings.savedLoginClearTotp'));
    expect(textOf(render({ login: plainLogin }))).not.toContain(t('settings.savedLoginClearTotp'));
  });
});
