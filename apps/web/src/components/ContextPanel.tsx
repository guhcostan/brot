import { useId, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { Badge, Button, Card, EmptyState, cx, type FaunaKind } from '@brot/ui';
import { faunaOf, formatCount, formatTime, formatUsd } from '../format';
import { t, type TranslationKey } from '../i18n';
import { sumCost, type ThreadState } from '../state/thread';

const TABS = ['computer', 'memory', 'skills', 'apps', 'routines', 'cost'] as const;
type TabId = (typeof TABS)[number];

const TAB_LABEL: Record<TabId, TranslationKey> = {
  computer: 'context.computer',
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

export function ContextPanel({ bot, thread, onClose, className }: ContextPanelProps): ReactElement {
  const [tab, setTab] = useState<TabId>('computer');
  const idBase = useId();
  const animal = faunaOf(bot);

  return (
    <div className={cx('flex min-h-0 flex-col bg-surface md:border-l md:border-line', className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div role="tablist" aria-label={t('context.tablist')} className="flex min-w-0 flex-1 flex-wrap gap-1">
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
                'rounded-sm px-2 py-1 text-xs font-medium',
                tab === id ? 'bg-paper text-ink shadow-[var(--shadow-1)]' : 'text-ink-2 hover:bg-paper',
              )}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {t('context.close')}
        </Button>
      </div>

      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <TabBody tab={tab} bot={bot} thread={thread} animal={animal} />
      </div>
    </div>
  );
}

interface TabBodyProps {
  tab: TabId;
  bot: Bot;
  thread: ThreadState;
  animal: FaunaKind;
}

function TabBody({ tab, bot, thread, animal }: TabBodyProps): ReactElement {
  const name = bot.name;

  switch (tab) {
    case 'computer':
      return bot.computer === 'none' ? (
        <EmptyState
          animal={animal}
          title={t('context.noComputerTitle')}
          description={t('context.noComputerBody', { name })}
        />
      ) : (
        <EmptyState animal={animal} title={t('context.computerTitle')} description={t('context.computerBody', { name })} />
      );

    case 'memory':
      if (thread.memories.length === 0) {
        return (
          <EmptyState animal={animal} title={t('context.memoryTitle')} description={t('context.memoryBody', { name })} />
        );
      }
      return (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {thread.memories.map((memory) => (
            <li key={memory.id}>
              <Card className="flex flex-col gap-2">
                <Badge>{memory.kind}</Badge>
                <p className="m-0 text-sm">{memory.content}</p>
                <span className="text-xs text-ink-2">{formatTime(memory.updatedAt)}</span>
              </Card>
            </li>
          ))}
        </ul>
      );

    case 'skills':
      return <EmptyState animal={animal} title={t('context.skillsTitle')} description={t('context.skillsBody', { name })} />;

    case 'apps':
      return <EmptyState animal={animal} title={t('context.appsTitle')} description={t('context.appsBody')} />;

    case 'routines':
      return (
        <EmptyState animal={animal} title={t('context.routinesTitle')} description={t('context.routinesBody', { name })} />
      );

    case 'cost': {
      const total = sumCost(thread);
      return (
        <Card className="flex flex-col gap-3">
          <h2 className="m-0 font-serif text-[length:var(--text-lg)] font-semibold">{t('context.costTitle')}</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-2">{t('context.costTokens')}</dt>
            <dd className="m-0 tabular-nums">
              {formatCount(total.tokensIn)} / {formatCount(total.tokensOut)}
            </dd>
            <dt className="text-ink-2">{t('context.costUsd')}</dt>
            <dd className="m-0 tabular-nums">{formatUsd(total.costUsd)}</dd>
          </dl>
        </Card>
      );
    }
  }
}
