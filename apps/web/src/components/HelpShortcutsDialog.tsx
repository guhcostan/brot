import type { ReactElement } from 'react';
import { Button } from '@brot/ui';
import { t, type TranslationKey } from '../i18n';
import { Dialog } from './Dialog';

export interface HelpShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Clears the persisted onboarding dismissal and reopens Getting started. */
  onShowGettingStarted: () => void;
}

interface ShortcutRow {
  keys: string[];
  title: TranslationKey;
  body: TranslationKey;
}

/** The documented shortcuts and gestures: existing behaviour only, written down in one place. */
const ROWS: readonly ShortcutRow[] = [
  { keys: ['⌘ / Ctrl', 'K'], title: 'help.search', body: 'help.searchBody' },
  { keys: ['Enter'], title: 'help.send', body: 'help.sendBody' },
  { keys: ['Shift', 'Enter'], title: 'help.newline', body: 'help.newlineBody' },
  { keys: ['Esc'], title: 'help.close', body: 'help.closeBody' },
  { keys: ['/help', '/new', '/rename', '/model', '/stop'], title: 'help.commands', body: 'help.commandsBody' },
  { keys: ['Mic'], title: 'help.dictate', body: 'help.dictateBody' },
  { keys: ['Clip', 'Drag'], title: 'help.attach', body: 'help.attachBody' },
  { keys: ['Esc'], title: 'help.mobile', body: 'help.mobileBody' },
];

/** The dialog's body, pure so SSR tests can render it and invoke its buttons. */
export function HelpShortcutsContent({ onShowGettingStarted }: { onShowGettingStarted: () => void }): ReactElement {
  return (
    <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {ROWS.map((row) => (
          <div key={row.title} className="contents">
            <dt className="flex flex-wrap items-center gap-1 sm:justify-end">
              {row.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2"
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="m-0 flex flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{t(row.title)}</span>
              <span className="text-xs text-ink-2">{t(row.body)}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <span className="text-sm font-medium text-ink">{t('help.gettingStarted')}</span>
        <span className="text-xs text-ink-2">{t('help.gettingStartedBody')}</span>
        <Button variant="secondary" size="sm" className="mt-1 self-start" onClick={onShowGettingStarted}>
          {t('help.gettingStarted')}
        </Button>
      </div>
    </div>
  );
}

/** Help and shortcuts: the discoverability sheet behind the sidebar's ? action. */
export function HelpShortcutsDialog({ open, onClose, onShowGettingStarted }: HelpShortcutsDialogProps): ReactElement {
  return (
    <Dialog open={open} size="md" title={t('help.title')} description={t('help.description')} onClose={onClose}>
      {open ? <HelpShortcutsContent onShowGettingStarted={onShowGettingStarted} /> : null}
    </Dialog>
  );
}
