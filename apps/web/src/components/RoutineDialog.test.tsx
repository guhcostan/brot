import type { Routine } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { RoutineDialog, type RoutineDialogProps } from './RoutineDialog';

const at = '2026-10-19T09:00:00.000Z';

const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: 'routine_1',
  botId: 'bot_capy',
  name: 'Morning brief',
  instruction: 'Summarize overnight email and list the three priorities.',
  trigger: { type: 'cron', cron: '30 7 1 * *', timezone: 'Europe/Lisbon' },
  enabled: false,
  catchUp: false,
  rememberLastRun: true,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const noop = async () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<RoutineDialogProps> = {}): string {
  const props: RoutineDialogProps = {
    open: true,
    bots: DEMO_BOTS,
    onClose: () => undefined,
    onCreate: noop,
    onUpdate: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<RoutineDialog {...props} />);
}

describe('routine dialog', () => {
  it('offers the full schedule builder for a new routine', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('routines.dialog.newTitle'));
    expect(text).toContain(t('routines.bot'));
    expect(text).toContain('Capy · Chief of Staff');
    expect(text).toContain(t('routines.name'));
    expect(text).toContain(t('routines.instructionHint'));
    for (const preset of ['every15', 'hourly', 'daily', 'weekdays', 'weekly', 'custom'] as const) {
      expect(text).toContain(t(`routines.preset.${preset}`));
    }
    expect(text).toContain(t('routines.timezone'));
    expect(text).toContain(t('routines.catchUp'));
    expect(text).toContain(t('routines.rememberLastRun'));
    expect(text).toContain(t('routines.enabled'));
    // The default preset is weekdays at 09:00, so its time field and cron preview render.
    expect(html).toContain('value="09:00"');
    expect(text).toContain(t('routines.cronEffective', { cron: '0 9 * * 1-5' }));
    expect(text).toContain(t('routines.create'));
    expect(text).toContain(t('dialog.cancel'));
  });

  it('prefills an edit with the instruction, schedule, timezone and flags', () => {
    const html = render({ routine: routine({ trigger: { type: 'cron', cron: '0 9 * * 1', timezone: 'America/Sao_Paulo' }, enabled: true, catchUp: true, rememberLastRun: false }) });
    const text = textOf(html);

    expect(text).toContain(t('routines.dialog.editTitle'));
    expect(text).toContain('Summarize overnight email and list the three priorities.');
    // Editing keeps the bot: the fixed bot chip replaces the picker.
    expect(text).not.toContain('Capy · Chief of Staff');
    expect(text).toContain(t('routines.cronEffective', { cron: '0 9 * * 1' }));
    expect(html).toContain('value="09:00"');
    expect(html).toContain('<option value="America/Sao_Paulo" selected="">');
    // One checked radio (weekly) plus catchUp and enabled.
    expect(html.match(/checked=""/g)).toHaveLength(3);
    expect(text).toContain(t('routines.save'));
  });

  it('opens a custom cron routine on the custom field and shows unchecked flags', () => {
    const html = render({ routine: routine({ rememberLastRun: false }) });
    const text = textOf(html);

    expect(html).toContain('value="30 7 1 * *"');
    expect(text).toContain(t('routines.cronHint'));
    expect(html).toContain('<option value="Europe/Lisbon" selected="">');
    // Only the custom preset radio is checked: every option flag starts off.
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it('cannot create a routine without a bot', () => {
    const text = textOf(render({ bots: [] }));

    expect(text).toContain(t('routines.noBotsTitle'));
  });
});

describe('routine dialog webhook section', () => {
  const hook = routine({
    id: 'routine_hook',
    name: 'Deploy hook',
    trigger: { type: 'webhook', secret: 'wh_secret_123' },
  });

  it('shows the URL, credential warning, copy and rotate for a webhook routine', () => {
    const html = render({ routine: hook, webhookPort: 8992, onRotateWebhook: async () => hook });
    const text = textOf(html);

    expect(text).toContain(t('routines.dialog.webhookTitle'));
    expect(text).toContain(t('routines.dialog.webhookCredential'));
    expect(text).toContain('http://127.0.0.1:8992/h/wh_secret_123');
    expect(html).toContain(`aria-label="${t('routines.webhookCopyUrl')}"`);
    expect(text).toContain(t('routines.webhookRotate'));
  });

  it('shows the secret and the port hint without a URL when the port is unknown', () => {
    const html = render({ routine: hook, onRotateWebhook: async () => hook });
    const text = textOf(html);

    expect(text).toContain('wh_secret_123');
    expect(text).toContain(t('routines.webhookPortMissing'));
    expect(text).not.toContain('/h/wh_secret_123');
  });
});
