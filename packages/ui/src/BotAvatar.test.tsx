import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_SHAPES } from './avatar';
import { BotAvatar, BrandMark, STATUS_MOOD } from './BotAvatar';
import { BOT_STATUSES } from './StatusDot';

describe('BotAvatar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders every shape as an svg with two eye strokes', () => {
    for (const shape of AVATAR_SHAPES) {
      const html = renderToStaticMarkup(<BotAvatar shape={shape} color="teal" />);
      expect(html).toContain(`data-shape="${shape}"`);
      expect(html.match(/class="brot-bot__eye"/g)).toHaveLength(2);
      expect(html).toContain('var(--avatar-teal)');
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('exposes a label as an image and sizes by name or pixels', () => {
    const html = renderToStaticMarkup(<BotAvatar shape="cloud" color="blue" size="lg" label="Lua" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Lua"');
    expect(html).toContain('width="48"');
    expect(renderToStaticMarkup(<BotAvatar shape="cloud" color="blue" size={20} />)).toContain('width="20"');
  });

  it('marks the mood and animates by default', () => {
    const html = renderToStaticMarkup(<BotAvatar shape="circle" color="pink" mood="thinking" />);
    expect(html).toContain('data-mood="thinking"');
    expect(html).toContain('data-animated="true"');
  });

  it('server-renders the motion-agnostic face so hydration matches, whatever the client prefers', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce') }));
    vi.stubGlobal('window', { matchMedia });
    const html = renderToString(<BotAvatar shape="circle" color="pink" mood="approval" />);
    expect(html).toContain('data-mood="approval"');
    expect(html).toContain('data-animated="true"');
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('renders the same markup every time, so server HTML hydrates cleanly', () => {
    const render = () => renderToString(<BotAvatar shape="cloud" color="teal" mood="thinking" />);
    expect(render()).toBe(render());
    expect(render()).not.toContain('--avatar-phase');
  });

  it('stays still when animation is turned off', () => {
    const html = renderToString(<BotAvatar shape="circle" color="pink" animated={false} />);
    expect(html).not.toContain('data-animated');
  });

  it('renders the brand mark as a still black squircle', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('data-shape="squircle"');
    expect(html).toContain('var(--avatar-black)');
    expect(html).not.toContain('data-animated');
  });

  it('maps every bot status to a mood', () => {
    for (const status of BOT_STATUSES) expect(STATUS_MOOD[status]).toBeTruthy();
  });
});
