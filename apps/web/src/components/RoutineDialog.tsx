import { useId, useState, type FormEvent, type ReactElement } from 'react';
import type { Bot, CreateRoutineInput, Routine, RoutineTrigger, UpdateRoutine } from '@brot/protocol';
import { BotAvatar, Button, Input, Textarea } from '@brot/ui';
import { avatarOf } from '../format';
import { t, type TranslationKey } from '../i18n';
import {
  browserTimezone,
  formatClock,
  matchSchedule,
  parseClock,
  presetCron,
  timezoneOptions,
  weekdayName,
  type SchedulePreset,
} from '../schedule';
import { ConfirmDialog, Dialog } from './Dialog';
import { CopyButton } from './CopyButton';
import { webhookHostname, webhookUrl } from '../webhooks';

export interface RoutineDialogProps {
  open: boolean;
  bots: Bot[];
  /** The routine to edit. Absent creates one. */
  routine?: Routine;
  onClose: () => void;
  onCreate: (input: CreateRoutineInput) => Promise<unknown>;
  onUpdate: (routineId: string, patch: UpdateRoutine) => Promise<unknown>;
  /** The webhook receiver port, when the server reported it. */
  webhookPort?: number;
  /** Rotates a webhook routine's secret and resolves with the refreshed routine. */
  onRotateWebhook?: (routineId: string) => Promise<Routine>;
}

const PRESETS: ReadonlyArray<Exclude<SchedulePreset, 'custom'>> = ['every15', 'hourly', 'daily', 'weekdays', 'weekly'];

const PRESET_LABEL: Record<SchedulePreset, TranslationKey> = {
  every15: 'routines.preset.every15',
  hourly: 'routines.preset.hourly',
  daily: 'routines.preset.daily',
  weekdays: 'routines.preset.weekdays',
  weekly: 'routines.preset.weekly',
  custom: 'routines.preset.custom',
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The routine form: what the bot should do, on which schedule, in which timezone. */
export function RoutineDialog({ open, bots, routine, onClose, onCreate, onUpdate, webhookPort, onRotateWebhook }: RoutineDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      size="md"
      title={t(routine ? 'routines.dialog.editTitle' : 'routines.dialog.newTitle')}
      description={t('routines.dialog.description')}
      onClose={onClose}
    >
      {open ? <RoutineForm bots={bots} routine={routine} onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} {...(webhookPort === undefined ? {} : { webhookPort })} {...(onRotateWebhook === undefined ? {} : { onRotateWebhook })} /> : null}
    </Dialog>
  );
}

