import type { ApprovalCardLabels } from '@brot/ui';
import { t } from '../i18n';

export function approvalLabels(): ApprovalCardLabels {
  return {
    kinds: {
      shell: t('approval.kind.shell'),
      file_write: t('approval.kind.file_write'),
      send: t('approval.kind.send'),
      publish: t('approval.kind.publish'),
      delete: t('approval.kind.delete'),
      purchase: t('approval.kind.purchase'),
      permission: t('approval.kind.permission'),
      other: t('approval.kind.other'),
    },
    decisions: {
      allow_once: t('approval.decided.allow_once'),
      allow_always: t('approval.decided.allow_always'),
      deny: t('approval.decided.deny'),
    },
    region: (summary) => t('approval.region', { summary }),
    waiting: t('status.waiting'),
    reply: t('approval.reply'),
    decide: t('approval.decide'),
    allowOnce: t('approval.allowOnce'),
    allowAlways: t('approval.allowAlways'),
    deny: t('approval.deny'),
  };
}
