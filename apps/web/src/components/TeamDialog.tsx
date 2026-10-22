import { useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import type { Bot, UpdateBot, UpdateTeam } from '@brot/protocol';
import { BotAvatar, Button, Input, Textarea } from '@brot/ui';
import type { NewTeam, Team } from '../data/client';
import { avatarOf } from '../format';
import { t } from '../i18n';
import { ConfirmDialog, Dialog } from './Dialog';
import { Trash } from './icons';

export interface TeamDialogProps {
  open: boolean;
  /** The team to edit. Absent creates a new team. */
  team?: Team;
  /** Every bot the dialog can put on the team. Archived bots keep their membership untouched. */
  bots: Bot[];
  onCreate: (input: NewTeam) => Promise<Team>;
  onUpdate: (teamId: string, patch: UpdateTeam) => Promise<unknown>;
  /** Groups one bot in or out of a team. `teamId: null` ungroups it. */
  onUpdateBot: (botId: string, patch: UpdateBot) => Promise<unknown>;
  onDelete: (teamId: string) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Creates and edits a team: its name, the shared brief every member bot gets in its prompt, a chief
 * picked from the members, and the roster itself. Creating a team keeps the dialog open on the new
 * team, so a team with no bots can still be edited or deleted before it ever shows in the sidebar.
 */
export function TeamDialog(props: TeamDialogProps): ReactElement {
  const { open, team, onClose } = props;
  const [created, setCreated] = useState<Team | null>(null);
  useEffect(() => {
    if (!open) setCreated(null);
  }, [open]);
  const editing = team ?? created ?? undefined;
  return (
    <Dialog
      open={open}
      size="md"
      title={editing ? t('teamForm.editTitle', { name: editing.name }) : t('teamForm.newTitle')}
      description={editing ? t('teamForm.editDescription') : t('teamForm.newDescription')}
      onClose={onClose}
    >
      {open ? <TeamForm key={editing?.id ?? 'new'} {...props} team={editing} onCreated={setCreated} /> : null}
    </Dialog>
  );
}

interface TeamFormProps extends TeamDialogProps {
  /** The team just created in this dialog, now shown in edit mode. */
  onCreated: (team: Team) => void;
}

function TeamForm({ team, bots, onCreate, onUpdate, onUpdateBot, onDelete, onClose, onCreated }: TeamFormProps): ReactElement {
  const active = bots.filter((bot) => !bot.archived);
  const [name, setName] = useState(team?.name ?? '');
  const [brief, setBrief] = useState(team?.instructions ?? '');
  const [members, setMembers] = useState<string[]>(() =>
    team === undefined ? [] : active.filter((bot) => bot.teamId === team.id).map((bot) => bot.id),
  );
  const [chief, setChief] = useState<string | null>(team?.chiefBotId ?? null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const chiefFieldId = useId();
  const countId = useId();

  // A chief that is not on the roster is no chief: the picker only offers members.
  const chiefMember = chief !== null && members.includes(chief) ? chief : undefined;
  const picked = active.filter((bot) => members.includes(bot.id));
  const valid = name.trim().length > 0;

  const toggleMember = (botId: string) => {
    setMembers((current) => (current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId]));
    setChief((current) => (current === botId ? null : current));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (team === undefined) {
        const created = await onCreate({
          name: name.trim(),
          instructions: brief,
          ...(chiefMember === undefined ? {} : { chiefBotId: chiefMember }),
        });
        // Join the picked bots before the dialog flips to edit mode, so the roster reads back correctly.
        await Promise.all(members.map((botId) => onUpdateBot(botId, { teamId: created.id })));
        onCreated(created);
      } else {
        const patch: UpdateTeam = {};
        if (name.trim() !== team.name) patch.name = name.trim();
        if (brief !== team.instructions) patch.instructions = brief;
        if ((chiefMember ?? null) !== (team.chiefBotId ?? null)) patch.chiefBotId = chiefMember ?? null;
        if (Object.keys(patch).length > 0) await onUpdate(team.id, patch);
        const before = new Set(active.filter((bot) => bot.teamId === team.id).map((bot) => bot.id));
        const changed = active.filter((bot) => before.has(bot.id) !== members.includes(bot.id));
        await Promise.all(changed.map((bot) => onUpdateBot(bot.id, { teamId: members.includes(bot.id) ? team.id : null })));
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 px-5 pt-4 pb-5" noValidate>
      <Input
        label={t('teamForm.name')}
        placeholder={t('teamForm.namePlaceholder')}
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        error={tried && !valid ? t('teamForm.nameRequired') : undefined}
        autoFocus
      />

      <Textarea
        label={t('teamForm.brief')}
        hint={t('teamForm.briefHint')}
        placeholder={t('teamForm.briefPlaceholder')}
        rows={5}
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
      />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={countId}>
        <legend className="mb-2 flex w-full items-baseline justify-between p-0 text-sm font-medium">{t('teamForm.members')}</legend>
        <span id={countId} className="-mt-2 text-xs text-ink-2">
          {t('teamForm.membersCount', { count: String(members.length) })} · {t('teamForm.membersHint')}
        </span>
        {active.length === 0 ? <p className="m-0 text-sm text-ink-2">{t('teamForm.noBots')}</p> : null}
        <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
          {active.map((bot) => {
            const avatar = avatarOf(bot);
            const checked = members.includes(bot.id);
            return (
              <li key={bot.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 has-checked:border-line has-checked:bg-surface-2">
                  <input type="checkbox" checked={checked} onChange={() => toggleMember(bot.id)} className="room-check" />
                  <BotAvatar shape={avatar.shape} color={avatar.color} size={22} mood={checked ? 'success' : 'idle'} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{bot.name}</span>
                    <span className="truncate text-xs text-ink-2">{bot.job}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={chiefFieldId} className="text-sm font-medium">
          {t('teamForm.chief')}
        </label>
        <select
          id={chiefFieldId}
          value={chiefMember ?? ''}
          disabled={picked.length === 0}
          onChange={(event) => setChief(event.target.value === '' ? null : event.target.value)}
          className="brot-input"
        >
          <option value="">{picked.length === 0 ? t('teamForm.chiefEmpty') : t('teamForm.noChief')}</option>
          {picked.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-2">{t('teamForm.chiefHint')}</span>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {team ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirm('delete')}>
            <Trash size={15} />
            {t('teamForm.delete')}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {team ? t('teamForm.save') : t('teamForm.create')}
        </Button>
      </div>

      {team ? (
        <ConfirmDialog
          open={confirm === 'delete'}
          tone="danger"
          title={t('teamForm.deleteTitle', { name: team.name })}
          description={t('teamForm.deleteBody')}
          confirmLabel={t('teamForm.deleteConfirm')}
          onConfirm={async () => {
            await onDelete(team.id);
            onClose();
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </form>
  );
}
