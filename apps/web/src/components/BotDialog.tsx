import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { EgressHost, type Bot, type CreateBotInput, type UpdateBot } from '@brot/protocol';
import {
  AVATAR_COLOR_NAMES,
  AVATAR_SPECIES,
  BotAvatar,
  Button,
  Input,
  Skeleton,
  Textarea,
  cx,
  formatAvatar,
  type AvatarColor,
  type AvatarMood,
  type AvatarSpecies,
} from '@brot/ui';
import type { BrowserStatus, Provider } from '../data/client';
import { ROLE_TEMPLATES, type ComputerChoice, type RoleTemplate } from '../data/templates';
import { avatarOf } from '../format';
import { t, type TranslationKey } from '../i18n';
import { ConfirmDialog, Dialog } from './Dialog';
import { Archive, Close, Trash } from './icons';

export interface BotDialogProps {
  open: boolean;
  /** The bot to edit. Absent creates a new bot. */
  bot?: Bot;
  loadProviders: () => Promise<Provider[]>;
  onCreate: (input: CreateBotInput) => Promise<unknown>;
  onUpdate: (botId: string, patch: UpdateBot) => Promise<unknown>;
  onDelete: (botId: string) => Promise<unknown>;
  onOpenSettings: () => void;
  browserStatus: (botId: string) => Promise<BrowserStatus>;
  startBrowserLogin: (botId: string) => Promise<BrowserStatus>;
  closeBrowser: (botId: string) => Promise<void>;
  onClose: () => void;
}

const SPECIES_KEY: Record<AvatarSpecies, TranslationKey> = {
  capivara: 'species.capivara',
  onca: 'species.onca',
  tucano: 'species.tucano',
  arara: 'species.arara',
  tamandua: 'species.tamandua',
  boto: 'species.boto',
  preguica: 'species.preguica',
  mico: 'species.mico',
  lobo: 'species.lobo',
  jabuti: 'species.jabuti',
};

const COLOR_KEY: Record<AvatarColor, TranslationKey> = {
  black: 'color.black',
  teal: 'color.teal',
  violet: 'color.violet',
  blue: 'color.blue',
  orange: 'color.orange',
  amber: 'color.amber',
  pink: 'color.pink',
  brown: 'color.brown',
  gray: 'color.gray',
  white: 'color.white',
};

const COMPUTER_KEYS: Record<ComputerChoice, { title: TranslationKey; hint: TranslationKey }> = {
  none: { title: 'botForm.computer.none', hint: 'botForm.computer.noneHint' },
  sandbox: { title: 'botForm.computer.sandbox', hint: 'botForm.computer.sandboxHint' },
  desktop: { title: 'botForm.computer.desktop', hint: 'botForm.computer.desktopHint' },
  host: { title: 'botForm.computer.host', hint: 'botForm.computer.hostHint' },
};

const BROWSER_STATE_KEYS: Record<BrowserStatus['state'], TranslationKey> = {
  stopped: 'botForm.browserState.stopped',
  running: 'botForm.browserState.running',
  login: 'botForm.browserState.login',
};

const DSH_ENGINE = 'dsh';

interface FormState {
  name: string;
  job: string;
  instructions: string;
  species: AvatarSpecies;
  color: AvatarColor;
  model: string | undefined;
  computer: ComputerChoice;
  /** A browser on the server machine. A sandbox with a desktop already has its own. */
  browser: boolean;
  hosts: string[];
  budget: string;
  pinned: boolean;
}

function computerOf(bot: Pick<Bot, 'computer' | 'desktop'>): ComputerChoice {
  if (bot.computer === 'sandbox') return bot.desktop ? 'desktop' : 'sandbox';
  return bot.computer;
}

