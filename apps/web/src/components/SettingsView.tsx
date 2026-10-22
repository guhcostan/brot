import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import type { Device, PairingStartResponse } from '@brot/protocol';
import { BotAvatar, Button, Skeleton, cx } from '@brot/ui';
import type { BrowserProfile, Provider } from '../data/client';
import { desktopNotificationState, requestDesktopNotifications, type DesktopNotificationState } from '../desktopNotifications';
import { formatTime } from '../format';
import { t, type Locale, type TranslationKey } from '../i18n';
import { encodeQr, qrPath } from '../qr';
import { THEMES, type Theme } from '../theme';
import { useClient } from './client';
import { Check, Phone, Trash } from './icons';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BrowserProfiles } from './BrowserProfiles';
import { PaneHeader } from './ThreadView';

export interface SettingsViewProps {
  locale: Locale;
  /** Shared browser profiles to render before the client load resolves, e.g. in an SSR render. */
  initialBrowserProfiles?: BrowserProfile[];
  onLocaleChange: (locale: Locale) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenBots: () => void;
}

const THEME_LABEL: Record<Theme, TranslationKey> = {
  system: 'settings.theme.system',
  light: 'settings.theme.light',
  dark: 'settings.theme.dark',
};

export function SettingsView({ locale, onLocaleChange, theme, onThemeChange, onOpenBots, initialBrowserProfiles }: SettingsViewProps): ReactElement {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{t('settings.title')}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{t('settings.subtitle')}</p>
        </div>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-4 py-8 md:px-6">
          <Providers />
          <DesktopNotifications />
          <Section title={t('settings.browserProfiles')} description={t('settings.browserProfilesBody')}>
            <BrowserProfiles initialProfiles={initialBrowserProfiles} />
          </Section>
          <Section title={t('settings.appearance')} description={t('settings.appearanceBody')}>
            <div role="radiogroup" aria-label={t('settings.theme')} className="grid grid-cols-3 gap-2">
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  onClick={() => onThemeChange(option)}
                  className={cx(
                    'flex flex-col items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-[background-color,border-color,transform] duration-[var(--dur-fast)] hover:bg-surface-2 active:scale-[0.98]',
                    theme === option ? 'border-ink bg-surface-2' : 'border-line',
                  )}
                >
                  <ThemeSwatch theme={option} />
                  {t(THEME_LABEL[option])}
                </button>
              ))}
            </div>
            <div className="flex max-w-[280px] flex-col gap-1.5">
              <span className="text-sm font-medium">{t('language.label')}</span>
              <div className="rounded-md border border-line">
                <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
              </div>
            </div>
          </Section>
          <Devices />
        </div>
      </div>
    </section>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="m-0 text-lg font-semibold tracking-[var(--tracking-heading)]">
          {title}
        </h2>
        {description ? <p className="m-0 text-sm text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Sun, moon, or both halves: the theme as a glyph in currentColor. */
function ThemeSwatch({ theme }: { theme: Theme }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {theme === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </>
      ) : theme === 'dark' ? (
        <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" fill="currentColor" />
      ) : (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function Providers(): ReactElement {
  const client = useClient();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client.listProviders().then(
      (list) => {
        setProviders(list);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [client]);

  useEffect(load, [load]);

  return (
    <Section title={t('settings.providers')} description={t('settings.providersBody')}>
      {error ? <p className="m-0 text-sm text-ink-2">{t('settings.providersUnavailable')}</p> : null}
      {providers === null && !error ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={60} shape="block" />
          ))}
        </div>
      ) : null}
      {providers ? (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line p-0">
          {providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} onSaved={load} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

/** A provider and its key. The stored value is never shown: only whether one is set. */
function ProviderRow({ provider, onSaved }: { provider: Provider; onSaved: () => void }): ReactElement {
  const client = useClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputId = useId();

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = value.trim();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.setSecret(provider.secretName, key);
      setValue('');
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-medium">{provider.label}</span>
          <span className="truncate text-xs text-ink-2">{provider.models.map((model) => model.label).join(' · ')}</span>
        </div>
        {saved ? (
          <span className="inline-flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] items-center gap-1 text-xs font-medium text-ink" role="status">
            <Check size={14} />
            {t('settings.keySaved')}
          </span>
        ) : provider.configured ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span className="size-1.5 rounded-full bg-ink" aria-hidden="true" />
            {t('settings.keySet')}
          </span>
        ) : (
          <span className="text-xs text-ink-3">{t('settings.keyMissing')}</span>
        )}
        {editing ? null : (
          <Button variant={provider.configured ? 'ghost' : 'secondary'} size="sm" onClick={() => setEditing(true)}>
            {provider.configured ? t('settings.replaceKey') : t('settings.addKey')}
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] flex-col gap-2">
          <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
            {t('settings.keyLabel', { name: provider.secretName })}
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t('settings.keyPlaceholder')}
              className="brot-input min-w-0 flex-1 font-mono"
              autoFocus
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !value.trim()}>
              {t('settings.saveKey')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setValue('');
                setError(null);
              }}
            >
              {t('dialog.cancel')}
            </Button>
          </div>
          <span className="text-xs text-ink-3">{t('settings.keyHint')}</span>
          {error ? (
            <p role="alert" className="m-0 text-xs text-attention-text">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

function Devices(): ReactElement {
  const client = useClient();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [pairing, setPairing] = useState<PairingStartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    client.listDevices().then(setDevices, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [client]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!pairing) return;
    // A device that pairs shows up in the list; poll while the code is on screen.
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [pairing, load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setPairing(await client.startPairing());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (deviceId: string) => {
    setError(null);
    try {
      await client.removeDevice(deviceId);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Section title={t('settings.devices')} description={t('settings.devicesBody')}>
      {pairing ? <PairingCard pairing={pairing} onDone={() => setPairing(null)} /> : null}
      {devices === null && !error ? <Skeleton height={56} shape="block" /> : null}
      {devices && devices.length > 0 ? (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line p-0">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-b-0">
              <span className="flex size-8 flex-none items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <Phone size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{device.name}</span>
                <span className="truncate text-xs text-ink-2">
                  {t(`settings.role.${device.role}`)}
                  {device.lastSeenAt ? ` · ${t('settings.lastSeen', { time: formatTime(device.lastSeenAt) })}` : ''}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => void remove(device.id)} aria-label={t('settings.removeDevice', { name: device.name })} title={t('settings.removeDevice', { name: device.name })}>
                <Trash size={15} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {devices && devices.length === 0 && !pairing ? <p className="m-0 text-sm text-ink-2">{t('settings.noDevices')}</p> : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      {pairing ? null : (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void start()}>
          <Phone size={16} />
          {t('settings.pair')}
        </Button>
      )}
    </Section>
  );
}

function PairingCard({ pairing, onDone }: { pairing: PairingStartResponse; onDone: () => void }): ReactElement {
  const grid = useMemo(() => {
    try {
      return encodeQr(pairing.qrPayload);
    } catch {
      return null;
    }
  }, [pairing.qrPayload]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000));
  const expired = left === 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const size = grid ? grid.length + 8 : 0;

  return (
    <div className="flex animate-[brot-rise_220ms_var(--ease)_both] flex-col items-center gap-5 rounded-lg border border-line bg-surface p-5 sm:flex-row sm:items-start">
      {grid ? (
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={184}
          height={184}
          role="img"
          aria-label={t('settings.qrLabel')}
          className={cx('flex-none rounded-md transition-opacity duration-[var(--dur-base)]', expired && 'opacity-25')}
          shapeRendering="crispEdges"
        >
          {/* Many phone scanners cannot read inverted codes, so the code stays dark on white in both themes. */}
          <rect width={size} height={size} fill="#FFFFFF" />
          <path d={qrPath(grid)} fill="#0A0A0A" />
        </svg>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <BotAvatar species="capivara" color="black" mood={expired ? 'sleeping' : 'approval'} size={28} />
          <p className="m-0 text-base font-semibold">{t('settings.pairTitle')}</p>
        </div>
        <ol className="m-0 flex flex-col gap-1 pl-5 text-sm text-ink-2">
          <li>{t('settings.pairStep1')}</li>
          <li>{t('settings.pairStep2')}</li>
        </ol>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">{t('settings.pairCode')}</span>
          <span className="font-mono text-2xl font-semibold tracking-[0.2em] tabular-nums">{pairing.code}</span>
        </div>
        <p className="m-0 text-xs text-ink-2" aria-live="polite">
          {expired ? t('settings.pairExpired') : t('settings.pairExpires', { time: clock })}
        </p>
        <Button variant="ghost" size="sm" className="self-start" onClick={onDone}>
          {t('settings.pairDone')}
        </Button>
      </div>
    </div>
  );
}

const DESKTOP_STATE_KEY: Record<DesktopNotificationState, TranslationKey> = {
  unsupported: 'settings.desktopState.unsupported',
  default: 'settings.desktopState.default',
  granted: 'settings.desktopState.granted',
  denied: 'settings.desktopState.denied',
};

/** The browser's desktop notifications: state plus an explicit opt-in. Never prompts on load. */
function DesktopNotifications(): ReactElement {
  const [state, setState] = useState<DesktopNotificationState>(() => desktopNotificationState());
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      setState(await requestDesktopNotifications());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('settings.desktopNotifications')} description={t('settings.desktopNotificationsBody')}>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{t(DESKTOP_STATE_KEY[state])}</span>
          {state === 'denied' ? <span className="text-xs text-ink-2">{t('settings.desktopDeniedHint')}</span> : null}
        </span>
        {state === 'default' ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void enable()}>
            {t('settings.desktopEnable')}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
