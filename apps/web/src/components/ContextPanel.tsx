import { useId, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { Badge, BotAvatar, Button, Card, EmptyState, cx } from '@brot/ui';
import { avatarOf, formatCount, formatTime, formatUsd } from '../format';
import { t, type TranslationKey } from '../i18n';
import { sumCost, type ThreadState } from '../state/thread';

const TABS = ['memory', 'skills', 'apps', 'routines', 'cost'] as const;
type TabId = (typeof TABS)[number];

const TAB_LABEL: Record<TabId, TranslationKey> = {
  memory: 'context.memory',
  skills: 'context.skills',
  apps: 'context.apps',
  routines: 'context.routines',
  cost: 'context.cost',
};

export interface ContextPanelProps {
  bot: Bot;
  thread: ThreadState;
  onClose: () => void;
  className?: string;
}

/** The bot's computer on top, then text tabs with an underline (DESIGN.md section 7). */
export function ContextPanel({ bot, thread, onClose, className }: ContextPanelProps): ReactElement {
  const [tab, setTab] = useState<TabId>('memory');
  const idBase = useId();

  return (
    <aside className={cx('flex min-h-0 flex-col bg-surface md:border-l md:border-line', className)}>
      <div className="flex h-14 flex-none items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="m-0 text-base font-semibold tracking-[var(--tracking-heading)]">{t('context.computer')}</h2>
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {t('context.close')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Computer bot={bot} />

        <div
          role="tablist"
          aria-label={t('context.tablist')}
          className="no-scrollbar sticky top-0 z-10 flex gap-4 overflow-x-auto border-b border-line bg-surface px-4"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${idBase}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${idBase}-panel`}
              onClick={() => setTab(id)}
              className={cx(
                '-mb-px flex-none border-b-2 py-3 text-sm font-medium transition-colors duration-[var(--dur-fast)]',
                tab === id ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${tab}`} className="p-4">
          <TabBody tab={tab} bot={bot} thread={thread} />
        </div>
      </div>
    </aside>
  );
}

function Computer({ bot }: { bot: Bot }): ReactElement {
  const name = bot.name;
  const avatar = avatarOf(bot);
  if (bot.computer === 'none') {
    return (
      <div className="flex flex-col gap-1 border-b border-line p-4">
        <p className="m-0 text-base font-medium">{t('context.noComputerTitle')}</p>
        <p className="m-0 text-sm text-ink-2">{t('context.noComputerBody', { name })}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 border-b border-line p-4">
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface-2 p-4 text-center">
        <BotAvatar shape={avatar.shape} color={avatar.color} mood="sleeping" size="md" />
        <p className="m-0 max-w-[30ch] text-sm text-ink-2">{t('context.computerBody', { name })}</p>
      </div>
      <p className="m-0 text-sm font-medium">{t('context.computerTitle')}</p>
    </div>
  );
}

function TabBody({ tab, bot, thread }: { tab: TabId; bot: Bot; thread: ThreadState }): ReactElement {
  const name = bot.name;

  switch (tab) {
    case 'memory':
      if (thread.memories.length === 0) {
        return <EmptyState className="py-8" title={t('context.memoryTitle')} description={t('context.memoryBody', { name })} />;
      }
      return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {thread.memories.map((memory) => (
            <li key={memory.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{memory.kind}</Badge>
                  <span className="text-xs text-ink-3 tabular-nums">{formatTime(memory.updatedAt)}</span>
                </div>
                <p className="m-0 text-base">{memory.content}</p>
              </Card>
            </li>
          ))}
        </ul>
      );

    case 'skills':
      return <EmptyState className="py-8" title={t('context.skillsTitle')} description={t('context.skillsBody', { name })} />;

    case 'apps':
      return <EmptyState className="py-8" title={t('context.appsTitle')} description={t('context.appsBody')} />;

    case 'routines':
      return <EmptyState className="py-8" title={t('context.routinesTitle')} description={t('context.routinesBody', { name })} />;

    case 'cost': {
      const total = sumCost(thread);
      return (
        <div className="flex flex-col gap-4">
          <h3 className="m-0 text-sm font-medium text-ink-2">{t('context.costTitle')}</h3>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
              <dt className="text-xs text-ink-2">{t('context.costTokens')}</dt>
              <dd className="m-0 text-md font-semibold tabular-nums">
                {formatCount(total.tokensIn)} / {formatCount(total.tokensOut)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
              <dt className="text-xs text-ink-2">{t('context.costUsd')}</dt>
              <dd className="m-0 text-md font-semibold tabular-nums">{formatUsd(total.costUsd)}</dd>
            </div>
          </dl>
        </div>
      );
    }
  }
}
