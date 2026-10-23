import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { GettingStartedItem, GettingStartedItemId } from '../onboarding';
import { GettingStartedChecklist, type GettingStartedChecklistProps } from './GettingStartedChecklist';

const item = (id: GettingStartedItemId, extra: Partial<GettingStartedItem> = {}): GettingStartedItem => ({
  id,
  done: false,
  optional: false,
  loading: false,
  failed: false,
  ...extra,
});

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<GettingStartedChecklistProps> = {}): string {
  const props: GettingStartedChecklistProps = {
    items: [item('modelKey'), item('hello'), item('tools', { optional: true }), item('routine'), item('phone', { optional: true })],
    onAction: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<GettingStartedChecklist {...props} />);
}

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

describe('getting started checklist', () => {
  it('renders every pending step with its copy, state and action', () => {
    const html = render();
    const text = textOf(html);

    for (const key of ['modelTitle', 'helloTitle', 'toolsTitle', 'routineTitle', 'phoneTitle'] as const) {
      expect(text).toContain(t(`gettingStarted.${key}`));
    }
    for (const key of ['modelBody', 'helloBody', 'toolsBody', 'routineBody', 'phoneBody'] as const) {
      expect(text).toContain(t(`gettingStarted.${key}`));
    }
    expect(text.match(new RegExp(t('gettingStarted.pending'), 'g'))).toHaveLength(5);
    expect(text.match(new RegExp(t('gettingStarted.optional'), 'g'))).toHaveLength(2);
    expect(text).toContain(t('gettingStarted.addKey'));
    expect(text).toContain(t('gettingStarted.sayHello'));
    expect(text).toContain(t('gettingStarted.giveTools'));
    expect(text).toContain(t('gettingStarted.scheduleRoutine'));
    expect(text).toContain(t('gettingStarted.pairPhone'));
  });

  it('marks done steps and hides their action', () => {
    const html = render({ items: [item('modelKey', { done: true }), item('hello', { done: true })] });
    const text = textOf(html);

    expect(text.match(new RegExp(t('gettingStarted.done'), 'g'))).toHaveLength(2);
    expect(text).not.toContain(t('gettingStarted.pending'));
    expect(html.match(/<button/g) ?? []).toHaveLength(0);
  });

  it('shows a skeleton while a cheap check is loading and retry when it failed', () => {
    const loading = render({ items: [item('modelKey', { loading: true })] });
    expect(textOf(loading)).toContain(t('gettingStarted.checking'));
    expect(loading).toContain('aria-busy="true"');

    const failed = render({ items: [item('routine', { failed: true })], onRetry: () => undefined });
    expect(textOf(failed)).toContain(t('gettingStarted.loadFailed'));
    expect(textOf(failed)).toContain(t('gettingStarted.retry'));
  });

  it('exposes each pending action to the row handler', () => {
    const actions: GettingStartedItemId[] = [];
    const tree = GettingStartedChecklist({
      items: [item('modelKey'), item('hello'), item('tools'), item('routine'), item('phone')],
      onAction: (id) => actions.push(id),
    });

    for (const element of elementsOf(tree)) {
      const onClick = (element.props as { onClick?: unknown }).onClick;
      if (typeof onClick === 'function') (onClick as () => void)();
    }
    expect(actions).toEqual(['modelKey', 'hello', 'tools', 'routine', 'phone']);
  });
});
