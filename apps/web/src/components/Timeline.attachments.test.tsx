import type { Attachment, Bot, CanonicalEvent } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { foldEvents } from '../state/thread';
import { TeamProvider, type TeamContextValue } from './team';
import { Timeline } from './Timeline';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: true,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const image: Attachment = {
  id: 'att_img',
  name: 'receipt.png',
  mimeType: 'image/png',
  size: 2048,
  kind: 'image',
  createdAt: at,
  messageId: 'm1',
};

const pdf: Attachment = {
  id: 'att_pdf',
  name: 'plan.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  kind: 'file',
  createdAt: at,
  messageId: 'm1',
};

const events: CanonicalEvent[] = [
  {
    id: 'evt_1',
    at,
    threadId: 't1',
    type: 'message.completed',
    message: {
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'Receipt and plan attached',
      createdAt: at,
      attachments: [image, pdf],
    },
  },
];

const noop = () => undefined;
const team: TeamContextValue = {
  bots: { [bot.id]: bot },
  rooms: [],
  tasks: {},
  waitingBots: new Set(),
  openBot: noop,
  openRoom: noop,
  openTask: noop,
};

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(): string {
  const thread = foldEvents(events);
  return renderToStaticMarkup(
    <TeamProvider value={team}>
      <Timeline thread={thread} mode="dm" defaultBotId={bot.id} members={[]} onDecide={async () => undefined} />
    </TeamProvider>,
  );
}

describe('transcript attachments', () => {
  it('renders an image gallery and a file chip with links to the bytes', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain('Receipt and plan attached');
    expect(text).toContain(t('attachment.images'));
    expect(text).toContain(t('attachment.files'));

    expect(html).toContain('src="/api/attachments/att_img"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="receipt.png"');
    expect(html).toContain('href="/api/attachments/att_img"');

    expect(html).toContain('href="/api/attachments/att_pdf"');
    expect(text).toContain('plan.pdf');
    expect(text).toContain('2.0 KB');
  });

  it('renders only the message text when it has no attachments', () => {
    const thread = foldEvents([
      {
        id: 'evt_2',
        at,
        threadId: 't1',
        type: 'message.completed',
        message: { id: 'm2', threadId: 't1', role: 'user', content: 'No files here', createdAt: at },
      },
    ]);
    const html = renderToStaticMarkup(
      <TeamProvider value={team}>
        <Timeline thread={thread} mode="dm" defaultBotId={bot.id} members={[]} onDecide={async () => undefined} />
      </TeamProvider>,
    );

    expect(textOf(html)).toContain('No files here');
    expect(html).not.toContain('/api/attachments/');
  });
});
