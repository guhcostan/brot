import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { formatBytes } from '../format';
import { t } from '../i18n';
import type { BackupEntry, BackupStatus } from '../data/client';
import { BackupsSection, type BackupsSectionProps } from './BackupsSection';
import { ClientProvider } from './client';

const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
const nextRun = new Date(Date.now() + 10 * 3_600_000).toISOString();

const entry = (overrides: Partial<BackupEntry> = {}): BackupEntry => ({
  name: 'brot-backup-2026-10-19-030000',
  createdAt: twoHoursAgo,
  sizeBytes: 2_400_000,
  includesSecrets: true,
  ...overrides,
});

const status: BackupStatus = {
  settings: { enabled: true, intervalHours: 12, keep: 3, lastRunAt: twoHoursAgo, lastBackupName: entry().name },
  backups: [entry(), entry({ name: 'brot-backup-2026-10-17-030000', createdAt: '2026-10-17T03:00:00.000Z', sizeBytes: 2_100_000, includesSecrets: false })],
  nextRunAt: nextRun,
};

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<BackupsSectionProps> = {}): string {
  const props: BackupsSectionProps = { initialStatus: status, ...overrides };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <BackupsSection {...props} />
    </ClientProvider>,
  );
}

const saveButton = (html: string): string => html.match(/<button[^>]*data-variant="primary"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

describe('BackupsSection', () => {
  it('renders the schedule form, status lines and recent backups', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.backupEnabled'));
    expect(text).toContain(t('settings.backupInterval'));
    expect(text).toContain(t('settings.backupKeep'));
    expect(text).toContain(t('settings.backupLastRun', { name: entry().name, time: '2 hours ago' }));
    expect(text).toContain(t('settings.backupNextRun', { time: 'in 10 hours' }));
    expect(text).toContain(t('settings.backupRecent'));
    expect(text).toContain('brot-backup-2026-10-19-030000');
    expect(text).toContain(formatBytes(2_400_000));
    expect(text).toContain(formatBytes(2_100_000));
    expect(text).toContain(t('settings.backupIncludesSecrets'));
    expect(text).toContain(t('settings.backupRunNow'));
    expect(text).toContain(t('settings.backupRefresh'));
  });

  it('shows inline validation errors and disables Save', () => {
    const html = render({ initialForm: { intervalHours: '0', keep: '99' } });
    const text = textOf(html);

    expect(text).toContain(t('settings.backupIntervalError'));
    expect(text).toContain(t('settings.backupKeepError'));
    expect(saveButton(html)).toContain('disabled=""');
  });

  it('shows the last error in the attention tone', () => {
    const html = render({
      initialStatus: { ...status, settings: { ...status.settings, lastError: 'Disk full' } },
    });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain(t('settings.backupLastError', { error: 'Disk full' }));
  });

  it('shows a run-now success line with name and size', () => {
    const created = entry({ name: 'brot-backup-2026-10-23-052000', sizeBytes: 2_500_000 });
    const text = textOf(render({ initialRunResult: created }));

    expect(text).toContain(t('settings.backupRunSuccess', { name: created.name, size: formatBytes(created.sizeBytes) }));
    expect(text).toContain(created.name);
  });

  it('shows the empty and loading states', () => {
    const empty = textOf(render({ initialStatus: { settings: { enabled: false, intervalHours: 24, keep: 5 }, backups: [] } }));

    expect(empty).toContain(t('settings.backupEmptyTitle'));
    expect(empty).toContain(t('settings.backupEmptyBody'));
    expect(empty).toContain(t('settings.backupNever'));

    expect(render({ initialStatus: undefined })).toContain('aria-busy="true"');
  });

  it('shows an inline error slot', () => {
    const html = render({ initialStatus: undefined, initialError: 'Backups did not load.' });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Backups did not load.');
  });
});
