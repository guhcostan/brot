import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import type { BackupEntry } from './create';
import { UpdateBackupSettings } from './settings';
import type { BackupService } from './service';

/** The admin activity entries backups record. The app supplies the actor through its recorder. */
export interface BackupActivityEntry {
  action: 'created' | 'updated';
  targetType: 'backup';
  summary: string;
}

export interface BackupRouteDeps {
  backups: BackupService;
  /** Best-effort recorder; the app passes its actor-aware activity helper. */
  record?(c: Context<AppEnv>, entry: BackupActivityEntry): Promise<void>;
}

/** What GET /api/backups returns: never file paths, file contents or secrets. */
export interface BackupStateView {
  settings: Awaited<ReturnType<BackupService['getSettings']>>;
  backups: BackupEntry[];
  nextRunAt?: string;
}

/**
 * Mounts the backup settings and history under `/api/*`, so device auth applies. The settings are stored under the
 * generic `backups` key; the backups themselves stay in `<home>/backups` and are only listed by name and size.
 */
export function mountBackupRoutes(app: Hono<AppEnv>, deps: BackupRouteDeps): void {
  const { backups } = deps;

  app.get('/api/backups', async (c) => {
    const settings = await backups.getSettings();
    const entries = await backups.list();
    const nextRunAt = await backups.nextRunAt();
    const view: BackupStateView = { settings, backups: entries, ...(nextRunAt === undefined ? {} : { nextRunAt }) };
    return c.json(view);
  });

  app.put('/api/backups', async (c) => {
    let raw: unknown;
    try {
      const text = await c.req.text();
      raw = text.trim() === '' ? {} : (JSON.parse(text) as unknown);
    } catch {
      return c.json({ error: 'Request body must be valid JSON', issues: [] }, 400);
    }
    const parsed = UpdateBackupSettings.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const settings = await backups.saveSettings(parsed.data);
    await recordQuietly(c, deps, { action: 'updated', targetType: 'backup', summary: 'Updated backup settings' });
    return c.json(settings);
  });

  app.post('/api/backups/run', async (c) => {
    try {
      const backup = await backups.createNow();
      await recordQuietly(c, deps, { action: 'created', targetType: 'backup', summary: 'Created backup' });
      return c.json(backup, 201);
    } catch (error) {
      // The message could name a local path; the client only needs to know the backup failed.
      console.error('manual backup failed', error);
      return c.json({ error: 'The backup could not be created.' }, 500);
    }
  });
}

async function recordQuietly(c: Context<AppEnv>, deps: BackupRouteDeps, entry: BackupActivityEntry): Promise<void> {
  try {
    await deps.record?.(c, entry);
  } catch (error) {
    console.error('could not record backup activity', error);
  }
}
