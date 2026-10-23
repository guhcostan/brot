import type { ReactElement } from 'react';
import { Badge, Button, Skeleton } from '@brot/ui';
import { t, type TranslationKey } from '../i18n';
import type { GettingStartedItem, GettingStartedItemId } from '../onboarding';
import { Check } from './icons';

export interface GettingStartedChecklistProps {
  items: GettingStartedItem[];
  onAction: (id: GettingStartedItemId) => void;
  /** Retries the cheap fetches when a row could not be checked. */
  onRetry?: () => void;
}

const ITEM_KEY: Record<GettingStartedItemId, { title: TranslationKey; body: TranslationKey; action: TranslationKey }> = {
  modelKey: {
    title: 'gettingStarted.modelTitle',
    body: 'gettingStarted.modelBody',
    action: 'gettingStarted.addKey',
  },
  hello: {
    title: 'gettingStarted.helloTitle',
    body: 'gettingStarted.helloBody',
    action: 'gettingStarted.sayHello',
  },
  tools: {
    title: 'gettingStarted.toolsTitle',
    body: 'gettingStarted.toolsBody',
    action: 'gettingStarted.giveTools',
  },
  routine: {
    title: 'gettingStarted.routineTitle',
    body: 'gettingStarted.routineBody',
    action: 'gettingStarted.scheduleRoutine',
  },
  phone: {
    title: 'gettingStarted.phoneTitle',
    body: 'gettingStarted.phoneBody',
    action: 'gettingStarted.pairPhone',
  },
};

/** The calm five-row checklist behind the Getting started panel. Pure, so SSR tests can render it directly. */
export function GettingStartedChecklist({ items, onAction, onRetry }: GettingStartedChecklistProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const copy = ITEM_KEY[item.id];
        return (
          <div key={item.id} className="flex items-start gap-3 border-b border-line pb-3 last:border-b-0 last:pb-0">
            <span
              aria-hidden="true"
              className={
                item.done
                  ? 'mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-ink text-[var(--primary-ink)]'
                  : 'mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border border-line text-ink-3'
              }
            >
              {item.done ? <Check size={12} /> : null}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={item.done ? 'text-sm font-medium text-ink-2 line-through decoration-line' : 'text-sm font-medium text-ink'}>
                  {t(copy.title)}
                </span>
                {item.optional ? <Badge>{t('gettingStarted.optional')}</Badge> : null}
                <span className="text-xs text-ink-3">{t(item.done ? 'gettingStarted.done' : 'gettingStarted.pending')}</span>
              </div>
              <span className="text-xs text-ink-2">{t(copy.body)}</span>
              {item.loading ? (
                <span className="mt-1 block" aria-busy="true" aria-label={t('gettingStarted.checking')}>
                  <Skeleton height={16} width={96} />
                </span>
              ) : item.failed ? (
                <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                  {t('gettingStarted.loadFailed')}
                  {onRetry !== undefined ? (
                    <Button variant="ghost" size="sm" onClick={onRetry} className="!min-h-6 !px-1.5 text-xs">
                      {t('gettingStarted.retry')}
                    </Button>
                  ) : null}
                </span>
              ) : item.done ? null : (
                <Button variant="ghost" size="sm" onClick={() => onAction(item.id)} className="mt-1 self-start !px-0 text-xs">
                  {t(copy.action)}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