function RoutineForm({ bots, routine, onClose, onCreate, onUpdate, webhookPort, onRotateWebhook }: Omit<RoutineDialogProps, 'open'>): ReactElement {
  const cronTrigger = routine?.trigger.type === 'cron' ? routine.trigger : undefined;
  const initial = matchSchedule(cronTrigger?.cron ?? '0 9 * * 1-5');
  const choices = bots.filter((bot) => !bot.archived);
  const fixedBot = routine === undefined ? undefined : bots.find((bot) => bot.id === routine.botId);

  const [botId, setBotId] = useState(routine?.botId ?? choices[0]?.id ?? '');
  const [name, setName] = useState(routine?.name ?? '');
  const [instruction, setInstruction] = useState(routine?.instruction ?? '');
  const [preset, setPreset] = useState<SchedulePreset>(initial.preset);
  const [time, setTime] = useState(formatClock(initial.parts.hour, initial.parts.minute));
  const [weekday, setWeekday] = useState(initial.parts.weekday ?? 1);
  const [cron, setCron] = useState(cronTrigger?.cron ?? '0 9 * * 1-5');
  const [timezone, setTimezone] = useState(cronTrigger?.timezone ?? browserTimezone());
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [catchUp, setCatchUp] = useState(routine?.catchUp ?? true);
  const [rememberLastRun, setRememberLastRun] = useState(routine?.rememberLastRun ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [rotatedRoutine, setRotatedRoutine] = useState<Routine | undefined>(undefined);
  const [rotateOpen, setRotateOpen] = useState(false);
  const shownRoutine = rotatedRoutine ?? routine;
  const webhookTrigger = shownRoutine?.trigger.type === 'webhook' ? shownRoutine.trigger : undefined;
  const webhook = webhookTrigger !== undefined;
  const idBase = useId();
  const botFieldId = `${idBase}-bot`;
  const timezoneId = `${idBase}-timezone`;
  const timeId = `${idBase}-time`;
  const dayId = `${idBase}-day`;

  const clock = parseClock(time) ?? { hour: 9, minute: 0 };
  const effectiveCron = preset === 'custom' ? cron.trim() : presetCron(preset, { hour: clock.hour, minute: clock.minute, weekday });
  const nameValid = name.trim().length > 0;
  const instructionValid = instruction.trim().length > 0;
  const botValid = routine !== undefined || botId !== '';
  const valid = nameValid && instructionValid && botValid;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const trigger: RoutineTrigger = {
        type: 'cron',
        cron: effectiveCron,
        ...(timezone.trim() !== '' ? { timezone: timezone.trim() } : {}),
      };
      if (routine) {
        await onUpdate(routine.id, {
          name: name.trim(),
          instruction: instruction.trim(),
          enabled,
          catchUp,
          rememberLastRun,
          ...(webhook ? {} : { trigger }),
        });
      } else {
        await onCreate({ botId, name: name.trim(), instruction: instruction.trim(), trigger, enabled, catchUp, rememberLastRun });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 px-5 pt-4 pb-5" noValidate>
      {routine === undefined ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={botFieldId} className="text-sm font-medium">
            {t('routines.bot')}
          </label>
          <select id={botFieldId} value={botId} onChange={(event) => setBotId(event.target.value)} className="brot-input">
            {choices.length === 0 ? <option value="">{t('routines.noBotsTitle')}</option> : null}
            {choices.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name} · {bot.job}
              </option>
            ))}
          </select>
        </div>
      ) : fixedBot ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('routines.bot')}</span>
          <span className="flex items-center gap-2.5 rounded-md bg-surface-2 px-2 py-1.5">
            <BotAvatar shape={avatarOf(fixedBot).shape} color={avatarOf(fixedBot).color} size={22} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{fixedBot.name}</span>
              <span className="truncate text-xs text-ink-2">{fixedBot.job}</span>
            </span>
          </span>
        </div>
      ) : null}

      <Input
        label={t('routines.name')}
        placeholder={t('routines.namePlaceholder')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={tried && !nameValid ? t('routines.nameRequired') : undefined}
        autoFocus
      />

      <Textarea
        label={t('routines.instruction')}
        hint={t('routines.instructionHint')}
        placeholder={t('routines.instructionPlaceholder')}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        error={tried && !instructionValid ? t('routines.instructionRequired') : undefined}
        rows={3}
      />

      {webhookTrigger !== undefined ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
          <span className="text-sm font-medium">{t('routines.dialog.webhookTitle')}</span>
          <p className="m-0 text-xs text-ink-2">{t('routines.dialog.webhookCredential')}</p>
          {webhookPort === undefined ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">{t('routines.webhookSecret')}</span>
              <code className="truncate font-mono text-xs">{webhookTrigger.secret}</code>
              <p className="m-0 text-xs text-attention-text">{t('routines.webhookPortMissing')}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{webhookUrl(webhookHostname(), webhookPort, webhookTrigger.secret)}</code>
              <CopyButton text={webhookUrl(webhookHostname(), webhookPort, webhookTrigger.secret)} label={t('routines.webhookCopyUrl')} />
            </div>
          )}
          {onRotateWebhook !== undefined && routine !== undefined ? (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setRotateOpen(true)}>
              {t('routines.webhookRotate')}
            </Button>
          ) : null}
          <ConfirmDialog
            open={rotateOpen}
            title={t('routines.webhookRotateTitle')}
            description={t('routines.webhookRotateBody')}
            confirmLabel={t('routines.webhookRotateConfirm')}
            tone="danger"
            onConfirm={async () => {
              if (routine === undefined || onRotateWebhook === undefined) return;
              setRotatedRoutine(await onRotateWebhook(routine.id));
            }}
            onClose={() => setRotateOpen(false)}
          />
        </div>
      ) : (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">{t('routines.schedule')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {[...PRESETS, 'custom' as const].map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 has-checked:border-ink has-checked:bg-surface-2"
              >
                <input
                  type="radio"
                  name={`${idBase}-preset`}
                  value={option}
                  checked={preset === option}
                  onChange={() => setPreset(option)}
                  className="room-check"
                />
                {t(PRESET_LABEL[option])}
              </label>
            ))}
          </div>

          {preset === 'daily' || preset === 'weekdays' || preset === 'weekly' ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={timeId} className="text-sm font-medium">
                  {t('routines.time')}
                </label>
                <input id={timeId} type="time" value={time} onChange={(event) => setTime(event.target.value)} className="brot-input !w-auto" />
              </div>
              {preset === 'weekly' ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={dayId} className="text-sm font-medium">
                    {t('routines.day')}
                  </label>
                  <select id={dayId} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="brot-input !w-auto">
                    {WEEKDAYS.map((day) => (
                      <option key={day} value={day}>
                        {weekdayName(day)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}

          {preset === 'custom' ? (
            <Input
              label={t('routines.cron')}
              hint={t('routines.cronHint')}
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 9 * * 1-5"
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
            />
          ) : null}

          <p className="m-0 text-xs text-ink-2">
            {t('routines.cronEffective', { cron: effectiveCron })}
          </p>
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={timezoneId} className="text-sm font-medium">
          {t('routines.timezone')}
        </label>
        <select id={timezoneId} value={timezone} onChange={(event) => setTimezone(event.target.value)} className="brot-input" disabled={webhook}>
          {timezoneOptions(timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">{t('routines.options')}</legend>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2">
          <input type="checkbox" checked={catchUp} onChange={(event) => setCatchUp(event.target.checked)} className="room-check mt-1" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{t('routines.catchUp')}</span>
            <span className="text-xs text-ink-2">{t('routines.catchUpHint')}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2">
          <input type="checkbox" checked={rememberLastRun} onChange={(event) => setRememberLastRun(event.target.checked)} className="room-check mt-1" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{t('routines.rememberLastRun')}</span>
            <span className="text-xs text-ink-2">{t('routines.rememberLastRunHint')}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="room-check mt-1" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{t('routines.enabled')}</span>
            <span className="text-xs text-ink-2">{t('routines.enabledHint')}</span>
          </span>
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || choices.length === 0}>
          {t(routine ? 'routines.save' : 'routines.create')}
        </Button>
      </div>
    </form>
  );
}
