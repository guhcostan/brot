import type { BotStatus } from '@brot/ui';
import type { TaskStatus } from '@brot/protocol';
import { t, type TranslationKey } from '../i18n';

const STATUS_KEY: Record<TaskStatus, TranslationKey> = {
  open: 'task.status.open',
  in_progress: 'task.status.in_progress',
  blocked: 'task.status.blocked',
  done: 'task.status.done',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
};

export function taskStatusLabel(status: TaskStatus): string {
  return t(STATUS_KEY[status]);
}

const BOT_STATUS_KEY: Record<BotStatus, TranslationKey> = {
  idle: 'status.idle',
  working: 'status.working',
  waiting: 'status.waiting',
  error: 'status.error',
  ok: 'status.ok',
  sleeping: 'status.sleeping',
};

export function botStatusLabel(status: BotStatus): string {
  return t(BOT_STATUS_KEY[status]);
}
