import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_SPECIES, BACK_POSE, SPECIES_GEOMETRY } from './avatar';
import { BotAvatar, BrandMark, STATUS_MOOD } from './BotAvatar';
import { BOT_STATUSES } from './StatusDot';

describe('BotAvatar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders every species as an svg with a head, its tone, and two eye strokes', () => {
    for (const species of AVATAR_SPECIES) {
      const html = renderToStaticMarkup(<BotAvatar species={species} color="teal" />);
      expect(html).toContain(`data-species="${species}"`);
      expect(html.match(/class="brot-bot__eye"/g)).toHaveLength(2);
      expect(html).toContain('class="brot-bot__fill"');
      expect(html).toContain('var(--avatar-teal)');
      expect(html).toContain('var(--avatar-teal-tone)');
      expect(html).toContain('aria-hidden="true"');
      expect(html.includes('brot-bot__back')).toBe(SPECIES_GEOMETRY[species].back.length > 0);
      expect(html.includes('brot-bot__front')).toBe(SPECIES_GEOMETRY[species].front.length > 0);
    }
  });

  it('still accepts a legacy shape and draws its species', () => {
    expect(renderToStaticMarkup(<BotAvatar shape="cloud" color="teal" />)).toContain('data-species="preguica"');
    expect(renderToStaticMarkup(<BotAvatar shape="lobo" color="teal" />)).toContain('data-species="lobo"');
  });

  it('perks the ears with the mood, as a transform only', () => {
    const idle = renderToStaticMarkup(<BotAvatar species="lobo" color="blue" />);
    const approval = renderToStaticMarkup(<BotAvatar species="lobo" color="blue" mood="approval" />);
    expect(idle).toContain('translate(0px, 0px) rotate(0deg) scale(1)');
    expect(approval).toContain(`translate(0px, ${BACK_POSE.approval.y}px) rotate(0deg) scale(${BACK_POSE.approval.scale})`);
  });

  it('exposes a label as an image and sizes by name or pixels', () => {
    const html = renderToStaticMarkup(<BotAvatar species="boto" color="blue" size="lg" label="Lua" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Lua"');
    expect(html).toContain('width="48"');
    expect(renderToStaticMarkup(<BotAvatar species="boto" color="blue" size={20} />)).toContain('width="20"');
  });

  it('marks the mood and animates by default', () => {
    const html = renderToStaticMarkup(<BotAvatar species="capivara" color="pink" mood="thinking" />);
    expect(html).toContain('data-mood="thinking"');
    expect(html).toContain('data-animated="true"');
  });

  it('server-renders the motion-agnostic face so hydration matches, whatever the client prefers', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce') }));
    vi.stubGlobal('window', { matchMedia });
    const html = renderToString(<BotAvatar species="capivara" color="pink" mood="approval" />);
    expect(html).toContain('data-mood="approval"');
    expect(html).toContain('data-animated="true"');
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('renders the same markup every time, so server HTML hydrates cleanly', () => {
    const render = () => renderToString(<BotAvatar species="mico" color="teal" mood="thinking" />);
    expect(render()).toBe(render());
    expect(render()).not.toContain('--avatar-phase');
  });

  it('stays still when animation is turned off', () => {
    const html = renderToString(<BotAvatar species="capivara" color="pink" animated={false} />);
    expect(html).not.toContain('data-animated');
  });

  it('renders the brand mark as a still black capybara with idle eyes', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('data-species="capivara"');
    expect(html).toContain('data-mood="idle"');
    expect(html).toContain('var(--avatar-black)');
    expect(html).not.toContain('data-animated');
  });

  it('maps every bot status to a mood', () => {
    for (const status of BOT_STATUSES) expect(STATUS_MOOD[status]).toBeTruthy();
  });
});
