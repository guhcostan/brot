import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button, Input, Skeleton } from '@brot/ui';
import { t } from '../i18n';
import { myChromeEndpointIssue } from '@brot/protocol';
import { MY_CHROME_DEFAULT_ENDPOINT, type MyChromeStatus } from '../data/client';
import { useClient } from './client';

export interface MyChromeSectionProps {
  /** Status to render before the client load resolves, e.g. in an SSR render. */
  initialStatus?: MyChromeStatus;
  /** Starts with this endpoint in the field, e.g. in an SSR render of the warning state. */
  initialEndpoint?: string;
  /** Starts showing the saved line, for SSR previews and tests. */
  initialSaved?: boolean;
  /** Starts showing an error, for SSR previews and tests. */
  initialError?: string;
}

const CHROME_COMMAND = 'google-chrome --remote-debugging-port=9333 --user-data-dir="$HOME/.brot-my-chrome"';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → My Chrome: the loopback CDP endpoint and whether the person's Chrome is reachable. */
export function MyChromeSection({ initialStatus, initialEndpoint, initialSaved = false, initialError }: MyChromeSectionProps): ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<MyChromeStatus | null>(initialStatus ?? null);
  const [endpoint, setEndpoint] = useState(initialEndpoint ?? initialStatus?.settings.endpoint ?? MY_CHROME_DEFAULT_ENDPOINT);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(initialSaved);
  const problem = endpoint.trim() === '' && initialEndpoint === undefined ? undefined : myChromeEndpointIssue(endpoint);

  const load = useCallback(async () => {
    try {
      const current = await client.getMyChrome();
      setStatus(current);
      setEndpoint(current.settings.endpoint);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (busy || problem !== undefined) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const current = await client.updateMyChrome({ endpoint: endpoint.trim() });
      setStatus(current);
      setEndpoint(current.settings.endpoint);
      setSaved(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (testing) return;
    setTesting(true);
    setError(null);
    try {
      const current = await client.getMyChrome();
      setStatus(current);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {status === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton height={34} shape="block" />
          <Skeleton height={28} shape="block" />
        </div>
      ) : (
        <>
          <p className="m-0 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-xs text-ink-2">
            {t('settings.myChromeSafety')}
          </p>
          {status.automation === true ? (
            <p role="alert" className="m-0 rounded-md border border-attention px-2.5 py-2 text-sm text-attention-text">
              {status.hint !== undefined && status.hint !== '' ? status.hint : t('settings.myChromeAutomation')}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <Input
              label={t('settings.myChromeEndpoint')}
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
                setSaved(false);
                setError(null);
              }}
              placeholder={MY_CHROME_DEFAULT_ENDPOINT}
              spellCheck={false}
              className="font-mono"
            />
            <p className="m-0 text-xs text-ink-2">{t('settings.myChromeStart')}</p>
            <code className="w-fit rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2">{CHROME_COMMAND}</code>
            {status.browser !== undefined ? (
              <div className="flex flex-col gap-0.5 pt-1">
                <p className="m-0 text-xs text-ink-2">{t('settings.myChromeBrowser', { version: status.browser.version })}</p>
                <p className="m-0 truncate font-mono text-xs text-ink-3" title={status.browser.userAgent}>
                  {t('settings.myChromeUserAgent', { userAgent: status.browser.userAgent })}
                </p>
              </div>
            ) : null}
          </div>
          {problem !== undefined ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {t('settings.myChromeInvalid')}
            </p>
          ) : status.hint !== undefined && status.hint !== '' && status.automation !== true ? (
            // The server probe's guidance wins: it knows the endpoint's actual state.
            <p role="status" className="m-0 text-sm text-ink-2">
              {status.hint}
            </p>
          ) : status.available ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.myChromeConnected')}
            </p>
          ) : (
            <p role="status" className="m-0 text-sm text-ink-2">
              {status.reason === undefined || status.reason === ''
                ? t('settings.myChromeUnavailable')
                : t('settings.myChromeUnavailableReason', { reason: status.reason })}
            </p>
          )}
          {error !== null ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {error}
            </p>
          ) : saved ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.myChromeSaved')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || problem !== undefined} onClick={() => void save()}>
              {t('settings.myChromeSave')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || testing} onClick={() => void test()}>
              {testing ? t('settings.myChromeTesting') : t('settings.myChromeTest')}
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
