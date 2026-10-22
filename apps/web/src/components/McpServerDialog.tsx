import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { McpServerName, McpServerUrl, type CreateMcpServerInput, type McpServer, type McpServerTransport, type UpdateMcpServer } from '@brot/protocol';
import { Button, Input, Textarea } from '@brot/ui';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { Close, Plus } from './icons';

export interface McpServerDialogProps {
  open: boolean;
  /** The server to edit. Absent creates one. */
  server?: McpServer;
  onClose: () => void;
  onCreate: (input: CreateMcpServerInput) => Promise<unknown>;
  onUpdate: (serverId: string, patch: UpdateMcpServer) => Promise<unknown>;
}

interface EnvRow {
  key: string;
  value: string;
}

/** Create/edit an MCP server: a local stdio process or a remote http endpoint. */
export function McpServerDialog({ open, server, onClose, onCreate, onUpdate }: McpServerDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      size="md"
      title={t(server ? 'settings.mcpDialogEdit' : 'settings.mcpDialogNew')}
      description={t('settings.mcpDialogDescription')}
      onClose={onClose}
    >
      {open ? <McpServerForm server={server} onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} /> : null}
    </Dialog>
  );
}

function McpServerForm({
  server,
  onClose,
  onCreate,
  onUpdate,
}: Omit<McpServerDialogProps, 'open'>): ReactElement {
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpServerTransport>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [argsText, setArgsText] = useState((server?.args ?? []).join('\n'));
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    Object.entries(server?.env ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [url, setUrl] = useState(server?.url ?? '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const commandId = useId();
  const urlId = useId();

  const trimmedName = name.trim();
  const nameError =
    trimmedName === ''
      ? t('settings.mcpNameRequired')
      : trimmedName === 'brot'
        ? t('settings.mcpNameReserved')
        : McpServerName.safeParse(trimmedName).success
          ? null
          : t('settings.mcpNamePattern');
  const commandError = transport === 'stdio' && command.trim() === '' ? t('settings.mcpCommandRequired') : null;
  const urlError =
    transport === 'http'
      ? url.trim() === ''
        ? t('settings.mcpUrlRequired')
        : McpServerUrl.safeParse(url.trim()).success
          ? null
          : t('settings.mcpUrlInvalid')
      : null;
  const valid = nameError === null && commandError === null && urlError === null;

  const setEnvRow = (index: number, patch: Partial<EnvRow>) =>
    setEnvRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const removeEnvRow = (index: number) => setEnvRows((current) => current.filter((_row, position) => position !== index));
  const addEnvRow = () => setEnvRows((current) => [...current, { key: '', value: '' }]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const args = argsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const env = Object.fromEntries(envRows.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value]));
    try {
      if (server) {
        const patch: UpdateMcpServer = { name: trimmedName, transport, enabled };
        if (transport === 'stdio') {
          patch.command = command.trim();
          patch.args = args;
          patch.env = env;
        } else {
          patch.url = url.trim();
        }
        await onUpdate(server.id, patch);
      } else {
        const input: CreateMcpServerInput = {
          name: trimmedName,
          transport,
          enabled,
          ...(transport === 'stdio' ? { command: command.trim(), args, env } : { url: url.trim() }),
        };
        await onCreate(input);
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
      <Input
        label={t('settings.mcpName')}
        placeholder={t('settings.mcpNamePlaceholder')}
        value={name}
        maxLength={64}
        onChange={(event) => setName(event.target.value)}
        error={tried && nameError !== null ? nameError : undefined}
        autoFocus
      />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">{t('settings.mcpTransport')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['stdio', 'http'] as const).map((option) => (
            <label
              key={option}
              className={
                transport === option
                  ? 'flex cursor-pointer flex-col gap-1 rounded-lg border border-ink bg-surface-2 p-3'
                  : 'flex cursor-pointer flex-col gap-1 rounded-lg border border-line p-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2'
              }
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="mcp-transport" className="room-check" checked={transport === option} onChange={() => setTransport(option)} />
                <span className="text-sm font-medium">{t(option === 'stdio' ? 'settings.mcpTransportStdio' : 'settings.mcpTransportHttp')}</span>
              </span>
              <span className="text-xs text-ink-2">{t(option === 'stdio' ? 'settings.mcpTransportStdioHint' : 'settings.mcpTransportHttpHint')}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {transport === 'stdio' ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={commandId} className="text-sm font-medium">
              {t('settings.mcpCommand')}
            </label>
            <input
              id={commandId}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={t('settings.mcpCommandPlaceholder')}
              spellCheck={false}
              autoComplete="off"
              className="brot-input font-mono"
              aria-invalid={tried && commandError !== null ? true : undefined}
              aria-describedby={tried && commandError !== null ? `${commandId}-error` : undefined}
            />
            {tried && commandError !== null ? (
              <span id={`${commandId}-error`} className="brot-field__hint" data-error="true">
                {commandError}
              </span>
            ) : null}
          </div>
          <Textarea
            label={t('settings.mcpArgs')}
            hint={t('settings.mcpArgsHint')}
            placeholder={t('settings.mcpArgsPlaceholder')}
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            rows={3}
            spellCheck={false}
            className="font-mono"
          />
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="p-0 text-sm font-medium">{t('settings.mcpEnv')}</legend>
            <span className="text-xs text-ink-2">{t('settings.mcpEnvHint')}</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {envRows.map((row, index) => (
                <li key={index} className="flex items-end gap-2">
                  <Input
                    label={`${t('settings.mcpEnvKey')} ${index + 1}`}
                    hideLabel
                    placeholder={t('settings.mcpEnvKey')}
                    value={row.key}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 font-mono"
                    onChange={(event) => setEnvRow(index, { key: event.target.value })}
                  />
                  <Input
                    label={`${t('settings.mcpEnvValue')} ${index + 1}`}
                    hideLabel
                    placeholder="secret://github_token"
                    value={row.value}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-[2] font-mono"
                    onChange={(event) => setEnvRow(index, { value: event.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEnvRow(index)}
                    aria-label={t('settings.mcpEnvRemove', { number: String(index + 1) })}
                    title={t('settings.mcpEnvRemove', { number: String(index + 1) })}
                    className="mb-0.5 flex-none text-ink-3"
                  >
                    <Close size={14} />
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" onClick={addEnvRow} className="self-start text-ink-2">
              <Plus size={14} />
              {t('settings.mcpEnvAdd')}
            </Button>
          </fieldset>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={urlId} className="text-sm font-medium">
            {t('settings.mcpUrl')}
          </label>
          <input
            id={urlId}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t('settings.mcpUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            className="brot-input font-mono"
            aria-invalid={tried && urlError !== null ? true : undefined}
            aria-describedby={tried && urlError !== null ? `${urlId}-error` : undefined}
          />
          {tried && urlError !== null ? (
            <span id={`${urlId}-error`} className="brot-field__hint" data-error="true">
              {urlError}
            </span>
          ) : null}
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2">
        <input type="checkbox" className="room-check mt-1" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span className="flex flex-col">
          <span className="text-sm font-medium">{t('settings.mcpEnabled')}</span>
          <span className="text-xs text-ink-2">{t('settings.mcpEnabledHint')}</span>
        </span>
      </label>

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
          {t(server ? 'settings.mcpSave' : 'settings.mcpCreate')}
        </Button>
      </div>
    </form>
  );
}
