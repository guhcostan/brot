import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { emptyThread, type MessageItem, type ThreadState } from '../state/thread';
import type { VoiceContext } from '../voice';
import { silentWavBlob } from '../voice';
import { TeamProvider } from './team';
import { Timeline } from './Timeline';

const at = '2026-10-19T09:00:00.000Z';

const message: MessageItem = {
  kind: 'message',
  id: 'msg_1',
  role: 'assistant',
  content: 'The Acme renewal is on track.',
  streaming: false,
  at,
  authorBotId: 'bot_capy',
};

const thread: ThreadState = { ...emptyThread, items: [message] };

const voice = (available: boolean, reason?: string): VoiceContext => ({
  status: {
    settings: { provider: 'system', voice: 'Samantha', secretName: 'tts', updatedAt: at },
    available,
    ...(reason === undefined ? {} : { reason }),
  },
  speak: async () => ({ blob: silentWavBlob(), contentType: 'audio/wav' }),
});

const noop = () => undefined;

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(options: { voice?: VoiceContext } = {}): string {
  return renderToStaticMarkup(
    <TeamProvider
      value={{
        bots: Object.fromEntries(DEMO_BOTS.map((bot) => [bot.id, bot])),
        rooms: [],
        tasks: {},
        waitingBots: new Set(),
        openBot: noop,
        openRoom: noop,
        openTask: noop,
      }}
    >
      <Timeline
        thread={thread}
        mode="dm"
        defaultBotId="bot_capy"
        members={[]}
        onDecide={async () => undefined}
        {...options}
      />
    </TeamProvider>,
  );
}

describe('Timeline voice button', () => {
  it('shows a Listen button on assistant messages when voice is available', () => {
    const html = render({ voice: voice(true) });
    const text = textOf(html);

    expect(text).toContain(message.content);
    expect(html).toContain(`aria-label="${t('voice.listen')}"`);
    expect(html).not.toContain('disabled=""');
  });

  it('disables the button with the reason when voice is unavailable', () => {
    const html = render({ voice: voice(false, 'The speech key is missing.') });
    const button = html.match(new RegExp(`<button[^>]*aria-label="${t('voice.listen')}"[^>]*>`))?.[0] ?? '';

    expect(button).toContain('disabled=""');
    expect(button).toContain('The speech key is missing.');
  });

  it('renders no listen button when the app has no voice context', () => {
    const html = render();

    expect(html).not.toContain(`aria-label="${t('voice.listen')}"`);
  });
});
