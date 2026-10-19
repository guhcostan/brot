import { useMemo, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { BotAvatar, BrandMark, Input, STATUS_MOOD, StatusDot, cx, type BotStatus } from '@brot/ui';
import { avatarOf } from '../format';
import { t, type Locale } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

export interface SidebarProps {
  bots: Bot[];
  statusOf: (botId: string) => BotStatus;
  selectedId: string | null;
  onSelect: (botId: string) => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  className?: string;
}

export function Sidebar({ bots, statusOf, selectedId, onSelect, locale, onLocaleChange, className }: SidebarProps): ReactElement {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter((bot) => bot.name.toLowerCase().includes(needle) || bot.job.toLowerCase().includes(needle));
  }, [bots, query]);

  const pinned = visible.filter((bot) => bot.pinned);
  const others = visible.filter((bot) => !bot.pinned);
  const rowProps = { statusOf, selectedId, onSelect };

  return (
    <nav
      aria-label={t('thread.bots')}
      className={cx('flex min-h-0 flex-col gap-4 bg-surface px-3 pt-4 pb-3 mac-shell:pt-0 md:border-r md:border-line', className)}
    >
      <div className="titlebar flex h-8 items-center gap-2 px-2 mac-shell:-mx-3 mac-shell:h-11 mac-shell:pr-5 mac-shell:pl-20">
        <BrandMark size={22} />
        <span className="text-lg leading-none font-semibold tracking-[var(--tracking-tight)]">{t('app.name')}</span>
      </div>

      <Input
        type="search"
        label={t('sidebar.search')}
        hideLabel
        placeholder={t('sidebar.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        {visible.length === 0 ? <p className="px-2 text-sm text-ink-2">{t('sidebar.empty', { query })}</p> : null}
        {pinned.length > 0 ? <BotSection title={t('sidebar.pinned')} bots={pinned} {...rowProps} /> : null}
        {others.length > 0 ? <BotSection title={t('sidebar.all')} bots={others} {...rowProps} /> : null}
      </div>

      <footer className="-mx-3 flex flex-none border-t border-line px-3 pt-3">
        <LanguageSwitcher locale={locale} onChange={onLocaleChange} className="w-full" />
      </footer>
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
      <h2 className="m-0 px-2 pb-1 text-xs font-medium text-ink-3">{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {bots.map((bot) => {
          const selected = bot.id === selectedId;
          const status = statusOf(bot.id);
          const avatar = avatarOf(bot);
          return (
            <li key={bot.id}>
              <button
                type="button"
                data-avatar-zone
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(bot.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 aria-[current=true]:bg-surface-2"
              >
                <BotAvatar shape={avatar.shape} color={avatar.color} mood={STATUS_MOOD[status]} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium text-ink">{bot.name}</span>
                  {status === 'idle' ? (
                    <span className="truncate text-sm text-ink-2">{bot.job}</span>
                  ) : (
                    <StatusDot status={status} className="text-sm" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
