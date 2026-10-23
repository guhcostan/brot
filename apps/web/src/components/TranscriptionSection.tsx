import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Badge, Button, Skeleton } from '@brot/ui';
import type { Provider } from '../data/client';
import { t } from '../i18n';
import { modelSupportsTranscription, type TranscriptionStatus } from '../transcription';
import { useClient } from './client';

export interface TranscriptionSectionProps {
  /** Status to render before the client load resolves, e.g. in an SSR render. */
  initialStatus?: TranscriptionStatus;
  /** Providers to render before the client load resolves, e.g. in an SSR render. */
  initialProviders?: Provider[];
  /** Starts showing the saved line, for SSR previews and tests. */
  initialSaved?: boolean;
  /** Starts showing an error, for SSR previews and tests. */
  initialError?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Transcription: the model that turns audio attachments into text before a run. */
export function TranscriptionSection({ initialStatus, initialProviders, initialSaved = false, initialError }: TranscriptionSectionProps): ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<TranscriptionStatus | null>(initialStatus ?? null);
  const [providers, setProviders] = useState<Provider[] | null>(initialProviders ?? null);
  const [selected, setSelected] = useState<string | null>(initialStatus?.settings.model ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(initialSaved);

  const load = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([client.getTranscriptionStatus(), client.listProviders()]);
      setStatus(current);
      setProviders(list);
      setSelected(current.settings.model ?? null);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (model: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const current = await client.updateTranscriptionSettings({ model });
      setStatus(current);
      setSelected(current.settings.model ?? null);
      await load();
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const hasCapable = (providers ?? []).some((provider) => provider.models.some((model) => modelSupportsTranscription(model)));

  return (
    <div className="flex flex-col gap-3">
      {status === null || providers === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton height={28} shape="block" />
          <Skeleton height={28} shape="block" />
        </div>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-2">
            {status.settings.model === undefined ? t('settings.transcriptionUnset') : t('settings.transcriptionCurrent', { model: status.settings.model })}
          </p>
          {!hasCapable ? (
            <p className="m-0 text-sm text-ink-2">{t('settings.transcriptionNoModels')}</p>
          ) : (
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 p-0 text-sm font-medium">{t('settings.transcriptionModel')}</legend>
              {providers.map((provider) => (
                <div key={provider.id} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-2">{provider.label}</span>
                  {provider.models.map((model) => {
                    const capable = modelSupportsTranscription(model);
                    return (
                      <label
                        key={model.id}
                        className={
                          capable
                            ? 'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2 has-checked:bg-surface-2'
                            : 'flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm opacity-60'
                        }
                      >
                        <input
                          type="radio"
                          name="transcription-model"
                          value={model.id}
                          checked={selected === model.id}
                          disabled={!capable || busy}
                          onChange={() => {
                            setSelected(model.id);
                            setSaved(false);
                          }}
                          className="room-check"
                        />
                        <span className="min-w-0 flex-1 truncate">{model.label}</span>
                        <code className="flex-none font-mono text-xs text-ink-3">{model.id}</code>
                        {capable ? null : <Badge>{t('settings.transcriptionCannot')}</Badge>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </fieldset>
          )}
          <p role="status" className="m-0 text-sm text-ink-2">
            {status.available
              ? t('settings.transcriptionAvailable')
              : status.reason === undefined || status.reason === ''
                ? t('settings.transcriptionUnavailable')
                : t('settings.transcriptionUnavailableReason', { reason: status.reason })}
          </p>
          {error !== null ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {error}
            </p>
          ) : saved ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.transcriptionSaved')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || selected === null} onClick={() => void save(selected)}>
              {t('settings.transcriptionSave')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || status.settings.model === undefined} onClick={() => void save(null)}>
              {t('settings.transcriptionClear')}
            </Button>
          </div>
        </>
      )}
      {status === null && error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
