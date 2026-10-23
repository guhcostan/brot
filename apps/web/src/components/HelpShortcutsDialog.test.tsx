import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { HelpShortcutsContent, HelpShortcutsDialog } from './HelpShortcutsDialog';

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function elementsOf(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, found);
    return found;
  }
  if (isValidElement(node)) {
    found.push(node);
    elementsOf((node.props as { children?: ReactNode }).children, found);
  }
  return found;
}

const html = (): string => renderToStaticMarkup(<HelpShortcutsDialog open onClose={() => undefined} onShowGettingStarted={() => undefined} />);

describe('HelpShortcutsDialog', () => {
  it('renders the title, description and every shortcut row', () => {
    const page = textOf(html());

    expect(page).toContain(t('help.title'));
    expect(page).toContain(t('help.description'));
    for (const row of ['search', 'send', 'newline', 'close', 'commands', 'dictate', 'attach', 'mobile'] as const) {
      expect(page).toContain(t(`help.${row}` as never));
      expect(page).toContain(t(`help.${row}Body` as never));
    }
  });

  it('shows the key caps and command names', () => {
    const page = textOf(html());

    for (const key of ['⌘ / Ctrl', 'Enter', 'Shift', 'Esc', '/help', '/new', '/rename', '/model', '/stop', 'Mic', 'Clip', 'Drag']) {
      expect(page).toContain(key);
    }
  });

  it('renders a two-column definition list', () => {
    expect(html()).toContain('<dl');
    expect(textOf(html())).toContain(t('help.gettingStarted'));
    expect(textOf(html())).toContain(t('help.gettingStartedBody'));
  });

  it('invokes the reopen callback from the Show getting started again button', () => {
    let reopened = 0;
    const tree = HelpShortcutsContent({ onShowGettingStarted: () => (reopened += 1) });

    for (const element of elementsOf(tree)) {
      const onClick = (element.props as { onClick?: unknown }).onClick;
      if (typeof onClick === 'function') (onClick as () => void)();
    }

    expect(reopened).toBe(1);
  });
});
