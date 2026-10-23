import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Input, Textarea } from '@brot/ui';
import { t } from '../i18n';
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type SkillDraft } from '../saveSkill';
import { Dialog } from './Dialog';

export interface SaveSkillDialogProps {
  /** Always opened by the button that owns it; the parent mounts it only while open. */
  open: boolean;
  initialDraft: SkillDraft;
  onClose: () => void;
  onSave: (draft: SkillDraft) => Promise<void>;
  /** Starts showing the success line, for SSR previews and tests. */
  initialSaved?: boolean;
  /** Starts showing an error, for SSR previews and tests. */
  initialError?: string;
}

/** Turns the current conversation into a reusable bot skill: editable name, description and Markdown body. */
export function SaveSkillDialog({ open, initialDraft, onClose, onSave, initialSaved = false, initialError }: SaveSkillDialogProps): ReactElement {
  const [name, setName] = useState(initialDraft.name);
  const [description, setDescription] = useState(initialDraft.description);
  const [body, setBody] = useState(initialDraft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(initialSaved);
  const errorId = useId();
  const canSave = name.trim() !== '' && body.trim() !== '' && !busy;
  const labelId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim(), body });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} size="md" title={t('skills.saveTitle')} description={t('skills.saveDescription')} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 px-5 pt-4 pb-5" noValidate>
        <Input label={t('skills.saveName')} value={name} maxLength={SKILL_NAME_MAX} onChange={(event) => setName(event.target.value)} autoFocus />
        <Input
          label={t('skills.saveDescriptionLabel')}
          value={description}
          maxLength={SKILL_DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Textarea
          label={t('skills.saveBody')}
          value={body}
          rows={8}
          maxLength={SKILL_BODY_MAX}
          hint={t('skills.saveBodyHint')}
          onChange={(event) => setBody(event.target.value)}
          className="font-mono text-xs"
        />
        {error !== null ? (
          <p role="alert" id={errorId} className="m-0 text-sm text-attention-text">
            {error}
          </p>
        ) : saved ? (
          <p id={labelId} role="status" className="m-0 text-sm text-ink-2">
            {t('skills.saved')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {t('skills.saveAction')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
