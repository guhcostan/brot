import { useEffect, useState, type ReactElement } from 'react';
import type { Bot, Thread } from '@brot/protocol';
import { Skeleton, cx } from '@brot/ui';
import type { Provider } from '../data/client';
import { t } from '../i18n';
import { Dialog } from './Dialog';

export interface ThreadModelPickerProps {
  open: boolean;
  bot: Bot;
  thread: Thread;
  onClose: () => void;
  loadProviders: () => Promise<Provider[]>;
  /** Patches the thread's model; null goes back to the bot's model. */
  onPick: (model: string | null) => Promise<unknown>;
}

/** A small dialog that overrides the model of one DM thread, or goes back to the bot's model. */
export function ThreadModelPicker({ open, bot, thread, onClose, loadProviders, onPick }: ThreadModelPickerProps): ReactElement {
  return (
    <Dialog open={open} title={t('thread.modelTitle')} description={t('thread.modelDescription')} onClose={onClose}>
      {open ? <ThreadModelForm bot={bot} thread={thread} onClose={onClose} loadProviders={loadProviders} onPick={onPick} /> : null}
    </Dialog>
  );
}

function ThreadModelForm({
  bot,
  thread,
  onClose,
  loadProviders,
  onPick,
}: Omit<ThreadModelPickerProps, 'open'>): ReactElement {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadProviders()
      .then((list) => {
        if (active) setProviders(list);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [loadProviders]);

  const pick = async (model: string | null) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await onPick(model);
      onClose();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
      <ThreadModelOptions
        providers={providers}
        error={error}
        botModel={bot.model}
        currentModel={thread.model}
        busy={busy}
        onPick={(model) => void pick(model)}
      />
      {actionError !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

export interface ThreadModelOptionsProps {
  providers: Provider[] | null;
  error: string | null;
  botModel: string | undefined;
  /** The thread's override; undefined means the bot's model is in use. */
  currentModel: string | undefined;
  busy: boolean;
  onPick: (model: string | null) => void;
}

/**
 * The radio list inside the picker: the bot's model, then every provider's models grouped by provider,
 * with unconfigured providers dimmed and a reason. Pure, so SSR tests can render it directly.
 */
export function ThreadModelOptions({ providers, error, botModel, currentModel, busy, onPick }: ThreadModelOptionsProps): ReactElement {
  const usingDefault = currentModel === undefined;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('thread.model')}</legend>
      {providers === null && error === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={34} shape="block" />
          <Skeleton height={34} shape="block" />
        </div>
      ) : null}
      {error !== null ? <p className="m-0 text-sm text-ink-2">{t('thread.modelUnavailable')}</p> : null}
      <label className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2', usingDefault && 'bg-surface-2')}>
        <input
          type="radio"
          name="thread-model"
          className="room-check"
          checked={usingDefault}
          disabled={busy}
          onChange={() => onPick(null)}
        />
        <span className="flex flex-col">
          <span className="font-medium">{t('thread.modelUseBot')}</span>
          {botModel !== undefined ? <code className="font-mono text-xs text-ink-3">{botModel}</code> : null}
        </span>
      </label>
      {providers?.map((provider) => (
        <div key={provider.id} className={cx('flex flex-col overflow-hidden rounded-lg border border-line', !provider.configured && 'bg-surface-2/50')}>
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
            <span className={cx('text-xs font-medium', provider.configured ? 'text-ink-2' : 'text-ink-3')}>{provider.label}</span>
            {provider.configured ? null : <span className="text-xs text-ink-3">{t('thread.modelAddKey')}</span>}
          </div>
          <div className="flex flex-col px-1.5 pb-1.5">
            {provider.models.map((entry) => {
              const selected = entry.id === currentModel;
              return (
                <label
                  key={entry.id}
                  className={cx(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-[var(--dur-fast)]',
                    provider.configured ? 'cursor-pointer hover:bg-surface-2' : 'cursor-not-allowed opacity-50',
                    selected && 'bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="thread-model"
                    className="room-check"
                    value={entry.id}
                    checked={selected}
                    disabled={!provider.configured || busy}
                    onChange={() => onPick(entry.id)}
                  />
                  <span className="flex-1 font-medium">{entry.label}</span>
                  <code className="hidden truncate font-mono text-xs text-ink-3 sm:inline">{entry.id}</code>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
