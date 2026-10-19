import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskStatus } from '@brot/protocol';
import { AvatarStack } from './AvatarStack';
import { BotAvatar } from './BotAvatar';
import { MessageBubble } from './MessageBubble';
import { TASK_STATUS_LABELS, TaskStatusLabel } from './TaskStatusLabel';

const members = [
  { id: 'a', species: 'capivara', color: 'teal' },
  { id: 'b', species: 'tucano', color: 'blue' },
  { id: 'c', species: 'boto', color: 'pink' },
  { id: 'd', shape: 'blob', color: 'amber' },
  { id: 'e', species: 'jabuti', color: 'white' },
] as const;

describe('AvatarStack', () => {
  it('draws up to max avatars and counts the rest', () => {
    const html = renderToStaticMarkup(<AvatarStack members={members} max={3} />);
    expect(html.match(/class="brot-bot"/g)).toHaveLength(3);
    expect(html).toContain('+2');
    expect(html).toContain('data-species="tucano"');
  });

  it('resolves legacy shapes in members', () => {
    expect(renderToStaticMarkup(<AvatarStack members={members.slice(3)} max={1} />)).toContain('data-species="mico"');
  });

  it('is one labeled image when given a label, hidden otherwise', () => {
    expect(renderToStaticMarkup(<AvatarStack members={members} label="Five bots" />)).toContain('aria-label="Five bots"');
    expect(renderToStaticMarkup(<AvatarStack members={members.slice(0, 2)} />)).toMatch(/^<span class="brot-stack"[^>]*aria-hidden="true"/);
  });
});

describe('BotAvatar gaze', () => {
  it('marks the gaze direction only when set', () => {
    expect(renderToStaticMarkup(<BotAvatar species="onca" color="teal" gaze="right" />)).toContain('data-gaze="right"');
    expect(renderToStaticMarkup(<BotAvatar species="onca" color="teal" />)).not.toContain('data-gaze');
  });
});

describe('TaskStatusLabel', () => {
  it('renders an icon and text for every status', () => {
    for (const status of TaskStatus.options) {
      const html = renderToStaticMarkup(<TaskStatusLabel status={status} />);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain('<svg');
      expect(html).toContain(TASK_STATUS_LABELS[status]);
    }
  });

  it('keeps the text for screen readers when icon-only', () => {
    const html = renderToStaticMarkup(<TaskStatusLabel status="blocked" label="Bloqueada" iconOnly />);
    expect(html).toContain('class="brot-sr-only">Bloqueada');
  });
});

describe('MessageBubble renderText', () => {
  it('renders settled text through renderText', () => {
    const html = renderToStaticMarkup(
      <MessageBubble role="user" content="hi @Capy" renderText={(text) => <b>{text.toUpperCase()}</b>} />,
    );
    expect(html).toContain('<b>HI @CAPY</b>');
  });

  it('leaves streaming text alone', () => {
    const html = renderToStaticMarkup(
      <MessageBubble role="assistant" content="partial" streaming renderText={() => <b>x</b>} />,
    );
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('partial');
  });
});
