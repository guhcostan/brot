import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS, type Bot, type ResponderMode } from '@brot/protocol';
import { BotAvatar, Button, Input } from '@brot/ui';
import type { NewRoom } from '../data/client';
import { avatarOf } from '../format';
import { t } from '../i18n';
import { Dialog } from './Dialog';

export interface NewRoomDialogProps {
  open: boolean;
  bots: Bot[];
  onClose: () => void;
  onCreate: (input: NewRoom) => Promise<unknown>;
}

export function NewRoomDialog({ open, bots, onClose, onCreate }: NewRoomDialogProps): ReactElement {
  return (
    <Dialog open={open} title={t('newRoom.title')} description={t('newRoom.description')} onClose={onClose}>
      {open ? <NewRoomForm bots={bots} onClose={onClose} onCreate={onCreate} /> : null}
    </Dialog>
  );
}

function NewRoomForm({ bots, onClose, onCreate }: Omit<NewRoomDialogProps, 'open'>): ReactElement {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [lead, setLead] = useState<string | null>(null);
  const [responder, setResponder] = useState<ResponderMode>('lead');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const leadId = useId();
  const countId = useId();

  const leadBotId = lead && picked.includes(lead) ? lead : picked[0];
  const countOk = picked.length >= MIN_ROOM_BOTS && picked.length <= MAX_ROOM_BOTS;
  const valid = title.trim().length > 0 && countOk && leadBotId !== undefined;
  const active = bots.filter((bot) => !bot.archived);

  const toggle = (botId: string) =>
    setPicked((current) =>
      current.includes(botId)
        ? current.filter((id) => id !== botId)
        : current.length >= MAX_ROOM_BOTS
          ? current
          : [...current, botId],
    );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || !leadBotId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), botIds: picked, leadBotId, responder });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const countText = t('newRoom.count', {
    count: String(picked.length),
    min: String(MIN_ROOM_BOTS),
    max: String(MAX_ROOM_BOTS),
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 px-5 pt-4 pb-5" noValidate>
      <Input
        label={t('newRoom.name')}
        placeholder={t('newRoom.namePlaceholder')}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={tried && title.trim().length === 0 ? t('newRoom.nameRequired') : undefined}
        autoFocus
      />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={countId}>
        <legend className="mb-2 flex w-full items-baseline justify-between p-0 text-sm font-medium">
          <span>{t('newRoom.bots')}</span>
        </legend>
        <span id={countId} className={`-mt-2 text-xs ${tried && !countOk ? 'text-attention-text' : 'text-ink-2'}`}>
          {countText}
        </span>
        <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
          {active.map((bot) => {
            const avatar = avatarOf(bot);
            const checked = picked.includes(bot.id);
            return (
              <li key={bot.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 has-checked:border-line has-checked:bg-surface-2">
                  <input type="checkbox" checked={checked} onChange={() => toggle(bot.id)} className="room-check" />
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
        <label htmlFor={leadId} className="text-sm font-medium">
          {t('newRoom.lead')}
        </label>
        <select
          id={leadId}
          value={leadBotId ?? ''}
          disabled={picked.length === 0}
          onChange={(event) => setLead(event.target.value)}
          className="brot-input"
        >
          {picked.length === 0 ? <option value="">{t('newRoom.leadEmpty')}</option> : null}
          {picked.map((botId) => (
            <option key={botId} value={botId}>
              {bots.find((bot) => bot.id === botId)?.name ?? botId}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">{t('newRoom.responder')}</legend>
        {(['lead', 'mention', 'auto'] as const).map((mode) => (
          <label key={mode} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
            <input
              type="radio"
              name="responder"
              value={mode}
              checked={responder === mode}
              onChange={() => setResponder(mode)}
              className="room-check mt-1"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">
                {t(mode === 'lead' ? 'newRoom.modeLead' : mode === 'mention' ? 'newRoom.modeMention' : 'newRoom.modeAuto')}
              </span>
              <span className="text-xs text-ink-2">
                {t(mode === 'lead' ? 'newRoom.modeLeadHint' : mode === 'mention' ? 'newRoom.modeMentionHint' : 'newRoom.modeAutoHint')}
              </span>
            </span>
          </label>
        ))}
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
        <Button type="submit" variant="primary" disabled={busy}>
          {t('newRoom.create')}
        </Button>
      </div>
    </form>
  );
}
