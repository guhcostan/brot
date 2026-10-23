import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { AVATAR_COLOR_NAMES, AVATAR_SPECIES, BotAvatar, Button, Card, EmptyState, Input, Skeleton, Textarea, formatAvatar, parseAvatar, type AvatarColor, type AvatarSpecies } from '@brot/ui';
import type { CreateBotPreset, UpdateBotPreset } from '../data/client';
import type { BotPreset } from '@brot/protocol';
import { t } from '../i18n';
import { useClient } from './client';
import { ConfirmDialog, Dialog } from './Dialog';
import { COLOR_KEY, SPECIES_KEY } from './avatarOptions';
import { Pencil, Plus, Trash } from './icons';

export interface BotPresetsSectionProps {
  /** Presets to render before the client load resolves, e.g. in an SSR render. */
  initialPresets?: BotPreset[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Bot presets: the reusable defaults the create dialog offers. */
export function BotPresetsSection({ initialPresets }: BotPresetsSectionProps): ReactElement {
  const client = useClient();
  const [presets, setPresets] = useState<BotPreset[] | null>(initialPresets ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ preset?: BotPreset } | null>(null);
  const [deleting, setDeleting] = useState<BotPreset | null>(null);

  const load = useCallback(async () => {
    try {
      setPresets(await client.listBotPresets());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setPresets((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: CreateBotPreset) => {
    await client.createBotPreset(input);
    await load();
  };

  const update = async (presetId: string, patch: UpdateBotPreset) => {
    await client.updateBotPreset(presetId, patch);
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium text-ink-2">{t('settings.botPresetsCount', { count: String(presets?.length ?? 0) })}</h3>
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('settings.botPresetNew')}
        </Button>
      </div>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {presets === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} shape="block" height={64} />
          ))}
        </div>
      ) : presets.length === 0 ? (
        <EmptyState title={t('settings.botPresetEmptyTitle')} description={t('settings.botPresetEmptyBody')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {presets.map((preset) => {
            const avatar = parseAvatar(preset.avatar, preset.id);
            return (
              <li key={preset.id}>
                <Card className="flex items-center gap-3 p-3">
                  <BotAvatar shape={avatar.shape} color={avatar.color} mood="idle" size={32} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{preset.name}</span>
                    <span className="line-clamp-1 text-xs text-ink-2">{preset.job}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ preset })}
                    aria-label={t('settings.botPresetEditNamed', { name: preset.name })}
                    title={t('settings.botPresetEditNamed', { name: preset.name })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(preset)}
                    aria-label={t('settings.botPresetDeleteNamed', { name: preset.name })}
                    title={t('settings.botPresetDeleteNamed', { name: preset.name })}
                    className="text-ink-3"
                  >
                    <Trash size={14} />
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={dialog !== null}
        size="md"
        title={t(dialog?.preset ? 'settings.botPresetEditTitle' : 'settings.botPresetNewTitle')}
        onClose={() => setDialog(null)}
      >
        {dialog !== null ? (
          <PresetForm preset={dialog.preset} onClose={() => setDialog(null)} onCreate={create} onUpdate={update} />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={t('settings.botPresetDeleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.botPresetDeleteBody')}
        confirmLabel={t('settings.botPresetDelete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteBotPreset(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function PresetForm({
  preset,
  onClose,
  onCreate,
  onUpdate,
}: {
  preset?: BotPreset | undefined;
  onClose: () => void;
  onCreate: (input: CreateBotPreset) => Promise<unknown>;
  onUpdate: (presetId: string, patch: UpdateBotPreset) => Promise<unknown>;
}): ReactElement {
  const initial = parseAvatar(preset?.avatar, preset?.id ?? 'new-preset');
  const [name, setName] = useState(preset?.name ?? '');
  const [job, setJob] = useState(preset?.job ?? '');
  const [instructions, setInstructions] = useState(preset?.instructions ?? '');
  const [species, setSpecies] = useState<AvatarSpecies>(initial.shape);
  const [color, setColor] = useState<AvatarColor>(initial.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const speciesId = useId();
  const colorId = useId();

  const nameError = name.trim() === '' ? t('settings.botPresetNameRequired') : null;
  const jobError = job.trim() === '' ? t('settings.botPresetJobRequired') : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (nameError !== null || jobError !== null || busy) return;
    setBusy(true);
    setError(null);
    const avatar = formatAvatar({ species, color });
    try {
      if (preset === undefined) await onCreate({ name: name.trim(), job: job.trim(), instructions, avatar });
      else await onUpdate(preset.id, { name: name.trim(), job: job.trim(), instructions, avatar });
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      <Input
        label={t('settings.botPresetName')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={tried && nameError !== null ? nameError : undefined}
        autoFocus
      />
      <Input
        label={t('settings.botPresetJob')}
        value={job}
        onChange={(event) => setJob(event.target.value)}
        error={tried && jobError !== null ? jobError : undefined}
      />
      <Textarea
        label={t('settings.botPresetInstructions')}
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        rows={4}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={speciesId} className="text-sm font-medium">
            {t('settings.botPresetSpecies')}
          </label>
          <select id={speciesId} value={species} onChange={(event) => setSpecies(event.target.value as AvatarSpecies)} className="brot-input">
            {AVATAR_SPECIES.map((option) => (
              <option key={option} value={option}>
                {t(SPECIES_KEY[option])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={colorId} className="text-sm font-medium">
            {t('settings.botPresetColor')}
          </label>
          <select id={colorId} value={color} onChange={(event) => setColor(event.target.value as AvatarColor)} className="brot-input">
            {AVATAR_COLOR_NAMES.map((option) => (
              <option key={option} value={option}>
                {t(COLOR_KEY[option])}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t(preset === undefined ? 'settings.botPresetCreate' : 'settings.botPresetSave')}
        </Button>
      </div>
    </form>
  );
}