function initialState(bot: Bot | undefined): FormState {
  if (!bot) {
    return {
      name: '',
      job: '',
      instructions: '',
      species: 'capivara',
      color: 'violet',
      model: undefined,
      computer: 'sandbox',
      browser: false,
      hosts: [],
      budget: '',
      pinned: false,
    };
  }
  const avatar = avatarOf(bot);
  return {
    name: bot.name,
    job: bot.job,
    instructions: bot.instructions,
    species: avatar.species,
    color: avatar.color,
    model: bot.model,
    computer: computerOf(bot),
    browser: bot.browser === true,
    hosts: bot.egress?.allow ?? [],
    budget: bot.teamBudgetUsd === undefined ? '' : String(bot.teamBudgetUsd),
    pinned: bot.pinned,
  };
}

export function BotDialog(props: BotDialogProps): ReactElement {
  const { open, bot, onClose } = props;
  return (
    <Dialog
      open={open}
      size="md"
      title={bot ? t('botForm.editTitle', { name: bot.name }) : t('botForm.newTitle')}
      description={bot ? t('botForm.editDescription') : t('botForm.newDescription')}
      onClose={onClose}
    >
      {open ? <BotForm key={bot?.id ?? 'new'} {...props} /> : null}
    </Dialog>
  );
}

