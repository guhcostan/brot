import { useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { parseSkillFile, type Skill } from '@brot/protocol';
import { Button, Textarea } from '@brot/ui';
import { readFileText } from '../download';
import { t } from '../i18n';
import { packageIssueText } from '../teamPackagePreview';

import { Dialog } from './Dialog';
import { FileDoc } from './icons';

export interface SkillImportDialogProps {
  open: boolean;
  botId: string;
  botName: string;
  onClose: () => void;
  onImport: (input: { content: string; botId?: string }) => Promise<Skill>;
  /** Content to preview before a person pastes one, e.g. in an SSR render. */
  initialContent?: string;
}

/** Paste or load a SKILL.md, preview it client-side, then import it for this bot or shared. */
export function SkillImportDialog({ open, botId, botName, onClose, onImport, initialContent }: SkillImportDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      size="md"
      title={t('skills.importTitle')}
      description={t('skills.importDescription')}
      onClose={onClose}
    >
      {open ? (
        <SkillImportForm botId={botId} botName={botName} onClose={onClose} onImport={onImport} initialContent={initialContent} />
      ) : null}
    </Dialog>
  );
}

function SkillImportForm({
  botId,
  botName,
  onClose,
  onImport,
  initialContent,
}: Omit<SkillImportDialogProps, 'open'>): ReactElement {
  const [content, setContent] = useState(initialContent ?? '');
  const [fileName, setFileName] = useState<string | null>(null);
  const [target, setTarget] = useState<'bot' | 'shared'>('bot');
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (content.trim() === '' ? null : parseSkillFile(content)), [content]);
  const targetId = 'skill-import-target';

  const pickFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setFileError(null);
    try {
      setContent(await readFileText(file));
      setFileName(file.name);
    } catch (cause) {
      setFileError(t('skills.importFileError', { message: cause instanceof Error ? cause.message : String(cause) }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview === null || !preview.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImport({ content, ...(target === 'shared' ? {} : { botId }) });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 px-5 pt-4 pb-5" noValidate>
      <Textarea
        label={t('skills.importPaste')}
        placeholder={t('skills.importPastePlaceholder')}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setFileName(null);
          setFileError(null);
        }}
        rows={7}
        spellCheck={false}
        className="font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="hidden"
          onChange={(event) => {
            void pickFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="text-ink-2">
          <FileDoc size={14} />
          {t('skills.importChooseFile')}
        </Button>
        {fileName !== null ? <span className="text-xs text-ink-3">{fileName}</span> : null}
      </div>
      {fileError !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {fileError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
        <h3 className="m-0 text-xs font-semibold text-ink-2">{t('skills.importPreview')}</h3>
        {preview === null ? (
          <p className="m-0 text-sm text-ink-3">{t('skills.importPreviewEmpty')}</p>
        ) : preview.ok ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{preview.skill.name}</span>
            {preview.skill.description !== '' ? <span className="text-xs text-ink-2">{preview.skill.description}</span> : null}
            {preview.skill.body !== '' ? (
              <pre className="m-0 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-ink-3">{preview.skill.body}</pre>
            ) : null}
          </div>
        ) : (
          <div role="alert" className="flex flex-col gap-1 text-sm text-attention-text">
            <span className="font-medium">{t('skills.importPreviewInvalid')}</span>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
              {preview.issues.map((issue, index) => (
                <li key={index}>{packageIssueText(issue)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <label htmlFor={targetId} className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('skills.importTarget')}</span>
        <select id={targetId} value={target} onChange={(event) => setTarget(event.target.value === 'shared' ? 'shared' : 'bot')} className="brot-input">
          <option value="bot">{t('skills.importTargetBot', { name: botName })}</option>
          <option value="shared">{t('skills.importTargetShared')}</option>
        </select>
      </label>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || preview === null || !preview.ok}>
          {t('skills.importAction')}
        </Button>
      </div>
    </form>
  );
}
