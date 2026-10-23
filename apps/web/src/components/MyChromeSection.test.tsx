import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { MY_CHROME_DEFAULT_ENDPOINT } from '../data/client';
import { ClientProvider } from './client';
import { MyChromeSection, type MyChromeSectionProps } from './MyChromeSection';

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<MyChromeSectionProps> = {}): string {
  const props: MyChromeSectionProps = {
    initialStatus: { settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT }, available: true },
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <MyChromeSection {...props} />
    </ClientProvider>,
  );
}

describe('MyChromeSection', () => {
  it('shows the explanation, default endpoint and connected state', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.myChromeEndpoint'));
    expect(text).toContain(MY_CHROME_DEFAULT_ENDPOINT);
    expect(html).toContain(`value="${MY_CHROME_DEFAULT_ENDPOINT}"`);
    expect(text).toContain(t('settings.myChromeStart'));
    expect(text).toContain('google-chrome --remote-debugging-port=9333 --user-data-dir="$HOME/.brot-my-chrome"');
    expect(text).toContain(t('settings.myChromeConnected'));
    expect(text).toContain(t('settings.myChromeSafety'));
    expect(text).toContain(t('settings.myChromeSave'));
    expect(text).toContain(t('settings.myChromeTest'));
  });

  it('shows which browser the probe reached', () => {
    const text = textOf(
      render({
        initialStatus: {
          settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT },
          available: true,
          browser: { version: 'Chrome/142.0.7339.82', userAgent: 'Mozilla/5.0 Chrome/142.0.7339.82 Safari/537.36' },
        },
      }),
    );

    expect(text).toContain(t('settings.myChromeBrowser', { version: 'Chrome/142.0.7339.82' }));
    expect(text).toContain('Mozilla/5.0 Chrome/142.0.7339.82 Safari/537.36');
  });

  it('shows an unavailable reason', () => {
    const text = textOf(
      render({ initialStatus: { settings: { endpoint: 'http://127.0.0.1:9444' }, available: false, reason: 'Chrome is not listening on that endpoint.' } }),
    );

    expect(text).toContain(t('settings.myChromeUnavailableReason', { reason: 'Chrome is not listening on that endpoint.' }));
    expect(text).toContain('http://127.0.0.1:9444');
  });

  it('warns inline when the endpoint is not loopback or not http(s)', () => {
    const remote = render({ initialEndpoint: 'http://192.168.1.20:9222' });
    expect(textOf(remote)).toContain(t('settings.myChromeInvalid'));
    const save = remote.match(/<button[^>]*>Save<\/button>/)?.[0] ?? '';
    expect(save).toContain('disabled=""');

    const scheme = render({ initialEndpoint: 'ftp://127.0.0.1:9222' });
    expect(textOf(scheme)).toContain(t('settings.myChromeInvalid'));
  });

  it('shows the saved line', () => {
    expect(textOf(render({ initialSaved: true }))).toContain(t('settings.myChromeSaved'));
  });
});

describe('MyChromeSection safety state', () => {
  it('warns when the endpoint looks like an automation browser', () => {
    const text = textOf(
      render({
        initialStatus: { settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT }, available: true, automation: true },
      }),
    );

    expect(text).toContain(t('settings.myChromeAutomation'));
    expect(render({ initialStatus: { settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT }, available: true } })).not.toContain(
      `role="alert"`,
    );
  });

  it('renders the server hint verbatim instead of the web warning when present', () => {
    const serverHint = 'That is OpenMausBot’s Chrome. Close it and start your own with the Brot profile.';
    const html = render({
      initialStatus: { settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT }, available: true, automation: true, hint: serverHint },
    });
    const text = textOf(html);

    expect(text).toContain(serverHint);
    expect(text.split(serverHint)).toHaveLength(2);
    expect(text).not.toContain(t('settings.myChromeAutomation'));
  });

  it('prefers the server hint over the web status copy', () => {
    const html = render({
      initialStatus: {
        settings: { endpoint: 'http://127.0.0.1:9444' },
        available: false,
        reason: 'No browser answered on that port.',
        hint: 'Start Chrome with the Brot profile and try again.',
      },
    });

    const text = textOf(html);
    expect(text).toContain('Start Chrome with the Brot profile and try again.');
    expect(text).not.toContain(t('settings.myChromeUnavailableReason', { reason: 'No browser answered on that port.' }));
  });
});
