import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Provider } from '../data/client';
import { t } from '../i18n';
import { ThreadModelOptions, type ThreadModelOptionsProps } from './ThreadModelPicker';

const providers: Provider[] = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    secretName: 'opencode_go_key',
    configured: true,
    models: [
      { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'opencode-go/kimi-k2', label: 'Kimi K2' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    secretName: 'anthropic_key',
    configured: false,
    models: [{ id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' }],
  },
];

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<ThreadModelOptionsProps> = {}): string {
  const props: ThreadModelOptionsProps = {
    providers,
    error: null,
    botModel: 'opencode-go/deepseek-v4.1-flash',
    currentModel: undefined,
    busy: false,
    onPick: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<ThreadModelOptions {...props} />);
}

/** Every element in a component's returned tree, so a hook-free component can be exercised without a DOM. */
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

const inputsOf = (tree: ReactElement): Array<{ value?: string; checked?: boolean; disabled?: boolean; onChange: () => void }> =>
  elementsOf(tree)
    .filter((element) => element.type === 'input')
    .map((element) => element.props as { value?: string; checked?: boolean; disabled?: boolean; onChange: () => void });

describe('thread model options', () => {
  it('lists the bot default and every provider model, dimming unconfigured providers', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('thread.model'));
    expect(text).toContain(t('thread.modelUseBot'));
    expect(text).toContain('OpenCode Go');
    expect(text).toContain('DeepSeek V4.1 Flash');
    expect(text).toContain('anthropic/claude-sonnet-5');
    expect(text).toContain(t('thread.modelAddKey'));
    expect(html).toContain('disabled=""');
  });

  it('marks the default selected without an override and the override selected with one', () => {
    const defaults = inputsOf(ThreadModelOptions({ providers, error: null, botModel: 'opencode-go/deepseek-v4.1-flash', currentModel: undefined, busy: false, onPick: () => undefined }));
    expect(defaults[0]?.checked).toBe(true);
    expect(defaults.slice(1).every((input) => input.checked !== true)).toBe(true);

    const overridden = inputsOf(ThreadModelOptions({ providers, error: null, botModel: undefined, currentModel: 'opencode-go/kimi-k2', busy: false, onPick: () => undefined }));
    const kimi = overridden.find((input) => input.value === 'opencode-go/kimi-k2');
    expect(kimi?.checked).toBe(true);
    expect(overridden[0]?.checked).toBe(false);
  });

  it('picks a model and the bot default through the callback', () => {
    const picks: Array<string | null> = [];
    const tree = ThreadModelOptions({ providers, error: null, botModel: 'opencode-go/deepseek-v4.1-flash', currentModel: undefined, busy: false, onPick: (model) => picks.push(model) });
    const inputs = inputsOf(tree);

    inputs.find((input) => input.value === 'opencode-go/deepseek-v4.1-flash')?.onChange();
    inputs[0]?.onChange();
    expect(picks).toEqual(['opencode-go/deepseek-v4.1-flash', null]);
  });

  it('shows an unavailable message when the provider list failed', () => {
    const text = textOf(render({ providers: null, error: 'offline' }));

    expect(text).toContain(t('thread.modelUnavailable'));
    expect(text).not.toContain('OpenCode Go');
  });
});
