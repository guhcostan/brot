import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@brot/ui';
import type { CreateSkill, Skill, SkillExport, UpdateSkill } from '../data/client';
import { downloadTextFile } from '../download';
import { t } from '../i18n';
import { Dialog, ConfirmDialog } from './Dialog';
import { Download, Pencil, Plus, Trash } from './icons';
import { SkillImportDialog } from './SkillImportDialog';

export interface SkillsTabProps {
  botId: string;
  botName: string;
  /** undefined while the list loads. */
  skills: Skill[] | undefined;
  error?: string;
  onCreate: (input: CreateSkill) => Promise<unknown>;
  onUpdate: (skillId: string, patch: UpdateSkill) => Promise<unknown>;
  onDelete: (skillId: string) => Promise<unknown>;
  /** Downloads the skill's SKILL.md. */
  onExport: (skillId: string) => Promise<SkillExport>;
  /** Imports a SKILL.md for this bot (default) or shared. */
  onImport: (input: { content: string; botId?: string }) => Promise<Skill>;
}

/**
 * Reusable procedures: the bot's own skills plus the shared ones. A skill's name, description and
 * body are added to the run prompt within a character budget, so the editor says so.
 */
export function SkillsTab({ botId, botName, skills, error, onCreate, onUpdate, onDelete, onExport, onImport }: SkillsTabProps): ReactElement {
  const [dialog, setDialog] = useState<{ skill?: Skill } | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedName, setImportedName] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const exportSkill = async (skill: Skill) => {
    setExporting(skill.id);
    setFileError(null);
    try {
      const file = await onExport(skill.id);
      if (!downloadTextFile(file.filename, file.content, 'text/markdown;charset=utf-8')) setFileError(t('skills.downloadUnavailable'));
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(null);
    }
  };


  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium text-ink-2">{t('skills.count', { count: String(skills?.length ?? 0) })}</h3>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
            {t('skills.import')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
            <Plus size={14} />
            {t('skills.new')}
          </Button>
        </div>
      </div>

      {importedName !== null ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          {t('skills.imported', { name: importedName })}
        </p>
      ) : null}
      {fileError !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {t('skills.exportError', { message: fileError })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {skills === undefined ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton shape="block" height={84} />
          <Skeleton shape="block" height={84} />
        </div>
      ) : skills.length === 0 ? (
        <EmptyState title={t('skills.emptyTitle')} description={t('skills.emptyBody', { name: botName })} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {skills.map((skill) => (
            <li key={skill.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
                  {skill.botId === undefined ? <Badge>{t('skills.shared')}</Badge> : null}
                </div>
                <p className="m-0 line-clamp-2 text-xs text-ink-2">{skill.description}</p>
                <p className="m-0 line-clamp-2 font-mono text-xs whitespace-pre-wrap text-ink-3">{skill.body}</p>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={exporting === skill.id}
                    onClick={() => void exportSkill(skill)}
                    aria-label={t('skills.exportNamed', { name: skill.name })}
                    title={t('skills.exportNamed', { name: skill.name })}
                    className="text-ink-3"
                  >
                    <Download size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ skill })}
                    aria-label={t('skills.editNamed', { name: skill.name })}
                    title={t('skills.editNamed', { name: skill.name })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(skill)}
                    aria-label={t('skills.deleteNamed', { name: skill.name })}
                    title={t('skills.deleteNamed', { name: skill.name })}
                    className="text-ink-3"
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog !== null} size="md" title={t(dialog?.skill ? 'skills.editTitle' : 'skills.newTitle')} onClose={() => setDialog(null)}>
        {dialog !== null ? (
          <SkillForm botId={botId} skill={dialog.skill} onClose={() => setDialog(null)} onCreate={onCreate} onUpdate={onUpdate} />
        ) : null}
      </Dialog>
      <SkillImportDialog
        open={importing}
        botId={botId}
        botName={botName}
        onClose={() => setImporting(false)}
        onImport={async (input) => {
          const created = await onImport(input);
          setImportedName(created.name);
          return created;
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('skills.deleteTitle', { name: deleting?.name ?? '' })}
        description={deleting?.botId === undefined ? t('skills.deleteSharedBody') : t('skills.deleteBody')}
        confirmLabel={t('skills.delete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await onDelete(deleting.id);
            setDeleting(null);
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function SkillForm({
  botId,
  skill,
  onClose,
  onCreate,
  onUpdate,
}: {
  botId: string;
  skill?: Skill | undefined;
  onClose: () => void;
  onCreate: (input: CreateSkill) => Promise<unknown>;
  onUpdate: (skillId: string, patch: UpdateSkill) => Promise<unknown>;
}): ReactElement {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [body, setBody] = useState(skill?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const bodyId = useId();

  const nameValid = name.trim() !== '';
  const descriptionValid = description.trim() !== '';
  const shared = skill !== undefined && skill.botId === undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!nameValid || !descriptionValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (skill) await onUpdate(skill.id, { name: name.trim(), description: description.trim(), body });
      else await onCreate({ botId, name: name.trim(), description: description.trim(), body });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      {shared ? <p className="m-0 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">{t('skills.sharedEditHint')}</p> : null}
      <Input
        label={t('skills.name')}
        placeholder={t('skills.namePlaceholder')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={tried && !nameValid ? t('skills.nameRequired') : undefined}
        autoFocus
      />
      <Input
        label={t('skills.description')}
        hint={t('skills.descriptionHint')}
        placeholder={t('skills.descriptionPlaceholder')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={tried && !descriptionValid ? t('skills.descriptionRequired') : undefined}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={bodyId} className="text-sm font-medium">
          {t('skills.body')}
        </label>
        <textarea
          id={bodyId}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={t('skills.bodyPlaceholder')}
          className="brot-textarea min-h-[220px] font-mono text-sm"
          aria-describedby={`${bodyId}-hint`}
        />
        <span id={`${bodyId}-hint`} className="brot-field__hint">
          {t('skills.promptHint')}
        </span>
      </div>
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
          {t(skill ? 'skills.save' : 'skills.create')}
        </Button>
      </div>
    </form>
  );
}
