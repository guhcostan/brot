import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Room } from '../data/client';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { emptyThread } from '../state/thread';
import { createMockClient } from '../data/mockClient';
import { ClientProvider } from './client';
import { RoomView, type RoomViewProps } from './RoomView';
import { TeamProvider } from './team';

const at = '2026-10-19T09:00:00.000Z';

const room: Room = {
  thread: {
    id: 'room_1',
    botId: 'bot_capy',
    title: 'Acme renewal',
    kind: 'room',
    leadBotId: 'bot_capy',
    responder: 'lead',
    createdAt: at,
    updatedAt: at,
  },
  memberIds: ['bot_capy', 'bot_onca'],
};

const noopAsync = async () => undefined;

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<RoomViewProps> = {}): string {
  const props: RoomViewProps = {
    room,
    members: DEMO_BOTS.filter((bot) => room.memberIds.includes(bot.id)),
    thread: emptyThread,
    status: 'idle',
    onSend: noopAsync,
    onDecide: noopAsync,
    onOpenBots: () => undefined,
    onOpenContext: () => undefined,
    onDeleteRoom: noopAsync,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <TeamProvider
        value={{
          bots: Object.fromEntries(DEMO_BOTS.map((bot) => [bot.id, bot])),
          rooms: [room],
          tasks: {},
          waitingBots: new Set(),
          openBot: () => undefined,
          openRoom: () => undefined,
          openTask: () => undefined,
        }}
      >
        <RoomView {...props} />
      </TeamProvider>
    </ClientProvider>,
  );
}

describe('RoomView room actions', () => {
  it('keeps the overflow menu closed until it is opened', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('room.actions'));
    expect(html).toContain('aria-expanded="false"');
    expect(text).not.toContain(t('room.delete'));
  });

  it('shows the delete action in the opened overflow menu', () => {
    const text = textOf(render({ initialMenuOpen: true }));

    expect(text).toContain(t('room.delete'));
  });

  it('confirms deletion with the exact consequence copy', () => {
    const text = textOf(render({ initialDeleteOpen: true }));

    expect(text).toContain(t('room.deleteTitle', { title: 'Acme renewal' }));
    expect(text).toContain(t('room.deleteBody'));
    expect(text).toContain(t('room.delete'));
  });

  it('hides the action when the caller cannot delete rooms', () => {
    const text = textOf(render({ onDeleteRoom: undefined }));

    expect(text).not.toContain(t('room.actions'));
  });
});
