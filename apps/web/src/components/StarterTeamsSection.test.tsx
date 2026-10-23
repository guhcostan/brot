import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StarterTeamSummary } from '../data/client';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { ClientProvider } from './client';
import { StarterTeamsSection, type StarterTeamsSectionProps } from './StarterTeamsSection';

const starters: StarterTeamSummary[] = [
  { id: 'dev-team', name: 'Dev team', description: 'A chief of staff, an engineer and a reviewer.', teamCount: 1, botCount: 3, roomCount: 1, routineCount: 1, skillCount: 1 },
  { id: 'ops-desk', name: 'Ops desk', description: 'Support triage and finance.', teamCount: 1, botCount: 2, roomCount: 1, routineCount: 1, skillCount: 1 },
];

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<StarterTeamsSectionProps> = {}): string {
  const props: StarterTeamsSectionProps = { initialStarters: starters, ...overrides };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <StarterTeamsSection {...props} />
    </ClientProvider>,
  );
}

describe('StarterTeamsSection', () => {
  it('renders a card per starter with name, description, counts and Install', () => {
    const text = textOf(render());

    expect(text).toContain('Dev team');
    expect(text).toContain('A chief of staff, an engineer and a reviewer.');
    expect(text).toContain(t('settings.starterCounts', { bots: '3', rooms: '1', routines: '1', skills: '1' }));
    expect(text).toContain(t('settings.starterCounts', { bots: '2', rooms: '1', routines: '1', skills: '1' }));
    expect((text.match(new RegExp(`>${t('settings.starterInstall')}<`, 'g')) ?? []).length).toBe(2);
  });

  it('shows a success line per installed card', () => {
    const text = textOf(
      render({
        initialResults: { 'dev-team': { counts: { bots: 3, teams: 1, rooms: 1, routines: 1, skills: 1 } } },
      }),
    );

    expect(text).toContain(t('settings.starterInstalled', { bots: '3', teams: '1', rooms: '1' }));
  });

  it('shows a card-level error slot', () => {
    const html = render({ initialResults: { 'ops-desk': { error: 'Install failed hard.' } } });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Install failed hard.');
  });

  it('shows the empty state, loading and a load error with retry', () => {
    expect(textOf(render({ initialStarters: [] }))).toContain(t('settings.starterEmptyTitle'));
    expect(render({ initialStarters: undefined })).toContain('aria-busy="true"');
    expect(textOf(render({ initialStarters: [], initialResults: {} }))).toContain(t('settings.starterEmptyBody'));
  });
});