function BotForm({
  bot,
  loadProviders,
  onCreate,
  onUpdate,
  onDelete,
  onOpenSettings,
  browserStatus,
  startBrowserLogin,
  closeBrowser,
  onClose,
}: BotDialogProps): ReactElement {
  const [form, setForm] = useState<FormState>(() => initialState(bot));
  const [template, setTemplate] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const [browserState, setBrowserState] = useState<BrowserStatus['state'] | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadProviders()
      .then((list) => {
        if (!active) return;
        setProviders(list);
        // A new bot starts on the first configured model, so it can work right away.
        if (!bot) {
          const first = list.find((provider) => provider.configured)?.models[0];
          if (first) setForm((current) => (current.model ? current : { ...current, model: first.id }));
        }
      })
      .catch((cause: unknown) => {
        if (active) setProviderError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [loadProviders, bot]);

  // The browser state is server-side, so read it when the form opens for a bot that already has one.
  const hasHostBrowser = bot?.browser === true && !(bot.computer === 'sandbox' && bot.desktop === true);
  useEffect(() => {
    if (!bot || !hasHostBrowser) return;
    let active = true;
    browserStatus(bot.id)
      .then((status) => {
        if (!active) return;
        setBrowserState(status.state);
        setBrowserError(null);
      })
      .catch((cause: unknown) => {
        if (active) setBrowserError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [bot, hasHostBrowser, browserStatus]);

  const openBrowserLogin = async () => {
    if (!bot) return;
    setBrowserBusy(true);
    setBrowserError(null);
    try {
      const status = await startBrowserLogin(bot.id);
      setBrowserState(status.state);
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBrowserBusy(false);
    }
  };

  const closeHostBrowser = async () => {
    if (!bot) return;
    setBrowserBusy(true);
    setBrowserError(null);
    try {
      await closeBrowser(bot.id);
      setBrowserState('stopped');
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBrowserBusy(false);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const applyTemplate = (entry: RoleTemplate) => {
    const [species, color] = entry.avatar.split(':') as [AvatarSpecies, AvatarColor];
    setTemplate(entry.id);
    setForm((current) => ({
      ...current,
      name: entry.name,
      job: t(entry.job),
      instructions: t(entry.instructions),
      species,
      color,
      computer: entry.computer,
      hosts: [...entry.egress],
      budget: entry.teamBudgetUsd === undefined ? '' : String(entry.teamBudgetUsd),
    }));
  };

  const budget = form.budget.trim() === '' ? undefined : Number(form.budget);
  const budgetOk = budget === undefined || (Number.isFinite(budget) && budget >= 0);
  const valid = form.name.trim().length > 0 && form.job.trim().length > 0 && budgetOk;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const computer = form.computer === 'desktop' ? 'sandbox' : form.computer;
    const desktop = form.computer === 'desktop';
    // A sandbox with a desktop already has its own browser, so the host browser does not apply there.
    const browserAvailable = form.computer !== 'desktop';
    const browser = browserAvailable && form.browser;
    const egress = form.hosts.length > 0 ? { mode: 'allowlist' as const, allow: form.hosts } : { mode: 'deny' as const, allow: [] };
    const avatar = formatAvatar({ species: form.species, color: form.color });
    try {
      if (!bot) {
        await onCreate({
          name: form.name.trim(),
          job: form.job.trim(),
          instructions: form.instructions,
          avatar,
          computer,
          ...(computer === 'sandbox' ? { desktop } : {}),
          ...(computer === 'host' ? { hostAcknowledged: true } : {}),
          browser,
          egress,
          ...(form.model ? { engine: DSH_ENGINE, model: form.model } : {}),
          ...(budget === undefined ? {} : { teamBudgetUsd: budget }),
        });
      } else {
        const patch: UpdateBot = {};
        if (form.name.trim() !== bot.name) patch.name = form.name.trim();
        if (form.job.trim() !== bot.job) patch.job = form.job.trim();
        if (form.instructions !== bot.instructions) patch.instructions = form.instructions;
        if (avatar !== bot.avatar) patch.avatar = avatar;
        if (form.model && form.model !== bot.model) {
          patch.model = form.model;
          if (bot.engine !== DSH_ENGINE) patch.engine = DSH_ENGINE;
        }
        if (form.computer !== computerOf(bot)) {
          patch.computer = computer;
          if (computer === 'sandbox') patch.desktop = desktop;
          if (computer === 'host') patch.hostAcknowledged = true;
        }
        if (browserAvailable && browser !== (bot.browser === true)) {
          patch.browser = browser;
        } else if (!browserAvailable && form.computer !== computerOf(bot) && bot.browser === true) {
          // Moving a host-browser bot to a desktop drops the browser it no longer needs.
          patch.browser = false;
        }
        const before = bot.egress?.allow ?? [];
        if (before.length !== form.hosts.length || before.some((host, index) => host !== form.hosts[index])) patch.egress = egress;
        if (budget !== bot.teamBudgetUsd) patch.teamBudgetUsd = budget ?? null;
        if (form.pinned !== bot.pinned) patch.pinned = form.pinned;
        if (Object.keys(patch).length > 0) await onUpdate(bot.id, patch);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!bot) return;
    setBusy(true);
    setError(null);
    try {
      await onUpdate(bot.id, { archived: !bot.archived });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 px-5 pt-4 pb-5" noValidate>
      {!bot ? <TemplatePicker chosen={template} onPick={applyTemplate} /> : null}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <AvatarPicker species={form.species} color={form.color} name={form.name} onSpecies={(value) => set('species', value)} onColor={(value) => set('color', value)} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Input
            label={t('botForm.name')}
            placeholder={t('botForm.namePlaceholder')}
            value={form.name}
            maxLength={40}
            onChange={(event) => set('name', event.target.value)}
            error={tried && !form.name.trim() ? t('botForm.nameRequired') : undefined}
            autoFocus={Boolean(bot)}
          />
          <Input
            label={t('botForm.job')}
            placeholder={t('botForm.jobPlaceholder')}
            value={form.job}
            maxLength={80}
            onChange={(event) => set('job', event.target.value)}
            error={tried && !form.job.trim() ? t('botForm.jobRequired') : undefined}
          />
        </div>
      </div>

      <Textarea
        label={t('botForm.instructions')}
        hint={t('botForm.instructionsHint')}
        rows={4}
        value={form.instructions}
        onChange={(event) => set('instructions', event.target.value)}
      />

      <ModelPicker
        providers={providers}
        error={providerError}
        model={form.model}
        onPick={(model) => set('model', model)}
        onOpenSettings={() => {
          onClose();
          onOpenSettings();
        }}
      />

      <ComputerPicker value={form.computer} allowHost={bot?.computer === 'host'} onChange={(value) => set('computer', value)} />

      <BrowserPicker
        hasBrowser={bot?.browser === true}
        enabled={form.browser}
        desktop={form.computer === 'desktop'}
        state={browserState}
        error={browserError}
        busy={browserBusy}
        onToggle={(value) => set('browser', value)}
        onLogin={() => void openBrowserLogin()}
        onClose={() => void closeHostBrowser()}
      />

      {form.computer !== 'host' && (form.computer !== 'none' || form.browser) ? (
        <EgressEditor hosts={form.hosts} onChange={(hosts) => set('hosts', hosts)} />
      ) : null}

      <Input
        label={t('botForm.budget')}
        hint={t('botForm.budgetHint')}
        type="number"
        inputMode="decimal"
        min={0}
        step={0.5}
        placeholder={t('botForm.budgetPlaceholder')}
        value={form.budget}
        onChange={(event) => set('budget', event.target.value)}
        error={tried && !budgetOk ? t('botForm.budgetInvalid') : undefined}
      />

      {bot ? (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" className="room-check" checked={form.pinned} onChange={(event) => set('pinned', event.target.checked)} />
          {t('botForm.pinned')}
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {bot ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive()}>
              <Archive size={15} />
              {bot.archived ? t('botForm.unarchive') : t('botForm.archive')}
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirm('delete')}>
              <Trash size={15} />
              {t('botForm.delete')}
            </Button>
          </>
        ) : null}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {bot ? t('botForm.save') : t('botForm.create')}
        </Button>
      </div>

      {bot ? (
        <ConfirmDialog
          open={confirm === 'delete'}
          tone="danger"
          title={t('botForm.deleteTitle', { name: bot.name })}
          description={t('botForm.deleteBody', { name: bot.name })}
          confirmLabel={t('botForm.deleteConfirm')}
          onConfirm={() => onDelete(bot.id)}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </form>
  );
}

function TemplatePicker({ chosen, onPick }: { chosen: string | null; onPick: (template: RoleTemplate) => void }): ReactElement {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-medium">{t('botForm.templates')}</legend>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {ROLE_TEMPLATES.map((entry) => {
          const [species, color] = entry.avatar.split(':') as [AvatarSpecies, AvatarColor];
          const selected = chosen === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(entry)}
              data-avatar-zone
              className={cx(
                'group flex w-[118px] flex-none flex-col items-center gap-2 rounded-lg border px-2 pt-3 pb-2.5 text-center transition-[background-color,border-color,transform] duration-[var(--dur-fast)] hover:bg-surface-2 active:scale-[0.97]',
                selected ? 'border-ink bg-surface-2' : 'border-line bg-surface',
              )}
            >
              <BotAvatar species={species} color={color} size={36} mood={selected ? 'success' : 'idle'} />
              <span className="text-xs leading-tight font-medium text-ink">{t(entry.title)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface AvatarPickerProps {
  species: AvatarSpecies;
  color: AvatarColor;
  name: string;
  onSpecies: (species: AvatarSpecies) => void;
  onColor: (color: AvatarColor) => void;
}

/** A live preview that hops when the look changes, plus the 10 species and 10 colors of DESIGN.md section 2. */
function AvatarPicker({ species, color, name, onSpecies, onColor }: AvatarPickerProps): ReactElement {
  const [mood, setMood] = useState<AvatarMood>('idle');
  const speciesId = useId();
  const colorId = useId();

  useEffect(() => {
    setMood('success');
    const timer = setTimeout(() => setMood('idle'), 900);
    return () => clearTimeout(timer);
  }, [species, color]);

  return (
    <div className="flex flex-col items-center gap-3 sm:w-[212px] sm:flex-none">
      <div data-avatar-zone className="flex size-[104px] items-center justify-center rounded-full bg-surface-2">
        <BotAvatar species={species} color={color} mood={mood} size={76} label={t('botForm.avatarPreview', { name: name || t('botForm.namePlaceholder') })} />
      </div>
      <div role="radiogroup" aria-labelledby={speciesId} className="flex w-full flex-col gap-1.5">
        <span id={speciesId} className="text-xs font-medium text-ink-2">
          {t('botForm.species')}
        </span>
        <div className="grid grid-cols-5 gap-1">
          {AVATAR_SPECIES.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={entry === species}
              aria-label={t(SPECIES_KEY[entry])}
              title={t(SPECIES_KEY[entry])}
              onClick={() => onSpecies(entry)}
              className={cx(
                'flex aspect-square items-center justify-center rounded-md border transition-[background-color,border-color,transform] duration-[var(--dur-fast)] hover:bg-surface-2 active:scale-90',
                entry === species ? 'border-ink bg-surface-2' : 'border-transparent',
              )}
            >
              <BotAvatar species={entry} color={color} size={26} animated={false} />
            </button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-labelledby={colorId} className="flex w-full flex-col gap-1.5">
        <span id={colorId} className="text-xs font-medium text-ink-2">
          {t('botForm.color')}
        </span>
        <div className="grid grid-cols-5 gap-1">
          {AVATAR_COLOR_NAMES.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={entry === color}
              aria-label={t(COLOR_KEY[entry])}
              title={t(COLOR_KEY[entry])}
              onClick={() => onColor(entry)}
              className={cx(
                'flex aspect-square items-center justify-center rounded-full border-2 transition-[border-color,transform] duration-[var(--dur-fast)] active:scale-90',
                entry === color ? 'border-ink' : 'border-transparent hover:border-line',
              )}
            >
              <span className="block size-[22px] rounded-full" style={{ background: `var(--avatar-${entry})`, boxShadow: 'inset 0 0 0 1px var(--line)' }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ModelPickerProps {
  providers: Provider[] | null;
  error: string | null;
  model: string | undefined;
  onPick: (model: string) => void;
  onOpenSettings: () => void;
}

function ModelPicker({ providers, error, model, onPick, onOpenSettings }: ModelPickerProps): ReactElement {
  const known = providers?.some((provider) => provider.models.some((entry) => entry.id === model)) ?? false;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('botForm.model')}</legend>
      {providers === null && !error ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={36} shape="block" />
          <Skeleton height={36} shape="block" />
        </div>
      ) : null}
      {error ? <p className="m-0 text-sm text-ink-2">{t('botForm.modelUnavailable')}</p> : null}
      {model && providers && !known ? <p className="m-0 text-xs text-ink-2">{t('botForm.modelCurrent', { model })}</p> : null}
      {providers ? (
        <div className="flex flex-col overflow-hidden rounded-lg border border-line">
          {providers.map((provider) => (
            <div key={provider.id} className={cx('flex flex-col border-b border-line last:border-b-0', !provider.configured && 'bg-surface-2/50')}>
              <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
                <span className={cx('text-xs font-medium', provider.configured ? 'text-ink-2' : 'text-ink-3')}>{provider.label}</span>
                {provider.configured ? null : (
                  <button type="button" onClick={onOpenSettings} className="rounded-sm text-xs text-ink-2 underline underline-offset-2 hover:text-ink">
                    {t('botForm.addKey')}
                  </button>
                )}
              </div>
              <div className="flex flex-col px-1.5 pb-1.5">
                {provider.models.map((entry) => {
                  const selected = entry.id === model;
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
                        name="bot-model"
                        className="room-check"
                        value={entry.id}
                        checked={selected}
                        disabled={!provider.configured}
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
        </div>
      ) : null}
    </fieldset>
  );
}

function ComputerPicker({ value, allowHost, onChange }: { value: ComputerChoice; allowHost: boolean; onChange: (value: ComputerChoice) => void }): ReactElement {
  const options: ComputerChoice[] = allowHost ? ['none', 'sandbox', 'desktop', 'host'] : ['none', 'sandbox', 'desktop'];
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('botForm.computer')}</legend>
      <div className={cx('grid gap-2', allowHost ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        {options.map((option) => (
          <label
            key={option}
            className={cx(
              'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-[background-color,border-color] duration-[var(--dur-fast)] hover:bg-surface-2',
              value === option ? 'border-ink bg-surface-2' : 'border-line',
            )}
          >
            <span className="flex items-center gap-2">
              <input type="radio" name="bot-computer" className="room-check" checked={value === option} onChange={() => onChange(option)} />
              <span className="text-sm font-medium">{t(COMPUTER_KEYS[option].title)}</span>
            </span>
            <span className="text-xs text-ink-2">{t(COMPUTER_KEYS[option].hint)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface BrowserPickerProps {
  /** The bot already has a host browser, so the server can report its state and open it. */
  hasBrowser: boolean;
  enabled: boolean;
  /** A sandbox with a desktop already has its own browser. */
  desktop: boolean;
  state: BrowserStatus['state'] | null;
  error: string | null;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onLogin: () => void;
  onClose: () => void;
}

/** Opt-in for the bot's browser on the server machine, and its live state once the bot has one. */
function BrowserPicker({ hasBrowser, enabled, desktop, state, error, busy, onToggle, onLogin, onClose }: BrowserPickerProps): ReactElement {
  if (desktop) {
    return (
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">{t('botForm.browser')}</legend>
        <p className="m-0 text-xs text-ink-2">{t('botForm.browserDesktop')}</p>
      </fieldset>
    );
  }

  const live = enabled && hasBrowser;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('botForm.browser')}</legend>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" className="room-check mt-0.5" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('botForm.browserOnHost')}</span>
          <span className="text-xs text-ink-2">{t('botForm.browserHint')}</span>
        </span>
      </label>
      {live ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface-2 p-3">
          {error === null ? (
            <p className="m-0 text-sm" aria-live="polite">
              {state === null ? t('botForm.browserState.checking') : t(BROWSER_STATE_KEYS[state])}
            </p>
          ) : null}
          {state === 'login' && error === null ? <p className="m-0 text-xs text-ink-2">{t('botForm.browserLoginHint')}</p> : null}
          <div className="flex flex-wrap gap-2">
            {state !== 'login' ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onLogin}>
                {t('botForm.browserLogin')}
              </Button>
            ) : null}
            {state === 'running' || state === 'login' ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                {t('botForm.browserClose')}
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="m-0 text-xs text-attention-text">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function EgressEditor({ hosts, onChange }: { hosts: string[]; onChange: (hosts: string[]) => void }): ReactElement {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  const add = () => {
    const entries = draft.split(/[\s,]+/).filter(Boolean);
    if (entries.length === 0) return;
    const next = [...hosts];
    for (const entry of entries) {
      const parsed = EgressHost.safeParse(entry);
      if (!parsed.success) {
        setProblem(t('botForm.egressInvalid', { host: entry }));
        return;
      }
      if (!next.includes(parsed.data)) next.push(parsed.data);
    }
    onChange(next);
    setDraft('');
    setProblem(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && hosts.length > 0) {
      onChange(hosts.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {t('botForm.egress')}
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 focus-within:border-focus">
        {hosts.map((host) => (
          <span key={host} className="inline-flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] items-center gap-1 rounded-full border border-line bg-surface py-0.5 pr-1 pl-2.5 font-mono text-xs">
            {host}
            <button
              type="button"
              onClick={() => onChange(hosts.filter((entry) => entry !== host))}
              aria-label={t('botForm.egressRemove', { host })}
              className="flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Close size={12} />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          aria-describedby={hintId}
          aria-invalid={problem ? true : undefined}
          placeholder={hosts.length === 0 ? t('botForm.egressPlaceholder') : ''}
          className="min-w-[140px] flex-1 border-0 bg-transparent py-1 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-ink-3"
        />
      </div>
      <span id={hintId} className={cx('text-xs', problem ? 'text-attention-text' : 'text-ink-2')} role={problem ? 'alert' : undefined}>
        {problem ?? (hosts.length === 0 ? t('botForm.egressNone') : t('botForm.egressHint'))}
      </span>
    </div>
  );
}
