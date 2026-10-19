import { useMemo, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { Avatar, Fauna, Input, StatusDot, cx, type BotStatus } from '@brot/ui';
import { faunaOf } from '../format';
import { t } from '../i18n';

export interface SidebarProps {
  bots: Bot[];
  statusOf: (botId: string) => BotStatus;
  selectedId: string | null;
  onSelect: (botId: string) => void;
  className?: string;
}

export function Sidebar({ bots, statusOf, selectedId, onSelect, className }: SidebarProps): ReactElement {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter(
      (bot) => bot.name.toLowerCase().includes(needle) || bot.job.toLowerCase().includes(needle),
    );
  }, [bots, query]);

  const pinned = visible.filter((bot) => bot.pinned);
  const others = visible.filter((bot) => !bot.pinned);
  const rowProps = { statusOf, selectedId, onSelect };

  return (
    <nav aria-label={t('thread.bots')} className={cx('flex min-h-0 flex-col gap-4 bg-paper p-3 md:border-r md:border-line', className)}>
      <div className="flex items-center gap-2 px-2 pt-1">
        <Fauna kind="capybara" size={28} />
        <span className="font-serif text-[length:var(--text-xl)] leading-none font-semibold tracking-tight">
          {t('app.name')}
        </span>
      </div>

      <Input
        type="search"
        label={t('sidebar.search')}
        hideLabel
        placeholder={t('sidebar.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {visible.length === 0 ? <p className="px-2 text-xs text-ink-2">{t('sidebar.empty', { query })}</p> : null}
        {pinned.length > 0 ? <BotSection title={t('sidebar.pinned')} bots={pinned} {...rowProps} /> : null}
        {others.length > 0 ? <BotSection title={t('sidebar.all')} bots={others} {...rowProps} /> : null}
      </div>
    </nav>
  );
}

interface BotSectionProps {
  title: string;
  bots: Bot[];
  statusOf: (botId: string) => BotStatus;
  selectedId: string | null;
  onSelect: (botId: string) => void;
}

function BotSection({ title, bots, statusOf, selectedId, onSelect }: BotSectionProps): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 pb-1 text-xs font-medium text-ink-2">{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {bots.map((bot) => {
          const selected = bot.id === selectedId;
          const status = statusOf(bot.id);
          return (
            <li key={bot.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(bot.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2 aria-[current=true]:bg-surface aria-[current=true]:shadow-[var(--shadow-1)]"
              >
                <Avatar kind={faunaOf(bot)} size="md" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{bot.name}</span>
                  <span className="truncate text-xs text-ink-2">{bot.job}</span>
                  <StatusDot status={status} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
