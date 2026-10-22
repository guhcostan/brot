import type { Bot, Team } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { TeamDialog, type TeamDialogProps } from './TeamDialog';

const at = '2026-10-19T09:00:00.000Z';

const capy: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  teamId: 'team_growth',
  engine: 'dsh',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const mico: Bot = {
  ...capy,
  id: 'bot_2',
  name: 'Mico',
  job: 'Triage',
  teamId: undefined,
};

const growth: Team = {
  id: 'team_growth',
  name: 'Growth',
  instructions: 'Win the Acme renewal.',
  chiefBotId: capy.id,
  createdAt: at,
  updatedAt: at,
};

const noop = async () => undefined;

function render(overrides: Partial<TeamDialogProps> = {}): string {
  const props: TeamDialogProps = {
    open: true,
    bots: [capy, mico],
    onCreate: async () => growth,
    onUpdate: noop,
    onUpdateBot: noop,
    onDelete: noop,
    onClose: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<TeamDialog {...props} />);
}

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

describe('TeamDialog create', () => {
  it('renders the name, the shared brief and the roster', () => {
    const text = textOf(render());

    expect(text).toContain(t('teamForm.newTitle'));
    expect(text).toContain(t('teamForm.newDescription'));
    expect(text).toContain(t('teamForm.name'));
    expect(text).toContain(t('teamForm.brief'));
    expect(text).toContain(t('teamForm.briefHint'));
    expect(text).toContain(t('teamForm.members'));
    expect(text).toContain('Capy');
    expect(text).toContain('Mico');
    expect(text).toContain(t('teamForm.create'));
    expect(text).not.toContain(t('teamForm.delete'));
  });

  it('starts with no member checked and no chief to pick', () => {
    const html = render();

    expect(html).not.toContain('checked=""');
    expect(textOf(html)).toContain(t('teamForm.chiefEmpty'));
    expect(html).toContain('<option value="" selected="">');
  });
});

describe('TeamDialog edit', () => {
  it('prefills the name, the brief and the member roster', () => {
    const html = render({ team: growth });
    const text = textOf(html);

    expect(text).toContain(t('teamForm.editTitle', { name: 'Growth' }));
    expect(html).toContain('value="Growth"');
    expect(html).toContain('Win the Acme renewal.');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/<option value="bot_1" selected="">Capy<\/option>/);
    expect(text).toContain(t('teamForm.save'));
    expect(text).toContain(t('teamForm.delete'));
  });
});
