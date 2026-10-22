import { useState, type FormEvent, type ReactElement } from 'react';
import { CreateSavedLogin, type CreateSavedLogin as CreateSavedLoginBody, type SavedLogin, type UpdateSavedLogin } from '@brot/protocol';
import { Button, Input } from '@brot/ui';
import { t } from '../i18n';
import { Dialog } from './Dialog';

export interface SavedLoginDialogProps {
  open: boolean;
  /** The login to edit. Absent creates one. */
  login?: SavedLogin;
  onClose: () => void;
  onCreate: (input: CreateSavedLoginBody) => Promise<unknown>;
  onUpdate: (loginId: string, patch: UpdateSavedLogin) => Promise<unknown>;
}

const Name = CreateSavedLogin.shape.name;
const Host = CreateSavedLogin.shape.host;
const Totp = CreateSavedLogin.shape.totp;

/** Create or edit a saved login. Editing keeps the write-only values unless a new one is typed. */
export function SavedLoginDialog({ open, login, onClose, onCreate, onUpdate }: SavedLoginDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      size="md"
      title={t(login ? 'settings.savedLoginDialogEdit' : 'settings.savedLoginDialogNew')}
      description={t('settings.savedLoginDialogDescription')}
      onClose={onClose}
    >
      {open ? <SavedLoginForm login={login} onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} /> : null}
    </Dialog>
  );
}

function SavedLoginForm({ login, onClose, onCreate, onUpdate }: Omit<SavedLoginDialogProps, 'open'>): ReactElement {
  const [name, setName] = useState(login?.name ?? '');
  const [host, setHost] = useState(login?.host ?? '');
  const [label, setLabel] = useState(login?.label ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [clearTotp, setClearTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const isEdit = login !== undefined;

  const trimmedName = name.trim();
  const trimmedHost = host.trim();
  const trimmedTotp = totp.trim();
  const nameError = trimmedName === '' ? t('settings.savedLoginNameRequired') : Name.safeParse(trimmedName).success ? null : t('settings.savedLoginNameInvalid');
  const hostError =
    trimmedHost === ''
      ? t('settings.savedLoginHostRequired')
      : Host.safeParse(trimmedHost).success
        ? null
        : t('settings.savedLoginHostInvalid');
  const usernameError = !isEdit && username === '' ? t('settings.savedLoginUsernameRequired') : null;
  const passwordError = !isEdit && password === '' ? t('settings.savedLoginPasswordRequired') : null;
  const totpError = trimmedTotp !== '' && !Totp.safeParse(trimmedTotp).success ? t('settings.savedLoginTotpInvalid') : null;
  const valid = nameError === null && hostError === null && usernameError === null && passwordError === null && totpError === null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (login === undefined) {
        const input: CreateSavedLoginBody = {
          name: trimmedName,
          host: trimmedHost,
          username,
          password,
          ...(trimmedTotp === '' ? {} : { totp: trimmedTotp }),
          ...(label.trim() === '' ? {} : { label: label.trim() }),
        };
        await onCreate(input);
      } else {
        const patch: UpdateSavedLogin = {};
        if (trimmedName !== login.name) patch.name = trimmedName;
        if (trimmedHost !== login.host) patch.host = trimmedHost;
        const nextLabel = label.trim();
        if (nextLabel !== (login.label ?? '')) patch.label = nextLabel === '' ? null : nextLabel;
        if (username !== '') patch.username = username;
        if (password !== '') patch.password = password;
        if (trimmedTotp !== '') patch.totp = trimmedTotp;
        else if (clearTotp) patch.totp = null;
        await onUpdate(login.id, patch);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      {isEdit ? <p className="m-0 rounded-md border border-line bg-surface-2 p-3 text-xs text-ink-2">{t('settings.savedLoginWriteOnly')}</p> : null}
      <Input
        label={t('settings.savedLoginName')}
        placeholder={t('settings.savedLoginNamePlaceholder')}
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        error={tried && nameError !== null ? nameError : undefined}
        autoFocus
      />
      <Input
        label={t('settings.savedLoginHost')}
        placeholder={t('settings.savedLoginHostPlaceholder')}
        value={host}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        onChange={(event) => setHost(event.target.value)}
        error={tried && hostError !== null ? hostError : undefined}
      />
      <Input
        label={t('settings.savedLoginLabel')}
        placeholder={t('settings.savedLoginLabelPlaceholder')}
        value={label}
        maxLength={80}
        onChange={(event) => setLabel(event.target.value)}
        hint={t('settings.savedLoginLabelHint')}
      />
      <Input
        label={t('settings.savedLoginUsername')}
        placeholder={isEdit ? t('settings.savedLoginLeaveBlank') : t('settings.savedLoginUsernamePlaceholder')}
        value={username}
        maxLength={320}
        autoComplete="off"
        onChange={(event) => setUsername(event.target.value)}
        error={tried && usernameError !== null ? usernameError : undefined}
      />
      <Input
        label={t('settings.savedLoginPassword')}
        placeholder={isEdit ? t('settings.savedLoginLeaveBlank') : t('settings.savedLoginPasswordPlaceholder')}
        value={password}
        type="password"
        maxLength={4096}
        autoComplete="new-password"
        onChange={(event) => setPassword(event.target.value)}
        error={tried && passwordError !== null ? passwordError : undefined}
      />
      <div className="flex flex-col gap-1">
        <Input
          label={t('settings.savedLoginTotp')}
          hint={t('settings.savedLoginTotpHint')}
          placeholder={isEdit ? t('settings.savedLoginLeaveBlank') : t('settings.savedLoginTotpPlaceholder')}
          value={totp}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          onChange={(event) => setTotp(event.target.value)}
          error={tried && totpError !== null ? totpError : undefined}
        />
        {isEdit && login.hasTotp ? (
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              className="room-check"
              checked={clearTotp}
              onChange={(event) => {
                setClearTotp(event.target.checked);
                if (event.target.checked) setTotp('');
              }}
            />
            {t('settings.savedLoginClearTotp')}
          </label>
        ) : null}
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
          {t(isEdit ? 'settings.savedLoginSave' : 'settings.savedLoginCreate')}
        </Button>
      </div>
    </form>
  );
}
