import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import type { VoiceInfo } from '../voice';
import { ClientProvider } from './client';
import { VoiceSection, type VoiceSectionProps } from './VoiceSection';

const at = '2026-10-19T09:00:00.000Z';

const system: VoiceInfo = {
  settings: { provider: 'system', voice: 'Samantha', secretName: 'tts', updatedAt: at },
  available: true,
};

const compatible = (available: boolean, reason?: string): VoiceInfo => ({
  settings: {
    provider: 'openai-compatible',
    voice: 'alloy',
    baseUrl: 'https://api.example.com/v1',
    model: 'tts-1',
    secretName: 'voice_key',
    updatedAt: at,
  },
  available,
  ...(reason === undefined ? {} : { reason }),
});

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<VoiceSectionProps> = {}): string {
  const props: VoiceSectionProps = { initialStatus: system, initialSecretNames: [], ...overrides };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <VoiceSection {...props} />
    </ClientProvider>,
  );
}

function inputValue(html: string, placeholder: string): string {
  const tag = html.match(new RegExp(`<input[^>]*placeholder="${placeholder}"[^>]*>`))?.[0] ?? '';
  return /value="([^"]*)"/.exec(tag)?.[1] ?? '';
}

describe('settings voice section', () => {
  it('renders both providers and the system voice with the availability line', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.voiceProvider'));
    expect(text).toContain(t('settings.voiceProviderSystem'));
    expect(text).toContain(t('settings.voiceProviderCompatible'));
    expect(text).toContain(t('settings.voiceSystemVoice'));
    expect(text).toContain(t('settings.voiceAvailable'));
    expect(text).toContain(t('settings.voiceTest'));
    expect(text).toContain(t('settings.voiceSave'));
    expect(inputValue(html, 'Samantha')).toBe('Samantha');
    expect(html).toMatch(/<input[^>]*name="voice-provider"[^>]*checked=""/);
  });

  it('shows the compatible fields, the key state and the availability reason', () => {
    const html = render({ initialStatus: compatible(false, 'The speech key is missing.'), initialSecretNames: [] });
    const text = textOf(html);

    expect(inputValue(html, 'https://api.openai.com/v1')).toBe('https://api.example.com/v1');
    expect(inputValue(html, 'gpt-4o-mini-tts')).toBe('tts-1');
    expect(text).toContain('voice_key');
    expect(html).toMatch(/<input[^>]*type="password"[^>]*>/);
    expect(text).toContain(t('settings.voiceKeyMissing'));
    expect(text).toContain(t('settings.voiceUnavailable', { reason: 'The speech key is missing.' }));
    expect(text).toContain(t('settings.voiceSaveKey'));
  });

  it('reports the key as saved when the vault lists its name', () => {
    const text = textOf(render({ initialStatus: compatible(true), initialSecretNames: ['voice_key'] }));

    expect(text).toContain(t('settings.voiceKeySaved'));
    expect(text).toContain(t('settings.voiceAvailable'));
    expect(text).not.toContain(t('settings.voiceKeyMissing'));
  });
});
