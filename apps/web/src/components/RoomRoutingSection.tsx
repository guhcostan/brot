import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Badge, Button, Skeleton } from '@brot/ui';
import type { Provider } from '../data/client';
import { t } from '../i18n';
import type { RoomDeciderSettings } from '@brot/protocol';
import { providerSupportsDecider } from '../data/client';
import { useClient } from './client';

export interface RoomRoutingSectionProps {
  /** Providers to render before the client load resolves, e.g. in an SSR render. */
  initialProviders?: Provider[];
  /** Saved decider settings to render before the client load resolves, e.g. in an SSR render. */
  initialSettings?: RoomDeciderSettings;
  /** Starts showing the saved line, for SSR previews and tests. */
  initialSaved?: boolean;
  /** Starts showing an error, for SSR previews and tests. */
  initialError?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Room routing: the model auto rooms ask who should answer, or none to fall back to the lead bot. */
export function RoomRoutingSection({ initialProviders, initialSettings, initialSaved = false, initialError }: RoomRoutingSectionProps): ReactElement {
  const client = useClient();
  const [providers, setProviders] = useState<Provider[] | null>(initialProviders ?? null);
  const [settings, setSettings] = useState<RoomDeciderSettings | null>(initialSettings ?? null);
  const [selected, setSelected] = useState<string | null>(initialSettings?.model ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(initialSaved);

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([client.listProviders(), client.getRoomDeciderSettings()]);
      setProviders(list);
      setSettings(current);
      setSelected(current.model ?? null);
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
      await client.updateRoomDeciderSettings({ model });
      // Refresh both sides: the saved setting, and provider availability after the save.
      await load();
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const supported = (providers ?? []).filter((provider) => providerSupportsDecider(provider));
  const unsupported = (providers ?? []).filter((provider) => !providerSupportsDecider(provider));

  return (
    <div className="flex flex-col gap-3">
      {providers === null || settings === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton height={28} shape="block" />
          <Skeleton height={28} shape="block" />
        </div>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-2">
            {settings.model === undefined ? t('settings.roomRoutingUnset') : t('settings.roomRoutingCurrent', { model: settings.model })}
          </p>
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-medium">{t('settings.roomRoutingModel')}</legend>
            {supported.map((provider) => (
              <div key={provider.id} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-2">{provider.label}</span>
                {provider.models.map((model) => (
                  <label
                    key={model.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2 has-checked:bg-surface-2"
                  >
                    <input
                      type="radio"
                      name="room-decider"
                      value={model.id}
                      checked={selected === model.id}
                      disabled={busy}
                      onChange={() => {
                        setSelected(model.id);
                        setSaved(false);
                      }}
                      className="room-check"
                    />
                    <span className="min-w-0 flex-1 truncate">{model.label}</span>
                    <code className="flex-none font-mono text-xs text-ink-3">{model.id}</code>
                  </label>
                ))}
              </div>
            ))}
            {unsupported.length > 0 ? (
              <div className="flex flex-col gap-1 pt-1">
                {unsupported.map((provider) => (
                  <div key={provider.id} className="flex flex-col gap-0.5 opacity-60">
                    <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-2">
                      {provider.label}
                      <Badge>{t('settings.roomRoutingUnsupported')}</Badge>
                    </span>
                    {provider.models.map((model) => (
                      <label key={model.id} className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">
                        <input type="radio" name="room-decider" value={model.id} disabled className="room-check" />
                        <span className="min-w-0 flex-1 truncate text-ink-3">{model.label}</span>
                        <code className="flex-none font-mono text-xs text-ink-3">{model.id}</code>
                      </label>
                    ))}
                  </div>
                ))}
                <p className="m-0 px-1 text-xs text-ink-2">{t('settings.roomRoutingUnsupportedBody')}</p>
              </div>
            ) : null}
          </fieldset>
          {error !== null ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {error}
            </p>
          ) : saved ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.roomRoutingSaved')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || selected === null} onClick={() => void save(selected)}>
              {t('settings.roomRoutingSave')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || settings.model === undefined} onClick={() => void save(null)}>
              {t('settings.roomRoutingClear')}
            </Button>
          </div>
        </>
      )}
      {error !== null && (providers === null || settings === null) ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
